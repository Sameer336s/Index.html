// Retire the old cache-first worker so account and score responses are never cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('neonslide-')) await caches.delete(key);
  await self.clients.claim();
})()));
