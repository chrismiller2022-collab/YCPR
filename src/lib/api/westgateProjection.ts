import { fetchWestgateSeasonRows, gradeWestgatePick, westgatePoints } from "./westgatePool";
import {
  fetchWestgateStandings,
  fetchWestgatePoolSettings,
  computePayoutPctByRank,
  projectPayout,
  type WestgateStandingRow,
} from "./westgateStandings";

// Same reference season WestgatePoolPanel's Standings tab uses to seed
// the payout-%-by-rank table.
const REFERENCE_SEASON = 2025;

export interface WestgateProjection {
  points: number;
  rank: number;
  payout: number;
}

/**
 * Your live points (from every Westgate game you've picked this season)
 * inserted into the uploaded standings by rank, then converted to a
 * projected payout via REFERENCE_SEASON's cash-prize percentages. Shared
 * by the Balance Sheet's Hypothetical tab — see WestgatePoolPanel's
 * Standings tab for the same computation applied to the live leaderboard
 * view.
 */
export async function fetchWestgateProjectedPayout(season: number, liveByTeam: Record<string, any> = {}): Promise<WestgateProjection> {
  const [myRows, standings, reference, settings] = await Promise.all([
    fetchWestgateSeasonRows(season, liveByTeam),
    fetchWestgateStandings(season),
    season === REFERENCE_SEASON ? Promise.resolve([] as WestgateStandingRow[]) : fetchWestgateStandings(REFERENCE_SEASON),
    fetchWestgatePoolSettings(season),
  ]);

  const record = myRows.reduce(
    (acc, r) => {
      const g = gradeWestgatePick(r);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      else if (g === "push") acc.pushes++;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0 }
  );
  const points = westgatePoints(record);
  const better = standings.filter((r) => (r.points ?? -Infinity) > points).length;
  const rank = better + 1;
  const pctByRank = computePayoutPctByRank(season === REFERENCE_SEASON ? standings : reference);
  const payout = projectPayout(rank, settings, pctByRank);
  return { points, rank, payout };
}
