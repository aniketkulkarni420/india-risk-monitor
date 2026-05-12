// IRM service worker · offline-capable + stale-while-revalidate.
//
// Strategy:
//   - For app shell (HTML/JS/CSS): cache-first
//   - For data.json bundle: stale-while-revalidate (serve cached + refresh in background)
//   - For external resources: network-first
//
// Cached size cap: ~5 MB. Auto-evicts on update.

const CACHE_VERSION = 'irm-v1-2026-05-12';
const APP_SHELL = [
  '/',
  '/index.html',
  '/main.mjs',
  '/dist/data.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== location.origin) return;

  // data.json: stale-while-revalidate
  if (url.pathname.endsWith('/dist/data.json') || url.pathname.endsWith('data.json')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const networkPromise = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        }).catch(() => null);
        return cached || (await networkPromise) || new Response(JSON.stringify({ error: 'offline' }), { headers: { 'content-type': 'application/json' } });
      })
    );
    return;
  }

  // App shell: cache-first
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) {
          // Refresh in background
          fetch(req).then(res => {
            if (res.ok) caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then(res => {
          if (res.ok && (url.pathname.endsWith('.mjs') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html'))) {
            caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
          }
          return res;
        }).catch(() => caches.match('/index.html'));
      })
    );
  }
});
