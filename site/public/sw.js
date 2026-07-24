/*
 * Service Worker (仕様4.6)
 * 直近7日分のコンテンツと静的アセットをキャッシュし、オフライン閲覧を可能にする。
 *
 * 方針:
 *  - HTML はネットワーク優先。朝の更新を確実に拾うため。オフライン時のみキャッシュ。
 *  - CSS/JS/画像はキャッシュ優先。変化が少なく、表示速度に直結する。
 *  - 記事ページは訪問時にキャッシュへ入れ、直近7日分を超えた日付は削除する。
 */

const VERSION = 'mb-v1';
const SHELL = `${VERSION}-shell`;
const PAGES = `${VERSION}-pages`;

const SHELL_URLS = [
  '/',
  '/archive/',
  '/bookmarks/',
  '/search/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await trimOldDates();
      await self.clients.claim();
    })(),
  );
});

/** URL から YYYY-MM-DD を取り出す。記事・日付ページのみ対象。 */
function dateOf(url) {
  const m = new URL(url).pathname.match(/^\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : null;
}

/** 直近7日分を超える日付のページをキャッシュから削除する(仕様4.6)。 */
async function trimOldDates() {
  const cache = await caches.open(PAGES);
  const reqs = await cache.keys();
  const dates = [...new Set(reqs.map((r) => dateOf(r.url)).filter(Boolean))].sort().reverse();
  const keep = new Set(dates.slice(0, 7));
  await Promise.all(
    reqs.map((r) => {
      const d = dateOf(r.url);
      return d && !keep.has(d) ? cache.delete(r) : undefined;
    }),
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDoc = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');

  if (isDoc) {
    // ネットワーク優先。成功したらキャッシュを更新する。
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGES).then(async (c) => {
            await c.put(req, copy);
            if (dateOf(req.url)) await trimOldDates();
          });
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req);
          return hit || caches.match('/') || Response.error();
        }),
    );
    return;
  }

  // 静的アセットはキャッシュ優先。
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
          return res;
        }),
    ),
  );
});
