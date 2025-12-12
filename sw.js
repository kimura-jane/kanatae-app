const CACHE_NAME = 'kanatake-v4';
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
  '/kanatae-app/cal.png',
  '/kanatae-app/map.png',
  '/kanatae-app/menu.png',
  '/kanatae-app/coupon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});
