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
