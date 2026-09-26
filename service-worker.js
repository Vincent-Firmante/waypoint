const CACHE_NAME = "waypoint-shell-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => (cacheName.startsWith("waypoint-shell-") || cacheName.startsWith("fieldnote-shell-")) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cacheKey = event.request.mode === "navigate" ? "./index.html" : event.request;
      try {
        const response = await fetch(event.request);
        if (response.ok) cache.put(cacheKey, response.clone()).catch(() => {});
        return response;
      } catch (error) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) return cachedResponse;
        throw error;
      }
    }),
  );
});