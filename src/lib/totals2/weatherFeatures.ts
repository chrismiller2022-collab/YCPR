// Game-window weather → model inputs. Shared by the offline training run (scripts/totals_v2) and the live page, so a
// feature means the same thing in both. Raw conditions come from src/lib/weather.ts (Open-Meteo, kickoff hour + 3).

export interface GameWeatherInputs {
  dome: boolean;
  avgWind: number | null; // mph, average over the game window
  maxGust: number | null;
  precip: number | null; // inches over the window
  snow: number | null;
  temp: number | null; // °F at kickoff
}

export interface LocRow {
  latitude: number | string | null;
  longitude: number | string | null;
  dome: boolean | null;
}

/** Where a game is played: the game's own venue when on file, else the home team's stadium (not for neutral sites). */
export function gameLocation(
  g: { venue_id?: number | null; neutral_site?: boolean | null; home_team: string },
  venues: Record<number, LocRow>,
  teamVenues: Record<string, LocRow>
): { latitude: number; longitude: number; dome: boolean } | null {
  const v = (g.venue_id != null ? venues[g.venue_id] : undefined) ?? (g.neutral_site ? undefined : teamVenues[g.home_team]);
  if (!v || v.latitude == null || v.longitude == null) return null;
  return { latitude: Number(v.latitude), longitude: Number(v.longitude), dome: !!v.dome };
}

// The thresholds below are where scoring visibly starts to drop in 2021-25 college games; the coefficients on them
// are fit by the residual model (how much of the effect the market already prices).
export const WIND_FLOOR_MPH = 10;
export const WEATHER_FEATURES = ["windOver10", "wind15", "rain", "snow", "cold", "dome"] as const;
export type WeatherFeature = (typeof WEATHER_FEATURES)[number];

/** Model inputs for one game. Unknown weather (no location / no data yet) = all zeros, i.e. "ordinary conditions". */
export function weatherFeatureVector(w: GameWeatherInputs | null | undefined): Record<WeatherFeature, number> {
  const out: Record<WeatherFeature, number> = { windOver10: 0, wind15: 0, rain: 0, snow: 0, cold: 0, dome: 0 };
  if (!w) return out;
  if (w.dome) {
    out.dome = 1;
    return out;
  }
  const wind = w.avgWind ?? 0;
  out.windOver10 = Math.min(15, Math.max(0, wind - WIND_FLOOR_MPH)); // mph above 10, capped (25+ mph games are rare)
  out.wind15 = wind >= 15 ? 1 : 0;
  out.rain = Math.min(1, w.precip ?? 0) >= 0.1 ? 1 : 0;
  out.snow = (w.snow ?? 0) > 0 ? 1 : 0;
  out.cold = w.temp == null ? 0 : Math.max(0, 40 - w.temp) / 10; // per 10°F below 40
  return out;
}
