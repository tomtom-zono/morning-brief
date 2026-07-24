/**
 * 日本語の「字数」を仕様どおりに数えるためのユーティリティ。
 *
 * String.prototype.length は UTF-16 コードユニット数であり、サロゲートペア
 * (絵文字・一部の漢字)を2字と数えてしまう。仕様 2.2 の「300字以内」
 * 「2,000字以上」は人間が読む字数を指すため、書記素クラスタで数える。
 */

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 書記素単位の字数。 */
export function countChars(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

/**
 * 本文の実質字数。Markdown 記法・URL・空白は字数に含めない。
 * 「2,000字以上」をリンクや記号で水増しされるのを防ぐ。
 */
export function countBodyChars(md: string): number {
  const stripped = md
    // コードフェンス
    .replace(/```[\s\S]*?```/g, '')
    // 画像・リンクはラベルのみ残す
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 裸のURL
    .replace(/https?:\/\/\S+/g, '')
    // 見出し・引用・リストの記号
    .replace(/^[ \t]*[#>\-*+]+[ \t]*/gm, '')
    // 強調記号
    .replace(/[*_`~]/g, '')
    // 空白類
    .replace(/\s+/g, '');
  return countChars(stripped);
}

/** 表示用に字数を丸めた文字列。ログ出力向け。 */
export function fmtChars(n: number): string {
  return `${n.toLocaleString('ja-JP')}字`;
}

/** 日本語文字を含むか(引用検出のヒューリスティックに使用)。 */
export function hasJapanese(s: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
}
