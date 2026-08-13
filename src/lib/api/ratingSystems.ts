import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";

export interface RatingPullRow {
  system_key: string;
  team: string;
  division: string | null;
  conference: string | null;
  value: number;
  pulled_at: string;
}

export async function fetchRatingPulls(): Promise<RatingPullRow[]> {
  return fetchAllRows<RatingPullRow>((from, to) =>
    supabase.from("rating_pulls").select("system_key, team, division, conference, value, pulled_at").range(from, to)
  );
}

export async function fetchRatingWeights(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("rating_system_weights").select("system_key, weight");
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of data ?? []) out[row.system_key] = Number(row.weight) || 0;
  return out;
}

// All ratings-related server calls go through one consolidated endpoint
// (api/ratings.ts), dispatched by an `action` field — Vercel's Hobby plan
// caps a deployment at 12 serverless functions (one per file in /api),
// and 5 separate files here would have pushed the project over that
// limit. Same behavior as before, just fewer files.
function authedPost(action: string, body: Record<string, any>) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  return fetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action, ...body }),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data;
  });
}

export function saveRatingWeights(weights: Record<string, number>) {
  return authedPost("weightsSave", { weights });
}

export function syncCfbdRatings(year: number) {
  return authedPost("sync", { year });
}

export async function fetchPublishedSheetCsv(): Promise<string> {
  const data = await authedPost("sheetProxy", {});
  return data.csv as string;
}

export interface RatingSaveRow {
  team: string;
  conference?: string | null;
  division?: string | null;
  values: Record<string, number>;
}

export function saveRatingRows(rows: RatingSaveRow[]) {
  return authedPost("save", { rows });
}

export function saveRatingWeek(season: number, week: number, rows: RatingSaveRow[]) {
  return authedPost("weekSave", { season, week, rows });
}

export interface WeeklyPowerRatingRow {
  season: number;
  week: number;
  team: string;
  division: string | null;
  conference: string | null;
  system_key: string;
  value: number;
}

export async function fetchWeeklyPowerRatings(season: number, week?: number): Promise<WeeklyPowerRatingRow[]> {
  return fetchAllRows<WeeklyPowerRatingRow>((from, to) => {
    let q = supabase
      .from("weekly_power_ratings")
      .select("season, week, team, division, conference, system_key, value")
      .eq("season", season);
    if (week != null) q = q.eq("week", week);
    return q.range(from, to);
  });
}

/** Distinct (season, week) pairs that have a saved snapshot — for the Save-As-Week picker and the Matchups page's week filter. */
export async function fetchSavedRatingWeeks(season: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("weekly_power_ratings")
    .select("week")
    .eq("season", season);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r: any) => r.week as number))).sort((a, b) => a - b);
}
