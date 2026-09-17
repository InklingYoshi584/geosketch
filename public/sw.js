/*
 * geosketch service worker — offline app shell, no dependencies.
 *
 * Strategy: cache-first for same-origin GETs, falling back to the network and
 * caching what comes back. Vite emits content-hashed assets, so a cached hit is
 * always the file that belongs to that URL; `index.html` is precached and any
 * miss (a fresh deploy, a query string) simply goes to the network.
 */
const CACHE = 'geosketch-v1';
const PRECACHE = ['./', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only store complete, same-origin responses: caching an opaque or
        // partial reply would poison the cache for the next visit.
        if (response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
