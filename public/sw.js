/*
 * geosketch service worker — offline app shell, no dependencies.
 *
 * Strategy:
 * - Navigations (`request.mode === 'navigate'`): network-first with a cached
 *   fallback. A fresh deploy must reach returning clients on the next visit;
 *   offline still serves the last cached shell.
 * - Other same-origin GETs (Vite's content-hashed assets): cache-first, since a
 *   cached hit is always the exact file that belongs to that URL.
 */
const CACHE = 'geosketch-v2';
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

/** Only store complete, same-origin responses: an opaque or partial reply would poison the cache. */
function cacheIfUsable(request, response) {
  if (response.status === 200 && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => cacheIfUsable(request, response))
        .catch(async () => (await caches.match(request)) ?? (await caches.match('./')) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => cacheIfUsable(request, response));
    }),
  );
});
