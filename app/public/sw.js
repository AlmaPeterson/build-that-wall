// The game is a website only for now, so it no longer installs as an app. Browsers that installed the earlier
// offline helper fetch this file, which deletes its saved files and removes itself. Keep it for a few months.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
