/* sw.js — Nibbi's service worker: network-first for the shell (dev stays fresh), cache as offline fallback; never touches /api or /nibbi. */
const V = 'nibbi-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/nibbi.js', '/vendor/marked.js', '/vendor/qrcode.js', '/fonts/GeistVF.woff2', '/fonts/GeistMonoVF.woff2', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/nibbi/')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)).catch(() => {}); } return r; }).catch(() => caches.match(e.request).then((m) => m || (u.pathname === '/' ? caches.match('/index.html') : undefined)).then((m) => m || new Response('offline', { status: 503 }))));
});
