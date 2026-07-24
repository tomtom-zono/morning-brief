/**
 * フィード疎通チェック。sources.yaml の全URLに実際にアクセスし、
 * HTTPステータスとアイテム件数を表示する。
 *
 * 実行:  npm run check:feeds
 *
 * 注: 開発サンドボックスは外部ドメインへの通信が遮断されているため
 * (x-deny-reason: host_not_allowed)、全件403になる。手元のPCで実行して
 * URLの正当性を確認すること。FAIL が出たフィードは sources.yaml を修正するか
 * 削除すれば、収集側は Promise.allSettled で個別に切り離される。
 */
import { loadSources } from '../pipeline/collect.js';
const conf = loadSources();
const results = await Promise.all(conf.feeds.map(async f => {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), 15000);
    const r = await fetch(f.url, { signal: ctrl.signal, headers:{'User-Agent': conf.defaults.user_agent} });
    clearTimeout(to);
    const body = await r.text();
    const items = (body.match(/<item[\s>]|<entry[\s>]/g)||[]).length;
    return { id:f.id, status:r.status, items, ms:Date.now()-t0, err:'' };
  } catch(e:any) { return { id:f.id, status:0, items:0, ms:Date.now()-t0, err:String(e.message||e).slice(0,60) }; }
}));
for (const r of results) {
  const mark = r.status===200 && r.items>0 ? 'OK  ' : r.status===200 ? 'EMPTY' : 'FAIL';
  console.log(`${mark} ${r.id.padEnd(22)} http=${String(r.status).padEnd(4)} items=${String(r.items).padEnd(4)} ${r.ms}ms ${r.err}`);
}
console.log(`\n到達可能: ${results.filter(r=>r.status===200&&r.items>0).length}/${results.length}`);
