// DROGBA spread model.
//   Layer 1 (market-blind): predicts the home margin from walk-forward ratings — efficiency (per-play
//     success rate / explosiveness / PPA) and scoreboard margin — with a ridge fit on past seasons.
//   Layer 2 (market-aware): predicts how much the HOME side covers the OPENING line by, from how far
//     each signal (efficiency model, Chris's consensus) disagrees with the open, with separate weights
//     for weeks 1-3 (preseason-driven) and week 4+ (in-season data). Heavy ridge = honest shrinkage:
//     the fitted weights say how much of a disagreement is real.
import { fitDenseRidge } from "./ridgeSolve";
import { margin, isFbsGame, type DGame } from "./dataset";
import { EFF_METRICS, netEff, type EffMetric, type EffSnapshot } from "./efficiencyRatings";
import type { RatingSnapshot } from "./marginRatings";
import { earlyWeight, PRESEASON_FEATURES, type PreseasonZ } from "./preseason";

export interface GameSignals {
  g: DGame;
  late: boolean; // week >= 4
  mrMargin: number | null; // scoreboard-rating predicted home margin
  effDiff: Partial<Record<EffMetric, number>>; // home net efficiency − away net efficiency (metric units)
  consensusMargin: number | null; // Chris's consensus predicted home margin (= −his home spread)
  preDiff: number[]; // home − away preseason z-scores (talent, returning, portal, recruiting), already faded by week
}

export const LATE_WEEK = 4;

export function buildSignals(
  games: DGame[],
  marginSnaps: Map<string, RatingSnapshot>,
  effSnaps: Partial<Record<EffMetric, Map<string, EffSnapshot>>>,
  consensusSpread: Map<string, number>,
  preseason: Map<string, PreseasonZ> = new Map()
): GameSignals[] {
  const out: GameSignals[] = [];
  for (const g of games) {
    if (!isFbsGame(g) || g.open == null) continue;
    const key = `${g.season}|${g.week}`;
    const ms = marginSnaps.get(key);
    const mrMargin = ms ? (ms.ratings.get(g.home) ?? NaN) - (ms.ratings.get(g.away) ?? NaN) + (g.neutral ? 0 : ms.hfa) : null;
    const effDiff: Partial<Record<EffMetric, number>> = {};
    for (const m of EFF_METRICS) {
      const s = effSnaps[m]?.get(key);
      if (!s) continue;
      const h = netEff(s, g.home);
      const a = netEff(s, g.away);
      if (h != null && a != null) effDiff[m] = h - a;
    }
    const cs = consensusSpread.get(g.id);
    const ph = preseason.get(`${g.season}|${g.home}`);
    const pa = preseason.get(`${g.season}|${g.away}`);
    const ew = earlyWeight(g.week);
    const preDiff = [0, 1, 2, 3].map((j) => (ph && pa ? (ph[j] - pa[j]) * ew : 0));
    out.push({
      g,
      late: g.week >= LATE_WEEK,
      mrMargin: mrMargin != null && Number.isFinite(mrMargin) ? mrMargin : null,
      effDiff,
      consensusMargin: cs == null ? null : -cs,
      preDiff,
    });
  }
  return out;
}

// ---------------------------------------------------------------- layer 1
export interface Layer1 {
  features: string[];
  mean: number[];
  sd: number[];
  intercept: number;
  coef: number[];
}
const L1_FEATURES = ["effSr", "effExpl", "effPpa", "scoreboard", "homeField", ...PRESEASON_FEATURES];
const l1Row = (s: GameSignals): number[] | null => {
  const { sr, expl, ppa } = s.effDiff;
  if (sr == null || expl == null || ppa == null || s.mrMargin == null) return null;
  return [sr, expl, ppa, s.mrMargin, s.g.neutral ? 0 : 1, ...s.preDiff];
};

