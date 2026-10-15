import { supabase } from "../supabaseClient";
import { fetchDistinctWeeks } from "./distinctWeeks";
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

/** Snapshots the "completed games only" Resume Rating into team_resume_ratings_finished (separate table — never touches the published numbers). */
export async function saveFinishedResumeRatings(season: number, week: number, rows: { team: string; score: number | null; actWins: number | null; losses: number | null }[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "saveResumeRatingsFinished", season, week, rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

/**
 * Framework for the weekly report (NOT wired into it yet): one saved week's
 * finished-games-only Resume Rating, team -> score. The report's resume
 * images read ratings through the report data layer (see
 * lib/reportOverlays.ts); to add a "finished games only" version, call this
 * for the report week, rank it like the other resume rows, and build
 * graphics from it the same way toResumeRows does.
 */
export async function fetchFinishedResumeForWeek(season: number, week: number): Promise<Record<string, { score: number | null; act_wins: number | null; losses: number | null }>> {
  const { data, error } = await supabase.from("team_resume_ratings_finished").select("team, score, act_wins, losses").eq("season", season).eq("week", week);
  if (error) throw error;
  const out: Record<string, { score: number | null; act_wins: number | null; losses: number | null }> = {};
  for (const r of (data ?? []) as { team: string; score: number | null; act_wins: number | null; losses: number | null }[]) {
    out[r.team] = { score: r.score, act_wins: r.act_wins, losses: r.losses };
  }
  return out;
}

/** Distinct week numbers with a saved Resume Ratings snapshot for this season — used by the Publish status grid. */
export async function fetchResumeRatingsAvailableWeeks(season: number): Promise<number[]> {
  return fetchDistinctWeeks("team_resume_ratings", season);
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

/**
 * The most recent saved Resume Ratings week, ranked (1 = best score) — what
 * the 24-team playoff tool uses for at-large bids and seeding. Null when no
 * week has been saved yet this season.
 */
export async function fetchLatestSavedResumeRanks(season: number): Promise<{ week: number; byTeam: Record<string, { rank: number; rating: number }> } | null> {
  const weeks = await fetchResumeRatingsAvailableWeeks(season);
  if (weeks.length === 0) return null;
  const week = Math.max(...weeks);
  const rows = await fetchResumeRatingsForWeek(season, week);
  const ranked = Object.entries(rows)
    .filter(([, r]) => r.score != null)
    .sort((a, b) => (b[1].score as number) - (a[1].score as number));
  const byTeam: Record<string, { rank: number; rating: number }> = {};
  ranked.forEach(([team, r], i) => {
    byTeam[team] = { rank: i + 1, rating: r.score as number };
  });
  return { week, byTeam };
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
