/**
 * 設定の集約点。仕様 4.1「使用モデル名は設定ファイル1箇所にまとめ、将来の変更を容易にすること」。
 * モデル名の文字列リテラルは本ファイル以外に置かない。
 */

/** DeepSeek V4。旧エイリアス deepseek-chat / deepseek-reasoner は 2026-07-24 15:59 UTC 廃止のため使用禁止(仕様 4.1)。 */
export const MODELS = {
  /** 拡張考察・米国市場概況。長文かつ論点密度が要る箇所。 */
  pro: 'deepseek-v4-pro',
  /** 要約・内容詳細・収集テキスト整形。 */
  flash: 'deepseek-v4-flash',
} as const;

export type ModelKey = keyof typeof MODELS;

/**
 * V4 は thinking/non-thinking をモデルIDではなくパラメータで切り替える。
 * 旧世代のように reasoner 系モデルIDを指定する実装にしないこと。
 */
export const REASONING = {
  /**
   * 既定は high(考察の質が本サイトの価値の中核のため)。
   * ただし high は1回の生成に5〜8分かかる夜があり、朝の時間枠を圧迫する。
   * 遅延が常態化した場合は Actions の環境変数 MB_REASONING_PRO=medium で
   * 品質と時間のバランスを切り替えられる(コード変更不要)。
   */
  pro: (process.env.MB_REASONING_PRO === 'medium' ? 'medium' : 'high') as
    | 'medium'
    | 'high',
  flash: 'medium' as const,
};

/** 単価 (USD / 1M tokens)。docs の Models & Pricing に対応。コスト計上のみに使用。 */
export const PRICING: Record<ModelKey, {
  inputCacheHit: number;
  inputCacheMiss: number;
  output: number;
}> = {
  pro: { inputCacheHit: 0.003625, inputCacheMiss: 0.435, output: 0.87 },
  flash: { inputCacheHit: 0.0028, inputCacheMiss: 0.14, output: 0.28 },
};

export const API = {
  baseURL: 'https://api.deepseek.com',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  /** 生成は長文。ネットワーク待ちで cron 枠を食い潰さないよう上限を置く。 */
  timeoutMs: 300_000,
  maxRetriesTransport: 2,
} as const;

/** 仕様 2.2 / 4.4 の数値制約。validate.ts と生成プロンプトの双方がここを参照する。 */
export const LIMITS = {
  summaryMaxChars: 300,
  analysisMinChars: 2000,
  detailMinChars: 600,
  detailMaxChars: 1200,
  recapMinChars: 800,
  recapMaxChars: 1200,
  articleCount: 10,
  /** 直接引用の上限。和訳も同様に扱う(仕様 2.2)。 */
  quoteMaxChars: 80,
  quotesPerSourceMax: 1,
  /** 記事単位の再生成上限(仕様 4.4)。 */
  maxRetries: 3,
} as const;

export const PATHS = {
  raw: 'raw',
  content: 'content',
  manualInput: 'input/manual',
  sources: 'pipeline/sources.yaml',
} as const;

export const DISCLAIMER =
  '本サイトは情報提供のみを目的とし、投資助言ではありません。';

/** MB_MOCK=1 で API を呼ばずに決定的なスタブを返す(CI・デモ用)。 */
export const IS_MOCK = process.env.MB_MOCK === '1';
