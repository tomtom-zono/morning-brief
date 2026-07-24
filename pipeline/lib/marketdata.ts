/**
 * 市況データ収集(仕様 2.1)。
 *
 * 背景: RSSは見出しと短い要約しか含まないため、「S&P500が何%下落したか」
 * といった数値が収集データに存在しない。結果として生成側は仕様2.4の
 * 「取得できなかった数値を捏造しない」に従い「未確認」と書くしかなかった。
 * ここで実数値を取得し、米国市場概況と各記事に事実の土台を与える。
 *
 * 取得元:
 *  - 米金利: 米財務省の公式XMLフィード(Daily Treasury Par Yield Curve Rates)
 *  - ドル円: 日本銀行 時系列統計データ検索サイト API(FM08 外国為替市況)。
 *    東京市場ドル・円スポット中心相場。日本の朝の基準として最も適切。
 *  - 指数・その他: FRED(セントルイス連銀)のCSV。APIキー不要。
 *
 * 日銀APIの利用条件(2026-02-18 公開のマニュアル・留意点に基づく):
 *  - 公開サービスでの利用にあたり日本銀行への連絡が必要(利用者が連絡済み)。
 *  - サービス利用者が参照できる場所にクレジット表示が必須。
 *    文言は site 側フッターに実装(BOJ_API_CREDIT を参照)。
 *  - 高頻度アクセスは禁止。本パイプラインは日次1回のみ実行する。
 *
 * Stooq は 2026-07 時点で JavaScript による proof-of-work 型のbot対策を
 * 導入しており、CSVではなく検証ページを返す。これは自動アクセス拒否の
 * 明確な意思表示であるため、回避せず採用を取りやめた(仕様2.4)。
 *
 * いずれも公開データであり、認証回避やスクレイピングは行わない(仕様2.4)。
 * 取得に失敗した系列は欠測のまま扱い、値を推測で埋めない。
 *
 * 注: FRED の日次系列は前営業日終値ベース。SOX指数と日経平均はFREDに
 * 無いため対象外とし、生成側では「未確認」として扱われる。
 * VIXCLS は 2026-07 時点で CSV が1997年5月で打ち切られており(提供側の
 * 不具合とみられる)使用しない。VIXが必要になった場合は別系列を探すこと。
 */

export interface Quote {
  symbol: string;
  name: string;
  /** 直近終値 */
  close: number;
  /** 前営業日比(%)。前日値が取れない場合は undefined */
  changePct?: number;
  /** データの日付 (YYYY-MM-DD) */
  date: string;
  /** 基準日から何日前のデータか。FREDは系列ごとに更新頻度が異なる。 */
  ageDays: number;
  /** 鮮度が許容範囲を超えているか。超えた系列は本文で使わせない。 */
  stale: boolean;
}

export interface YieldPoint {
  tenor: string;
  rate: number;
}

export interface MarketData {
  /** 指数・為替・商品 */
  quotes: Quote[];
  /** 米国債利回り(年限別) */
  usYields: { date: string; points: YieldPoint[] } | null;
  errors: string[];
}

/** FRED の系列ID。仕様2.1が求める系列のうち FRED で取れるもの。 */
const FRED_SERIES: { symbol: string; name: string }[] = [
  { symbol: 'SP500', name: 'S&P500' },
  { symbol: 'NASDAQCOM', name: 'NASDAQ総合' },
  { symbol: 'DJIA', name: 'ダウ工業株30種' },
  { symbol: 'DCOILWTICO', name: 'WTI原油' },
];

const UA = 'Mozilla/5.0 (compatible; morning-brief/1.0; personal market brief)';

/**
 * データ鮮度の許容日数。
 *
 * FRED は系列ごとに更新頻度が異なり、特に為替(DEXJPUS/DEXUSEU)は
 * 週次バッチのため数日遅れる。古い値を「前日終値」として朝のブリーフに
 * 載せると、読者は当日の水準と誤認する。これは数値を書かないことより
 * 有害なため、しきい値を超えた系列は「参考値(N日前)」として扱い、
 * 前日終値としては使わせない(仕様2.4の正確性要件)。
 *
 * しきい値は「1営業日」。暦日で数えると月曜朝に金曜終値が3日前となり、
 * 正当な前営業日終値まで警告枠に落ちてしまう(毎週月曜のブリーフから
 * 数値が消える)。土日を除いた営業日で数えることで、平日も週明けも
 * 「直前の取引日の値」だけを新鮮として扱う。
 * 祝日は考慮していないため、休日明けは安全側(警告枠)に倒れる。
 */
