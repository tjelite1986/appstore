/* App Store service worker.
 *
 * It exists to be registered, which is half of what makes the store
 * installable, and deliberately does nothing else. There is no fetch handler:
 * APK downloads are large, some are signed redirects to GitHub, and icons of
 * 18+ listings are gated per account — a cache here could only get one of
 * those wrong. Every request goes to the network as if no worker existed.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.clients.claim();
    })()
  )
);
