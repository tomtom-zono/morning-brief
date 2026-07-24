/**
 * 生成: raw/YYYY-MM-DD.json → content/YYYY-MM-DD.json (仕様 4.2 / 4.4)
 *
 * 品質担保の要は「機械検証 + 自動再生成」(仕様 4.4)。各記事は checkArticle を
 * 通し、error が残る間は最大3回まで再生成する。3回で通らない場合も公開は止めず
 * quality_warning を立てて出力する。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, PATHS, DISCLAIMER, IS_MOCK } from './config.js';
import { todayJst, previousUsSessionDate } from './lib/date.js';
import { complete, parseJsonLoose, emptyUsage, addUsage, type Usage } from './lib/llm.js';
import { ARTICLE_TASK, RECAP_TASK, TRANSLATE_TASK, TRANSLATE_RECAP_TASK, retryHint } from './prompts/system.js';
import { checkArticle } from './validate.js';
import { countBodyChars } from './lib/text.js';
import { Article, type DailyContent } from './schema.js';
import type { RawBundle, RawItem } from './collect.js';
import { loadSources } from './collect.js';
import { mockArticle, mockRecap, mockArticleEn, mockRecapEn } from './lib/mock.js';
import { renderMarketData } from './lib/marketdata.js';

/**
 * 生成全体の時間予算(分)。既定22分。
 *
 * 背景: 記事を直列で生成していたところ、API応答が遅い夜にリトライが重なり
 * 3時間近く走り続ける事象が起きた(2026-07-24 実測)。夏時間の cron は
 * 5:30 開始 → 6:00 公開なので、生成に使えるのは実質22分前後しかない。
 * 予算超過後は、残る記事のリトライを省略して1発生成で進め、英訳もスキップする。
 * 「完璧な記事を7時に出す」より「十分な記事を6時に出す」を優先する(仕様4.4)。
 */
const GEN_BUDGET_MS =
  (Number(process.env.MB_GEN_BUDGET_MIN) > 0
    ? Number(process.env.MB_GEN_BUDGET_MIN)
    : 22) * 60_000;

/** 記事生成の同時実行数。直列(1)だと遅延×リトライで時間が爆発する。 */
const CONCURRENCY = 4;

/** 並列プール。結果の順序は items の順序を保つ。 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

import type { MarketData } from './lib/marketdata.js';

/**
 * テーマ → URLスラッグ。日本語はASCIIが残らないため辞書で対応付ける。
 * 記事URLは仕様4.2の /[date]/[slug] に使われ、ブックマークのidにもなるので、
 * theme-3 のような無意味な値にせず、内容が読み取れる安定した文字列にする。
 */
const THEME_SLUGS: [RegExp, string][] = [
  [/日銀|円金利|JGB/, 'boj-jgb'],
  [/為替|ドル円|ベーシス/, 'fx-usdjpy'],
  [/日本株/, 'japan-equities'],
  [/需給|ポジショニング/, 'flows-positioning'],
  [/米金融政策|米金利/, 'us-rates'],
  [/AI|テック|半導体/, 'ai-semis'],
  [/クレジット|プライベート/, 'credit-private'],
  [/地政学|コモディティ/, 'geopolitics-commodities'],
  [/各国マクロ|中国|欧州/, 'global-macro'],
  [/規制|政策|制度/, 'policy-regulation'],
];

function slugify(theme: string, idx: number): string {
  for (const [re, slug] of THEME_SLUGS) {
    if (re.test(theme)) return slug;
  }
  const ascii = theme
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii.length >= 3 ? ascii.slice(0, 40) : `theme-${idx + 1}`;
}

