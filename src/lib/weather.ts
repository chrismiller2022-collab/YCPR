// Game-day weather from Open-Meteo (https://open-meteo.com) — free, no API key, CORS-enabled, so it's called straight
// from the browser. Everything is requested in UTC (timezone=GMT) so an hourly slot lines up with a game's start_date
// without any timezone math; display converts back to local time.
//
// Coverage: the forecast endpoint serves roughly the last 3 months through 16 days ahead (past hours there are the
// model's best estimate of what happened). Older games go to the historical archive endpoint. Games more than ~15
// days out have no forecast yet.

import { cachedFetch } from "./api/cache";

export interface WeatherPoint {
  latitude: number;
  longitude: number;
}

/** One hour of conditions at a location. Units: °F, mph, inches, %. */
export interface WeatherHour {
  time: string; // UTC, "YYYY-MM-DDTHH:00"
  temp: number | null;
  feelsLike: number | null;
  humidity: number | null;
  precipProb: number | null; // null from the archive endpoint
  precip: number | null;
  rain: number | null;
  snow: number | null;
  code: number | null;
  cloudCover: number | null;
  wind: number | null;
  gust: number | null;
  windDir: number | null;
  isDay: boolean | null;
}

export type WeatherSource = "forecast" | "archive";

export interface GameWeatherSummary {
  source: WeatherSource;
  /** Hours from kickoff through the end of a typical game (≈3.5 hours). */
  hours: WeatherHour[];
  kickoff: WeatherHour;
  /** Most significant condition during the game window (thunder > snow > rain > fog > clouds > clear). */
  code: number | null;
  tempLow: number | null;
  tempHigh: number | null;
  maxPrecipProb: number | null;
  totalPrecip: number;
  totalSnow: number;
  avgWind: number | null;
  maxGust: number | null;
  avgCloud: number | null;
  flags: WeatherFlag[];
}

export type WeatherFlag = "wind" | "rain" | "snow" | "storms" | "cold" | "freezing" | "hot";

// ---------------------------------------------------------------------
// WMO weather codes (what Open-Meteo's weather_code returns)
// ---------------------------------------------------------------------

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

const WMO: Record<number, { label: string; kind: WeatherKind; severity: number }> = {
  0: { label: "Clear", kind: "clear", severity: 0 },
  1: { label: "Mostly clear", kind: "clear", severity: 1 },
  2: { label: "Partly cloudy", kind: "partly", severity: 2 },
  3: { label: "Overcast", kind: "cloudy", severity: 3 },
  45: { label: "Fog", kind: "fog", severity: 4 },
  48: { label: "Freezing fog", kind: "fog", severity: 5 },
  51: { label: "Light drizzle", kind: "drizzle", severity: 6 },
  53: { label: "Drizzle", kind: "drizzle", severity: 7 },
  55: { label: "Heavy drizzle", kind: "drizzle", severity: 8 },
  56: { label: "Freezing drizzle", kind: "drizzle", severity: 10 },
  57: { label: "Heavy freezing drizzle", kind: "drizzle", severity: 12 },
  61: { label: "Light rain", kind: "rain", severity: 9 },
  80: { label: "Rain showers", kind: "rain", severity: 9 },
  63: { label: "Rain", kind: "rain", severity: 11 },
  81: { label: "Heavy showers", kind: "rain", severity: 12 },
  65: { label: "Heavy rain", kind: "rain", severity: 13 },
  82: { label: "Violent showers", kind: "rain", severity: 14 },
  66: { label: "Freezing rain", kind: "rain", severity: 14 },
  67: { label: "Heavy freezing rain", kind: "rain", severity: 16 },
  77: { label: "Snow grains", kind: "snow", severity: 10 },
  71: { label: "Light snow", kind: "snow", severity: 12 },
  85: { label: "Snow showers", kind: "snow", severity: 13 },
  73: { label: "Snow", kind: "snow", severity: 15 },
  86: { label: "Heavy snow showers", kind: "snow", severity: 16 },
  75: { label: "Heavy snow", kind: "snow", severity: 17 },
  95: { label: "Thunderstorms", kind: "storm", severity: 18 },
  96: { label: "Thunderstorms, hail", kind: "storm", severity: 19 },
  99: { label: "Severe thunderstorms, hail", kind: "storm", severity: 20 },
};

export function weatherLabel(code: number | null | undefined): string {
  if (code == null) return "–";
  return WMO[code]?.label ?? `Code ${code}`;
}

export function weatherKind(code: number | null | undefined): WeatherKind | null {
  if (code == null) return null;
  return WMO[code]?.kind ?? null;
}

function severity(code: number | null): number {
  return code == null ? -1 : WMO[code]?.severity ?? code;
}

