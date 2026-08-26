// Value/edge math for the Odds page — deliberately reuses the exact
// approaches already used elsewhere on the site rather than inventing a
// new one per market:
//
// - Moneyline: same "my win% vs. the book's implied win%" EV% used by
//   computeMlRow (moneylineBetHistory.ts) and AdminMatchupsPanel's
//   Best EV sort — just run against every book's price instead of one
//   "vegas" line.
// - Spread / Total: same "my number minus the market's number" point-diff
//   idea behind determineBetCall (gameTotals.ts) — for spreads that's
//   done per side (own-oriented, so the sign always means the same thing
//   regardless of favorite/underdog); for totals it's Over/Under exactly
//   like the Totals page.
import { vegasImpliedWinPct } from "./moneylineBetHistory";

// Placeholder thresholds for "worth highlighting" — Chris can tune these;
// they're not fit to anything, just a reasonable first cut so the page
// isn't either all-green or all-gray.
export const SPREAD_EDGE_THRESHOLD = 1.5; // points
export const TOTAL_EDGE_THRESHOLD = 1.5; // points
export const ML_EDGE_THRESHOLD = 3; // percentage points

/** My win% vs. a book's moneyline-implied win%, in percentage points. Positive = that side is +EV at that price. */
export function moneylineEdgePct(myWinPct: number | null, bookPrice: number | null): number | null {
  if (myWinPct == null || bookPrice == null) return null;
  return (myWinPct - vegasImpliedWinPct(bookPrice)) * 100;
}

/**
 * A book's spread for one side minus my own spread for that same side,
 * both in that side's own-oriented convention (negative = favored). A
 * positive result means the book is giving that side more points than I
 * think is fair — i.e. betting that side there is the better price.
 */
export function spreadEdgePts(mySideSpread: number | null, bookSideSpread: number | null): number | null {
  if (mySideSpread == null || bookSideSpread == null) return null;
  return bookSideSpread - mySideSpread;
}

export interface TotalCall {
  amountOff: number | null; // my total - book's total
  call: "Over" | "Under" | null;
}

/** Same shape as gameTotals.ts's determineBetCall — kept local so this file doesn't need to import a Totals-specific engine module for one function. */
export function totalCall(myTotal: number | null, bookTotal: number | null): TotalCall {
  if (myTotal == null || bookTotal == null) return { amountOff: null, call: null };
  const amountOff = myTotal - bookTotal;
  if (amountOff === 0) return { amountOff, call: null };
  return { amountOff, call: amountOff > 0 ? "Over" : "Under" };
}

/** Picks the index of the most favorable value in `values` per `better` (e.g. (a, b) => a > b for "highest wins"). Nulls are ignored. Returns -1 if everything is null. */
export function bestIndex(values: (number | null)[], better: (a: number, b: number) => boolean): number {
  let bestI = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (bestI === -1 || better(v, values[bestI]!)) bestI = i;
  }
  return bestI;
}
