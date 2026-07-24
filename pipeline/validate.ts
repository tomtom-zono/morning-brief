/**
 * 検証(仕様 4.4)。
 *
 * 方針: 検証失敗が残っても公開は止めない。該当記事に quality_warning を立てて
 * 公開し、警告をログに出す(6時公開を最優先・仕様4.4)。
 * 「不足時は該当記事のみ再生成、最大3リトライ」は generate.ts 側が本モジュールの
 * checkArticle を呼んで実施する。
 */

import { readFileSync } from 'node:fs';
import { LIMITS } from './config.js';
import { DailyContent, Article, expectedArticleCount } from './schema.js';
import { countChars, countBodyChars, fmtChars } from './lib/text.js';
import { checkQuotes } from './lib/quotes.js';

export interface Issue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
}

export interface ArticleReport {
  id: string;
  issues: Issue[];
  metrics: { summary: number; detail: number; analysis: number };
}

/** 記事1本の検証。sourceTexts を渡すと原文転載チェックも行う。 */
export function checkArticle(a: Article, sourceTexts: string[] = []): ArticleReport {
  const issues: Issue[] = [];

  const summary = countChars(a.summary);
  const detail = countBodyChars(a.detail_md);
  const analysis = countBodyChars(a.analysis_md);

  // --- 文字数(仕様 2.2 / 4.4) ---
  if (summary > LIMITS.summaryMaxChars) {
    issues.push({
      severity: 'error',
      code: 'summary_too_long',
      message: `要約が${fmtChars(summary)}。上限${LIMITS.summaryMaxChars}字。`,
    });
  }
  if (analysis < LIMITS.analysisMinChars) {
    issues.push({
      severity: 'error',
      code: 'analysis_too_short',
      message: `拡張考察が${fmtChars(analysis)}。下限${LIMITS.analysisMinChars}字。`,
    });
  }
  if (detail < LIMITS.detailMinChars) {
    // 実データ試走で②が薄くなる事象が出たため error に格上げし、
    // 再生成を発火させる。目安下限を割る記事は読み物として成立しない。
    issues.push({
      severity: 'error',
      code: 'detail_too_short',
      message: `内容詳細が${fmtChars(detail)}。下限${LIMITS.detailMinChars}字。`,
    });
  } else if (detail > LIMITS.detailMaxChars) {
    issues.push({
      severity: 'warn',
      code: 'detail_too_long',
      message: `内容詳細が${fmtChars(detail)}。目安上限${LIMITS.detailMaxChars}字。`,
    });
  }

  // --- 出典(仕様 2.2) ---
  if (a.sources.length === 0) {
    issues.push({ severity: 'error', code: 'no_sources', message: '出典が無い。' });
  }
  for (const s of a.sources) {
    try {
      const u = new URL(s.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    } catch {
      issues.push({
        severity: 'error',
        code: 'bad_source_url',
        message: `出典URLが不正: ${s.url}`,
      });
    }
  }
  // 本文中に原文リンクが表示されていること(仕様2.2「出典名+原文リンクを必須表示」)
  const linked = a.sources.some((s) => a.detail_md.includes(s.url));
  if (!linked) {
    issues.push({
      severity: 'error',
      code: 'source_link_missing',
      message: '内容詳細の本文に原文リンクが含まれていない。',
    });
  }

  // --- 引用・転載(仕様 2.2 / 4.4) ---
  for (const f of checkQuotes(a.detail_md, a.sources.length, sourceTexts)) {
    issues.push({
      severity: 'error',
      code: f.kind,
      message: `${f.detail} 該当: 「${f.excerpt}…」`,
    });
  }

  return { id: a.id, issues, metrics: { summary, detail, analysis } };
}

export interface ValidationReport {
  ok: boolean;
  articleReports: ArticleReport[];
  globalIssues: Issue[];
}

export function validateDaily(
  content: DailyContent,
  sourceTextsById: Record<string, string[]> = {},
): ValidationReport {
  const globalIssues: Issue[] = [];

  // スキーマ検証
  const parsed = DailyContent.safeParse(content);
  if (!parsed.success) {
    for (const e of parsed.error.issues) {
      globalIssues.push({
        severity: 'error',
        code: 'schema',
        message: `${e.path.join('.')}: ${e.message}`,
      });
    }
  }

  // 記事数=10(仕様 4.4)
  if (content.articles.length !== expectedArticleCount) {
    globalIssues.push({
      severity: 'error',
      code: 'article_count',
      message: `記事数が${content.articles.length}本。仕様は${expectedArticleCount}本。`,
    });
  }

  // id の重複
  const ids = new Set<string>();
  for (const a of content.articles) {
    if (ids.has(a.id)) {
      globalIssues.push({
        severity: 'error',
        code: 'duplicate_id',
        message: `id重複: ${a.id}`,
      });
    }
    ids.add(a.id);
  }

  // 米国市場概況の分量(仕様 2.1)
  const recap = countBodyChars(content.us_market_recap.body_md);
  if (recap < LIMITS.recapMinChars || recap > LIMITS.recapMaxChars) {
    globalIssues.push({
      severity: 'warn',
      code: 'recap_out_of_range',
      message: `米国市場概況が${fmtChars(recap)}。目安${LIMITS.recapMinChars}〜${LIMITS.recapMaxChars}字。`,
    });
  }

  // 免責(仕様 2.4)
  if (!content.disclaimer || !content.disclaimer.includes('投資助言ではありません')) {
    globalIssues.push({
      severity: 'error',
      code: 'disclaimer_missing',
      message: '免責文が無い、または規定の文言を含まない。',
    });
  }

  const articleReports = content.articles.map((a) =>
    checkArticle(a, sourceTextsById[a.id] ?? []),
  );

  const hasError =
    globalIssues.some((i) => i.severity === 'error') ||
    articleReports.some((r) => r.issues.some((i) => i.severity === 'error'));

  return { ok: !hasError, articleReports, globalIssues };
}

/** 人間可読なレポート出力。Actions のログに出す(仕様 4.4)。 */
export function printReport(r: ValidationReport, content: DailyContent): void {
  console.log(`\n===== 検証レポート ${content.date} =====`);
  for (const i of r.globalIssues) {
    console.log(`  [${i.severity === 'error' ? 'ERROR' : 'WARN '}] ${i.code}: ${i.message}`);
  }
  console.log(
    `\n  ${'記事ID'.padEnd(34)} ${'要約'.padStart(6)} ${'詳細'.padStart(6)} ${'考察'.padStart(6)}  判定`,
  );
  for (const ar of r.articleReports) {
    const err = ar.issues.filter((i) => i.severity === 'error').length;
    const warn = ar.issues.filter((i) => i.severity === 'warn').length;
    const mark = err > 0 ? `NG(${err})` : warn > 0 ? `warn(${warn})` : 'OK';
    console.log(
      `  ${ar.id.padEnd(34)} ${String(ar.metrics.summary).padStart(6)} ${String(
        ar.metrics.detail,
      ).padStart(6)} ${String(ar.metrics.analysis).padStart(6)}  ${mark}`,
    );
    for (const i of ar.issues) {
      console.log(`      - [${i.severity}] ${i.message}`);
    }
  }
  console.log(`\n  総合判定: ${r.ok ? 'PASS' : 'FAIL(警告フラグ付きで公開)'}`);
  console.log('=====================================\n');
}

// CLI 実行
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npm run validate -- content/YYYY-MM-DD.json');
    process.exit(2);
  }
  const content = JSON.parse(readFileSync(path, 'utf-8')) as DailyContent;
  const report = validateDaily(content);
  printReport(report, content);
  process.exit(report.ok ? 0 : 1);
}
