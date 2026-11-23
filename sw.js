// Service worker: caches the app shell so it opens with no network.
const CACHE = 'moneyapp-v10'; // keep in step with APP_VERSION in app.js
// The OCR engine (vendor/tesseract, ~16 MB) is cached on first use by the fetch handler below.
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'slip-parse.js',
  'slip.js',
  'styles.css',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates arrive when online), cache fallback when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
      )
  );
});
