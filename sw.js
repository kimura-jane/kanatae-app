const CACHE_NAME = 'kanatake-v7';

const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './spots.js',
  './spots-all.js',
  './icon.png',
  './onigiriya_kanatake_192.png',
  './onigiriya_kanatake_512.png',
  './IMG_7605.jpeg',
  './1.png',
  './2.png',
  './3.png',
  './4.png',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

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

// ===== Push通知（受信）=====
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
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
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : './';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if ('focus' in c) {
        c.focus();
        return;
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
