const CACHE_NAME = 'kanatake-v6';

const CORE_ASSETS = [
  '/',                // ルート
  '/index.html',
  '/style.css',
  '/spots.js',
  '/spots-all.js',
  '/manifest.json',
  '/icon.png',
  '/onigiriya_kanatake_192.png',
  '/onigiriya_kanatake_512.png',
  '/IMG_7605.jpeg',
  '/1.png',
  '/2.png',
  '/3.png',
  '/4.png',
  '/privacy.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // ナビゲーション（ページ遷移）は「ネット優先・失敗したらキャッシュ」
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match('/index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // それ以外の静的ファイルは「キャッシュ優先」
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
