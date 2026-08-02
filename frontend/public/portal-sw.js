// Deliberately does no caching — this only exists to satisfy the browser's PWA
// installability requirement (a fetch handler must be registered). Every request
// still goes to the network, so a shipped update is never masked by a stale cache.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
