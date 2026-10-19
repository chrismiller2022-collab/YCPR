import { useEffect, useMemo, useState } from "react";
import { type BetHistoryRecord, BET_HISTORY } from "../data/betHistory.data";
import { fetchGamesWithLines, type GameWithLines } from "./api/gamesLines";
import { useWeekAccurateRatings } from "./weekAccurateRatings";
import { useGameProjectionLocks } from "./api/gameProjectionLocks";
import { buildLiveBetHistoryRecords, type HfaMode, type LineMode } from "./betHistory";

export const BET_HISTORY_SEASONS = [2024, 2025, 2026];

// Seasons with no row in the static BET_HISTORY upload are graded live from games + that week's own saved ratings.
const LIVE_SEASONS = BET_HISTORY_SEASONS.filter((s) => !BET_HISTORY.some((r) => r.season === s));

/**
 * Every bet-history game record: the static upload for past seasons plus live seasons rebuilt from games and each
 * week's own ratings. `records` uses live projections; `recordsLocked` uses frozen pregame projections where a game
 * was locked. Shared by Bet History and the admin Teams page so both grade the same games the same way.
 */
export function useBetHistoryRecords(hfaMode: HfaMode = "team", lineMode: LineMode = "close") {
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
  const ratingsBySeasonThenWeek = useMemo(
    () => ({
      [BET_HISTORY_SEASONS[0]]: seasonRatings0.byWeek,
      [BET_HISTORY_SEASONS[1]]: seasonRatings1.byWeek,
      [BET_HISTORY_SEASONS[2]]: seasonRatings2.byWeek,
    }),
    [seasonRatings0.byWeek, seasonRatings1.byWeek, seasonRatings2.byWeek]
  );

  const { locks: liveLocks } = useGameProjectionLocks(currentSeason, weekNumbersBySeason[currentSeason] ?? []);

  const liveRecords = useMemo(() => {
    const all: BetHistoryRecord[] = [];
    for (const s of LIVE_SEASONS) {
      all.push(...buildLiveBetHistoryRecords(liveGamesBySeason[s] ?? [], ratingsBySeasonThenWeek[s] ?? {}, hfaMode, lineMode));
    }
    return all;
  }, [liveGamesBySeason, ratingsBySeasonThenWeek, hfaMode, lineMode]);

  const liveRecordsLocked = useMemo(() => {
    const all: BetHistoryRecord[] = [];
    for (const s of LIVE_SEASONS) {
      all.push(...buildLiveBetHistoryRecords(liveGamesBySeason[s] ?? [], ratingsBySeasonThenWeek[s] ?? {}, hfaMode, lineMode, liveLocks));
    }
    return all;
  }, [liveGamesBySeason, ratingsBySeasonThenWeek, hfaMode, lineMode, liveLocks]);

  // The static upload only carries closing lines, so "open" mode is live seasons only.
  const records = useMemo(() => (lineMode === "open" ? liveRecords : [...BET_HISTORY, ...liveRecords]), [liveRecords, lineMode]);
  const recordsLocked = useMemo(() => (lineMode === "open" ? liveRecordsLocked : [...BET_HISTORY, ...liveRecordsLocked]), [liveRecordsLocked, lineMode]);
  const loading = LIVE_SEASONS.length > 0 && Object.keys(liveGamesBySeason).length === 0;

  return { records, recordsLocked, loading };
}
