// Строит data/europe.geojson и data/asia.geojson из Natural Earth (пакет world-atlas).
// Играбельные страны берутся из 50m (детальнее), фон — из 110m (легче).
// Запуск: cd tools && npm i && node build-geo.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as topojson from "topojson-client";
import { geoIdentity, geoArea } from "d3-geo";
import { geoProject } from "d3-geo-projection";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, "node_modules/world-atlas", f), "utf8"));

// Названия Natural Earth -> код страны. Несколько названий на один код = слияние.
const EUROPE = {
  Iceland: "IS", Norway: "NO", Sweden: "SE", Finland: "FI", Åland: "FI", Denmark: "DK",
  Estonia: "EE", Latvia: "LV", Lithuania: "LT",
  "United Kingdom": "GB", "Isle of Man": "GB", Jersey: "GB", Guernsey: "GB",
  Ireland: "IE", Netherlands: "NL", Belgium: "BE", Luxembourg: "LU",
  Germany: "DE", Poland: "PL", Czechia: "CZ", Slovakia: "SK", Austria: "AT",
  Switzerland: "CH", Liechtenstein: "LI", Hungary: "HU",
  France: "FR", Spain: "ES", Portugal: "PT", Andorra: "AD", Monaco: "MC",
  Italy: "IT", "San Marino": "SM", Vatican: "VA", Malta: "MT",
  Slovenia: "SI", Croatia: "HR", "Bosnia and Herz.": "BA", Serbia: "RS", Montenegro: "ME",
  Kosovo: "XK", Albania: "AL", Macedonia: "MK", Greece: "GR", Bulgaria: "BG",
  Romania: "RO", Moldova: "MD", Ukraine: "UA", Belarus: "BY",
  Russia: "RU", Turkey: "TR", Cyprus: "CY", "N. Cyprus": "CY",
  Georgia: "GE", Armenia: "AM", Azerbaijan: "AZ",
};

const ASIA = {
  Turkey: "TR", Cyprus: "CY", "N. Cyprus": "CY", Syria: "SY", Lebanon: "LB", Israel: "IL", Palestine: "PS",
  Jordan: "JO", Iraq: "IQ", Iran: "IR", "Saudi Arabia": "SA", Yemen: "YE", Oman: "OM",
  "United Arab Emirates": "AE", Qatar: "QA", Bahrain: "BH", Kuwait: "KW",
  Georgia: "GE", Armenia: "AM", Azerbaijan: "AZ", Kazakhstan: "KZ", Uzbekistan: "UZ", Turkmenistan: "TM",
  Kyrgyzstan: "KG", Tajikistan: "TJ", Afghanistan: "AF", Russia: "RU",
  Pakistan: "PK", India: "IN", Nepal: "NP", Bhutan: "BT", Bangladesh: "BD", "Sri Lanka": "LK", Maldives: "MV",
  China: "CN", "Hong Kong": "CN", Macao: "CN", Mongolia: "MN", "North Korea": "KP", "South Korea": "KR",
  Japan: "JP", Taiwan: "TW",
  Myanmar: "MM", Thailand: "TH", Laos: "LA", Cambodia: "KH", Vietnam: "VN", Malaysia: "MY", Singapore: "SG",
  Indonesia: "ID", Philippines: "PH", Brunei: "BN", "Timor-Leste": "TL",
};

// Рамка обрезки в градусах: [запад, юг, восток, север].
const CONTINENTS = [
  { out: "europe.geojson", data: "countries.json", names: EUROPE, box: [-75, 15, 140, 85] },
  { out: "asia.geojson", data: "asia.json", names: ASIA, box: [5, -20, 180, 82] },
];
let clipper;
// Без обрезки: только округление. Играбельные страны не режем — плоская обрезка по рамке
// у контура, выходящего за её край (Россия), рисовала ложные полосы вдоль края рамки.
const noClip = geoIdentity().reflectY(true);

function round(geom, digits) {
  const k = 10 ** digits;
  const ring = (r) => {
    const out = [];
    for (const [x, y] of r) {
      const p = [Math.round(x * k) / k, Math.round(-y * k) / k]; // обратно из reflectY
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    return out.length >= 4 ? out : null;
  };
  const poly = (p) => {
    const rings = p.map(ring).filter(Boolean);
    return rings.length ? rings : null;
  };
  if (geom.type === "Polygon") {
    const p = poly(geom.coordinates);
    return p ? { type: "Polygon", coordinates: p } : null;
  }
  if (geom.type === "MultiPolygon") {
    const ps = geom.coordinates.map(poly).filter(Boolean);
    if (!ps.length) return null;
    return ps.length === 1 ? { type: "Polygon", coordinates: ps[0] } : { type: "MultiPolygon", coordinates: ps };
  }
  return null;
}

function clip(geometry, digits, projection = clipper) {
  const projected = geoProject({ type: "Feature", properties: {}, geometry }, projection);
  if (!projected || !projected.geometry) return null;
  const g = round(projected.geometry, digits);
  if (!g) return null;
  // Защита от вывернутых колец: площадь «почти вся сфера» значит неправильную ориентацию.
  // Проверяем каждый полигон отдельно — после обрезки ориентация может сбиться у части из них.
  const fix = (coords) => {
    if (geoArea({ type: "Polygon", coordinates: coords }) <= 2 * Math.PI) return coords;
    return coords.map((r) => r.slice().reverse());
  };
  g.coordinates = g.type === "Polygon" ? fix(g.coordinates) : g.coordinates.map(fix);
  return g;
}

const detailed = load("countries-50m.json");
const coarse = load("countries-110m.json");

for (const { out: outFile, data, names, box } of CONTINENTS) {
  clipper = geoIdentity().reflectY(true).clipExtent([[box[0], -box[3]], [box[2], -box[1]]]);

  // Играбельные: сливаем по коду средствами topojson.merge (общие границы исчезают).
  const byCode = {};
  for (const g of detailed.objects.countries.geometries) {
    const code = names[g.properties.name];
    if (code) (byCode[code] ||= []).push(g);
  }
  const features = [];
  for (const [code, geoms] of Object.entries(byCode)) {
    const merged = geoms.length > 1 ? topojson.merge(detailed, geoms) : topojson.feature(detailed, geoms[0]).geometry;
    const g = clip(merged, 3, noClip);
    if (!g) throw new Error("Пустая геометрия: " + code);
    features.push({ type: "Feature", properties: { code }, geometry: g });
  }

  // Фон: всё остальное, что попадает в рамку, грубее и без кодов.
  const playableNames = new Set(Object.keys(names));
  for (const g of coarse.objects.countries.geometries) {
    if (playableNames.has(g.properties.name)) continue;
    const geom = clip(topojson.feature(coarse, g).geometry, 2);
    if (geom) features.push({ type: "Feature", properties: { bg: 1 }, geometry: geom });
  }

  const countries = JSON.parse(fs.readFileSync(path.join(root, "data", data), "utf8")).countries;
  const missing = countries.filter((c) => !byCode[c.code]).map((c) => c.code);
  if (missing.length) throw new Error("Нет на карте: " + missing.join(", "));

  const out = { type: "FeatureCollection", features };
  fs.writeFileSync(path.join(root, "data", outFile), JSON.stringify(out));
  console.log(`${outFile}: ${features.length} объектов, ${(JSON.stringify(out).length / 1024).toFixed(0)} КБ`);
}
