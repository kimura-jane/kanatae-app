const CACHE_NAME = 'kanatake-v9';

function getBasePath() {
  const scopeUrl = new URL(self.registration.scope);
  return scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : scopeUrl.pathname + '/';
}

self.addEventListener('install', (e) => {
  const BASE = getBasePath();
  const urlsToCache = [
    BASE,
    BASE + 'index.html',
    BASE + 'style.css',
    BASE + 'spots.js',
    BASE + 'spots-all.js',
    BASE + 'manifest.json',
    BASE + 'icon.png',
    BASE + 'onigiriya_kanatake_192.png',
    BASE + 'onigiriya_kanatake_512.png',
    BASE + 'IMG_7605.jpeg',
    BASE + '1.png',
    BASE + '2.png',
    BASE + '3.png',
    BASE + '4.png',
  ];

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

  const BASE = getBasePath();
  const title = data.title || 'おにぎり屋かなたけ';
  const body = data.body || '明日の出店のお知らせです';
  
  // url が "/" や相対パスの場合、BASEを付ける
  let targetUrl = data.url || BASE;
  if (targetUrl === '/' || targetUrl === '') {
    targetUrl = BASE;
  } else if (!targetUrl.startsWith('http') && !targetUrl.startsWith(BASE)) {
    targetUrl = BASE + targetUrl.replace(/^\//, '');
  }

  const options = {
    body,
    icon: BASE + 'onigiriya_kanatake_192.png',
    badge: BASE + 'onigiriya_kanatake_192.png',
    data: { url: targetUrl }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const BASE = getBasePath();
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : BASE;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if (c.url.includes(BASE) && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
