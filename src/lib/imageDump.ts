import { useEffect, useState } from "react";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { TEAMS } from "../data/teams";
import { TEAM_WIN_TOTALS, buildRankMap } from "./ranks";
import { bucketFor } from "./conferenceBuckets";
import { fetchWeeklyStats, type WeeklyTeamStats } from "./api/weeklyStats";

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

/** Top N by rating change — ascending (most negative change) = Top Gainers, since a
 * lower rating is better in this app's convention; descending = Top Losers.
 * Mirrors reportData.ts's topGainersAndLosers sort direction exactly. */
export function sortByChange(
  rows: ImageDumpTeamRow[],
  direction: "gainers" | "losers",
  limit = 25
): ImageDumpTeamRow[] {
  const withChange = rows.filter((r) => r.change != null);
  const sorted = [...withChange].sort((a, b) =>
    direction === "gainers" ? (a.change as number) - (b.change as number) : (b.change as number) - (a.change as number)
  );
  return sorted.slice(0, limit);
}

/** Top N G6 teams, in FBS-rank order — filtering the division-scoped rows
 * to Group of 6 teams only, same idea as filtering the live table's
 * conference dropdown to "Group of 6" and reading off the top of the list. */
export function topG6(rows: ImageDumpTeamRow[], limit = 25): ImageDumpTeamRow[] {
  return rows.filter((r) => r.bucket === "G6").slice(0, limit);
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
