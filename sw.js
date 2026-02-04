// Zagu Ordering Portal — Service Worker v2
const CACHE_NAME = "zagu-v2";
const API_CACHE = "zagu-api-v2";

const PRECACHE_URLS = [
  "/zagu-ordering-portal/",
  "/zagu-ordering-portal/index.html",
];

// Install — pre-cache shell, skip waiting immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching app shell (v2)");
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — purge ALL old caches so updates take effect
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== API_CACHE)
          .map((key) => {
            console.log("[SW] Purging old cache:", key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  // API calls: network-first, cache fallback for products/news
  if (url.href.includes("zagu-api.tom-arai.workers.dev")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
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

  // Google Fonts & CDN: cache-first (these never change)
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

  // App shell & assets: network-first with cache fallback
  // This ensures updates are picked up immediately when online
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Listen for skip waiting message from client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
