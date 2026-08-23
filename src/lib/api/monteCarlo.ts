import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import type { SimGame, TeamSimResult, ResumeComparisonEntry } from "../montecarlo/engine";

export interface SeasonGame extends SimGame {
  week: number;
}

/** Every game for a season (any classification) — the engine itself filters by FBS/FCS as needed. */
export async function fetchSeasonGames(season: number): Promise<SeasonGame[]> {
  return fetchAllRows<SeasonGame>((from, to) =>
    supabase
      .from("games")
      .select("week, home_team, away_team, neutral_site, conference_game, completed, home_points, away_points")
      .eq("season", season)
      .range(from, to)
  );
}

export interface MonteCarloRunSummary {
  id: number;
  season: number;
  week: number;
  num_trials: number;
  run_at: string;
}

export async function fetchMonteCarloRuns(season: number): Promise<MonteCarloRunSummary[]> {
  const { data, error } = await supabase
    .from("monte_carlo_runs")
    .select("id, season, week, num_trials, run_at")
    .eq("season", season)
    .order("run_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface MonteCarloRun extends MonteCarloRunSummary {
  results: TeamSimResult[];
  unmatched_teams: string[] | null;
  resume_comparison: ResumeComparisonEntry[] | null;
  resume_comparison_trials: number | null;
}

export async function fetchMonteCarloRun(runId: number): Promise<MonteCarloRun | null> {
  const { data, error } = await supabase.from("monte_carlo_runs").select("*").eq("id", runId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * One entry per week that has at least one saved run this season, pointing
 * at that week's MOST RECENT run only — the "select week" dropdown pattern
 * used by Playoff Seeds / Betting / Conference Standings, which deliberately
 * don't want the full run-by-run history the Results & History tab shows.
 */
export async function fetchLatestMonteCarloRunPerWeek(season: number): Promise<MonteCarloRunSummary[]> {
  const runs = await fetchMonteCarloRuns(season); // already ordered run_at desc
  const latestByWeek = new Map<number, MonteCarloRunSummary>();
  for (const r of runs) {
    if (!latestByWeek.has(r.week)) latestByWeek.set(r.week, r); // first hit per week = most recent, since runs is desc
  }
  return Array.from(latestByWeek.values()).sort((a, b) => b.week - a.week);
}

export interface TeamRunHistoryEntry {
  runId: number;
  week: number;
  runAt: string;
  numTrials: number;
  result: TeamSimResult;
}

/** A single team's stats across every saved run this season, oldest first. */
export async function fetchTeamRunHistory(season: number, team: string): Promise<TeamRunHistoryEntry[]> {
  const { data, error } = await supabase
    .from("monte_carlo_runs")
    .select("id, week, run_at, num_trials, results")
    .eq("season", season)
    .order("run_at", { ascending: true });
  if (error) throw error;

  const out: TeamRunHistoryEntry[] = [];
  for (const row of data ?? []) {
    const result = (row.results as TeamSimResult[]).find((r) => r.team === team);
    if (result) {
      out.push({ runId: row.id, week: row.week, runAt: row.run_at, numTrials: row.num_trials, result });
    }
  }
  return out;
}

export async function saveMonteCarloRun(body: {
  season: number;
  week: number;
  numTrials: number;
  results: TeamSimResult[];
  unmatchedTeams: string[];
  resumeComparison?: ResumeComparisonEntry[];
  resumeComparisonTrials?: number;
}) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/montecarlo-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}
