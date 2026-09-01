import { spreadToWinPct } from "./odds";
import { NFL_RATINGS, NFL_SCHEDULE, type NflTeamRatings } from "../data/nflDraftPoolData";

// Same shape as the college Win Totals engine (see src/lib/ranks.ts's
// TEAM_WIN_TOTALS): for every game, turn the two teams' power-rating gap
// (plus/minus home field advantage) into a point spread, convert that to
// a win probability via the same empirical spread->win% table used
// site-wide (spreadToWinPct/WP_TABLE), then sum win probabilities across
// the full schedule. No live data involved: everything below runs off
// the two hardcoded tables in data/nflDraftPoolData.ts.
//
// IMPORTANT sign note: WP_TABLE/spreadToWinPct expects a "Vegas-style"
// spread where NEGATIVE = favored (see odds.ts's spreadColor comment:
// "green = favorite (more negative)"). The college engine's TEAMS data
// (src/data/teams.ts) happens to use that same convention for its own
// `rating` field — a LOWER (more negative) rating is a BETTER team
// (Ohio State, ranked #1, has rating -29.34) — so `team.rating -
// opp.rating` already comes out negative when `team` is better, and
// plugs straight into spreadToWinPct. This NFL data instead uses the
// normal convention everyone actually reads (higher composite = better
// team, Rams #1 at +8.4), so the diff has to be inverted here
// (opponent's rating minus ours, not ours minus theirs) to land on the
// same negative-is-favored spread scale before calling spreadToWinPct.
// Mixing the two conventions up is exactly what produced an inverted
// result (worst teams projecting the most wins) on the first pass.
const NFL_HFA = 2.28;

export interface RatingSystemDef {
  key: keyof Omit<NflTeamRatings, "team" | "name">;
  label: string;
}

export const RATING_SYSTEMS: RatingSystemDef[] = [
  { key: "composite", label: "Composite" },
  { key: "fpi", label: "FPI" },
  { key: "nfelo", label: "nfelo" },
  { key: "inpredictable", label: "Inpredictable" },
  { key: "unexpectedPoints", label: "Unexpected Points" },
  { key: "ftnDvoa", label: "FTN DVOA" },
  { key: "pff", label: "PFF" },
  { key: "poolGenius", label: "Pool Genius" },
];

export interface NflWinTotalRow {
  team: string;
  name: string;
  winsBySystem: Record<string, number>;
  average: number;
  high: number;
  low: number;
}

function projectedWinsForSystem(team: string, ratingsByTeam: Record<string, NflTeamRatings>, systemKey: RatingSystemDef["key"]): number {
  const schedule = NFL_SCHEDULE[team] ?? [];
  const myRating = ratingsByTeam[team]?.[systemKey];
  if (myRating == null) return 0;

  let total = 0;
  for (const entry of schedule) {
    if (entry === "BYE") continue;
    const isHome = !entry.startsWith("@");
    const oppTeam = isHome ? entry : entry.slice(1);
    const oppRating = ratingsByTeam[oppTeam]?.[systemKey];
    if (oppRating == null) continue;
    // Inverted vs. the CFB engine's `team.rating - opp.rating` — see the
    // file-header note on why (this data's rating scale runs the
    // opposite direction from src/data/teams.ts's).
    const spread = isHome ? oppRating - myRating - NFL_HFA : oppRating - myRating + NFL_HFA;
    total += spreadToWinPct(spread);
  }
  return total;
}

export function computeNflWinTotals(): NflWinTotalRow[] {
  const ratingsByTeam = Object.fromEntries(NFL_RATINGS.map((r) => [r.team, r]));

  return NFL_RATINGS.map((r) => {
    const winsBySystem: Record<string, number> = {};
    for (const sys of RATING_SYSTEMS) {
      winsBySystem[sys.key] = projectedWinsForSystem(r.team, ratingsByTeam, sys.key);
    }
    const values = Object.values(winsBySystem);
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const high = Math.max(...values);
    const low = Math.min(...values);
    return { team: r.team, name: r.name, winsBySystem, average, high, low };
  });
}
