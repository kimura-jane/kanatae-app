const CACHE_NAME = 'kanatake-v6';
const urlsToCache = [
  '/kanatae-app/',
  '/kanatae-app/index.html',
  '/kanatae-app/style.css',
  '/kanatae-app/spots.js',
  '/kanatae-app/spots-all.js',
  '/kanatae-app/icon.png',
  '/kanatae-app/onigiriya_kanatake_192.png',
  '/kanatae-app/onigiriya_kanatake_512.png',
  '/kanatae-app/IMG_7605.jpeg',
  '/kanatae-app/1.png',
  '/kanatae-app/2.png',
  '/kanatae-app/3.png',
  '/kanatae-app/4.png'
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

  // 同一オリジンのGETだけ
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
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
  const targetUrl = data.url || '/kanatae-app/';

  const options = {
    body,
    icon: '/kanatae-app/onigiriya_kanatake_192.png',
    badge: '/kanatae-app/onigiriya_kanatake_192.png',
    data: { url: targetUrl }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/kanatae-app/';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if (c.url.includes('/kanatae-app/') && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
