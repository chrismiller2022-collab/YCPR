import type { TeamSimResult } from "./engine";

export interface WinTotalBucket {
  wins: number;
  losses: number;
  pct: number;
}

// Same bucketing logic as the admin Monte Carlo panel's expanded-row
// distribution detail (buckets under 0.05% dropped as noise, sorted most
// to least likely) — kept here as a shared helper since the team page's
// win distribution card wants the identical numbers, not a re-derivation
// that could quietly drift from the admin view.
export function winTotalBuckets(result: TeamSimResult): WinTotalBucket[] {
  const total = result.winDistribution.reduce((s, c) => s + c, 0);
  if (total === 0) return [];
  return result.winDistribution
    .map((count, wins) => ({ wins, losses: result.totalGames - wins, pct: (count / total) * 100 }))
    .filter((b) => b.pct > 0.05)
    .sort((a, b) => b.pct - a.pct);
}