/** テーマごとに関連度の高い収集記事を束ねる。一次情報を優先的に含める。 */
function bundleForTheme(items: RawItem[], theme: string, limit = 12): RawItem[] {
  const scored = items.map((it) => {
    let score = 0;
    if (it.theme_hint && theme.includes(it.theme_hint.slice(0, 4))) score += 3;
    if (it.theme_hint === theme) score += 5;
    if (it.primary) score += 2;
    if (!it.headline_only) score += 1;
    return { it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.it);
}

/** 可変部の組み立て。固定部の後に置く(キャッシュ設計・仕様4.1)。 */
function renderVariablePart(
  date: string,
  theme: string,
  items: RawItem[],
  manualNotes: { filename: string; body: string }[],
  market: MarketData,
): string {
  const lines: string[] = [];
  lines.push(`【生成日】${date}`);
  lines.push(`【担当テーマ】${theme}`);
  lines.push('');
  lines.push(renderMarketData(market));
  lines.push('');
  lines.push('【収集した情報源】');
  lines.push(
    '各項目は media / title / url / snippet。snippet が "見出しのみ" の媒体は' +
      '本文を取得していないため、内容を推測で補わずリンク誘導に留めること。',
  );
  lines.push(
    '【重要】収集記事にはテーマと無関係なもの(商品紹介・買い物情報・生活記事等)が' +
      '混在することがある。無関係な記事は完全に無視し、言及も引用もしないこと。' +
      '無関係な記事の商品名や見出しを鉤括弧で引用すると引用制約違反で不合格になる。',
  );
  lines.push('');
  for (const [i, it] of items.entries()) {
    lines.push(`--- [${i + 1}] ${it.source_name}${it.primary ? '(一次情報)' : ''}`);
    lines.push(`title: ${it.title}`);
    lines.push(`url: ${it.link}`);
    lines.push(`snippet: ${it.headline_only ? '(見出しのみ) ' : ''}${it.snippet}`);
    lines.push('');
  }
  if (manualNotes.length > 0) {
    lines.push('【今週の週刊誌視点(手動インプット)】');
    lines.push('以下は読者本人の読了メモ。考察(c)に織り込んでよい。');
    for (const n of manualNotes) {
      lines.push(`--- ${n.filename}`);
      lines.push(n.body.slice(0, 4000));
    }
    lines.push('');
  }
  lines.push(
    `上記に基づき、テーマ「${theme}」の記事を1本、指定JSON形式で生成すること。`,
  );
  return lines.join('\n');
}

interface GeneratedArticle {
  theme: string;
  title: string;
  summary: string;
  detail_md: string;
  analysis_md: string;
  sources: { name: string; url: string }[];
}

/**
 * 記事の英語対訳を生成する(読者の英語学習用)。
 *
 * モデルは Flash。翻訳は「変換」であり論点の生成を伴わないため、
 * Pro を使う必要がない(コストは記事全体で月+50〜100円程度)。
 * 失敗しても公開は止めず、日本語のみで出す(6時公開優先・仕様4.4と同方針)。
 */
async function translateArticle(
  a: Article,
): Promise<{ en: NonNullable<Article['en']> | undefined; usage: Usage }> {
  const source = JSON.stringify({
    title: a.title,
    summary: a.summary,
    detail_md: a.detail_md,
    analysis_md: a.analysis_md,
  });

  let usage = emptyUsage();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, usage: u } = await complete(
      'flash',
      TRANSLATE_TASK,
      `Translate the following Japanese article. Source JSON:\n${source}`,
      () => mockArticleEn(a.theme),
    );
    usage = addUsage(usage, u);
    try {
      const en = parseJsonLoose<NonNullable<Article['en']>>(text);
      if (en.title && en.summary && en.detail_md && en.analysis_md) {
        return { en, usage };
      }
    } catch {
      // 2回目で再試行
    }
  }
  console.warn(`  [warn] 英訳に失敗: ${a.id}。日本語のみで公開する。`);
  return { en: undefined, usage };
}

async function translateRecap(
  bodyMd: string,
): Promise<{ en: string | undefined; usage: Usage }> {
  let usage = emptyUsage();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, usage: u } = await complete(
      'flash',
      TRANSLATE_RECAP_TASK,
      `Translate the following Japanese market recap. Source JSON:\n${JSON.stringify({ body_md: bodyMd })}`,
      () => mockRecapEn(),
    );
    usage = addUsage(usage, u);
    try {
      const en = parseJsonLoose<{ body_md: string }>(text);
      if (en.body_md) return { en: en.body_md, usage };
    } catch {
      // 2回目で再試行
    }
  }
  console.warn('  [warn] 米国市場概況の英訳に失敗。日本語のみで公開する。');
  return { en: undefined, usage };
}

