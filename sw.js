const CACHE_NAME = "kanatake-v7";

// scope から / または /kanatae-app/ を自動で取る
const SCOPE_URL = new URL(self.registration.scope);
const BASE = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : (SCOPE_URL.pathname + "/");
const p = (file) => BASE + file;

const urlsToCache = [
  BASE,
  p("index.html"),
  p("style.css"),
  p("spots.js"),
  p("spots-all.js"),
  p("icon.png"),
  p("onigiriya_kanatake_192.png"),
  p("onigiriya_kanatake_512.png"),
  p("IMG_7605.jpeg"),
  p("1.png"),
  p("2.png"),
  p("3.png"),
  p("4.png"),
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 同一オリジンのGETだけ
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

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
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "おにぎり屋かなたけ";
  const body  = data.body  || "出店のお知らせをチェックしてね 🍙";
  const targetUrl = data.url || BASE; // payloadなしでもBASEへ

  const options = {
    body,
    icon: p("onigiriya_kanatake_192.png"),
    badge: p("onigiriya_kanatake_192.png"),
    data: { url: targetUrl }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : BASE;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of allClients) {
      // 同じアプリ内ならフォーカス
      if (c.url.startsWith(self.location.origin + BASE) && "focus" in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
