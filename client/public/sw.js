// Zagu Ordering Portal — Service Worker
const CACHE_NAME = "zagu-v1";
const API_CACHE = "zagu-api-v1";

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  "/zagu-ordering-portal/",
  "/zagu-ordering-portal/index.html",
  "/zagu-ordering-portal/icon-192x192.png",
  "/zagu-ordering-portal/icon-512x512.png",
  "/zagu-ordering-portal/zagu-logo.png",
];

// Install — pre-cache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching app shell");
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  // API calls: network-first, fall back to cache
  if (url.href.includes("zagu-api.tom-arai.workers.dev")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses (products, news)
          if (response.ok && (url.pathname.includes("/products/") || url.pathname.includes("/news/"))) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Google Fonts & CDN: cache-first
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // App shell & static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