export function compassDir(deg: number | null | undefined): string {
  if (deg == null) return "";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// ---------------------------------------------------------------------
// Thresholds for the "this could matter" flags — wind is the one that moves totals most.
// ---------------------------------------------------------------------
export const WEATHER_THRESHOLDS = {
  windSustained: 15, // mph average over the game
  windGust: 25, // mph peak gust
  rainProb: 50, // % peak chance of precipitation
  rainAmount: 0.05, // inches over the game
  cold: 40, // °F at kickoff
  freezing: 32,
  hot: 90,
};

export const FLAG_LABELS: Record<WeatherFlag, string> = {
  wind: "Windy",
  rain: "Wet",
  snow: "Snow",
  storms: "Storms",
  cold: "Cold",
  freezing: "Freezing",
  hot: "Hot",
};

// ---------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------

const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "is_day",
];
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const DAY_MS = 24 * 3600 * 1000;
const FORECAST_PAST_DAYS = 85; // forecast endpoint keeps ~92 days of past hours; stay inside that
const FORECAST_AHEAD_DAYS = 15; // and ~16 days ahead
const LOCATIONS_PER_REQUEST = 40;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pointKey = (p: WeatherPoint) => `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;

/** Which endpoint can serve a kickoff, or null when it's too far out for a forecast. */
export function weatherSourceFor(kickoffIso: string, now = Date.now()): WeatherSource | null {
  const t = Date.parse(kickoffIso);
  if (!Number.isFinite(t)) return null;
  if (t > now + FORECAST_AHEAD_DAYS * DAY_MS) return null;
  if (t < now - FORECAST_PAST_DAYS * DAY_MS) return "archive";
  return "forecast";
}

/** Hourly series for one location, keyed by UTC hour ("YYYY-MM-DDTHH:00"). */
export type HourlySeries = Map<string, WeatherHour>;

function parseSeries(loc: any): HourlySeries {
  const h = loc?.hourly ?? {};
  const out: HourlySeries = new Map();
  const col = (name: string, i: number): number | null => {
    const v = h[name]?.[i];
    return v == null ? null : Number(v);
  };
  (h.time ?? []).forEach((time: string, i: number) => {
    const isDay = col("is_day", i);
    out.set(time, {
      time,
      temp: col("temperature_2m", i),
      feelsLike: col("apparent_temperature", i),
      humidity: col("relative_humidity_2m", i),
      precipProb: col("precipitation_probability", i),
      precip: col("precipitation", i),
      rain: col("rain", i),
      snow: col("snowfall", i),
      code: col("weather_code", i),
      cloudCover: col("cloud_cover", i),
      wind: col("wind_speed_10m", i),
      gust: col("wind_gusts_10m", i),
      windDir: col("wind_direction_10m", i),
      isDay: isDay == null ? null : isDay === 1,
    });
  });
  return out;
}

async function fetchBatch(source: WeatherSource, points: WeatherPoint[], startDate: string, endDate: string): Promise<HourlySeries[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.latitude.toFixed(4)).join(","),
    longitude: points.map((p) => p.longitude.toFixed(4)).join(","),
    hourly: HOURLY_VARS.filter((v) => source === "forecast" || v !== "precipitation_probability").join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "GMT",
    start_date: startDate,
    end_date: endDate,
  });
  const res = await fetch(`${source === "forecast" ? FORECAST_URL : ARCHIVE_URL}?${params}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) throw new Error(`Open-Meteo: ${body?.reason ?? res.statusText ?? res.status}`);
  // One location comes back as a bare object, several as an array (same order as requested).
  const list = Array.isArray(body) ? body : [body];
  return list.map(parseSeries);
}

export interface WeatherRequest {
  key: string; // caller's id (e.g. game id)
  point: WeatherPoint;
  kickoff: string; // ISO
}

/**
 * Hourly weather around each request's kickoff. Locations are de-duplicated and batched (Open-Meteo takes many
 * coordinates per call), so a full week of games is a handful of requests. Results are cached for 30 minutes.
 * Requests too far in the future are skipped (absent from the result).
 */