async function generateArticle(
  date: string,
  theme: string,
  idx: number,
  items: RawItem[],
  manualNotes: { filename: string; body: string }[],
  market: MarketData,
  deadline: number,
): Promise<{ article: Article; usage: Usage; warnings: string[] }> {
  const variable = renderVariablePart(date, theme, items, manualNotes, market);
  const sourceTexts = items.map((i) => i.snippet).filter((s) => s.length > 0);

  let usage = emptyUsage();
  let lastIssues: string[] = [];
  let best: Article | null = null;

  for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
    // 時間予算超過後はリトライしない(初回生成のみ行い、警告付きで公開)。
    if (attempt > 0 && Date.now() > deadline) {
      lastIssues.push('時間予算超過のためリトライを省略した。');
      console.warn(`  [budget] ${theme}: 予算超過。リトライを省略。`);
      break;
    }
    const suffix = attempt === 0 ? '' : retryHint(lastIssues, attempt);
    const { text, usage: u } = await complete(
      'pro',
      ARTICLE_TASK,
      variable + suffix,
      () => mockArticle(theme, attempt),
    );
    usage = addUsage(usage, u);

    let gen: GeneratedArticle;
    try {
      gen = parseJsonLoose<GeneratedArticle>(text);
    } catch (e) {
      lastIssues = [`出力がJSONとして解釈できなかった: ${String(e).slice(0, 120)}`];
      continue;
    }

    const candidate: Article = {
      id: `${date}-${slugify(gen.theme || theme, idx)}`,
      theme: gen.theme || theme,
      title: gen.title ?? '',
      summary: gen.summary ?? '',
      detail_md: gen.detail_md ?? '',
      analysis_md: gen.analysis_md ?? '',
      sources: Array.isArray(gen.sources) ? gen.sources : [],
    };

    const report = checkArticle(candidate, sourceTexts);
    const errors = report.issues.filter((i) => i.severity === 'error');
    best = candidate;

    if (errors.length === 0) {
      const warns = report.issues.map((i) => i.message);
      return { article: candidate, usage, warnings: warns };
    }

    lastIssues = errors.map((i) => i.message);
    console.warn(
      `  [retry] ${theme}: ${attempt + 1}回目不合格 (${errors.length}件) — ${lastIssues[0]}`,
    );
  }

  // 3回で通らなかった。公開は止めず警告フラグを立てる(仕様4.4)。
  const fallback: Article = {
    ...(best as Article),
    quality_warning: true,
    quality_notes: lastIssues,
  };
  console.warn(`  [WARN] ${theme}: 再生成上限に到達。品質注意フラグ付きで公開。`);
  return { article: fallback, usage, warnings: lastIssues };
}

async function generateRecap(
  date: string,
  items: RawItem[],
  market: MarketData,
): Promise<{ recap: DailyContent['us_market_recap']; usage: Usage }> {
  const usSession = previousUsSessionDate();
  const relevant = items
    .filter((i) => i.theme_hint === '米国市場概況' || i.lang === 'en' || i.theme_hint?.includes('米'))
    .slice(0, 20);
  const pool = relevant.length > 0 ? relevant : items.slice(0, 20);

  const variable = [
    `【対象セッション】${usSession}(前営業日)`,
    `【生成日】${date}`,
    '',
    renderMarketData(market),
    '',
    '【収集した情報源】',
    ...pool.flatMap((it) => [
      `--- ${it.source_name}`,
      `title: ${it.title}`,
      `url: ${it.link}`,
      `snippet: ${it.headline_only ? '(見出しのみ) ' : ''}${it.snippet}`,
      '',
    ]),
    '上記に基づき、前日の米国市場概況を指定JSON形式で生成すること。',
  ].join('\n');

  // 概況も字数を機械検証し、不足なら再生成する(記事と同じ方針・仕様4.4)。
  let usage = emptyUsage();
  let last: { body_md: string; sources?: { name: string; url: string }[] } | null = null;
  let issues: string[] = [];

  for (let attempt = 0; attempt <= LIMITS.maxRetries; attempt++) {
    const suffix = attempt === 0 ? '' : retryHint(issues, attempt);
    const { text, usage: u } = await complete(
      'pro',
      RECAP_TASK,
      variable + suffix,
      () => mockRecap(),
    );
    usage = addUsage(usage, u);

    try {
      last = parseJsonLoose<{ body_md: string; sources?: { name: string; url: string }[] }>(text);
    } catch (e) {
      issues = [`出力がJSONとして解釈できなかった: ${String(e).slice(0, 120)}`];
      continue;
    }

    const n = countBodyChars(last.body_md ?? '');
    if (n >= LIMITS.recapMinChars) break;

    issues = [
      `本文が${n}字。下限${LIMITS.recapMinChars}字に不足。` +
        `論点を追加して密度を上げること(同内容の言い換えでの水増しは不可)。`,
    ];
    console.warn(`  [retry] 米国市場概況: ${attempt + 1}回目不合格 (${n}字)`);
  }

  return {
    recap: { body_md: last?.body_md ?? '', sources: last?.sources ?? [] },
    usage,
  };
}

