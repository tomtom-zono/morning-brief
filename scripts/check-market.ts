/**
 * 市況データの疎通確認 (npm run check:market)
 *
 * 米財務省XMLとStooq CSVから実際に数値が取れるかを確認する。
 * 開発環境からは外部通信が遮断されているため、手元のPCで実行すること。
 */

import { collectMarketData, renderMarketData } from '../pipeline/lib/marketdata.js';

console.log('市況データを取得します…\n');
const m = await collectMarketData();

console.log(renderMarketData(m));

if (m.errors.length > 0) {
  console.log('\n--- 取得に失敗した系列 ---');
  for (const e of m.errors) console.log('  ! ' + e);
  console.log(
    '\n一部失敗しても生成は継続します(失敗分は「未確認」と記載されます)。',
  );
}

const okQuotes = m.quotes.length;
const okYields = m.usYields?.points.length ?? 0;
console.log(`\n結果: 指数・為替・商品 ${okQuotes}/9 系列、米国債利回り ${okYields}/4 年限`);

if (okQuotes === 0 && okYields === 0) {
  console.log('全滅です。ネットワークかエンドポイントの問題の可能性があります。');
  process.exit(1);
}
process.exit(0);
