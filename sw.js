const CACHE_NAME = 'kanatake-v10';

// ===== Utils =====
function getBasePath() {
  const scopeUrl = new URL(self.registration.scope);
  return scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : scopeUrl.pathname + '/';
}

function isCoreAsset(pathname, BASE) {
  // “アプリの心臓部”は必ずネット優先で取りに行く
  const core = new Set([
    BASE,
    BASE + 'index.html',
    BASE + 'style.css',
    BASE + 'spots.js',
    BASE + 'spots-all.js',
    BASE + 'manifest.json',
    BASE + 'sw.js',
  ]);
  return core.has(pathname);
}

function isStaticAsset(pathname) {
  // 画像などはキャッシュ優先でOK
  return (
    pathname.match(/\.(png|jpg|jpeg|webp|svg|ico)$/i) ||
    pathname.match(/\.(woff2?|ttf|otf)$/i)
  );
}

async function cachePutSafe(cache, req, res) {
  try {
    await cache.put(req, res);
  } catch {
    // put失敗しても落とさない
  }
}

// ===== Install =====
self.addEventListener('install', (e) => {
  const BASE = getBasePath();

  // ここは“必須級”だけにする（失敗で全体が壊れるのを防ぐ）
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

  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // addAll で1個でも落ちると install 全体が失敗するので、個別に安全に入れる
    await Promise.allSettled(
      urlsToCache.map(async (u) => {
        try {
          await cache.add(u);
        } catch {
          // 取れないものがあってもSW自体は生かす
        }
      })
    );

    self.skipWaiting();
  })());
});

// ===== Activate =====
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// ===== Fetch =====
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  const BASE = getBasePath();
  const pathname = url.pathname;

  // ナビゲーション（ページ遷移）は index.html を返せるように network-first
  const isNav = req.mode === 'navigate';

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1) index や js/css/manifest は network-first（更新ズレで死ぬのを防ぐ）
    if (isNav || isCoreAsset(pathname, BASE)) {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) await cachePutSafe(cache, req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;

        // navigate の場合、最後の手段で index.html を返す
        if (isNav) {
          const fallback = await caches.match(BASE + 'index.html');
          if (fallback) return fallback;
        }
        throw new Error('offline and no cache');
      }
    }

    // 2) 画像などは cache-first
    if (isStaticAsset(pathname)) {
      const cached = await caches.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      if (res && res.ok) await cachePutSafe(cache, req, res.clone());
      return res;
    }

    // 3) その他はほどほど（cache → network → cache）
    const cached = await caches.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    if (res && res.ok) await cachePutSafe(cache, req, res.clone());
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
