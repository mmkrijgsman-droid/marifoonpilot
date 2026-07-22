/* MarifoonPilot v2 – service worker (offline app-shell + kaarttegel-cache) */
const VERSION = "mp2-v2.1.0";
const SHELL = "shell-" + VERSION;
const TILES = "tiles-" + VERSION;

const SHELL_FILES = [
  "./", "./index.html", "./app.js", "./data.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
  "./vendor/leaflet/leaflet.js", "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/marker-icon.png", "./vendor/leaflet/images/marker-shadow.png",
  "./depth/diepte.geojson"
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES).catch(()=>{})));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/tile\.openstreetmap|openseamap|arcgisonline/.test(url.href)) {
    e.respondWith(caches.open(TILES).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) { cache.put(req, res.clone()); trim(TILES, 800); } return res; }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)).catch(()=>{}); return res;
  }).catch(() => caches.match("./index.html"))));
});
async function trim(name, max) {
  const cache = await caches.open(name); const keys = await cache.keys();
  if (keys.length > max) for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
