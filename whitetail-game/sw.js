/* Whitetail Country: keeps a copy of the game on the phone so it opens and plays with no signal.
   With a signal it always fetches the newest files first and refreshes its copy; without one (or on a connection too
   slow to answer in a few seconds) it plays from the copy. Saves are not kept here: they live in the browser's own storage. */
const CACHE = 'whitetail-country-1';
const FILES = ['./', 'index.html', 'config.js', 'sim.js', 'antlers.js', 'deerart.js', 'game.js', 'ui-core.js', 'ui-map.js', 'ui-hunt.js', 'ui-books.js',
  'fonts/press-start-2p.woff2', 'fonts/vt323.woff2', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fromCopy = () => caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()));
  const fresh = fetch(e.request).then((r) => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; });
  const slow = new Promise((resolve) => setTimeout(resolve, 4000, null));
  e.respondWith(Promise.race([fresh.catch(() => null), slow]).then((r) => (r && r.ok ? r : fromCopy().then((c) => (c && c.ok ? c : fresh.catch(() => c))))));
});
