/**
 * 収集: RSS・一次情報 → raw/YYYY-MM-DD.json (仕様 3.1 / 4.2)
 *
 * 制約(仕様 2.4): ペイウォール回避・ログイン突破・robots.txt 無視は実装しない。
 * 取得するのは各媒体が公開しているフィードのみ。use: headline の媒体は
 * 見出しとスニペットのみ保持し、本文取得は行わない。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import Parser from 'rss-parser';
import { PATHS, IS_MOCK } from './config.js';
import { collectMarketData, type MarketData } from './lib/marketdata.js';
import { todayJst } from './lib/date.js';

export interface RawItem {
  feed_id: string;
  source_name: string;
  title: string;
  link: string;
  published?: string;
  /** use:headline の場合は短いスニペットのみ。 */
  snippet: string;
  lang: string;
  theme_hint?: string;
  primary: boolean;
  headline_only: boolean;
}

export interface ManualNote {
  filename: string;
  body: string;
}

export interface RawBundle {
  date: string;
  collected_at: string;
  items: RawItem[];
  /** 指数・金利・為替の実測値(仕様2.1)。RSSからは取れないため別途取得する。 */
  market: MarketData;
  manual_notes: ManualNote[];
  errors: { feed_id: string; message: string }[];
}

interface FeedConf {
  id: string;
  name: string;
  url: string;
  theme_hint?: string;
  use: 'full' | 'headline';
  lang: string;
  primary?: boolean;
}

interface SourcesConf {
  defaults: {
    timeout_ms: number;
    max_items_per_feed: number;
    user_agent: string;
  };
  feeds: FeedConf[];
  themes: string[];
}

export function loadSources(path = PATHS.sources): SourcesConf {
  const conf = YAML.parse(readFileSync(path, 'utf-8')) as SourcesConf;

  // 本ファイルはユーザーが編集する前提(仕様3.1)。壊れた編集は静かに通さず
  // ここで落とす。特に「日本株: 個別…」のようにコロンを含むテーマは
  // クォートしないとYAMLがマップとして解釈するため、型を明示的に検査する。
  if (!Array.isArray(conf?.feeds) || conf.feeds.length === 0) {
    throw new Error(`${path}: feeds が空、または配列でない。`);
  }
  for (const [i, f] of conf.feeds.entries()) {
    for (const k of ['id', 'name', 'url', 'use', 'lang'] as const) {
      if (typeof f?.[k] !== 'string') {
        throw new Error(`${path}: feeds[${i}].${k} が文字列でない。`);
      }
    }
    if (f.use !== 'full' && f.use !== 'headline') {
      throw new Error(`${path}: feeds[${i}].use は full か headline のみ。`);
    }
  }
  if (!Array.isArray(conf?.themes)) {
    throw new Error(`${path}: themes が配列でない。`);
  }
  for (const [i, t] of conf.themes.entries()) {
    if (typeof t !== 'string') {
      throw new Error(
        `${path}: themes[${i}] が文字列でない (${JSON.stringify(t)})。` +
          `コロンを含むテーマ名は "日本株: 個別・セクター・決算" のように引用符で囲むこと。`,
      );
    }
  }
  return conf;
}

