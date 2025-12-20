const CACHE_NAME = 'kanatake-v7';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './spots.js',
  './spots-all.js',
  './icon.png',
  './onigiriya_kanatake_192.png',
  './onigiriya_kanatake_512.png',
  './IMG_7605.jpeg',
  './1.png',
  './2.png',
  './3.png',
  './4.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// キャッシュ戦略：同一オリジンGETは「キャッシュ優先→なければ取得→保存」
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, copy);
    }
    return res;
  })());
});

// ===== Push通知 =====
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'おにぎり屋かなたけ';
  const body = data.body || 'お知らせです';
  const targetUrl = data.url || './';

  const options = {
    body,
    icon: './onigiriya_kanatake_192.png',
    badge: './onigiriya_kanatake_192.png',
    data: { url: targetUrl }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) ? event.notification.data.url : './';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      // 同じスコープ内のタブがあればフォーカス
      if (c.url && c.url.includes('/kanatae-app/') && 'focus' in c) {
        return c.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
