// Service worker — makes the app installable and lets the shell load
// offline. API requests are never cached (always live).
const CACHE = 'reps-v3';
const ASSETS = [
  '/', '/index.html', '/app.js', '/manifest.json', '/install', '/install.js',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache the API or non-GET requests.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
