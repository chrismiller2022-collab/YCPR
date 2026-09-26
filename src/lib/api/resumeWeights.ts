import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import type { WeekSaveInfo } from "./ratingSystems";

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
/** Every team's saved Resume Rating snapshot for one SPECIFIC week — for the Resume Ratings Week N public page. */
export async function fetchResumeRatingsForWeek(season: number, week: number): Promise<Record<string, { score: number | null; act_wins: number | null; losses: number | null }>> {
  const { data, error } = await supabase.from("team_resume_ratings").select("team, score, act_wins, losses").eq("season", season).eq("week", week);
  if (error) throw error;
  const out: Record<string, { score: number | null; act_wins: number | null; losses: number | null }> = {};
  for (const r of (data ?? []) as { team: string; score: number | null; act_wins: number | null; losses: number | null }[]) {
    out[r.team] = { score: r.score, act_wins: r.act_wins, losses: r.losses };
  }
  return out;
}

export async function fetchResumeRatingsByWeeks(
  season: number
): Promise<{ weeks: number[]; byWeek: Record<number, Record<string, number | null>>; weekInfo: Record<number, WeekSaveInfo> }> {
  // Paginated — 266 teams x several weeks passes PostgREST's 1000-row cap.
  const data = await fetchAllRows<{ week: number; team: string; score: number | null; updated_at: string }>((from, to) =>
    supabase.from("team_resume_ratings").select("week, team, score, updated_at").eq("season", season).order("id").range(from, to)
  );
  const byWeek: Record<number, Record<string, number | null>> = {};
  const weekInfo: Record<number, WeekSaveInfo> = {};
  for (const r of data) {
    (byWeek[r.week] ??= {})[r.team] = r.score;
    const info = (weekInfo[r.week] ??= { teams: 0, updatedAt: "" });
    info.teams += 1;
    if (r.updated_at > info.updatedAt) info.updatedAt = r.updated_at;
  }
  return { weeks: Object.keys(byWeek).map(Number).sort((a, b) => a - b), byWeek, weekInfo };
}
