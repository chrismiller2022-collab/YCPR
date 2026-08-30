import { useEffect, useState } from "react";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { TEAMS } from "../data/teams";
import { TEAM_WIN_TOTALS, buildRankMap } from "./ranks";
import { bucketFor } from "./conferenceBuckets";
import { fetchWeeklyStats, type WeeklyTeamStats } from "./api/weeklyStats";
import type { CompactRatingRow } from "./compactPowerRatings";

// ---------------------------------------------------------------------
// Shared data layer for the Weekly Image Dump admin tool (Admin > Weekly
// Image Dump). Deliberately separate from HomePage.tsx's own resolvedAll/
// rank-map logic rather than refactoring HomePage to share it — the live
// public page is high-traffic and this tool's output needs to diverge
// from it in one specific way (see rank below), so keeping them
// independent avoids any risk of an image-dump change ever touching the
// live page's behavior. The tradeoff is some duplicated resolution logic
// with HomePage.tsx; that's accepted on purpose here.
// ---------------------------------------------------------------------

export interface ImageDumpTeamRow {
  team: string;
  conf: string;
  div: "FBS" | "FCS";
  // "P4"/"G6" for FBS teams, null for FCS (bucketFor only classifies FBS
  // conferences — see conferenceBuckets.ts).
  bucket: "P4" | "G6" | null;
  // Rank WITHIN this division only (1..~138 for FBS, 1..~127 for FCS) —
  // NOT the site's live-table rank, which ranks FBS and FCS together as
  // one combined 1..265 list. The Weekly Image Dump always presents FBS
  // and FCS as separate images (per the requested folder structure), so a
  // combined rank number would read as a confusing gap-filled sequence
  // inside a division-only image. Recomputing per-division here is the
  // deliberate fix.
  rank: number;
  rating: number;
  winTotal: number;
  winTotalRank: number;
  confWinTotal: number;
  confWinTotalRank: number;
  resumeRating: number | null;
  resumeRank: number | null;
  sos: number | null;
  sosRank: number | null;
  // Rating change vs. whatever comparison week the caller picked (see
  // useWeekPairChange below) — null until two weeks are selected/available.
  change: number | null;
}

/**
 * Resolves every team in one division to its live-preferred values (same
 * live-over-preseason precedence as HomePage.tsx's resolvedAll), then
 * ranks/sorts strictly within that division. `liveByTeam` should be keyed
 * by team name, from fetchWeeklyStats(week) for whatever week the caller
 * has selected as "current."
 */
export function buildDivisionResolvedTeams(
  division: "FBS" | "FCS",
  liveByTeam: Record<string, WeeklyTeamStats>,
  changeByTeam: Record<string, { change: number | null }> = {}
): ImageDumpTeamRow[] {
  const divTeams = TEAMS.filter((t) => t.div === division);

  const withRating = divTeams.map((t) => {
    const live = liveByTeam[t.team];
    return {
      team: t.team,
      conf: t.conf,
      div: t.div,
      rating: live?.rating ?? t.rating,
      winTotal: live?.total_wins ?? TEAM_WIN_TOTALS[t.team]?.total ?? 0,
      confWinTotal: live?.conf_proj_wins ?? TEAM_WIN_TOTALS[t.team]?.confTotal ?? 0,
      sos: live?.sor ?? SOS_BY_TEAM[t.team] ?? null,
      resumeRating: live?.resume_rating ?? RESUME_BY_TEAM[t.team]?.rating ?? null,
      resumeRank: live?.resume_rank ?? RESUME_BY_TEAM[t.team]?.rank ?? null,
    };
  });

  const ratingRankByTeam = buildRankMap(withRating.map((t) => [t.team, t.rating]), false);
  const winTotalRankByTeam = buildRankMap(withRating.map((t) => [t.team, t.winTotal]), true);
  const confWinTotalRankByTeam = buildRankMap(withRating.map((t) => [t.team, t.confWinTotal]), true);
  // Ascending (lower SOS = rank 1) — matches HomePage.tsx's own inline
  // sorRankByTeam exactly, which is the "reg table" this tool mirrors.
  // (Note this differs from the higherIsBetter=true convention used by
  // ranks.ts's SOR_RANK_BY_TEAM elsewhere on the site; HomePage's own
  // computation, not that export, is the one being replicated here.)
  const sosRankByTeam = buildRankMap(
    withRating.filter((t) => t.sos != null).map((t) => [t.team, t.sos as number]),
    false
  );

  return withRating
    .map((t) => ({
      team: t.team,
      conf: t.conf,
      div: t.div,
      bucket: t.div === "FBS" ? bucketFor(t.team, t.conf) : null,
      rank: ratingRankByTeam[t.team],
      rating: t.rating,
      winTotal: t.winTotal,
      winTotalRank: winTotalRankByTeam[t.team],
      confWinTotal: t.confWinTotal,
      confWinTotalRank: confWinTotalRankByTeam[t.team],
      resumeRating: t.resumeRating,
      resumeRank: t.resumeRank,
      sos: t.sos,
      sosRank: t.sos != null ? sosRankByTeam[t.team] : null,
      change: changeByTeam[t.team]?.change ?? null,
    }))
    .sort((a, b) => a.rank - b.rank);
}

