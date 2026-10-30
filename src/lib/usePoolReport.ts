import { useEffect, useMemo, useState } from "react";
import { fetchGamesWithLines, type GameWithLines } from "./api/gamesLines";
import { computeRow, classOf, pickLine } from "./matchupsCompute";
import { useWeekAccurateRatings } from "./weekAccurateRatings";
import { useGameProjectionLocks } from "./api/gameProjectionLocks";
import { useGameTotalsEngine } from "./gameTotalsEngine";
import { fetchSavedRatingsAtOrBefore } from "./api/ratingSystems";
import { useWeeklyStats } from "./api/weeklyStats";
import { buildRatingsByTeam, computeMultiSystemRow } from "./multiRatingMatchups";
import { DEFAULT_CUSTOM_PARAMS } from "./betHistory";
import { buildPoolReport, buildSeasonStats, type ReportGame, type ReportGameInput, type SeasonGame } from "./poolReport";

/** One game on a pool page, in the shape the report needs (lines away-perspective). */
export interface PoolSlateGame {
  gameId: string;
  poolLine: number | null;
  myLine: number | null;
  vegasLine: number | null;
}

/**
 * Gathers everything the Pool Report scores — the season's games graded
 * with week-accurate ratings and kickoff locks (same inputs as the matchup
 * popup's records), my totals, and the saved rating-system snapshot — then
 * scores the slate. The pool page passes its own rows so the report uses
 * the pool lines exactly as currently typed.
 */
export function usePoolReport(season: number, week: number, slate: PoolSlateGame[]): { report: ReportGame[]; ratingsWeek: number | null; loading: boolean; error: string | null } {
  const [allGames, setAllGames] = useState<GameWithLines[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setGamesLoading(true);
    fetchGamesWithLines(season)
      .then((rows) => !cancelled && setAllGames(rows))
      .catch((err) => !cancelled && setError(err.message ?? "Failed to load games"))
      .finally(() => !cancelled && setGamesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const [systems, setSystems] = useState<{ week: number | null; byTeam: Record<string, Record<string, number>> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSystems(null);
    fetchSavedRatingsAtOrBefore(season, week)
      .then(({ week: usedWeek, rows }) => !cancelled && setSystems({ week: usedWeek, byTeam: buildRatingsByTeam(rows) }))
      .catch(() => !cancelled && setSystems({ week: null, byTeam: {} }));
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  const weekNumbers = useMemo(() => Array.from(new Set(allGames.map((g) => g.week))), [allGames]);
  const { byWeek: ratingsByWeek, loading: ratingsLoading } = useWeekAccurateRatings(season, weekNumbers, season);
  const { locks, loading: locksLoading } = useGameProjectionLocks(season, weekNumbers);
  const { rows: totalsRows, loading: totalsLoading } = useGameTotalsEngine(season);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const loading = gamesLoading || ratingsLoading || locksLoading || totalsLoading || systems == null;

  const stats = useMemo(() => {
    if (loading) return null;
    // The totals engine keys games by week + team names (its own game ids are a different id space).
    const engineTotal = new Map(totalsRows.map((r) => [`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection?.projectedTotal ?? null]));
    const seasonGames: SeasonGame[] = allGames
      .filter((g) => g.week < week && g.completed && classOf(g, "home") === "fbs" && classOf(g, "away") === "fbs")
      .map((g) => {
        const lock = locks[g.id];
        const c = computeRow(
          g,
          ratingsByWeek[g.week] ?? {},
          "team",
          DEFAULT_CUSTOM_PARAMS,
          lock ? { myAwaySpread: lock.my_away_spread, myAwayWinPct: lock.my_away_win_pct } : null
        );
        return {
          week: g.week,
          away: g.away_team,
          home: g.home_team,
          myLine: c.projAwaySpread,
          vegasLine: c.vegasAwaySpread,
          actCover: c.actCoverTeam,
          myTotal: lock?.my_total ?? engineTotal.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
          vegasTotal: c.line?.over_under ?? null,
        };
      });
    return { season: buildSeasonStats(seasonGames), engineTotal };
  }, [loading, allGames, week, locks, ratingsByWeek, totalsRows]);

  const report = useMemo(() => {
    if (!stats || !systems) return [];
    const gamesById = new Map(allGames.map((g) => [g.id, g]));
    const inputs: ReportGameInput[] = [];
    for (const s of slate) {
      const g = gamesById.get(s.gameId);
      if (!g) continue;
      const systemLines: Record<string, number | null> = {};
      if (systems.week != null) {
        const multi = computeMultiSystemRow(g, systems.byTeam, liveByTeam);
        for (const [key, r] of Object.entries(multi.systems)) systemLines[key] = r.projAwaySpread;
      }
      inputs.push({
        gameId: s.gameId,
        away: g.away_team,
        home: g.home_team,
        startDate: g.start_date,
        completed: g.completed === true,
        poolLine: s.poolLine,
        myLine: s.myLine,
        vegasLine: s.vegasLine,
        myTotal: locks[g.id]?.my_total ?? stats.engineTotal.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
        vegasTotal: pickLine(g.lines)?.over_under ?? null,
        systemLines,
      });
    }
    return buildPoolReport(inputs, stats.season);
    // liveByTeam is rebuilt every render (see gameTotalsEngine.ts) — only HFA for the system lines reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, systems, allGames, slate, locks]);

  return { report, ratingsWeek: systems?.week ?? null, loading, error };
}
