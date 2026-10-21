import { useEffect, useState } from "react";
import { TEAMS_BY_NAME } from "../data/teams";
import { fetchSeasonRatingsByWeeks } from "./api/seasonWeeklyRatings";
import { fetchFinishedResumeByWeeks } from "./api/resumeWeights";
import { fetchLatestMonteCarloRunPerWeek, fetchMonteCarloRun, type MonteCarloRun } from "./api/monteCarlo";
import { deriveBracketSeeds } from "./bracketSeeds";

// Week-by-week series for the Weekly Progression graphics in the Weekly
// Image Dump (ProgressionGraphic). Each metric reads the same saved
// archive the public Weekly Progression page / Bracket page read:
//
//   power     season_weekly_ratings.rating   (week_number; 0 = preseason)
//             rank 1 = lowest (most negative) rating, site-wide convention
//   resume    team_resume_ratings_finished.score ("Résumé so far",
//             completed games only — the same table the image dump's
//             Résumé So Far graphic reads); rank 1 = highest score
//   winTotals monte_carlo_runs results[].meanWins, latest run per week;
//             rank 1 = most projected wins
//   bracket12 monte_carlo_runs latest run per week -> deriveBracketSeeds
//             (BracketPage's exact field/seed logic). rank = seed (1-12);
//             value = that team's playoffPct (0-100) in the run. A team
//             only has a point in weeks it was in the 12-team field.
//
// Ranks are recomputed here within the chosen division (default FBS) —
// season_weekly_ratings.rank is not reliable for this (its `div` column
// is null and preseason rows carry odd ranks), so every metric ranks the
// same way: sort the division's values for that week, 1-based.

export type ProgressionMetric = "power" | "resume" | "winTotals" | "bracket12";
export type ProgressionDivision = "FBS" | "FCS" | "all";

export interface ProgressionPoint {
  week: number;
  value: number;
  rank: number;
}

export interface TeamProgression {
  team: string;
  /** Ascending by week; only weeks where the team has a value (bracket12: only weeks in the field). */
  points: ProgressionPoint[];
}

export interface ProgressionSeries {
  metric: ProgressionMetric;
  season: number;
  /** Every week with saved data for this metric, ascending, capped at throughWeek. */
  weeks: number[];
  teams: TeamProgression[];
}

/** Whether a larger raw value is the better team (drives rank direction and chart orientation). */
export const PROGRESSION_HIGHER_IS_BETTER: Record<ProgressionMetric, boolean> = {
  power: false,
  resume: true,
  winTotals: true,
  bracket12: true, // value = playoffPct
};

// Monte Carlo runs carry big jsonb results; winTotals and bracket12 share
// the same per-week runs, so cache the fetch per season for the page's life.
const mcCache = new Map<number, Promise<{ week: number; run: MonteCarloRun }[]>>();
function fetchLatestRunsPerWeek(season: number) {
  let p = mcCache.get(season);
  if (!p) {
    p = (async () => {
      const summaries = await fetchLatestMonteCarloRunPerWeek(season);
      const runs = await Promise.all(summaries.map(async (s) => ({ week: s.week, run: await fetchMonteCarloRun(s.id) })));
      return runs.filter((r): r is { week: number; run: MonteCarloRun } => r.run != null).sort((a, b) => a.week - b.week);
    })();
    p.catch(() => mcCache.delete(season));
    mcCache.set(season, p);
  }
  return p;
}

function inDivision(team: string, division: ProgressionDivision) {
  if (division === "all") return true;
  return TEAMS_BY_NAME[team]?.div === division;
}

/** byWeek (week -> team -> value) -> per-team series with ranks computed within each week. */
function seriesFromByWeek(
  metric: ProgressionMetric,
  season: number,
  weeks: number[],
  byWeek: Record<number, Record<string, number | null>>,
  higherIsBetter: boolean,
  division: ProgressionDivision
): ProgressionSeries {
  const byTeam = new Map<string, ProgressionPoint[]>();
  for (const w of weeks) {
    const entries = Object.entries(byWeek[w] ?? {}).filter(
      (e): e is [string, number] => e[1] != null && Number.isFinite(e[1]) && inDivision(e[0], division)
    );
    entries.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
    entries.forEach(([team, value], i) => {
      let pts = byTeam.get(team);
      if (!pts) byTeam.set(team, (pts = []));
      pts.push({ week: w, value, rank: i + 1 });
    });
  }
  return { metric, season, weeks, teams: Array.from(byTeam, ([team, points]) => ({ team, points })) };
}

/** Non-hook loader (same result as useProgressionSeries). throughWeek null = every saved week. */
export async function loadProgressionSeries(
  season: number,
  throughWeek: number | null,
  metric: ProgressionMetric,
  opts: { division?: ProgressionDivision } = {}
): Promise<ProgressionSeries> {
  const division = opts.division ?? "FBS";
  const cap = (ws: number[]) => ws.filter((w) => throughWeek == null || w <= throughWeek).sort((a, b) => a - b);

  if (metric === "power" || metric === "resume") {
    const { weeks, byWeek } = metric === "power" ? await fetchSeasonRatingsByWeeks(season) : await fetchFinishedResumeByWeeks(season);
    return seriesFromByWeek(metric, season, cap(weeks), byWeek, PROGRESSION_HIGHER_IS_BETTER[metric], division);
  }

  const runs = (await fetchLatestRunsPerWeek(season)).filter((r) => throughWeek == null || r.week <= throughWeek);
  const weeks = cap(runs.map((r) => r.week));

  if (metric === "winTotals") {
    const byWeek: Record<number, Record<string, number | null>> = {};
    for (const { week, run } of runs) {
      byWeek[week] = {};
      for (const r of run.results) byWeek[week][r.team] = r.meanWins;
    }
    return seriesFromByWeek(metric, season, weeks, byWeek, true, division);
  }

  // bracket12 — the field is FBS by construction; division is ignored.
  const byTeam = new Map<string, ProgressionPoint[]>();
  for (const { week, run } of runs) {
    const pct = new Map(run.results.map((r) => [r.team, r.playoffPct]));
    // Same TEAMS_BY_NAME filter BracketPage applies after seeding.
    const field = deriveBracketSeeds(run.results).filter((t) => TEAMS_BY_NAME[t]);
    field.forEach((team, i) => {
      let pts = byTeam.get(team);
      if (!pts) byTeam.set(team, (pts = []));
      pts.push({ week, value: pct.get(team) ?? 0, rank: i + 1 });
    });
  }
  return { metric, season, weeks, teams: Array.from(byTeam, ([team, points]) => ({ team, points })) };
}

/**
 * React hook around loadProgressionSeries. `series` is null until loaded
 * (or when season/throughWeek is null). Mode (rating vs ranking) is a
 * render-time choice, so one call feeds both ProgressionGraphic modes.
 */
export function useProgressionSeries(
  season: number | null,
  throughWeek: number | null,
  metric: ProgressionMetric,
  opts: { division?: ProgressionDivision; enabled?: boolean } = {}
): { series: ProgressionSeries | null; loading: boolean; error: string | null } {
  const division = opts.division ?? "FBS";
  const enabled = opts.enabled ?? true;
  const [series, setSeries] = useState<ProgressionSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (season == null || !enabled) {
      setSeries(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadProgressionSeries(season, throughWeek, metric, { division })
      .then((s) => !cancelled && setSeries(s))
      .catch((err: any) => {
        if (!cancelled) {
          setSeries(null);
          setError(err?.message ?? "Failed to load progression");
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, throughWeek, metric, division, enabled]);

  return { series, loading, error };
}