export async function fetchWeatherForKickoffs(reqs: WeatherRequest[], now = Date.now()): Promise<Map<string, { source: WeatherSource; series: HourlySeries }>> {
  const groups: Record<WeatherSource, Map<string, { point: WeatherPoint; times: number[] }>> = { forecast: new Map(), archive: new Map() };
  for (const r of reqs) {
    const source = weatherSourceFor(r.kickoff, now);
    if (!source) continue;
    const k = pointKey(r.point);
    const g = groups[source].get(k) ?? { point: r.point, times: [] };
    g.times.push(Date.parse(r.kickoff));
    groups[source].set(k, g);
  }

  const seriesByPoint = new Map<string, { source: WeatherSource; series: HourlySeries }>();
  const jobs: Promise<void>[] = [];
  for (const source of ["forecast", "archive"] as WeatherSource[]) {
    const entries = Array.from(groups[source].entries());
    for (let i = 0; i < entries.length; i += LOCATIONS_PER_REQUEST) {
      const chunk = entries.slice(i, i + LOCATIONS_PER_REQUEST);
      const times = chunk.flatMap(([, g]) => g.times);
      // UTC dates covering every kickoff in the chunk plus the hours after it (a late kickoff runs past midnight UTC;
      // a TBD kickoff's window spans the whole afternoon and evening).
      let start = ymd(Math.min(...times));
      let end = ymd(Math.max(...times) + 14 * 3600 * 1000);
      if (source === "forecast") {
        // Clamp to the forecast window so a boundary game can't make the whole batch fail.
        const lo = ymd(now - FORECAST_PAST_DAYS * DAY_MS);
        const hi = ymd(now + FORECAST_AHEAD_DAYS * DAY_MS);
        if (start < lo) start = lo;
        if (end > hi) end = hi;
      }
      const points = chunk.map(([, g]) => g.point);
      const cacheKey = `weather:${source}:${start}:${end}:${chunk.map(([k]) => k).join("|")}`;
      jobs.push(
        cachedFetch(cacheKey, () => fetchBatch(source, points, start, end), 30 * 60 * 1000).then((series) => {
          chunk.forEach(([k], j) => seriesByPoint.set(`${source}|${k}`, { source, series: series[j] ?? new Map() }));
        })
      );
    }
  }
  await Promise.all(jobs);

  const out = new Map<string, { source: WeatherSource; series: HourlySeries }>();
  for (const r of reqs) {
    const source = weatherSourceFor(r.kickoff, now);
    if (!source) continue;
    const hit = seriesByPoint.get(`${source}|${pointKey(r.point)}`);
    if (hit) out.set(r.key, hit);
  }
  return out;
}

// ---------------------------------------------------------------------
// Summarizing a game window
// ---------------------------------------------------------------------

const hourKey = (ms: number) => new Date(ms).toISOString().slice(0, 13) + ":00";

const max = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
};
const min = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
};
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/**
 * Conditions over a game: the kickoff hour plus the next three (a college game runs about 3.5 hours). For a TBD
 * kickoff, pass the date's midday and set `windowHours` wider to cover the whole possible window.
 */
export function summarizeGameWeather(series: HourlySeries, source: WeatherSource, kickoffIso: string, windowHours = 4): GameWeatherSummary | null {
  const k = Date.parse(kickoffIso);
  if (!Number.isFinite(k)) return null;
  const start = Math.floor(k / 3600000) * 3600000;
  const hours: WeatherHour[] = [];
  for (let i = 0; i < windowHours; i++) {
    const h = series.get(hourKey(start + i * 3600000));
    if (h) hours.push(h);
  }
  if (hours.length === 0) return null;
  const kickoff = hours[0];

  let code: number | null = null;
  for (const h of hours) if (severity(h.code) > severity(code)) code = h.code;

  const summary: GameWeatherSummary = {
    source,
    hours,
    kickoff,
    code,
    tempLow: min(hours.map((h) => h.temp)),
    tempHigh: max(hours.map((h) => h.temp)),
    maxPrecipProb: max(hours.map((h) => h.precipProb)),
    totalPrecip: sum(hours.map((h) => h.precip)),
    totalSnow: sum(hours.map((h) => h.snow)),
    avgWind: avg(hours.map((h) => h.wind)),
    maxGust: max(hours.map((h) => h.gust)),
    avgCloud: avg(hours.map((h) => h.cloudCover)),
    flags: [],
  };
  summary.flags = weatherFlags(summary);
  return summary;
}

export function weatherFlags(s: Omit<GameWeatherSummary, "flags">): WeatherFlag[] {
  const T = WEATHER_THRESHOLDS;
  const flags: WeatherFlag[] = [];
  const kind = weatherKind(s.code);
  if ((s.avgWind ?? 0) >= T.windSustained || (s.maxGust ?? 0) >= T.windGust) flags.push("wind");
  if (kind === "storm") flags.push("storms");
  if (s.totalSnow > 0 || kind === "snow") flags.push("snow");
  else if (s.totalPrecip >= T.rainAmount || (s.maxPrecipProb ?? 0) >= T.rainProb || kind === "rain") flags.push("rain");
  const t = s.kickoff.temp;
  if (t != null && t <= T.freezing) flags.push("freezing");
  else if (t != null && t <= T.cold) flags.push("cold");
  if (t != null && t >= T.hot) flags.push("hot");
  return flags;
}