export function fitLayer1(train: GameSignals[], alpha = 30): Layer1 | null {
  const X: number[][] = [];
  const y: number[] = [];
  for (const s of train) {
    if (!s.g.completed) continue;
    const r = l1Row(s);
    if (!r) continue;
    X.push(r);
    y.push(margin(s.g));
  }
  if (X.length < 200) return null;
  const p = X[0].length;
  const mean = new Array(p).fill(0).map((_, j) => X.reduce((a, r) => a + r[j], 0) / X.length);
  const sd = new Array(p).fill(0).map((_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mean[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const f = fitDenseRidge(Z, y, alpha);
  return { features: [...L1_FEATURES], mean, sd, intercept: f.intercept, coef: f.coef };
}

export function predictLayer1(m: Layer1, s: GameSignals): number | null {
  const r = l1Row(s);
  if (!r) return null;
  return m.intercept + r.reduce((a, v, j) => a + ((v - m.mean[j]) / m.sd[j]) * m.coef[j], 0);
}

// ---------------------------------------------------------------- layer 2
export interface Layer2 {
  features: string[];
  intercept: number;
  coef: number[];
  useConsensus: boolean;
}
// Disagreements beyond 8 points are too rare in the data to extrapolate from (26 of ~1,750 games in 2024-26, with
// no better a cover rate than smaller edges), and are more often a stale rating or news the ratings can't see.
export const EDGE_CAP = 8;
// Small disagreements are mostly noise and big ones are where the signal shows up (weeks 1-3 consensus: 54% at 3+,
// 59% at 4+, 60% at 5+, 67% at 6+), so each signal also gets a hinge term that only switches on past HINGE_KNOT.
// The knot of 3 was read off the same 2024-26 games the model is graded on, so treat the result as optimistic.
export const HINGE_KNOT = 3;
const hinge = (e: number) => Math.sign(e) * Math.max(0, Math.abs(e) - HINGE_KNOT);
const clip = (v: number, c = EDGE_CAP) => Math.max(-c, Math.min(c, v));

// Edge of each signal vs the opening line = (signal's home margin) + open, i.e. the points by which that
// signal says the home side beats the number. Positive = home.
function l2Row(s: GameSignals, l1: Layer1 | null, useConsensus: boolean): number[] | null {
  const open = s.g.open!;
  const effM = l1 ? predictLayer1(l1, s) : null;
  const effEdge = effM == null ? 0 : clip(effM + open);
  const row: number[] = [];
  const late = s.late ? 1 : 0;
  if (!l1 && !useConsensus) return null;
  if (l1) row.push(effEdge * late, effEdge * (1 - late), hinge(effEdge) * late, hinge(effEdge) * (1 - late));
  if (useConsensus) {
    if (s.consensusMargin == null) return null;
    const c = clip(s.consensusMargin + open);
    row.push(c * late, c * (1 - late), hinge(c) * late, hinge(c) * (1 - late));
  }
  return row;
}

export function fitLayer2(train: GameSignals[], l1: Layer1 | null, useConsensus: boolean, alpha = 400): Layer2 | null {
  const X: number[][] = [];
  const y: number[] = [];
  for (const s of train) {
    if (!s.g.completed) continue;
    const r = l2Row(s, l1, useConsensus);
    if (!r) continue;
    X.push(r);
    y.push(margin(s.g) + s.g.open!);
  }
  if (X.length < 150) return null;
  const f = fitDenseRidge(X, y, alpha);
  const features = [
    ...(l1 ? ["effEdge×late", "effEdge×early", "effEdge hinge×late", "effEdge hinge×early"] : []),
    ...(useConsensus ? ["consensusEdge×late", "consensusEdge×early", "consensusEdge hinge×late", "consensusEdge hinge×early"] : []),
  ];
  return { features, intercept: f.intercept, coef: f.coef, useConsensus };
}

// Expected points by which the HOME side covers the opening spread (negative = the away side covers).
export function predictCover(l2: Layer2, l1: Layer1 | null, s: GameSignals): number | null {
  const r = l2Row(s, l1, l2.useConsensus);
  if (!r) return null;
  return r.reduce((a, v, j) => a + v * l2.coef[j], 0); // no intercept: a pure disagreement model
}

// ---------------------------------------------------------------- walk-forward evaluation
export interface BetResult {
  g: DGame;
  cover: number; // predicted home cover margin
  side: 1 | -1;
  won: boolean | null; // null = push
  closeBeat: number | null; // points the line moved toward our side open→close (CLV)
}

export function evaluateWalkForward(
  signals: GameSignals[],
  opts: { testSeasons: number[]; useConsensus: boolean; useEff: boolean; alpha1?: number; alpha2?: number; loso?: boolean }
): BetResult[] {
  const results: BetResult[] = [];
  for (const S of opts.testSeasons) {
    const train = signals.filter((s) => (opts.loso ? s.g.season !== S : s.g.season < S) && s.g.completed);
    const l1 = opts.useEff ? fitLayer1(train, opts.alpha1) : null;
    if (opts.useEff && !l1) continue;
    const l2 = fitLayer2(train, l1, opts.useConsensus, opts.alpha2);
    if (!l2) continue;
    for (const s of signals) {
      if (s.g.season !== S || !s.g.completed) continue;
      const c = predictCover(l2, l1, s);
      if (c == null || c === 0) continue;
      const side: 1 | -1 = c > 0 ? 1 : -1;
      const cov = side * (margin(s.g) + s.g.open!);
      results.push({
        g: s.g,
        cover: c,
        side,
        won: cov === 0 ? null : cov > 0,
        closeBeat: s.g.close == null ? null : side * (s.g.open! - s.g.close),
      });
    }
  }
  return results;
}

export interface ThresholdRow {
  minCover: number;
  n: number;
  w: number;
  l: number;
  atsPct: number;
  avgMoveToUs: number;
}
export function thresholdTable(results: BetResult[], thresholds: number[]): ThresholdRow[] {
  return thresholds.map((t) => {
    const sub = results.filter((r) => Math.abs(r.cover) >= t);
    const w = sub.filter((r) => r.won === true).length;
    const l = sub.filter((r) => r.won === false).length;
    const mv = sub.filter((r) => r.closeBeat != null);
    return {
      minCover: t,
      n: sub.length,
      w,
      l,
      atsPct: w + l === 0 ? 0 : (100 * w) / (w + l),
      avgMoveToUs: mv.length === 0 ? 0 : mv.reduce((a, r) => a + r.closeBeat!, 0) / mv.length,
    };
  });
}
