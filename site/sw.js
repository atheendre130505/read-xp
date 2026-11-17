// Makes Read XP installable (Brave / Chrome need a service worker) and readable offline:
// the app shell and the issues you opened are cached; the network is always tried first so issues are never stale.
const CACHE = "rxp-v5";
const ROOT = new URL("./", self.location).pathname;
const SHELL = ["", "style.css", "app.js", "md.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "sample.json"].map(p => ROOT + p);
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (req.method !== "GET" || (!fonts && (url.origin !== location.origin || !url.pathname.startsWith(ROOT)))) return;  // Gemini etc. untouched
  if (fonts) {                                    // fonts never change: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)); return res; })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match(ROOT))));
});
