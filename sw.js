/* MarifoonPilot v2 – service worker (offline app-shell + kaarttegel-cache) */
// Tegel-hosts uit config.js halen, zodat een nieuwe kaartprovider maar op één plek staat.
// NIET zelf TILE_HOSTS declareren: config.js doet dat met const, en twee declaraties in
// dezelfde global scope laten importScripts stilletjes falen.
const HOST_FALLBACK = ["tile.openstreetmap.org", "tiles.openseamap.org", "server.arcgisonline.com"];
try { importScripts("config.js?v=5.1.0"); } catch (e) { console.warn("sw: config.js niet geladen", e); }
const HOSTS = (typeof TILE_HOSTS !== "undefined" && Array.isArray(TILE_HOSTS)) ? TILE_HOSTS : HOST_FALLBACK;

const VERSION = "mp2-v5.1.0";
const SHELL = "shell-" + VERSION;
const TILES = "tiles-" + VERSION;
// Dieptetegels apart: die worden pas tijdens het varen opgehaald en mogen de app-shell
// niet laten groeien. Eigen cache betekent ook dat we ze kunnen aftoppen zonder de
// app-bestanden te raken. Zie tools/build-depth-rws.py voor waar ze vandaan komen.
const DEPTH = "depth-" + VERSION;

const SHELL_FILES = [
  // app.js/data.js met dezelfde ?v= als in index.html, anders cachet de SW een andere URL
  "./", "./index.html", "./config.js?v=5.1.0", "./app.js?v=5.1.0", "./data.js?v=5.1.0",
  "./vhf-points.js?v=5.1.0", "./fairway-depths.js?v=5.1.0", "./obstacles.js?v=5.1.0", "./stations.js?v=5.1.0", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
  "./vendor/leaflet/leaflet.js", "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/marker-icon.png", "./vendor/leaflet/images/marker-shadow.png",
  "./depth/diepte.geojson", "./depth/ijsselmeergebied.json", "./depth/rws/index.json"
];

self.addEventListener("install", e => {
  // Bewust GEEN skipWaiting(): een nieuwe versie blijft wachten tot de gebruiker akkoord
  // gaat. Zo wisselt de app niet onder je handen van versie terwijl je vaart, en kan de
  // app betrouwbaar zien dat er een update klaarstaat (registration.waiting).
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES).catch(()=>{})));
});
// De app vraagt om over te schakelen zodra de gebruiker op OK tikt.
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== SHELL && k !== TILES && k !== DEPTH).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Alleen eigen bestanden en kaarttegels afhandelen. Andere cross-origin requests (API's e.d.)
  // volledig met rust laten — anders kregen die bij een netwerkfout de app-HTML terug met status 200.
  const sameOrigin = url.origin === self.location.origin;
  const isTile = HOSTS.some(h => url.hostname === h || url.hostname.endsWith("." + h));
  if (!sameOrigin && !isTile) return;
  // Dieptetegels: cache-first en blijvend. Een loding verandert niet tussen twee tochten,
  // en juist buiten bereik van de wal wil je hem hebben.
  if (sameOrigin && url.pathname.endsWith(".mpd")) {
    e.respondWith(caches.open(DEPTH).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) { cache.put(req, res.clone()); trim(DEPTH, 400); } return res; }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  if (isTile) {
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
  }).catch(() => req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
});
async function trim(name, max) {
  const cache = await caches.open(name); const keys = await cache.keys();
  if (keys.length > max) for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
