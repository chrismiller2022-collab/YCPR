import { fetchWestgateSeasonRows, gradeWestgatePick, westgatePoints } from "./westgatePool";
import { fetchWestgateStandings, fetchWestgatePoolSettings, projectPayout } from "./westgateStandings";

export interface WestgateProjection {
  points: number;
  rank: number;
  payout: number;
}

/**
 * Your live points (from every Westgate game you've picked this season)
 * inserted into the uploaded standings by rank, then converted to a
 * projected payout via the top-10 place schedule, splitting tied places
 * across the whole tie group (see tieGroupPayoutPct). Shared
 * by the Balance Sheet's Hypothetical tab — see WestgatePoolPanel's
 * Standings tab for the same computation applied to the live leaderboard
 * view.
 */
export async function fetchWestgateProjectedPayout(season: number, liveByTeam: Record<string, any> = {}): Promise<WestgateProjection> {
  const [myRows, standings, settings] = await Promise.all([
    fetchWestgateSeasonRows(season, liveByTeam),
    fetchWestgateStandings(season),
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
  // Everyone already at exactly your points, plus you, share this rank.
  const groupSize = standings.filter((r) => r.points === points).length + 1;
  const payout = projectPayout(rank, groupSize, settings);
  return { points, rank, payout };
}
