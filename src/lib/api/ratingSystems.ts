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

/** Writes YC into weekly_team_stats.rating for the given week (site-wide "live rating" source), without touching any other column on those rows. */
export function pushYcToLiveRatings(week: string, teamRatings: { team: string; rating: number }[]) {
  return authedPost("pushYc", { week, teamRatings });
}

/** Snapshots the SOS admin page's computed rows into team_sos, keyed by (season, week, team) — see src/pages/SosAdminPanel.tsx for the row shape. Week-scoped: saving a later week never touches an earlier week's saved snapshot. */
export function saveSosToSite(season: number, week: number, rows: any[]) {
  return authedPost("saveSos", { season, week, rows });
}

/** Distinct week numbers with a saved SOS snapshot for this season — used by the Publish status grid. */
export async function fetchTeamSosAvailableWeeks(season: number): Promise<number[]> {
  const { data, error } = await supabase.from("team_sos").select("week").eq("season", season);
  if (error) throw error;
  const set = new Set<number>();
  for (const row of (data ?? []) as { week: number | null }[]) {
    if (row.week != null) set.add(row.week);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export interface TeamSosRow {
  season: number;
  week: number;
  team: string;
  updated_at: string;
  avg_opp_pr_total: number | null;
  avg_opp_pr_conference: number | null;
  sos_srs_total: number | null;
  sos_srs_conference: number | null;
  num_srs_runs: number | null;
  best_win_pr_total: number | null;
  best_win_pr_total_opp: string | null;
  best_win_pr_conference: number | null;
  best_win_pr_conference_opp: string | null;
  best_loss_pr_total: number | null;
  best_loss_pr_total_opp: string | null;
  best_loss_pr_conference: number | null;
  best_loss_pr_conference_opp: string | null;
  worst_loss_pr_total: number | null;
  worst_loss_pr_total_opp: string | null;
  worst_loss_pr_conference: number | null;
  worst_loss_pr_conference_opp: string | null;
}

/** Public read of the SOS admin page's last saved snapshot for a season — team -> row. */
/** Latest saved week's row per team for this season — team_sos can now have multiple rows per team (one per saved week; see the "week" column), so this picks the highest week number available for each team rather than assuming exactly one row. */
/** Latest saved week's row per team for this season — team_sos can now have multiple rows per team (one per saved week; see the "week" column), so this picks the highest week number available for each team rather than assuming exactly one row. */
export async function fetchTeamSos(season: number): Promise<Record<string, TeamSosRow>> {
  const rows = await fetchAllRows<TeamSosRow>((from, to) =>
    supabase.from("team_sos").select("*").eq("season", season).range(from, to)
  );
  const out: Record<string, TeamSosRow> = {};
  for (const r of rows) {
    const existing = out[r.team];
    if (!existing || r.week > existing.week) out[r.team] = r;
  }
  return out;
}

/** Every saved week's SOS-via-SRS value for every team, indexed by week then team — for Weekly Progression, which needs each week's own snapshot side by side, not just the latest. */
export async function fetchTeamSosByWeeks(season: number): Promise<{ weeks: number[]; byWeek: Record<number, Record<string, number | null>> }> {
  const rows = await fetchAllRows<TeamSosRow>((from, to) =>
    supabase.from("team_sos").select("*").eq("season", season).range(from, to)
  );
  const weekSet = new Set<number>();
  const byWeek: Record<number, Record<string, number | null>> = {};
  for (const r of rows) {
    weekSet.add(r.week);
    if (!byWeek[r.week]) byWeek[r.week] = {};
    byWeek[r.week][r.team] = r.sos_srs_total ?? null;
  }
  return { weeks: Array.from(weekSet).sort((a, b) => a - b), byWeek };
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
