// Observed game-window weather for TRAINING, from Meteostat's free bulk station archive (no key, no daily quota):
// the nearest station with hourly data to each stadium, kickoff hour + the next 3 hours (UTC), converted to the
// units src/lib/weather.ts reports (mph, inches, °F) so weatherFeatureVector() reads training and live data alike.
// Live projections use Open-Meteo forecasts instead (forecast error is real and is part of what a bet faces).
//   bun scripts/totals_v2/weather_meteostat.ts      (after pull.ts)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { gameLocation, type GameWeatherInputs } from "../../src/lib/totals2/weatherFeatures";

const DIR = new URL("./data/", import.meta.url).pathname;
const CACHE = `${DIR}meteostat/`;
mkdirSync(CACHE, { recursive: true });
const load = (n: string) => JSON.parse(readFileSync(`${DIR}${n}.json`, "utf8"));

async function fetchGz(url: string, path: string): Promise<string | null> {
  if (existsSync(path)) return readFileSync(path, "utf8");
  const r = await fetch(url);
  if (r.status === 404) {
    writeFileSync(path, "");
    return "";
  }
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const txt = gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
  writeFileSync(path, txt);
  return txt;
}

const stationsTxt = await fetchGz("https://bulk.meteostat.net/v2/stations/lite.json.gz", `${CACHE}stations.json`);
const stations: any[] = JSON.parse(stationsTxt!).filter((s: any) => s.inventory?.hourly?.start && s.location?.latitude != null);
const km = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
function nearest(lat: number, lon: number, year: number): any[] {
  return stations
    .filter((s) => s.inventory.hourly.start.slice(0, 4) <= String(year) && s.inventory.hourly.end.slice(0, 4) >= String(year))
    .map((s) => ({ s, d: km(lat, lon, s.location.latitude, s.location.longitude) }))
    .filter((x) => x.d <= 60)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.s);
}

type Hour = { temp: number | null; prcp: number | null; wspd: number | null; wpgt: number | null; coco: number | null };
const yearCache = new Map<string, Map<string, Hour> | null>();
async function stationYear(id: string, year: number): Promise<Map<string, Hour> | null> {
  const k = `${id}|${year}`;
  if (yearCache.has(k)) return yearCache.get(k)!;
  let txt: string | null = null;
  try {
    txt = await fetchGz(`https://bulk.meteostat.net/v2/hourly/${year}/${id}.csv.gz`, `${CACHE}${id}_${year}.csv`);
  } catch {
    txt = null;
  }
  if (!txt) {
    yearCache.set(k, null);
    return null;
  }
  const m = new Map<string, Hour>();
  const n = (v: string) => (v === "" || v == null ? null : Number(v));
  for (const line of txt.split("\n")) {
    const c = line.split(",");
    if (c.length < 13) continue;
    m.set(`${c[0]}T${c[1].padStart(2, "0")}`, { temp: n(c[2]), prcp: n(c[5]), wspd: n(c[8]), wpgt: n(c[9]), coco: n(c[12]) });
  }
  yearCache.set(k, m);
  return m;
}

const SNOW = new Set([14, 15, 16, 21, 22]);
const games = load("games");
const vn = Object.fromEntries(load("venues").map((r: any) => [r.id, r]));
const tv = Object.fromEntries(load("team_venues").map((r: any) => [r.team, r]));
const out: Record<string, GameWeatherInputs & { station?: string }> = {};
let i = 0, hit = 0;
for (const g of games) {
  if (g.home_classification !== "fbs" && g.away_classification !== "fbs") continue;
  if (!g.start_date || g.start_time_tbd) continue;
  const loc = gameLocation(g, vn, tv);
  if (!loc) continue;
  if (++i % 1000 === 0) console.log(i, "games,", hit, "with weather");
  if (loc.dome) {
    out[g.id] = { dome: true, avgWind: null, maxGust: null, precip: null, snow: null, temp: null };
    continue;
  }
  const t0 = Math.floor(Date.parse(g.start_date) / 3600000) * 3600000;
  if (t0 > Date.now()) continue;
  for (const st of nearest(loc.latitude, loc.longitude, new Date(t0).getUTCFullYear())) {
    const yr = await stationYear(st.id, new Date(t0).getUTCFullYear());
    if (!yr) continue;
    const hours: Hour[] = [];
    for (let h = 0; h < 4; h++) {
      const d = new Date(t0 + h * 3600000).toISOString();
      const x = yr.get(`${d.slice(0, 10)}T${d.slice(11, 13)}`);
      if (x) hours.push(x);
    }
    const winds = hours.map((h) => h.wspd).filter((v): v is number => v != null);
    if (winds.length < 2) continue; // try the next-nearest station
    const prcps = hours.map((h) => h.prcp).filter((v): v is number => v != null);
    const gusts = hours.map((h) => h.wpgt).filter((v): v is number => v != null);
    const MPH = 0.621371;
    out[g.id] = {
      dome: false,
      avgWind: (winds.reduce((a, b) => a + b, 0) / winds.length) * MPH,
      maxGust: gusts.length ? Math.max(...gusts) * MPH : null,
      precip: prcps.length ? prcps.reduce((a, b) => a + b, 0) / 25.4 : null,
      snow: hours.some((h) => h.coco != null && SNOW.has(h.coco)) ? 1 : 0,
      temp: hours[0].temp == null ? null : (hours[0].temp * 9) / 5 + 32,
      station: st.id,
    };
    hit++;
    break;
  }
}
writeFileSync(`${DIR}weather.json`, JSON.stringify(out));
console.log("games with weather", Object.keys(out).length, "observed", hit);
