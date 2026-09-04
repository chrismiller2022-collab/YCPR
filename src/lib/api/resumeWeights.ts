import { supabase } from "../supabaseClient";

export async function fetchResumeWeights(season: number): Promise<Record<string, number> | null> {
  const { data, error } = await supabase
    .from("resume_rating_weights")
    .select("weights")
    .eq("season", season)
    .maybeSingle();
  if (error) throw error;
  return (data?.weights as Record<string, number>) ?? null;
}

/** Snapshots this week's computed Resume Rating scores into team_resume_ratings, keyed by (season, week, team) — week-scoped from the start, mirroring the SOS fix. */
export async function saveResumeRatingsToSite(season: number, week: number, rows: { team: string; score: number | null; actWins: number | null; losses: number | null }[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "saveResumeRatings", season, week, rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

/** Distinct week numbers with a saved Resume Ratings snapshot for this season — used by the Publish status grid. */
export async function fetchResumeRatingsAvailableWeeks(season: number): Promise<number[]> {
  const { data, error } = await supabase.from("team_resume_ratings").select("week").eq("season", season);
  if (error) throw error;
  const set = new Set<number>();
  for (const row of (data ?? []) as { week: number | null }[]) {
    if (row.week != null) set.add(row.week);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Every saved week's Resume Rating score for every team, indexed by week then team — for Weekly Progression. */
export async function fetchResumeRatingsByWeeks(season: number): Promise<{ weeks: number[]; byWeek: Record<number, Record<string, number | null>> }> {
  const { data, error } = await supabase.from("team_resume_ratings").select("week, team, score").eq("season", season);
  if (error) throw error;
  const weekSet = new Set<number>();
  const byWeek: Record<number, Record<string, number | null>> = {};
  for (const r of (data ?? []) as { week: number; team: string; score: number | null }[]) {
    weekSet.add(r.week);
    if (!byWeek[r.week]) byWeek[r.week] = {};
    byWeek[r.week][r.team] = r.score;
  }
  return { weeks: Array.from(weekSet).sort((a, b) => a - b), byWeek };
}
