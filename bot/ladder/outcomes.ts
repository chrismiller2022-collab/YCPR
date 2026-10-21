// "What do I win or lose if the game lands on X?" — a game's positions turned
// into ranges of final margins with the same P&L, plus each range's chance
// under a margin distribution. P&L only changes at a strike, so a ladder of
// 30 rungs collapses into a readable list.

import type { MarginPmf } from "../fairPrice/marginDistribution";

export interface HeldRung {
  side: "home" | "away";
  strike: number;
  /** Net YES contracts (negative = short). */
  yes: number;
  /** Dollars paid, fees included (negative = received). */
  cost: number;
}

export interface OutcomeRange {
  /** Home margins (home − away), inclusive; never spans 0 (no ties in CFB). */
  from: number;
  to: number;
  pnl: number;
  prob: number;
  /** Chance under the market's distribution (when one is given). */
  marketProb?: number;
}

export function outcomeRanges(
  held: HeldRung[],
  pmf: MarginPmf,
  limit = 60,
  marketPmf?: MarginPmf
): { ranges: OutcomeRange[]; expected: number; marketExpected?: number } {
  const pnlAt = (m: number) => held.reduce((s, h) => s + h.yes * ((h.side === "home" ? m : -m) > h.strike ? 1 : 0) - h.cost, 0);
  const at = (d: MarginPmf, m: number) => (Math.abs(m) >= limit ? tail(d, m) : d.probs[m + d.maxMargin] ?? 0);
  const ranges: OutcomeRange[] = [];
  let expected = 0;
  let marketExpected = 0;
  for (let m = -limit; m <= limit; m++) {
    if (m === 0) continue;
    const pnl = Math.round(pnlAt(m) * 100) / 100;
    const prob = at(pmf, m);
    const mp = marketPmf ? at(marketPmf, m) : 0;
    expected += pnl * prob;
    marketExpected += pnl * mp;
    const last = ranges[ranges.length - 1];
    if (last && last.pnl === pnl && last.to === m - 1 && Math.sign(last.to) === Math.sign(m)) {
      last.to = m;
      last.prob += prob;
      if (marketPmf) last.marketProb! += mp;
    } else ranges.push({ from: m, to: m, pnl, prob, ...(marketPmf ? { marketProb: mp } : {}) });
  }
  return marketPmf ? { ranges, expected, marketExpected } : { ranges, expected };
}

// Everything at or beyond ±limit is folded into the end margins.
function tail(pmf: MarginPmf, m: number): number {
  let s = 0;
  for (let i = 0; i < pmf.probs.length; i++) {
    const x = i - pmf.maxMargin;
    if ((m < 0 && x <= m) || (m > 0 && x >= m)) s += pmf.probs[i];
  }
  return s;
}
