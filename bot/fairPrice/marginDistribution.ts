// Final-margin distribution for one college football game, built around a
// projected margin. A plain normal undercounts key numbers (3, 7, 10, 14),
// which is exactly where alternate spreads and pushes live, so the normal is
// discretized to whole points and then reweighted per |margin| by factors
// fitted from history (see fitKeyWeights below and bot/scripts/fitKeyWeights.ts).
//
// Convention: margins are HOME points minus AWAY points. College football
// has overtime, so a final margin of exactly 0 never happens and gets no mass.

import { DEFAULT_KEY_WEIGHTS, DEFAULT_SIGMA } from "./keyWeights.fitted";

export interface MarginModel {
  /** Stddev of final margin around the projection, in points. */
  sigma: number;
  /** Multiplier on P(|margin| = k), keyed by k. Missing k = 1. */
  keyWeights: Record<number, number>;
  /** Margins beyond ±maxMargin are folded into the end bins. */
  maxMargin: number;
}

export const DEFAULT_MARGIN_MODEL: MarginModel = {
  sigma: DEFAULT_SIGMA,
  keyWeights: DEFAULT_KEY_WEIGHTS,
  maxMargin: 80,
};

/** P(home margin = m) for every whole m in [-maxMargin, maxMargin]. */
export interface MarginPmf {
  maxMargin: number;
  /** probs[m + maxMargin] = P(margin = m). Sums to 1. */
  probs: number[];
}

// Standard normal CDF via erf (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7).
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function rawPmf(mean: number, model: MarginModel, weighted: boolean): number[] {
  const { sigma, keyWeights, maxMargin } = model;
  const n = 2 * maxMargin + 1;
  const probs = new Array<number>(n).fill(0);
  let total = 0;
  for (let m = -maxMargin; m <= maxMargin; m++) {
    if (m === 0) continue;
    const lo = m === -maxMargin ? 0 : normalCdf((m - 0.5 - mean) / sigma);
    const hi = m === maxMargin ? 1 : normalCdf((m + 0.5 - mean) / sigma);
    const w = weighted ? keyWeights[Math.abs(m)] ?? 1 : 1;
    const p = Math.max(0, hi - lo) * w;
    probs[m + maxMargin] = p;
    total += p;
  }
  for (let i = 0; i < n; i++) probs[i] /= total;
  return probs;
}

export function pmfMean(pmf: MarginPmf): number {
  let s = 0;
  for (let i = 0; i < pmf.probs.length; i++) s += (i - pmf.maxMargin) * pmf.probs[i];
  return s;
}

/**
 * Margin distribution whose mean equals `projectedHomeMargin`. Reweighting
 * key numbers and dropping 0 both nudge the mean, so the center of the
 * underlying normal is shifted until the final mean lands on the projection.
 */
export function marginPmf(projectedHomeMargin: number, model: MarginModel = DEFAULT_MARGIN_MODEL, weighted = true): MarginPmf {
  let center = projectedHomeMargin;
  let pmf: MarginPmf = { maxMargin: model.maxMargin, probs: rawPmf(center, model, weighted) };
  for (let i = 0; i < 25; i++) {
    const err = projectedHomeMargin - pmfMean(pmf);
    if (Math.abs(err) < 1e-6) break;
    center += err;
    pmf = { maxMargin: model.maxMargin, probs: rawPmf(center, model, weighted) };
  }
  return pmf;
}

export function pAt(pmf: MarginPmf, margin: number): number {
  const i = margin + pmf.maxMargin;
  return i >= 0 && i < pmf.probs.length ? pmf.probs[i] : 0;
}

/** P(home margin > x). x may be fractional (e.g. 7.5). */
export function pHomeMarginAbove(pmf: MarginPmf, x: number): number {
  let s = 0;
  for (let i = 0; i < pmf.probs.length; i++) if (i - pmf.maxMargin > x) s += pmf.probs[i];
  return s;
}

export interface MarginObservation {
  /** Projected (or market-implied) home margin before the game. */
  expected: number;
  /** Actual final home margin. */
  actual: number;
}

export interface KeyWeightFit {
  sigma: number;
  keyWeights: Record<number, number>;
  /** Per |k|: games observed at that margin vs. the plain-normal expectation. */
  table: { k: number; observed: number; expectedNormal: number; weight: number }[];
  games: number;
}

/** Stddev of (actual − expected): the spread of outcomes around the projection. */
export function residualSigma(obs: MarginObservation[]): number {
  const r = obs.map((o) => o.actual - o.expected);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
}

/**
 * Fit per-|margin| weights for k = 1..maxKey by iterative proportional
 * fitting: scale each weight by observed / model-expected count until the
 * model reproduces how often each exact margin happened. `prior` games of
 * pseudo-count shrink thin cells toward 1 so noise in rare margins
 * (e.g. exactly 19) doesn't become a fake key number.
 */
export function fitKeyWeights(
  obs: MarginObservation[],
  opts: { maxKey?: number; sigma?: number; prior?: number; iterations?: number; maxMargin?: number } = {}
): KeyWeightFit {
  const maxKey = opts.maxKey ?? 35;
  const sigma = opts.sigma ?? residualSigma(obs);
  const prior = opts.prior ?? 20;
  const maxMargin = opts.maxMargin ?? 80;
  const observed = new Array<number>(maxKey + 1).fill(0);
  for (const o of obs) {
    const k = Math.abs(o.actual);
    if (k >= 1 && k <= maxKey) observed[k]++;
  }
  const keyWeights: Record<number, number> = {};
  for (let k = 1; k <= maxKey; k++) keyWeights[k] = 1;

  const expectedCounts = (weighted: boolean) => {
    const model: MarginModel = { sigma, keyWeights, maxMargin };
    const e = new Array<number>(maxKey + 1).fill(0);
    for (const o of obs) {
      // Unshifted center: fitting needs the same pmf shape the observation
      // was drawn around, and the shift is tiny relative to the bucket noise.
      const probs = rawPmf(o.expected, model, weighted);
      for (let k = 1; k <= maxKey; k++) e[k] += probs[k + maxMargin] + probs[-k + maxMargin];
    }
    return e;
  };

  const plain = expectedCounts(false);
  for (let it = 0; it < (opts.iterations ?? 30); it++) {
    const e = expectedCounts(true);
    let moved = 0;
    for (let k = 1; k <= maxKey; k++) {
      const f = (observed[k] + prior) / (e[k] + prior);
      keyWeights[k] *= f;
      moved = Math.max(moved, Math.abs(f - 1));
    }
    if (moved < 1e-4) break;
  }
  for (let k = 1; k <= maxKey; k++) keyWeights[k] = Math.round(keyWeights[k] * 1000) / 1000;
  return {
    sigma,
    keyWeights,
    games: obs.length,
    table: Array.from({ length: maxKey }, (_, i) => ({ k: i + 1, observed: observed[i + 1], expectedNormal: plain[i + 1], weight: keyWeights[i + 1] })),
  };
}

/** Mean log-likelihood of the actual margins under a model (higher is better). */
export function meanLogLikelihood(obs: MarginObservation[], model: MarginModel, weighted = true): number {
  let s = 0;
  for (const o of obs) s += Math.log(Math.max(1e-12, pAt(marginPmf(o.expected, model, weighted), o.actual)));
  return s / obs.length;
}