/** Top N G6 teams, in FBS-rank order — filtering the division-scoped rows
 * to Group of 6 teams only, same idea as filtering the live table's
 * conference dropdown to "Group of 6" and reading off the top of the list. */
export function topG6(rows: ImageDumpTeamRow[], limit = 30): ImageDumpTeamRow[] {
  return rows.filter((r) => r.bucket === "G6").slice(0, limit);
}

/** Plain rank/team/rating rows for the Full List / Top N compact grid,
 * straight off the power rating (division-scoped rank, already computed
 * by buildDivisionResolvedTeams). */
export function toRatingRows(rows: ImageDumpTeamRow[]): CompactRatingRow[] {
  return rows.map((r) => ({ rank: r.rank, team: r.team, conf: r.conf, rating: r.rating }));
}

/** Same idea, but ranked/valued by Resume Rating instead of Power Rating —
 * teams without a resume rating yet (no live upload, no preseason value)
 * are dropped rather than shown with a blank rank. */
export function toResumeRows(rows: ImageDumpTeamRow[]): CompactRatingRow[] {
  return rows
    .filter((r): r is ImageDumpTeamRow & { resumeRating: number; resumeRank: number } => r.resumeRating != null && r.resumeRank != null)
    .map((r) => ({ rank: r.resumeRank, team: r.team, conf: r.conf, rating: r.resumeRating }))
    .sort((a, b) => a.rank - b.rank);
}

/** Same idea, ranked/valued by Strength of Schedule. */
export function toSosRows(rows: ImageDumpTeamRow[]): CompactRatingRow[] {
  return rows
    .filter((r): r is ImageDumpTeamRow & { sos: number; sosRank: number } => r.sos != null && r.sosRank != null)
    .map((r) => ({ rank: r.sosRank, team: r.team, conf: r.conf, rating: r.sos }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Top N Gainers/Losers for any metric, generalized so it works for Power
 * Rating, Resume Rating, and SOS alike — the tricky part is that "Gainers"
 * always means "got better," but which arithmetic direction that is
 * depends on the metric's own sign convention. Power Rating and SOS are
 * lower-is-better here (a negative change is an improvement, matching
 * their rank columns); Resume Rating is higher-is-better (a positive
 * change is an improvement). Get `higherIsBetter` wrong for a metric and
 * the "Gainers" list would silently show the teams that got worse.
 *
 * `rankSelector` picks which of the row's rank fields to display (e.g.
 * `r => r.resumeRank` for a Resume Rating list) — the "#" column always
 * shows the team's rank in that metric, not its overall power rank.
 */
export function metricGainersLosers(
  rows: ImageDumpTeamRow[],
  rankSelector: (row: ImageDumpTeamRow) => number | null,
  changeByTeam: Record<string, { change: number | null }>,
  direction: "gainers" | "losers",
  higherIsBetter: boolean,
  limit = 30
): CompactRatingRow[] {
  const withChange = rows
    .map((r) => ({ team: r.team, conf: r.conf, rank: rankSelector(r), change: changeByTeam[r.team]?.change ?? null }))
    .filter((r): r is { team: string; conf: string; rank: number; change: number } => r.rank != null && r.change != null);

  const wantsPositiveFirst = higherIsBetter ? direction === "gainers" : direction === "losers";
  const sorted = [...withChange].sort((a, b) => (wantsPositiveFirst ? b.change - a.change : a.change - b.change));

  return sorted.slice(0, limit).map((r) => ({ rank: r.rank, team: r.team, conf: r.conf, rating: r.change }));
}

interface WeekPairChangeResult {
  byTeam: Record<string, { current: number | null; previous: number | null; change: number | null }>;
  loading: boolean;
  error: string | null;
}

/**
 * Like useWeeklyChange in api/weeklyStats.ts, but takes the two weeks to
 * compare explicitly instead of always using the two most-recently-saved
 * weeks. The Weekly Image Dump needs the person to be able to pick which
 * week's Gainers/Losers they're generating (e.g. building last week's post
 * after this week's data already exists), which the hardcoded hook can't do.
 */
export function useWeekPairChange(
  field: keyof WeeklyTeamStats,
  currentWeek: string | null,
  previousWeek: string | null
): WeekPairChangeResult {
  const [byTeam, setByTeam] = useState<WeekPairChangeResult["byTeam"]>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentWeek || !previousWeek) {
      setByTeam({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [currentRows, previousRows] = await Promise.all([
          fetchWeeklyStats(currentWeek),
          fetchWeeklyStats(previousWeek),
        ]);
        const previousByTeam = Object.fromEntries(previousRows.map((r) => [r.team, r]));
        const map: WeekPairChangeResult["byTeam"] = {};
        for (const row of currentRows) {
          const currentVal = row[field] as number | null;
          const previousVal = (previousByTeam[row.team]?.[field] as number | null) ?? null;
          map[row.team] = {
            current: currentVal,
            previous: previousVal,
            change: currentVal != null && previousVal != null ? currentVal - previousVal : null,
          };
        }
        if (!cancelled) setByTeam(map);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load week comparison");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [field, currentWeek, previousWeek]);

  return { byTeam, loading, error };
}
