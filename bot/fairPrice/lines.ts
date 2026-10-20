// Fair probabilities for any spread / moneyline / Kalshi "wins by over X.5"
// line, read off a margin distribution. Pure math, no I/O.

import { pAt, pHomeMarginAbove, type MarginPmf } from "./marginDistribution";

export type Side = "home" | "away";

export interface LineOutcome {
  win: number;
  push: number;
  lose: number;
}

/** P(side's margin > x). */
export function pMarginAbove(pmf: MarginPmf, side: Side, x: number): number {
  if (side === "home") return pHomeMarginAbove(pmf, x);
  // away margin > x  ⇔  home margin < −x
  let s = 0;
  for (let i = 0; i < pmf.probs.length; i++) if (i - pmf.maxMargin < -x) s += pmf.probs[i];
  return s;
}

/**
 * A spread bet on `side` at `line` in that team's perspective
 * (+3 = getting 3, −7 = laying 7). Covers when margin + line > 0, pushes
 * when it is exactly 0 (only possible on whole-number lines).
 */
export function spreadOutcome(pmf: MarginPmf, side: Side, line: number): LineOutcome {
  const win = pMarginAbove(pmf, side, -line);
  const push = Number.isInteger(line) ? pAt(pmf, side === "home" ? -line : line) : 0;
  return { win, push, lose: Math.max(0, 1 - win - push) };
}

/** Straight-up win probability (no ties in college football). */
export function winProb(pmf: MarginPmf, side: Side): number {
  return pMarginAbove(pmf, side, 0);
}

/**
 * Kalshi spread market: "<team> wins by over <strike> points", strike is the
 * market's floor_strike (always X.5, so no push). Returns fair P(YES).
 */
export function kalshiSpreadYesProb(pmf: MarginPmf, side: Side, floorStrike: number): number {
  return pMarginAbove(pmf, side, floorStrike);
}

/**
 * Expected profit per $1-payout contract bought at `price` (0–1), with a
 * push refunding the stake: win·(1−p) − lose·p.
 */
export function evPerContract(o: LineOutcome, price: number): number {
  return o.win * (1 - price) - o.lose * price;
}

/** Break-even price: the most you can pay and still be EV ≥ 0. */
export function fairPrice(o: LineOutcome): number {
  return o.win + o.lose > 0 ? o.win / (o.win + o.lose) : 0;
}

/** Probability (0–1) → fair American odds. */
export function americanFromProb(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  return p >= 0.5 ? -(100 * p) / (1 - p) : (100 * (1 - p)) / p;
}
