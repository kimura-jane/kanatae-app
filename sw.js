const CACHE_NAME = 'kanatake-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/spots.js',
  '/spots-all.js',
  '/icon.png',
  '/onigiriya_kanatake_192.png',
  '/onigiriya_kanatake_512.png',
  '/IMG_7605.jpeg'
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
