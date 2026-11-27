const CACHE_NAME = 'invexaretail-v4';
const RUNTIME_CACHE = 'invexaretail-runtime-v4';

const PUBLIC_FILES = [
  '/index.html',
  '/favicon-32.png',
  '/favicon-16.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PUBLIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key =>
        key.startsWith('invexaretail-') &&
        key !== CACHE_NAME &&
        key !== RUNTIME_CACHE
      ).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Never cache API or authenticated requests.
  if (/^\/(api|control|studio|sync)(\/|$)/.test(url.pathname)) return;
  if (/^\/(health|ready|meta)(\/|$)/.test(url.pathname)) return;
  if (request.headers.has('Authorization')) return;

  // Network-first navigation with public shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .catch(() => caches.match('/index.html')
          .then(response => response || Response.error()))
    );
    return;
  }

  // Cache only public static files.
  if (
    PUBLIC_FILES.includes(url.pathname) ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
        return response;
      })
    );
  }
});
