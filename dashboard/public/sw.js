// Minimal service worker: lets Chrome install the dashboard as an app.
// It does NOT cache anything — all data stays live from Convex.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* network only */
});
