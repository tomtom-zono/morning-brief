/**
 * 実データでの試走 (npm run try)
 *
 * 実際のRSS・一次情報を取得し、DeepSeek API で1日分を生成してサイトに反映する。
 * 開発サンドボックスからは外部通信が遮断されているため、このスクリプトは
 * 必ず手元のPCで実行すること。
 *
 * 使い方:
 *   1. .env に DEEPSEEK_API_KEY=sk-... を書く(.env は gitignore 済み)
 *   2. npm run try            … 全10本を生成
 *      npm run try -- --articles 2   … まず2本だけで様子を見る(推奨)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// .env を読む(dotenv 依存を足さない簡易実装)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

const argv = process.argv.slice(2);
const nArg = argv.indexOf('--articles');
const limit = nArg >= 0 ? argv[nArg + 1] : undefined;

if (!process.env.DEEPSEEK_API_KEY) {
  console.error(
    '\nDEEPSEEK_API_KEY が設定されていません。\n' +
      '  .env に DEEPSEEK_API_KEY=sk-... を記載するか、環境変数で渡してください。\n' +
      '  キーは platform.deepseek.com → API Keys で発行できます。\n',
  );
  process.exit(1);
}

console.log('\n━━━ 実データ試走 ━━━');
console.log('1) フィード疎通を確認します\n');
const feeds = spawnSync('npx', ['tsx', 'scripts/check-feeds.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (feeds.status !== 0) console.warn('\n(疎通チェックが異常終了しましたが続行します)\n');

console.log('\n2) 収集 → 生成 → 検証 を実行します');
if (limit) {
  console.log(`   記事数を ${limit} 本に制限します(コスト確認用)`);
  process.env.MB_ARTICLE_LIMIT = limit;
}
console.log('   DeepSeek API を呼び出すため課金が発生します。数分かかります。\n');

const daily = spawnSync('npx', ['tsx', 'pipeline/daily.ts'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

if (daily.status !== 0) {
  console.error('\n生成に失敗しました。上のログを確認してください。');
  process.exit(daily.status ?? 1);
}

console.log('\n3) サイトをビルドします\n');
spawnSync('npm', ['run', 'build', '--prefix', 'site'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

console.log('\n━━━ 完了 ━━━');
console.log('  npm run preview --prefix site  でブラウザ確認できます');
console.log('  生成物: content/<日付>.json\n');
