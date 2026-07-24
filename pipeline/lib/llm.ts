/**
 * DeepSeek クライアント(仕様 4.1 / 4.8)。
 * OpenAI 互換 API を base_url 指定で利用する。モデル名は config.ts のみが持つ。
 */

import OpenAI from 'openai';
import { API, MODELS, PRICING, REASONING, IS_MOCK, type ModelKey } from '../config.js';

export interface Usage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export const emptyUsage = (): Usage => ({
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  estimated_cost_usd: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    cached_input_tokens: a.cached_input_tokens + b.cached_input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    estimated_cost_usd: a.estimated_cost_usd + b.estimated_cost_usd,
  };
}

function costOf(model: ModelKey, u: Omit<Usage, 'estimated_cost_usd'>): number {
  const p = PRICING[model];
  const miss = Math.max(u.input_tokens - u.cached_input_tokens, 0);
  return (
    (miss * p.inputCacheMiss +
      u.cached_input_tokens * p.inputCacheHit +
      u.output_tokens * p.output) /
    1_000_000
  );
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env[API.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `環境変数 ${API.apiKeyEnv} が未設定。GitHub Actions では Secrets に登録すること(仕様4.7)。`,
    );
  }
  client = new OpenAI({
    apiKey,
    baseURL: API.baseURL,
    timeout: API.timeoutMs,
    maxRetries: API.maxRetriesTransport,
  });
  return client;
}

export interface CompleteResult {
  text: string;
  usage: Usage;
}

/**
 * @param fixedPrefix 日次で変化しない固定部。必ず先頭に置きキャッシュを効かせる。
 * @param variablePart 当日の収集テキスト等の可変部。
 */
export async function complete(
  modelKey: ModelKey,
  fixedPrefix: string,
  variablePart: string,
  mock?: () => string,
): Promise<CompleteResult> {
  if (IS_MOCK) {
    return { text: mock ? mock() : '{}', usage: emptyUsage() };
  }

  const res = await getClient().chat.completions.create({
    model: MODELS[modelKey],
    messages: [
      // 固定部を system に単独で置くことで前方一致キャッシュを最大化する。
      { role: 'system', content: fixedPrefix },
      { role: 'user', content: variablePart },
    ],
    response_format: { type: 'json_object' },
    reasoning_effort: REASONING[modelKey],
  } as Parameters<OpenAI['chat']['completions']['create']>[0]);

  const choice = (res as any).choices?.[0];
  const text: string = choice?.message?.content ?? '';
  const u = (res as any).usage ?? {};
  const cached: number =
    u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;

  const base = {
    input_tokens: u.prompt_tokens ?? 0,
    cached_input_tokens: cached,
    output_tokens: u.completion_tokens ?? 0,
  };

  return { text, usage: { ...base, estimated_cost_usd: costOf(modelKey, base) } };
}

/** モデル出力からJSONを取り出す。稀に混入するコードフェンス・前置きを剥がす。 */
export function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`JSONが見つからない: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(s.slice(start, end + 1)) as T;
}
