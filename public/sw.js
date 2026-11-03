const CACHE_VERSION = 'v2';
const CACHE_NAME = `gileh-kord-shell-${CACHE_VERSION}`;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

/**
 * Extracts built Vite asset URLs (/assets/...) referenced in index.html
 * so the entire application bundle is available offline after first visit.
 */
async function preCacheAppShell(cache) {
  await cache.addAll(CORE_ASSETS);
  try {
    const response = await fetch('/index.html', { cache: 'no-cache' });
    if (!response || !response.ok) return;
    const html = await response.text();
    const assetMatches = Array.from(
      html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g),
      (m) => m[1]
    );
    if (assetMatches.length > 0) {
      await cache.addAll(assetMatches);
    }
  } catch (_) {
    // Ignore network errors if offline during install check
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => preCacheAppShell(cache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('gileh-kord-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation =
    request.mode === 'navigate' ||
    request.headers.get('accept')?.includes('text/html');

  if (isNavigation) {
    // Network-First for HTML navigation to avoid serving stale index.html indefinitely
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request)) || (await caches.match('/index.html'));
          return cached || Response.error();
        })
    );
    return;
  }

  // Cache-First with runtime caching for hashed static assets (/assets/*, icons, etc.)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then((networkResponse) => {
        if (
          !networkResponse ||
          !networkResponse.ok ||
          networkResponse.status !== 200 ||
          networkResponse.type !== 'basic'
        ) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