function clean(s: string | undefined, maxChars: number): string {
  if (!s) return '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** 週刊誌スロット(仕様 3.2)。ファイルが無い日は無視。 */
export function loadManualNotes(dir = PATHS.manualInput): ManualNote[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    // README.md は使い方の説明であり週刊誌メモではない。実メモとして
    // 読み込むと説明用の例文が考察に混入する。
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .map((f) => ({ filename: f, body: readFileSync(join(dir, f), 'utf-8') }))
    .filter((n) => n.body.trim().length > 0);
}

/**
 * rss-parser の timeout オプションは環境によっては発火しない(プロキシが
 * 接続を保持し続ける場合など)。6時公開に間に合わせるには収集段階で
 * 確実に打ち切る必要があるため、外側から強制的に時間を区切る。
 */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout ${ms}ms: ${label}`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function fetchFeed(
  parser: Parser,
  feed: FeedConf,
  maxItems: number,
  timeoutMs: number,
): Promise<RawItem[]> {
  const parsed = await withDeadline(parser.parseURL(feed.url), timeoutMs, feed.id);
  const headlineOnly = feed.use === 'headline';
  // headline 媒体はスニペットを短く切り、本文相当を保持しない(仕様 3.1)
  const snippetCap = headlineOnly ? 200 : 1200;

  return (parsed.items ?? []).slice(0, maxItems).map((it) => ({
    feed_id: feed.id,
    source_name: feed.name,
    title: clean(it.title, 300),
    link: it.link ?? '',
    published: it.isoDate ?? it.pubDate,
    snippet: clean(it.contentSnippet ?? it.content ?? it.summary, snippetCap),
    lang: feed.lang,
    theme_hint: feed.theme_hint,
    primary: feed.primary === true,
    headline_only: headlineOnly,
  }));
}

/** モック用の決定的なダミー収集結果(APIキー不要のデモ・CI向け)。 */
function mockItems(conf: SourcesConf): RawItem[] {
  const out: RawItem[] = [];
  for (const [i, f] of conf.feeds.entries()) {
    for (let k = 0; k < 3; k++) {
      out.push({
        feed_id: f.id,
        source_name: f.name,
        title: `[MOCK] ${f.theme_hint ?? '市場'}に関する記事 ${i + 1}-${k + 1}`,
        link: `https://example.com/${f.id}/${i + 1}-${k + 1}`,
        published: new Date().toISOString(),
        snippet:
          f.use === 'headline'
            ? '[MOCK] 見出しスニペットのみ。'
            : '[MOCK] 市場動向に関するダミー要約テキスト。数値は含めない。',
        lang: f.lang,
        theme_hint: f.theme_hint,
        primary: f.primary === true,
        headline_only: f.use === 'headline',
      });
    }
  }
  return out;
}

export async function collect(date = todayJst()): Promise<RawBundle> {
  const conf = loadSources();
  const errors: RawBundle['errors'] = [];
  let items: RawItem[] = [];

  if (IS_MOCK) {
    items = mockItems(conf);
  } else {
    const parser = new Parser({
      timeout: conf.defaults.timeout_ms,
      headers: { 'User-Agent': conf.defaults.user_agent },
    });
    // フィード単位で独立。1本落ちても全体は止めない(6時公開優先・仕様4.4)。
    const results = await Promise.allSettled(
      conf.feeds.map((f) =>
        fetchFeed(parser, f, conf.defaults.max_items_per_feed, conf.defaults.timeout_ms),
      ),
    );
    for (const [i, r] of results.entries()) {
      const feed = conf.feeds[i]!;
      if (r.status === 'fulfilled') {
        items.push(...r.value);
      } else {
        errors.push({ feed_id: feed.id, message: String(r.reason).slice(0, 300) });
      }
    }
  }

  // 市況データ。失敗しても収集全体は止めない。
  let market: MarketData = { quotes: [], usYields: null, errors: [] };
  if (!IS_MOCK) {
    try {
      market = await collectMarketData();
    } catch (e) {
      market.errors.push(String(e).slice(0, 200));
    }
  }

  const bundle: RawBundle = {
    date,
    collected_at: new Date().toISOString(),
    items,
    market,
    manual_notes: loadManualNotes(),
    errors,
  };

  mkdirSync(PATHS.raw, { recursive: true });
  writeFileSync(join(PATHS.raw, `${date}.json`), JSON.stringify(bundle, null, 2));
  return bundle;
}

// CLI 実行時
if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await collect();
  console.log(
    `[collect] ${b.date}: ${b.items.length}件 / 週刊誌メモ ${b.manual_notes.length}件 / 失敗 ${b.errors.length}フィード`,
  );
  console.log(
    `[collect] 市況: ${b.market.quotes.length}系列 / 米金利 ${b.market.usYields ? b.market.usYields.points.length + '年限' : '取得失敗'}`,
  );
  for (const e of b.errors) console.warn(`  ! ${e.feed_id}: ${e.message}`);
  for (const e of b.market.errors) console.warn(`  ! 市況: ${e}`);
  // rss-parser は失敗時にソケットハンドルを残すことがあり、そのままだと
  // イベントループが解放されずプロセスが終了しない(Actions がジョブ上限まで
  // ハングする)。成果物は書き出し済みなので明示的に終了する。
  process.exit(0);
}
