// Minimal service worker: makes the app installable. Network-first, no offline caching of API/game data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
