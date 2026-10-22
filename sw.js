const C = 'rs-v9', SHELL = ['driver/', 'driver/index.html', 'driver/manifest.json', 'dispatch/', 'dispatch/index.html', 'dispatch/manifest.json', 'tokens.css', 'ui.css', 'icons.js', 'learn.js', './', 'index.html', 'style.css', 'app.js', 'cloud.js', 'fare.js', 'dispatch.js', 'transport.js', 'manifest.json', 'icons/icon.svg', 'vendor/nostr.js', 'data.js', 'map.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => { const u = new URL(e.request.url); if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request))); });
