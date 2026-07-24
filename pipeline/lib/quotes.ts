/**
 * 引用・転載チェック(仕様 2.2 / 4.4 / 6)。
 *
 * 公開サイトであるため著作権制約は must。ここでの検出対象は2種類:
 *   A. 明示的な直接引用(鉤括弧・引用符・blockquote)が規定長を超える、
 *      または同一出典から複数箇所ある。
 *   B. 明示引用の体裁を取らずに原文をそのまま貼った「隠れ転載」。
 *      収集した原文スニペットと生成文の N-gram 一致で検出する。
 */

import { countChars } from './text.js';
import { LIMITS } from '../config.js';

export interface QuoteFinding {
  kind: 'quote_too_long' | 'too_many_quotes' | 'verbatim_overlap';
  detail: string;
  excerpt: string;
}

/** 鉤括弧・引用符・blockquote に囲まれた直接引用を抽出。 */
export function extractQuotes(md: string): string[] {
  const out: string[] = [];
  // 「」『』 と各種引用符
  const bracket = /[「『"“](.+?)[」』"”]/gs;
  for (const m of md.matchAll(bracket)) {
    if (m[1]) out.push(m[1].trim());
  }
  // blockquote 行
  for (const line of md.split('\n')) {
    const q = line.match(/^\s*>\s?(.+)$/);
    if (q?.[1]) out.push(q[1].trim());
  }
  return out.filter((q) => q.length > 0);
}

/**
 * 原文との連続一致を検出する。
 * 日本語は空白分かち書きが無いため、文字 N-gram で照合する。
 */
export function findVerbatimOverlap(
  generated: string,
  sourceTexts: string[],
  ngram = 30,
): string[] {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const gen = norm(generated);
  const hits: string[] = [];
  if (gen.length < ngram) return hits;

  const haystack = sourceTexts.map(norm).filter((s) => s.length >= ngram);
  if (haystack.length === 0) return hits;

  // 生成文側を N-gram で走査し、原文に含まれるものを拾う。
  const seen = new Set<string>();
  for (let i = 0; i + ngram <= gen.length; i++) {
    const slice = gen.slice(i, i + ngram);
    if (seen.has(slice)) continue;
    for (const h of haystack) {
      if (h.includes(slice)) {
        seen.add(slice);
        hits.push(slice);
        // 重なりを避けて先へ飛ばす
        i += ngram - 1;
        break;
      }
    }
  }
  return hits;
}

/** detail_md に対する引用制約チェック。 */
export function checkQuotes(
  detailMd: string,
  sourceCount: number,
  sourceTexts: string[] = [],
): QuoteFinding[] {
  const findings: QuoteFinding[] = [];

  const quotes = extractQuotes(detailMd);
  for (const q of quotes) {
    const n = countChars(q);
    if (n > LIMITS.quoteMaxChars) {
      findings.push({
        kind: 'quote_too_long',
        detail: `直接引用が${n}字。上限${LIMITS.quoteMaxChars}字(仕様2.2)。`,
        excerpt: q.slice(0, 60),
      });
    }
  }

  // 出典1件につき直接引用は1箇所まで(仕様 2.2)。
  const allowed = Math.max(sourceCount, 1) * LIMITS.quotesPerSourceMax;
  if (quotes.length > allowed) {
    findings.push({
      kind: 'too_many_quotes',
      detail: `直接引用${quotes.length}箇所。出典${sourceCount}件に対し上限${allowed}箇所(仕様2.2)。`,
      excerpt: quotes.slice(allowed).map((q) => q.slice(0, 30)).join(' / '),
    });
  }

  // 隠れ転載の検出。
  const overlaps = findVerbatimOverlap(detailMd, sourceTexts);
  for (const o of overlaps) {
    findings.push({
      kind: 'verbatim_overlap',
      detail: `原文と30字以上連続一致。転載・全訳は禁止(仕様2.2)。`,
      excerpt: o,
    });
  }

  return findings;
}