const MAX_AGE_DAYS = 1;

/**
 * 日銀 FM08(外国為替市況)の系列コード: 東京市場ドル・円スポット中心相場(日次)。
 * 系列コードが変更された場合はここだけ直せばよい。
 * 環境変数 MB_BOJ_USDJPY_CODE で上書きできる(コードを編集せず試せる)。
 * 実在する系列コードは以下で確認できる:
 *   https://www.stat-search.boj.or.jp/api/v1/getMetadata?format=csv&lang=jp&db=fm08
 */
const BOJ_USDJPY_CODE = process.env.MB_BOJ_USDJPY_CODE ?? 'FXERD05';

/**
 * 日銀 FM08 から取得する系列(メタデータAPIで実在を確認済み・2026-07-24)。
 *  FXERD05: ドル・円 スポット 中心相場 — 取引金額で測った当日の代表的相場
 *  FXERD04: ドル・円 スポット 17時時点 — 東京市場クローズ近辺の水準
 *  FXERD06: ドル・円 スポット出来高(百万ドル) — 価格だけでなく商いの厚みを見る
 *  FXERD31: ユーロ・ドル スポット 9時時点
 * 出来高は需給・ポジショニングを扱う本サイトの性格上、価格と並べる価値がある。
 */
const BOJ_SERIES: { code: string; name: string; unit: string }[] = [
  { code: BOJ_USDJPY_CODE, name: 'ドル円(東京市場スポット中心相場)', unit: '円' },
  { code: 'FXERD04', name: 'ドル円(東京17時時点)', unit: '円' },
  { code: 'FXERD06', name: 'ドル円スポット出来高', unit: '百万ドル' },
  { code: 'FXERD31', name: 'ユーロドル(東京9時時点)', unit: 'ドル' },
];

/**
 * サイトに表示する日銀APIのクレジット(利用条件により必須)。
 */
export const BOJ_API_CREDIT =
  'このサービスは、日本銀行時系列統計データ検索サイトの API 機能を使用しています。' +
  'サービスの内容は日本銀行によって保証されたものではありません。';

/** 2つの YYYY-MM-DD の暦日差。 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * 土日を除いた営業日ベースの差。from の翌営業日から to までを数える。
 * 例: 金曜 → 翌月曜 は 1、金曜 → 翌火曜 は 2。
 */
function businessDaysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * タイムアウト付き取得。
 *
 * FRED は時間帯によって応答が著しく遅く、60秒近くかけて 504 を返すことがある
 * (2026-07 に実測)。朝6時の公開に間に合わせるには、全系列の合計取得時間に
 * 上限を設ける必要がある。そのため:
 *  - 1回あたりのタイムアウトは短めに保つ
 *  - 5xx/タイムアウトのみ1回だけ再試行し、それ以上は粘らない
 *  - HTTP 4xx(パラメータ誤り)は再試行しても無駄なので即諦める
 * 取れなかった系列は「未確認」として扱われ、生成自体は継続する。
 */
async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  // 実測(2026-07)では、同じURLが成功したり接続失敗したりと結果が揺れる。
  // 一時的な不安定さを吸収するため、間隔を空けながら最大3回試行する。
  const waits = [0, 2000, 5000];
  let lastErr: unknown;

  for (const wait of waits) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fetchOnce(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      // パラメータ誤りは何度試しても同じなので即座に諦める。
      if (/HTTP 4\d\d/.test(String(e))) throw e;
    }
  }
  throw new Error(`${String(lastErr).replace(/^Error:\s*/, '')} (3回試行)`);
}

/**
 * FRED のCSVから直近2営業日を取り、終値と前日比を作る。
 * CSV形式: observation_date,SERIESID  (欠測日は "." が入る)
 */
