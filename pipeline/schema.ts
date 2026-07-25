import { z } from 'zod';
import { LIMITS } from './config.js';

/**
 * 仕様 4.3 のコンテンツJSONスキーマ。
 * 検証(4.4)は本スキーマ + validate.ts の文字数/引用チェックの二段構え。
 */

export const SourceRef = z.object({
  name: z.string().min(1),
  url: z.string().url(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Article = z.object({
  /** 例: 2026-07-24-boj-jgb-auction */
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/, 'id は日付+英小文字スラッグ'),
  theme: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  detail_md: z.string().min(1),
  analysis_md: z.string().min(1),
  sources: z.array(SourceRef).min(1, '出典は最低1件必須(仕様 2.2)'),
  /** 検証不合格でも公開は止めない(仕様 4.4)。その際に立てる。 */
  quality_warning: z.boolean().optional(),
  quality_notes: z.array(z.string()).optional(),
});
export type Article = z.infer<typeof Article>;

export const UsMarketRecap = z.object({
  body_md: z.string().min(1),
  sources: z.array(SourceRef).default([]),
  quality_warning: z.boolean().optional(),
  quality_notes: z.array(z.string()).optional(),
});

export const DailyContent = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generated_at: z.string(),
  us_market_recap: UsMarketRecap,
  articles: z.array(Article),
  /** トークン・コスト計上(仕様 4.8)。 */
  usage: z
    .object({
      input_tokens: z.number(),
      cached_input_tokens: z.number(),
      output_tokens: z.number(),
      estimated_cost_usd: z.number(),
    })
    .optional(),
  disclaimer: z.string(),
});
export type DailyContent = z.infer<typeof DailyContent>;

/** 記事数は10本(仕様 4.4)。生成途中の部分成果も扱えるよう、本チェックは validate 側で行う。 */
export const expectedArticleCount = LIMITS.articleCount;
