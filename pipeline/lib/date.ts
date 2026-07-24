/**
 * 日付・タイムゾーン処理。
 *
 * 仕様 4.7: cron 2本を常時有効にし、スクリプト冒頭で当日の米国夏時間/冬時間を
 * 判定して片方をスキップする。判定は自前の日付計算ではなく IANA タイムゾーン
 * (America/New_York) の UTC オフセットを引いて行う。米国の DST 移行日規則が
 * 将来変更されても Node の tzdata 更新に追随できるため。
 */

/** JST の YYYY-MM-DD。 */
export function todayJst(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 指定 IANA ゾーンでの UTC オフセット(分)。東が正。 */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // ローカル表記を UTC として解釈し、元の UTC 時刻との差を取る。
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * ニューヨークが夏時間(EDT, UTC-4)かどうか。冬時間(EST)は UTC-5。
 */
export function isUsDst(d = new Date()): boolean {
  return tzOffsetMinutes(d, 'America/New_York') === -240;
}

/**
 * 当該 cron 実行を継続すべきか判定する(仕様 4.7)。
 * summer 用ジョブは夏時間期のみ、winter 用ジョブは冬時間期のみ実行する。
 */
export function shouldRunForSchedule(
  schedule: 'summer' | 'winter',
  d = new Date(),
): boolean {
  return schedule === 'summer' ? isUsDst(d) : !isUsDst(d);
}

/** 前営業日相当(米国市場概況の対象日)。単純な前日ではなく週末を戻す。 */
export function previousUsSessionDate(d = new Date()): string {
  const nyDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const cur = new Date(`${nyDate}T12:00:00Z`);
  do {
    cur.setUTCDate(cur.getUTCDate() - 1);
  } while (cur.getUTCDay() === 0 || cur.getUTCDay() === 6);
  return cur.toISOString().slice(0, 10);
}
