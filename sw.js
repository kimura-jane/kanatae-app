const CACHE_NAME = 'kanatake-v8';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './spots.js',
  './spots-all.js',
  './manifest.json',
  './icon.png',
  './onigiriya_kanatake_192.png',
  './onigiriya_kanatake_512.png',
  './IMG_7605.jpeg',
  './1.png',
  './2.png',
  './3.png',
  './4.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // scopeに対して相対解決（/kanatae-app/ と / の両対応）
    const scope = self.registration.scope;
    const urls = ASSETS.map(p => new URL(p, scope).toString());
    await cache.addAll(urls);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 同一オリジンのGETだけ
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith((async () => {
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
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'おにぎり屋かなたけ';
  const body = data.body || 'お知らせです';
  const targetUrl = data.url || self.registration.scope;

  const options = {
    body,
    icon: new URL('./onigiriya_kanatake_192.png', self.registration.scope).toString(),
    badge: new URL('./onigiriya_kanatake_192.png', self.registration.scope).toString(),
    data: { url: targetUrl }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : self.registration.scope;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if ('focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