async function fetchQuote(symbol: string, name: string): Promise<Quote> {
  const csv = await fetchText(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(symbol)}`,
  );
  if (csv.trimStart().startsWith('<')) {
    throw new Error('CSVではなくHTMLが返された');
  }

  const lines = csv.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('データ行なし');

  // 有効な観測値だけを取り出す。
  // 注意: Number('') は 0 を返すため、空文字を弾かないと空欄行を
  // 「値0の観測」として拾ってしまう(長期系列の末尾に空欄が続くことがあり、
  // 実際に33年前の値を最新値として採用する不具合が出た)。
  const rows: { date: string; value: number }[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const d = (cols[0] ?? '').trim();
    const v = (cols[1] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (v === '' || v === '.') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    rows.push({ date: d, value: n });
  }

  if (rows.length === 0) throw new Error('有効な観測値なし');

  // 行順に依存せず、日付昇順に並べ替えてから末尾2件を取る。
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const last = rows[rows.length - 1]!;
  const prev = rows.length >= 2 ? rows[rows.length - 2] : undefined;

  const close = last.value;

  let changePct: number | undefined;
  if (prev && prev.value !== 0) {
    changePct = ((close - prev.value) / prev.value) * 100;
  }

  const date = last.date;
  const today = new Date().toISOString().slice(0, 10);

  return {
    symbol,
    name,
    close,
    changePct,
    date,
    ageDays: daysBetween(date, today),
    stale: businessDaysBetween(date, today) > MAX_AGE_DAYS,
  };
}

/** 米財務省の公式XMLから当年の利回りを取り、最新日の年限別レートを返す。 */
async function fetchUsYields(): Promise<MarketData['usYields']> {
  const year = new Date().getUTCFullYear();
  const xml = await fetchText(
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml' +
      `?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`,
    20000,
  );

  // <entry> の並びのうち最後のものが最新日。属性名は BC_2YEAR 等。
  const entries = xml.split('<entry>').slice(1);
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1]!;

  const pick = (tag: string): number | null => {
    const m = latest.match(new RegExp(`<d:${tag}[^>]*>([^<]*)</d:${tag}>`));
    if (!m || !m[1]) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };

  const dateRaw = latest.match(/<d:NEW_DATE[^>]*>([^<]*)</)?.[1] ?? '';
  const date = dateRaw.slice(0, 10);

  const wanted: [string, string][] = [
    ['BC_2YEAR', '2年'],
    ['BC_5YEAR', '5年'],
    ['BC_10YEAR', '10年'],
    ['BC_30YEAR', '30年'],
  ];

  const points: YieldPoint[] = [];
  for (const [tag, label] of wanted) {
    const v = pick(tag);
    if (v !== null) points.push({ tenor: label, rate: v });
  }
  return points.length > 0 ? { date, points } : null;
}

/**
 * 日銀 時系列統計データ検索サイト API から東京市場ドル円スポット中心相場を取得。
 *
 * DB: FM08(外国為替市況)。API では系列コードの先頭に DB 名を付けると
 * エラーになるため、コードのみ渡す。
 * 期間は当月と前月を指定し(週明けや月初でも前営業日が取れるようにする)、
 * 欠損値(null)を除いた最新2件から終値と前日比を作る。
 */
async function fetchBojSeries(): Promise<Quote[]> {
  const now = new Date();
  const ym = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const url =
    'https://www.stat-search.boj.or.jp/api/v1/getDataCode' +
    `?format=json&lang=jp&db=FM08&code=${BOJ_SERIES.map((b) => b.code).join(',')}` +
    `&startDate=${ym(prevMonth)}&endDate=${ym(now)}`;

  // 日銀APIはパラメータ誤りでも本文にエラー内容(MESSAGE)を返すため、
  // HTTPステータスで捨てずに本文を読む。系列コードの誤りを特定できる。
  // 日銀APIはパラメータ誤り時も本文に MESSAGE を返す。ステータスで捨てると
  // 原因が分からないため、ここでは生の応答を直接読む。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let raw: string;
  let httpStatus: number;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' },
    });
    httpStatus = res.status;
    raw = await res.text();
  } finally {
    clearTimeout(timer);
  }

  if (httpStatus !== 200) {
    const m = raw.match(/"MESSAGE"\s*:\s*"([^"]*)"/);
    throw new Error(
      `日銀API HTTP ${httpStatus}: ${m?.[1] ?? raw.slice(0, 120)} ` +
        `(系列コード ${BOJ_USDJPY_CODE})`,
    );
  }

  const json = JSON.parse(raw) as {
    STATUS?: number;
    MESSAGE?: string;
    [k: string]: unknown;
  };

  if (json.STATUS !== undefined && Number(json.STATUS) !== 200) {
    throw new Error(`日銀API STATUS=${json.STATUS} ${json.MESSAGE ?? ''}`);
  }

  // 出力部から系列単位で SERIES_CODE / SURVEY_DATES / VALUES を集める。
  // 複数系列を1リクエストで取得しているため、系列ごとに分解する必要がある。
  interface RawSeries {
    code: string;
    dates: string[];
    values: (string | number | null)[];
  }
  const series: RawSeries[] = [];

  // 実応答の構造(2026-07 実測):
  //   RESULTSET: [ { SERIES_CODE, ..., VALUES: { SURVEY_DATES: [...], VALUES: [...] } } ]
  // VALUES が「オブジェクト」と「配列」の二重の意味で使われている点に注意。
  // 系列コードは親要素にあるため、親を辿りながら対応付ける。
  const walk = (node: unknown, inheritedCode: string): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, inheritedCode);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const o = node as Record<string, unknown>;
    const code = o.SERIES_CODE !== undefined ? String(o.SERIES_CODE) : inheritedCode;

    // 期待する形: SURVEY_DATES と VALUES がともに配列
    const sd = o.SURVEY_DATES;
    const vv = o.VALUES;
    if (Array.isArray(sd) && Array.isArray(vv)) {
      series.push({
        code,
        dates: sd.map((d) => String(d)),
        values: vv as (string | number | null)[],
      });
      return;
    }

    for (const v of Object.values(o)) walk(v, code);
  };
  walk(json, '');

  if (series.length === 0) throw new Error('日銀APIの応答に系列データが無い');

  const today = new Date().toISOString().slice(0, 10);
  const out: Quote[] = [];

  for (const conf of BOJ_SERIES) {
    const found = series.find((x) => x.code === conf.code);
    if (!found) continue;

    // 欠測(null)を除き、日付昇順で有効な観測値を並べる。
    const pairs: { date: string; value: number }[] = [];
    for (let i = 0; i < found.dates.length; i++) {
      const v = found.values[i];
      // Number('') が 0 になるため、空文字・null を明示的に弾く。
      if (v === null || v === undefined) continue;
      const vs = String(v).trim();
      if (vs === '' || vs === 'ND' || vs === 'NA') continue;
      const n = Number(vs);
      if (!Number.isFinite(n)) continue;
      const d = String(found.dates[i]).trim(); // YYYYMMDD
      if (!/^\d{8}$/.test(d)) continue;
      pairs.push({
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        value: n,
      });
    }
    if (pairs.length === 0) continue;

    // 応答順に依存せず日付昇順に整える。
    pairs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const last = pairs[pairs.length - 1]!;
    const prev = pairs.length >= 2 ? pairs[pairs.length - 2] : undefined;

    let changePct: number | undefined;
    if (prev && prev.value !== 0) {
      changePct = ((last.value - prev.value) / prev.value) * 100;
    }

    out.push({
      symbol: conf.code,
      name: conf.name,
      close: last.value,
      changePct,
      date: last.date,
      ageDays: daysBetween(last.date, today),
      stale: businessDaysBetween(last.date, today) > MAX_AGE_DAYS,
    });
  }

  if (out.length === 0) throw new Error('指定した系列の有効な観測値が無い');
  return out;
}

/**
 * 市況取得全体の時間上限。朝6時公開のため、ここで確実に切り上げる。
 * 超過した時点で取得済みの系列だけを返す。
 *
 * 内訳の目安: 1系列あたり最大3回試行 × 20秒 + 待機7秒 ≒ 67秒。
 * 重要度順(日銀→米財務省→FRED)に取得するため、上限に達して落ちるのは
 * 常に優先度の低いFRED側になる。生成開始は5:30、公開は6:00のため
 * 3分を上限としても余裕がある。
 */
const TOTAL_BUDGET_MS = 180_000;

/**
 * 妥当性検査の上限日数。これを超える日付の値はデータではなく
 * パース失敗とみなして捨てる。休場が続いても1年空くことはない。
 */
const SANITY_MAX_AGE_DAYS = 365;

export async function collectMarketData(): Promise<MarketData> {
  const errors: string[] = [];
  const quotes: Quote[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  // 取得順は重要度順。FREDは応答が不安定(60秒かけて504を返すことがある)なため
  // 最後に回し、遅い日でも日銀・米財務省の値が確実に取れるようにする。

  // 1) ドル円ほか(日銀)。3ペルソナ全員に必須。複数系列を1リクエストで取得。
  try {
    quotes.push(...(await fetchBojSeries()));
  } catch (e) {
    errors.push(`日銀(外国為替市況): ${String(e).slice(0, 200)}`);
  }

  // 2) 米国債利回り(米財務省)。円金利トレーダーの中核。
  let usYields: MarketData['usYields'] = null;
  try {
    usYields = await fetchUsYields();
  } catch (e) {
    errors.push(`米国債利回り: ${String(e).slice(0, 120)}`);
  }

  // 3) 株価指数ほか(FRED)。並列に叩くと同時接続が増えて共倒れするため逐次。
  //    取得後に鮮度の妥当性を検査する(下記 SANITY_MAX_AGE_DAYS)。
  for (const conf of FRED_SERIES) {
    if (Date.now() > deadline) {
      errors.push(`${conf.name}: 市況取得の時間上限に達したためスキップ`);
      continue;
    }
    try {
      quotes.push(await fetchQuote(conf.symbol, conf.name));
    } catch (e) {
      errors.push(`${conf.name}: ${String(e).slice(0, 120)}`);
    }
  }

  // 最終検査: 1年以上前のデータはパース失敗の兆候であり、実データではない。
  // 33年前の原油価格を最新値として拾う不具合が実際に発生したため、
  // 明らかに古い値は市況データから除外し、誤った数値が記事に載るのを防ぐ。
  const sane: Quote[] = [];
  for (const q of quotes) {
    if (q.ageDays > SANITY_MAX_AGE_DAYS) {
      errors.push(
        `${q.name}: 取得値の日付が${q.date}(${q.ageDays}日前)と古すぎるため除外`,
      );
      continue;
    }
    sane.push(q);
  }

  return { quotes: sane, usYields, errors };
}

/** プロンプトに埋め込む整形済みテキスト。取れなかった系列は明示的に落とす。 */
export function renderMarketData(m: MarketData): string {
  const fresh = m.quotes.filter((q) => !q.stale);
  const stale = m.quotes.filter((q) => q.stale);

  if (fresh.length === 0 && stale.length === 0 && !m.usYields) {
    return '【市況データ】取得できなかった。数値は一切記載せず「未確認」と明記すること。';
  }

  const lines: string[] = ['【市況データ(実測値。ここにある数値のみ使用可)】'];

  if (fresh.length > 0) {
    lines.push('■ 直近終値 / 前営業日比 — 前日の市場動向としてそのまま記述してよい');
    for (const q of fresh) {
      const chg =
        q.changePct === undefined
          ? '前日比 未確認'
          : `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`;
      lines.push(`  ${q.name}: ${q.close.toLocaleString('en-US')} (${chg}) [${q.date}]`);
    }
  }

  if (stale.length > 0) {
    lines.push('');
    lines.push('■ 更新が遅れている系列 — 【重要】以下は前日の値ではない');
    lines.push(
      '  これらを「前日終値」「昨日の水準」として書いてはならない。言及する場合は',
      '  必ず日付を併記し、「N月N日時点」と明示すること。当日の水準は未確認である。',
    );
    for (const q of stale) {
      lines.push(
        `  ${q.name}: ${q.close.toLocaleString('en-US')} [${q.date}時点 / ${q.ageDays}日前]`,
      );
    }
  }

  if (m.usYields) {
    lines.push('');
    lines.push(`■ 米国債利回り(%) [${m.usYields.date} 米財務省]`);
    lines.push(
      '  ' + m.usYields.points.map((p) => `${p.tenor} ${p.rate.toFixed(2)}`).join(' / '),
    );
  }

  if (m.errors.length > 0) {
    lines.push('');
    lines.push(`■ 取得失敗(これらは「未確認」と記載すること): ${m.errors.length}系列`);
  }

  return lines.join('\n');
}
