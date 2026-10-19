// Строит контуры частей света (data/*.geojson) из Natural Earth (пакет world-atlas).
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

const AFRICA = {
  Morocco: "MA", Algeria: "DZ", Tunisia: "TN", Libya: "LY", Egypt: "EG", Sudan: "SD", "W. Sahara": "EH",
  Mauritania: "MR", Senegal: "SN", Gambia: "GM", "Guinea-Bissau": "GW", Guinea: "GN", "Sierra Leone": "SL",
  Liberia: "LR", "Côte d'Ivoire": "CI", Mali: "ML", "Burkina Faso": "BF", Ghana: "GH", Togo: "TG", Benin: "BJ",
  Niger: "NE", Nigeria: "NG", "Cabo Verde": "CV",
  Chad: "TD", Cameroon: "CM", "Central African Rep.": "CF", "Eq. Guinea": "GQ", Gabon: "GA", Congo: "CG",
  "Dem. Rep. Congo": "CD", "São Tomé and Principe": "ST",
  "S. Sudan": "SS", Ethiopia: "ET", Eritrea: "ER", Djibouti: "DJ", Somalia: "SO", Somaliland: "SO", Kenya: "KE",
  Uganda: "UG", Rwanda: "RW", Burundi: "BI", Tanzania: "TZ", Seychelles: "SC", Comoros: "KM", Madagascar: "MG",
  Mauritius: "MU",
  Angola: "AO", Zambia: "ZM", Malawi: "MW", Mozambique: "MZ", Zimbabwe: "ZW", Namibia: "NA", Botswana: "BW",
  "South Africa": "ZA", Lesotho: "LS", eSwatini: "SZ",
};

const SAMERICA = {
  Colombia: "CO", Venezuela: "VE", Guyana: "GY", Suriname: "SR", Ecuador: "EC", Peru: "PE", Bolivia: "BO",
  Chile: "CL", Brazil: "BR", Paraguay: "PY", Uruguay: "UY", Argentina: "AR",
};

// Рамка обрезки фона в градусах: [запад, юг, восток, север].
const CONTINENTS = [
  { out: "europe.geojson", data: "countries.json", names: EUROPE, box: [-75, 15, 140, 85] },
  { out: "asia.geojson", data: "asia.json", names: ASIA, box: [5, -20, 180, 82] },
  { out: "africa.geojson", data: "africa.json", names: AFRICA, box: [-40, -45, 75, 45] },
  { out: "samerica.geojson", data: "samerica.json", names: SAMERICA, box: [-110, -62, -20, 20] },
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

// Кольца, пересекающие 180-й меридиан (Фиджи, Чукотка), плоская обрезка превращает
// в полосу через всю карту. Для фона их проще выбросить.
function dropAntimeridian(geom) {
  if (!geom) return null;
  const bad = (poly) => poly[0].some(([x]) => x > 170) && poly[0].some(([x]) => x < -170);
  const polys = (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates).filter((p) => !bad(p));
  if (!polys.length) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
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
    const geom = clip(dropAntimeridian(topojson.feature(coarse, g).geometry), 2);
    if (geom) features.push({ type: "Feature", properties: { bg: 1 }, geometry: geom });
  }

  const countries = JSON.parse(fs.readFileSync(path.join(root, "data", data), "utf8")).countries;
  const missing = countries.filter((c) => !byCode[c.code]).map((c) => c.code);
  if (missing.length) throw new Error("Нет на карте: " + missing.join(", "));

  // Защита от ложных полос: широкий и очень низкий по широте объект — почти наверняка артефакт.
  for (const f of features) {
    let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
    const walk = (a) => (Array.isArray(a[0]) ? a.forEach(walk) : (x0 = Math.min(x0, a[0]), x1 = Math.max(x1, a[0]), y0 = Math.min(y0, a[1]), y1 = Math.max(y1, a[1])));
    walk(f.geometry.coordinates);
    if (x1 - x0 > 60 && y1 - y0 < 5) throw new Error(`${outFile}: подозрительная полоса ${JSON.stringify(f.properties)}`);
  }

  const out = { type: "FeatureCollection", features };
  fs.writeFileSync(path.join(root, "data", outFile), JSON.stringify(out));
  console.log(`${outFile}: ${features.length} объектов, ${(JSON.stringify(out).length / 1024).toFixed(0)} КБ`);
}
