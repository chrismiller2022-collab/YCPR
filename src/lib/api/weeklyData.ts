import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { fetchGamesWithLines } from "./gamesLines";
import { invalidateCache } from "./cache";

// The weekly CFBD pull: one button for a week (Sync week) and a Fill gaps that re-runs only what the database shows
// as missing. Each step is one request to api/cfbd-sync (mode "weekly") and is logged in rating_pull_runs as
// "cfbd:<step>".

export type WeeklyStep = "games" | "gameadv" | "plays" | "seasonstats";

export const WEEKLY_STEPS: { key: WeeklyStep; label: string; what: string; requests: number }[] = [
  { key: "games", label: "Games & lines", what: "scores, kickoff times, TV, PGWE, CFBD closing lines", requests: 3 },
  { key: "gameadv", label: "Game stats", what: "per-game advanced stats for both teams (net SR, PPA; DROGBA, Review)", requests: 1 },
  { key: "plays", label: "Plays", what: "play-by-play aggregated per team-game (DROGBA)", requests: 1 },
  { key: "seasonstats", label: "Season stats", what: "season-to-date team stats (Totals)", requests: 2 },
];

export async function runWeeklyStep(season: number, week: number, step: WeeklyStep): Promise<{ saved: number | null }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/cfbd-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "weekly", password, year: season, week, step }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${step} pull failed (${res.status})`);
  invalidateCache();
  return { saved: data.saved ?? null };
}

export interface WeekCoverage {
  week: number;
  games: number;
  /** Games whose kickoff was more than 4 hours ago. */
  started: number;
  completed: number;
  withPgwe: number;
  withLine: number;
  withGameStats: number;
  withPlays: number;
}

export interface WeeklyCoverage {
  weeks: WeekCoverage[];
  seasonStatsUpdatedAt: string | null;
  latestCompletedKickoff: string | null;
}

/** What the database holds for each regular-season week: the basis for Fill gaps and the coverage table. */
export async function fetchWeeklyCoverage(season: number): Promise<WeeklyCoverage> {
  const [games, adv, plays, stats] = await Promise.all([
    fetchGamesWithLines(season),
    fetchAllRows<{ game_id: string }>((from, to) =>
      supabase.from("team_game_advanced").select("game_id").eq("season", season).order("game_id").range(from, to)
    ),
    fetchAllRows<{ game_id: string }>((from, to) =>
      supabase.from("team_game_play_agg").select("game_id").eq("season", season).order("game_id").range(from, to)
    ),
    supabase.from("team_season_stats").select("updated_at").eq("season", season).order("updated_at", { ascending: false }).limit(1),
  ]);
  const advIds = new Set(adv.map((r) => String(r.game_id)));
  const playIds = new Set(plays.map((r) => String(r.game_id)));
  const cutoff = Date.now() - 4 * 3600 * 1000;
  const byWeek = new Map<number, WeekCoverage>();
  let latestCompletedKickoff: string | null = null;
  for (const g of games) {
    if (g.season_type && g.season_type !== "regular") continue;
    const w = byWeek.get(g.week) ?? { week: g.week, games: 0, started: 0, completed: 0, withPgwe: 0, withLine: 0, withGameStats: 0, withPlays: 0 };
    w.games++;
    if (g.start_date && new Date(g.start_date).getTime() < cutoff) w.started++;
    if ((g.lines ?? []).some((l) => l.spread != null)) w.withLine++;
    if (g.completed) {
      w.completed++;
      if (g.home_postgame_win_probability != null) w.withPgwe++;
      if (advIds.has(String(g.id))) w.withGameStats++;
      if (playIds.has(String(g.id))) w.withPlays++;
      if (g.start_date && (!latestCompletedKickoff || g.start_date > latestCompletedKickoff)) latestCompletedKickoff = g.start_date;
    }
    byWeek.set(g.week, w);
  }
  return {
    weeks: Array.from(byWeek.values()).sort((a, b) => a.week - b.week),
    seasonStatsUpdatedAt: (stats.data?.[0] as { updated_at: string } | undefined)?.updated_at ?? null,
    latestCompletedKickoff,
  };
}

// Plays and game stats only exist for FBS offenses, so a handful of FCS-only games never fill in; a week counts as
// covered once 90% of its completed games have them.
const COVERED = 0.9;

/** The steps Fill gaps should run, week by week, from what's missing in the database. */
export function gapsFrom(cov: WeeklyCoverage, throughWeek: number): { week: number; step: WeeklyStep }[] {
  const out: { week: number; step: WeeklyStep }[] = [];
  for (const w of cov.weeks) {
    if (w.week > throughWeek) continue;
    // Kicked off but not marked final, final without PGWE, or no line at all: games & lines is stale for that week.
    if (w.started > w.completed || w.withPgwe < w.completed || w.withLine < w.games) out.push({ week: w.week, step: "games" });
    if (w.completed > 0 && w.withGameStats < w.completed * COVERED) out.push({ week: w.week, step: "gameadv" });
    if (w.completed > 0 && w.withPlays < w.completed * COVERED) out.push({ week: w.week, step: "plays" });
  }
  const statsStale =
    cov.latestCompletedKickoff != null && (cov.seasonStatsUpdatedAt == null || cov.seasonStatsUpdatedAt < cov.latestCompletedKickoff);
  if (statsStale) out.push({ week: throughWeek, step: "seasonstats" });
  return out;
}

export interface CfbdPullRun {
  source: string;
  ran_at: string;
  ok: boolean;
  error: string | null;
  saved: number | null;
  label: string | null;
}

/** The weekly pull's log, newest first. */
export async function fetchCfbdPullRuns(days = 21): Promise<CfbdPullRun[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from("rating_pull_runs")
    .select("source, ran_at, ok, error, saved, label")
    .like("source", "cfbd:%")
    .gte("ran_at", since)
    .order("ran_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as CfbdPullRun[];
}
