const CACHE_NAME = 'kanatake-v5';
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
