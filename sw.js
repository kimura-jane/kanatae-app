const CACHE_NAME = 'kanatake-v8';

function getBasePath() {
  // scope: "https://example.com/" or "https://example.com/kanatae-app/"
  const scopeUrl = new URL(self.registration.scope);
  let p = scopeUrl.pathname;
  if (!p.endsWith('/')) p += '/';
  return p;
}

function withBase(base, file) {
  // file: "" | "index.html" | "style.css"...
  return base + file;
}

self.addEventListener('install', (event) => {
  const base = getBasePath();

  const urlsToCache = [
    withBase(base, ''),              // /  or /kanatae-app/
    withBase(base, 'index.html'),
    withBase(base, 'style.css'),
    withBase(base, 'manifest.json'),
    withBase(base, 'spots.js'),
    withBase(base, 'spots-all.js'),
    withBase(base, 'icon.png'),
    withBase(base, 'onigiriya_kanatake_192.png'),
    withBase(base, 'onigiriya_kanatake_512.png'),
    withBase(base, 'IMG_7605.jpeg'),
    withBase(base, '1.png'),
    withBase(base, '2.png'),
    withBase(base, '3.png'),
    withBase(base, '4.png'),
  ];

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );

  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのGETだけ
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // ナビゲーション（ページ遷移）は cache-first（落ちたら index に倒す）
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      } catch {
        const base = getBasePath();
        const fallback = await caches.match(withBase(base, 'index.html'));
        return fallback || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // それ以外（CSS/JS/画像など）は cache-first → 無ければ fetch → 成功したら保存
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
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
  const targetUrl = data.url || getBasePath();

  const options = {
    body,
    icon: 'onigiriya_kanatake_192.png',
    badge: 'onigiriya_kanatake_192.png',
    data: { url: targetUrl }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) ? event.notification.data.url : getBasePath();

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if ('focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
