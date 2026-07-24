/**
 * 収集 → 生成 → 検証 を一発で通す(仕様 5.1「npm run daily 一発で完走」)。
 *
 * 仕様 4.7: cron 2本を常時有効にし、冒頭で夏時間/冬時間を判定して片方をスキップする。
 * 環境変数 MB_SCHEDULE=summer|winter が与えられた場合のみ判定を行う。
 * 手動実行(未設定)では常に実行する。
 */

import { collect } from './collect.js';
import { generate, printUsage } from './generate.js';
import { validateDaily, printReport } from './validate.js';
import { shouldRunForSchedule, isUsDst, todayJst } from './lib/date.js';
import { IS_MOCK } from './config.js';

const schedule = process.env.MB_SCHEDULE as 'summer' | 'winter' | undefined;
const date = process.argv[2] ?? todayJst();

if (schedule) {
  if (!shouldRunForSchedule(schedule)) {
    console.log(
      `[daily] スケジュール "${schedule}" は本日スキップ ` +
        `(現在NYは${isUsDst() ? '夏時間' : '冬時間'})。仕様4.7。`,
    );
    process.exit(0);
  }
  console.log(`[daily] スケジュール "${schedule}" を実行 (NY: ${isUsDst() ? '夏時間' : '冬時間'})`);
}

console.log(`[daily] 対象日: ${date}${IS_MOCK ? ' (MB_MOCK=1: API未使用)' : ''}`);

const raw = await collect(date);
console.log(
  `[daily] 収集完了: ${raw.items.length}件 / 週刊誌メモ ${raw.manual_notes.length}件 / 失敗 ${raw.errors.length}フィード`,
);

const content = await generate(date);
if (content.usage) printUsage(content.usage);

// 原文転載チェックのため、収集スニペットを記事に紐付けて渡す。
const allSnippets = raw.items.map((i) => i.snippet).filter(Boolean);
const byId: Record<string, string[]> = {};
for (const a of content.articles) byId[a.id] = allSnippets;

const report = validateDaily(content, byId);
printReport(report, content);

// 検証失敗でも公開は止めない(仕様4.4)。終了コードは0のまま、警告のみ出す。
if (!report.ok) {
  console.warn(
    '[daily] 検証にエラーが残ったが、6時公開を優先し処理は継続する(仕様4.4)。' +
      '該当記事には quality_warning が付与されている。',
  );
}
console.log(`[daily] 完了: content/${date}.json`);

// 収集時に残ったソケットハンドルでイベントループが解放されない場合があるため、
// 全成果物を書き出したうえで明示的に終了する(Actions のハング防止)。
process.exit(0);
