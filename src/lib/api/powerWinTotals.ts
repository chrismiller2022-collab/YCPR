import { useEffect, useState } from "react";
import { fetchGamesWithLines, type GameWithLines } from "./gamesLines";
import { fetchAvailableWeeks, fetchWeeklyStats } from "./weeklyStats";
import { computeProjectedWins, type ProjectedWins } from "../reportOverlays";

function labelToNumber(w: string): number {
  if (w === "preseason") return 0;
  const m = /^week(\d+)$/.exec(w);
  return m ? parseInt(m[1], 10) : -1;
}

/**
 * Win totals straight from power ratings, one season: games already played
 * count as full wins/losses, every remaining game as its win probability.
 * `weekNum` null = live (latest saved ratings, every completed game counts);
 * a number = as of that week (that week's saved ratings — or the latest
 * earlier one — and only games through that week count as played).
 */
export async function fetchPowerRatingWinTotals(
  season: number,
  weekNum: number | null,
  // Pass the already-loaded season games when computing several weeks in a row.
  preloadedGames?: GameWithLines[]
): Promise<Record<string, ProjectedWins>> {
  const [games, labels] = await Promise.all([preloadedGames ?? fetchGamesWithLines(season), fetchAvailableWeeks()]);
  const numbered = labels.map((l) => ({ l, n: labelToNumber(l) })).filter((x) => x.n >= 0);
  const pool = weekNum == null ? numbered : numbered.filter((x) => x.n <= weekNum);
  const pick = [...pool].sort((a, b) => b.n - a.n)[0];
  if (!pick) return {};
  const rows = await fetchWeeklyStats(pick.l);
  const ratings = Object.fromEntries(rows.map((r) => [r.team, r]));
  return computeProjectedWins(games, ratings, weekNum);
}

export function usePowerRatingWinTotals(season: number, weekNum: number | null) {
  const [byTeam, setByTeam] = useState<Record<string, ProjectedWins>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPowerRatingWinTotals(season, weekNum)
      .then((r) => !cancelled && setByTeam(r))
      .catch(() => !cancelled && setByTeam({}))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, weekNum]);
  return { byTeam, loading };
}
