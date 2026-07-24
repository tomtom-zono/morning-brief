import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * content/ はパイプラインの出力先(仕様4.2)。
 *
 * 注意: Astro はビルド時にこのファイルをバンドルするため、import.meta.url は
 * src/lib/ ではなく生成チャンクの場所を指す。固定の相対段数では壊れるので、
 * 実行時のディレクトリから上方向に content/ を探す。リポジトリ内のどこから
 * ビルドしても(ルート/site/Cloudflare)同じ場所に解決される。
 */
function findContentDir(): string {
  const candidates = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      const p = join(dir, 'content');
      if (existsSync(p)) return p;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  // 見つからない場合は従来の想定位置を返す(空表示になるだけで落とさない)
  return join(process.cwd(), '..', 'content');
}
const CONTENT_DIR = findContentDir();

export interface SourceRef { name: string; url: string }

export interface Article {
  id: string;
  theme: string;
  title: string;
  summary: string;
  detail_md: string;
  analysis_md: string;
  sources: SourceRef[];
  en?: { title: string; summary: string; detail_md: string; analysis_md: string };
  quality_warning?: boolean;
  quality_notes?: string[];
}

export interface DailyContent {
  date: string;
  generated_at: string;
  us_market_recap: { body_md: string; body_md_en?: string; sources?: SourceRef[]; quality_warning?: boolean };
  articles: Article[];
  disclaimer: string;
}

/** 全日付を新しい順に返す。 */
export function allDays(): DailyContent[] {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((f) => JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf-8')) as DailyContent);
}

export function latestDay(): DailyContent | null {
  return allDays()[0] ?? null;
}

export function dayByDate(date: string): DailyContent | null {
  const p = join(CONTENT_DIR, `${date}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as DailyContent;
}

/**
 * テーマ → 符号色。色は装飾ではなく分類子であり、
 * 一覧で見出しを読まずにカテゴリを判別するために使う。
 */
export function themeColor(theme: string): string {
  const t = theme;
  if (/日銀|円金利|JGB/.test(t)) return 'var(--t-rates)';
  if (/米金融政策|米金利/.test(t)) return 'var(--t-rates)';
  if (/為替|ドル円|ベーシス/.test(t)) return 'var(--t-fx)';
  if (/日本株/.test(t)) return 'var(--t-equity)';
  if (/需給|ポジショニング/.test(t)) return 'var(--t-flow)';
  if (/AI|テック|半導体/.test(t)) return 'var(--t-tech)';
  if (/クレジット|プライベート/.test(t)) return 'var(--t-credit)';
  if (/地政学|コモディティ/.test(t)) return 'var(--t-geo)';
  if (/規制|政策|制度/.test(t)) return 'var(--t-policy)';
  return 'var(--t-macro)';
}

/** 日付表示: 2026-07-24 → 2026年7月24日(金) */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
  ];
  return `${y}年${m}月${d}日(${wd})`;
}

const ESC: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/**
 * 生成物の Markdown を HTML に変換する。
 *
 * 依存を増やさず、パイプラインが出す範囲(見出し・段落・リンク・強調・
 * リスト・引用)に限定した最小実装。入力は必ずエスケープしてから
 * インライン記法を適用し、生成物由来のHTML混入を防ぐ。
 */
export function renderMarkdown(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[^*])\*\*([^*]+)\*\*/g, '$1<strong>$2</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 裸のURLもリンク化(出典リンクが素で書かれる場合がある)
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  const out: string[] = [];
  let list: string[] | null = null;
  let quote: string[] | null = null;

  const flushList = () => {
    if (list) { out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`); list = null; }
  };
  const flushQuote = () => {
    if (quote) { out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`); quote = null; }
  };

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); flushQuote(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList(); flushQuote();
      const lv = Math.min(h[1]!.length + 1, 4);
      out.push(`<h${lv}>${inline(h[2]!)}</h${lv}>`);
      continue;
    }
    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) { flushQuote(); (list ??= []).push(li[1]!); continue; }

    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) { flushList(); (quote ??= []).push(bq[1]!); continue; }

    flushList(); flushQuote();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList(); flushQuote();
  return out.join('\n');
}
