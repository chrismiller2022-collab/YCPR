import { useEffect, useMemo, useState } from "react";
import { type BetHistoryRecord, BET_HISTORY } from "../data/betHistory.data";
import { fetchGamesWithLines, type GameWithLines } from "./api/gamesLines";
import { useWeekAccurateRatings } from "./weekAccurateRatings";
import { useGameProjectionLocks } from "./api/gameProjectionLocks";
import { buildLiveBetHistoryRecords, type HfaMode, type LineMode } from "./betHistory";
import { overlayStandardizedRatings, useStandardizedYc, type RatingMethod } from "./standardizedYc";

export const BET_HISTORY_SEASONS = [2024, 2025, 2026];

// Seasons with no row in the static BET_HISTORY upload are graded live from games + that week's own saved ratings.
const LIVE_SEASONS = BET_HISTORY_SEASONS.filter((s) => !BET_HISTORY.some((r) => r.season === s));

/**
 * Every bet-history game record: the static upload for past seasons plus live seasons rebuilt from games and each
 * week's own ratings. `records` uses live projections; `recordsLocked` uses frozen pregame projections where a game
 * was locked. Shared by Bet History and the admin Teams page so both grade the same games the same way.
 *
 * `method` "standardized" re-grades the current season as the standardized YC build would have rated it (each
 * week's saved rating-system snapshot, current weights and points per SD) and ignores projection locks, which froze
 * the old method's numbers. Seasons without saved snapshots are unaffected (see standardizedSeason).
 */
export function useBetHistoryRecords(hfaMode: HfaMode = "team", lineMode: LineMode = "close", method: RatingMethod = "asRated") {
  const [liveGamesBySeason, setLiveGamesBySeason] = useState<Record<number, GameWithLines[]>>({});

  useEffect(() => {
    if (LIVE_SEASONS.length === 0) return;
    Promise.all(LIVE_SEASONS.map((s) => fetchGamesWithLines(s).then((games) => [s, games] as const)))
      .then((pairs) => setLiveGamesBySeason(Object.fromEntries(pairs)))
      .catch(() => setLiveGamesBySeason({}));
  }, []);

  const currentSeason = new Date().getFullYear();
  const weekNumbersBySeason = useMemo(() => {
    const map: Record<number, number[]> = {};
    for (const s of BET_HISTORY_SEASONS) map[s] = Array.from(new Set((liveGamesBySeason[s] ?? []).map((g) => g.week)));
    return map;
  }, [liveGamesBySeason]);
  const seasonRatings0 = useWeekAccurateRatings(BET_HISTORY_SEASONS[0], weekNumbersBySeason[BET_HISTORY_SEASONS[0]] ?? [], currentSeason);
  const seasonRatings1 = useWeekAccurateRatings(BET_HISTORY_SEASONS[1], weekNumbersBySeason[BET_HISTORY_SEASONS[1]] ?? [], currentSeason);
  const seasonRatings2 = useWeekAccurateRatings(BET_HISTORY_SEASONS[2], weekNumbersBySeason[BET_HISTORY_SEASONS[2]] ?? [], currentSeason);
  const standardizing = method === "standardized";
  const { data: stdYc, loading: stdLoading, error: stdError } = useStandardizedYc(currentSeason, standardizing);
  const ratingsBySeasonThenWeek = useMemo(
    (): Record<number, Record<number, Record<string, any>>> => ({
      [BET_HISTORY_SEASONS[0]]: seasonRatings0.byWeek,
      [BET_HISTORY_SEASONS[1]]: seasonRatings1.byWeek,
      [BET_HISTORY_SEASONS[2]]: seasonRatings2.byWeek,
    }),
    [seasonRatings0.byWeek, seasonRatings1.byWeek, seasonRatings2.byWeek]
  );
  // Same, with the current season's ratings swapped for the standardized YC build.
  const stdRatingsBySeasonThenWeek = useMemo(
    () =>
      standardizing && stdYc
        ? { ...ratingsBySeasonThenWeek, [currentSeason]: overlayStandardizedRatings(ratingsBySeasonThenWeek[currentSeason] ?? {}, stdYc) }
        : null,
    [ratingsBySeasonThenWeek, standardizing, stdYc, currentSeason]
  );

  const { locks: liveLocks } = useGameProjectionLocks(currentSeason, weekNumbersBySeason[currentSeason] ?? []);

  function build(ratings: Record<number, Record<number, Record<string, any>>>, locks?: Record<string, any>) {
    const all: BetHistoryRecord[] = [];
    for (const s of LIVE_SEASONS) all.push(...buildLiveBetHistoryRecords(liveGamesBySeason[s] ?? [], ratings[s] ?? {}, hfaMode, lineMode, locks));
    return all;
  }
  const liveRecords = useMemo(() => build(ratingsBySeasonThenWeek), [liveGamesBySeason, ratingsBySeasonThenWeek, hfaMode, lineMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveRecordsLocked = useMemo(
    () => build(ratingsBySeasonThenWeek, liveLocks),
    [liveGamesBySeason, ratingsBySeasonThenWeek, hfaMode, lineMode, liveLocks] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Standardized backtest: no locks (they froze the as-rated projection), so "locked" = live here.
  const stdLiveRecords = useMemo(
    () => (stdRatingsBySeasonThenWeek ? build(stdRatingsBySeasonThenWeek) : null),
    [liveGamesBySeason, stdRatingsBySeasonThenWeek, hfaMode, lineMode] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The static upload only carries closing lines, so "open" mode is live seasons only.
  const withStatic = (live: BetHistoryRecord[]) => (lineMode === "open" ? live : [...BET_HISTORY, ...live]);
  const asRatedRecords = useMemo(() => withStatic(liveRecords), [liveRecords, lineMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const asRatedRecordsLocked = useMemo(() => withStatic(liveRecordsLocked), [liveRecordsLocked, lineMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const standardizedRecords = useMemo(() => (stdLiveRecords ? withStatic(stdLiveRecords) : null), [stdLiveRecords, lineMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the page grades: the standardized backtest once it's loaded, else as rated.
  const records = standardizedRecords ?? asRatedRecords;
  const recordsLocked = standardizedRecords ?? asRatedRecordsLocked;
  // Still loading until the games AND each live season's week-by-week ratings are in — otherwise the first render
  // grades every game on the static fallback ratings and the numbers visibly jump a few seconds later.
  const ratingsLoading =
    (LIVE_SEASONS.includes(BET_HISTORY_SEASONS[0]) && seasonRatings0.loading) ||
    (LIVE_SEASONS.includes(BET_HISTORY_SEASONS[1]) && seasonRatings1.loading) ||
    (LIVE_SEASONS.includes(BET_HISTORY_SEASONS[2]) && seasonRatings2.loading);
  const loading = (LIVE_SEASONS.length > 0 && Object.keys(liveGamesBySeason).length === 0) || ratingsLoading || stdLoading;

  return {
    records,
    recordsLocked,
    loading,
    /** Always the real record (locks applied in recordsLocked's as-rated twin). */
    asRatedRecords,
    asRatedRecordsLocked,
    /** Null unless method is "standardized" and the snapshots have loaded. */
    standardizedRecords,
    /** The season the standardized method applies to (others always grade as rated). */
    standardizedSeason: currentSeason,
    standardizedLoading: stdLoading,
    standardizedError: stdError,
  };
}
