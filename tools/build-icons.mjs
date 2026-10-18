// Генерирует icons/*.png: силуэт Европы на синем фоне (SVG -> PNG через Chromium/Playwright).
// Запуск: cd tools && node build-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { geoConicConformal, geoPath } from "d3-geo";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const geo = JSON.parse(fs.readFileSync(path.join(root, "data/europe.geojson"), "utf8"));
const countries = JSON.parse(fs.readFileSync(path.join(root, "data/countries.json"), "utf8")).countries;
const base = new Set(countries.filter((c) => !c.group).map((c) => c.code));
const land = { type: "FeatureCollection", features: geo.features.filter((f) => base.has(f.properties.code)) };

function iconSvg(size, safe) {
  const pad = size * safe;
  const proj = geoConicConformal().parallels([40, 62]).rotate([-14, 0])
    .fitExtent([[pad, pad], [size - pad, size - pad]], { type: "MultiPoint", coordinates: [[-10, 36], [-22, 66], [26, 71], [40, 49], [28, 35]] })
    .clipExtent([[0, 0], [size, size]]);
  const p = geoPath(proj);
  const d = land.features.map((f) => p(f)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b7cf5"/><stop offset="1" stop-color="#1d4fc4"/></linearGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <path d="${d}" fill="#ffffff" stroke="#1d4fc4" stroke-width="${size / 400}" stroke-linejoin="round"/>
    <circle cx="${proj([2.35, 48.86])[0]}" cy="${proj([2.35, 48.86])[1]}" r="${size * 0.028}" fill="#ff5a4e" stroke="#fff" stroke-width="${size * 0.008}"/>
  </svg>`;
}

const targets = [
  ["icon-180.png", 180, 0.1],
  ["icon-192.png", 192, 0.1],
  ["icon-512.png", 512, 0.1],
  ["icon-maskable-512.png", 512, 0.2],
];

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
fs.mkdirSync(path.join(root, "icons"), { recursive: true });
for (const [name, size, safe] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${iconSvg(size, safe)}</body></html>`);
  await page.screenshot({ path: path.join(root, "icons", name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log("icons/" + name);
}
fs.writeFileSync(path.join(root, "icons/icon.svg"), iconSvg(512, 0.1));
await browser.close();
