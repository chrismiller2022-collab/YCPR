import type { TeamSimResult } from "./montecarlo/engine";

/**
 * The projected 12-team CFP field for one saved Monte Carlo run, in seed
 * order (index 0 = the 1 seed). Pure copy of BracketPage's `staticSeeds`
 * derivation (kept there unchanged): the 12 teams with the highest
 * playoffPct, then ordered by average simulated seed (lower = better).
 * Returns team names only — callers resolve ratings/logos themselves.
 */
export function deriveBracketSeeds(results: TeamSimResult[] | null | undefined, fieldSize = 12): string[] {
  if (!results) return [];
  const withPlayoffOdds = results.filter((r) => r.playoffPct > 0 && r.avgSeed != null);
  const top = [...withPlayoffOdds].sort((a, b) => b.playoffPct - a.playoffPct).slice(0, fieldSize);
  const seeded = [...top].sort((a, b) => (a.avgSeed ?? 99) - (b.avgSeed ?? 99));
  return seeded.map((r) => r.team);
}
