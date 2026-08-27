export type ContestGrade = "win" | "loss" | "push" | null;

export interface ContestCandidate {
  week: number;
  gameLabel: string; // "Away @ Home", for display
  pick: string | null; // team picked, per the site's own model (everyBetTeam)
  grade: ContestGrade; // null = not yet played
  absAmountOff: number | null; // |my line - vegas line|, points
  qualifiesWfb: boolean; // whether this game clears the Weighted Filtered Bet threshold
}

export type ContestStrategy = "amountOff" | "sigmaOff" | "wfb";

// Flat, site-wide constant (same one used for sigmaOff everywhere else,
// e.g. matchupsCompute.ts) — since it's a fixed divisor, ranking by
// "sigma off" and "amount off" produce identical orderings today. Kept
// as two separate selectable strategies anyway (rather than collapsing
// them into one) since a future per-game volatility model would make
// them genuinely diverge, and the UI already treats them as distinct
// options Chris asked for.
const SPREAD_STD_DEV = 15.7;

export interface ContestWeekResult {
  week: number;
  picks: { gameLabel: string; pick: string; grade: ContestGrade }[];
  wins: number;
  losses: number;
  pushes: number;
}

export interface ContestSeasonResult {
  strategy: ContestStrategy;
  topN: number;
  weeks: ContestWeekResult[];
  totalWins: number;
  totalLosses: number;
  totalPushes: number;
}

function sortKeyFor(c: ContestCandidate, strategy: ContestStrategy): number {
  if (strategy === "sigmaOff") return (c.absAmountOff ?? -Infinity) / SPREAD_STD_DEV;
  return c.absAmountOff ?? -Infinity;
}

/**
 * For each week, picks the top N candidates by the chosen strategy and
 * grades them. WFB strategy first restricts to games that actually
 * clear the Weighted Filtered Bet threshold — if fewer than N qualify
 * that week (the normal case, per Chris), that week just has fewer
 * picks rather than padding with games that don't qualify.
 */
export function simulateTopNStrategy(
  candidates: ContestCandidate[],
  topN: number,
  strategy: ContestStrategy
): ContestSeasonResult {
  const byWeek = new Map<number, ContestCandidate[]>();
  for (const c of candidates) {
    const list = byWeek.get(c.week) ?? [];
    list.push(c);
    byWeek.set(c.week, list);
  }

  const weeks: ContestWeekResult[] = [];
  let totalWins = 0;
  let totalLosses = 0;
  let totalPushes = 0;

  for (const week of Array.from(byWeek.keys()).sort((a, b) => a - b)) {
    let pool = byWeek.get(week)!.filter((c) => c.pick != null);
    if (strategy === "wfb") pool = pool.filter((c) => c.qualifiesWfb);
    const sorted = [...pool].sort((a, b) => sortKeyFor(b, strategy) - sortKeyFor(a, strategy));
    const selected = sorted.slice(0, topN);

    const picks = selected.map((c) => ({ gameLabel: c.gameLabel, pick: c.pick!, grade: c.grade }));
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    for (const p of picks) {
      if (p.grade === "win") wins++;
      else if (p.grade === "loss") losses++;
      else if (p.grade === "push") pushes++;
    }
    weeks.push({ week, picks, wins, losses, pushes });
    totalWins += wins;
    totalLosses += losses;
    totalPushes += pushes;
  }

  return { strategy, topN, weeks, totalWins, totalLosses, totalPushes };
}

export function contestWinPct(r: { totalWins: number; totalLosses: number }): number | null {
  const decided = r.totalWins + r.totalLosses;
  return decided > 0 ? (r.totalWins / decided) * 100 : null;
}
