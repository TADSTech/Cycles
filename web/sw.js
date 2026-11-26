const CACHE_NAME = 'cycles-shell-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/transports.js', '/transfer.js', '/qr.js', '/zip.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.searchParams.get('share') === '1') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const files = formData.getAll('files');
      const text = formData.get('text') || formData.get('url') || '';
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: 'shared-intake', files, text });
      }
      return Response.redirect('/', 303);
    })());
    return;
  }

  if (event.request.method !== 'GET' || url.pathname === '/ws') return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