export async function generate(date = todayJst()): Promise<DailyContent> {
  const rawPath = join(PATHS.raw, `${date}.json`);
  if (!existsSync(rawPath)) {
    throw new Error(`raw が無い: ${rawPath}。先に collect を実行すること。`);
  }
  const raw = JSON.parse(readFileSync(rawPath, 'utf-8')) as RawBundle;

  // MB_ARTICLE_LIMIT で本数を絞れる。実APIの試走でコストを確認する用途
  // (npm run try -- --articles 2)。未指定なら仕様どおり10本。
  const limitEnv = Number(process.env.MB_ARTICLE_LIMIT);
  const limit =
    Number.isFinite(limitEnv) && limitEnv > 0
      ? Math.min(limitEnv, LIMITS.articleCount)
      : LIMITS.articleCount;
  const themes = loadSources().themes.slice(0, limit);
  if (limit !== LIMITS.articleCount) {
    console.warn(
      `[generate] 記事数を ${limit} 本に制限中(MB_ARTICLE_LIMIT)。` +
        `仕様は${LIMITS.articleCount}本のため検証は article_count で失敗します。`,
    );
  }

  let usage = emptyUsage();

  console.log(`[generate] ${date}: 米国市場概況を生成中…`);
  const { recap, usage: ru } = await generateRecap(date, raw.items, raw.market);
  usage = addUsage(usage, ru);
  {
    const { en, usage: tu } = await translateRecap(recap.body_md);
    usage = addUsage(usage, tu);
    if (en) recap.body_md_en = en;
  }

  const deadline = Date.now() + GEN_BUDGET_MS;
  const t0 = Date.now();
  const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;

  const genOne = async (theme: string, idx: number): Promise<Article> => {
    console.log(`[generate] (${idx + 1}/${themes.length}) ${theme} 開始 [${elapsed()}]`);
    const items = bundleForTheme(raw.items, theme);
    const { article, usage: au } = await generateArticle(
      date,
      theme,
      idx,
      items,
      raw.manual_notes,
      raw.market,
      deadline,
    );
    usage = addUsage(usage, au);
    console.log(`[generate] (${idx + 1}/${themes.length}) ${theme} 完了 [${elapsed()}]`);
    return article;
  };

  // 1本目を先行実行して固定プロンプトのキャッシュを作り(4.1のコスト設計)、
  // 残りを並列化する。直列だとAPI遅延×リトライで時間が爆発するため。
  const articles: Article[] = [];
  if (themes.length > 0) {
    articles.push(await genOne(themes[0]!, 0));
    const rest = await mapPool(themes.slice(1), CONCURRENCY, (theme, i) =>
      genOne(theme, i + 1),
    );
    articles.push(...rest);
  }

  // 英語対訳(学習用)。検証合格後の本文を Flash で並列翻訳する。
  // 品質注意フラグ付きの記事は本文が確定と言えないため翻訳しない。
  // 時間予算超過時はスキップし、日本語のみで公開する(6時公開優先)。
  if (Date.now() <= deadline) {
    const targets = articles.filter((a) => !a.quality_warning);
    console.log(`[generate] 英訳 ${targets.length}本を並列実行 [${elapsed()}]`);
    await mapPool(targets, CONCURRENCY, async (a) => {
      const { en, usage: tu } = await translateArticle(a);
      usage = addUsage(usage, tu);
      if (en) a.en = en;
    });
  } else {
    console.warn(`[generate] 時間予算超過のため英訳をスキップ [${elapsed()}]`);
  }

  const content: DailyContent = {
    date,
    generated_at: new Date().toISOString(),
    us_market_recap: recap,
    articles,
    usage,
    disclaimer: DISCLAIMER,
  };

  mkdirSync(PATHS.content, { recursive: true });
  writeFileSync(join(PATHS.content, `${date}.json`), JSON.stringify(content, null, 2));
  return content;
}

/** トークン・コストのログ出力(仕様 4.8)。 */
export function printUsage(u: Usage): void {
  const jpy = u.estimated_cost_usd * 157; // 概算表示用の参考レート
  const hitRate =
    u.input_tokens > 0 ? ((u.cached_input_tokens / u.input_tokens) * 100).toFixed(1) : '0.0';
  console.log('----- トークン使用量 / 概算コスト -----');
  console.log(`  入力 : ${u.input_tokens.toLocaleString()} tok (うちキャッシュヒット ${u.cached_input_tokens.toLocaleString()} / ${hitRate}%)`);
  console.log(`  出力 : ${u.output_tokens.toLocaleString()} tok`);
  console.log(`  概算 : $${u.estimated_cost_usd.toFixed(4)} (約 ${jpy.toFixed(1)} 円) /日`);
  console.log(`  月額換算: 約 ${(jpy * 30).toFixed(0)} 円`);
  console.log('--------------------------------------');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? todayJst();
  const c = await generate(date);
  if (c.usage) printUsage(c.usage);
  console.log(`[generate] 完了: ${PATHS.content}/${date}.json (${c.articles.length}本)`);
  if (IS_MOCK) console.log('[generate] ※ MB_MOCK=1 のためAPI未使用');
}
