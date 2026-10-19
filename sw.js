/* Service worker: кэширует всё приложение для работы офлайн. */
const VERSION = "geogame-v7";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "vendor/d3.min.js",
  "data/countries.json",
  "data/europe.geojson",
  "data/asia.json",
  "data/asia.geojson",
  "data/africa.json",
  "data/africa.geojson",
  "data/samerica.json",
  "data/samerica.geojson",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала кэш, затем сеть; навигация офлайн всегда получает index.html.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});
