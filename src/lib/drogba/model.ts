// DROGBA spread model — fully independent: it never sees a betting line while rating teams, and uses no one
// else's projections (not the site's consensus either).
//   Layer 1 (market-blind): predicts the home margin from walk-forward ratings — efficiency (per-play
//     success rate / explosiveness / PPA), scoreboard margin, home field and preseason inputs — with a ridge
//     fit on earlier seasons.
//   Edge response: how a disagreement with the OPENING line turns into (a) the line's later move toward the
//     model (closing-line value) and (b) the points the model's side covers by, with separate weights for
//     weeks 1-3 (preseason-driven) and week 4+ (in-season data). Heavy shrinkage: the fitted weights are the
//     honest answer to "how much of a disagreement with the market is real".
import { fitDenseRidge } from "./ridgeSolve";
import { margin, isFbsGame, type DGame } from "./dataset";
import { netEff, type EffSnapshot } from "./efficiencyRatings";
import type { RatingSnapshot } from "./marginRatings";
import { earlyWeight, PRESEASON_FEATURES, type PreseasonZ } from "./preseason";

export interface GameSignals {
  g: DGame;
  late: boolean; // week >= 4
  mrMargin: number | null; // scoreboard-rating predicted home margin
  effDiff: Record<string, number>; // home net efficiency − away net efficiency, per metric (metric units)
  extra: Record<string, number>; // other pairwise ratings, home − away (e.g. "st": special teams, in points)
  preDiff: number[]; // home − away preseason z-scores (talent, returning, portal, recruiting), already faded by week
}

export const LATE_WEEK = 4;

export function buildSignals(
  games: DGame[],
  marginSnaps: Map<string, RatingSnapshot>,
  effSnaps: Record<string, Map<string, EffSnapshot>>,
  preseason: Map<string, PreseasonZ> = new Map(),
  pairSnaps: Record<string, Map<string, RatingSnapshot>> = {}
): GameSignals[] {
  const out: GameSignals[] = [];
  for (const g of games) {
    if (!isFbsGame(g) || g.open == null) continue;
    const key = `${g.season}|${g.week}`;
    const ms = marginSnaps.get(key);
    const mrMargin = ms ? (ms.ratings.get(g.home) ?? NaN) - (ms.ratings.get(g.away) ?? NaN) + (g.neutral ? 0 : ms.hfa) : null;
    const effDiff: Record<string, number> = {};
    for (const [m, snaps] of Object.entries(effSnaps)) {
      const s = snaps.get(key);
      if (!s) continue;
      const h = netEff(s, g.home);
      const a = netEff(s, g.away);
      if (h != null && a != null) effDiff[m] = h - a;
    }
    const extra: Record<string, number> = {};
    for (const [name, snaps] of Object.entries(pairSnaps)) {
      const s = snaps.get(key);
      const h = s?.ratings.get(g.home);
      const a = s?.ratings.get(g.away);
      if (h != null && a != null) extra[name] = h - a;
    }
    const ph = preseason.get(`${g.season}|${g.home}`);
    const pa = preseason.get(`${g.season}|${g.away}`);
    const ew = earlyWeight(g.week);
    const preDiff = [0, 1, 2, 3].map((j) => (ph && pa ? (ph[j] - pa[j]) * ew : 0));
    out.push({ g, late: g.week >= LATE_WEEK, mrMargin: mrMargin != null && Number.isFinite(mrMargin) ? mrMargin : null, effDiff, extra, preDiff });
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
  fallback?: Layer1; // the base-feature model, used for games that lack the richer inputs (e.g. no play-level data yet)
}
const BASE_EFF = ["sr", "expl", "ppa"];
const PLAY_EFF = ["srf", "isof"];
const TAIL = ["scoreboard", "homeField", ...PRESEASON_FEATURES];

function featureValue(s: GameSignals, name: string): number | null {
  if (name === "scoreboard") return s.mrMargin;
  if (name === "homeField") return s.g.neutral ? 0 : 1;
  if (name === "st") return s.extra.st ?? null;
  const pi = PRESEASON_FEATURES.indexOf(name);
  if (pi >= 0) return s.preDiff[pi];
  return s.effDiff[name] ?? null;
}
const l1Row = (s: GameSignals, names: string[]): number[] | null => {
  const row: number[] = [];
  for (const n of names) {
    const v = featureValue(s, n);
    if (v == null) return null;
    row.push(v);
  }
  return row;
};

// alpha 300 came out of the bake-off: stronger shrinkage than the first version's 30 predicted held-out
// seasons better (tuned on 2022-23 only, then confirmed on 2024-26).
export const LAYER1_ALPHA = 300;
const MIN_RICH_ROWS = 600; // a richer feature set needs about a season of games that have every one of its inputs

function fitOn(train: GameSignals[], names: string[], alpha: number): Layer1 | null {
  const X: number[][] = [];
  const y: number[] = [];
  for (const s of train) {
    if (!s.g.completed) continue;
    const r = l1Row(s, names);
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
  return { features: names, mean, sd, intercept: f.intercept, coef: f.coef };
}

// Fits the richest feature set the training data supports (base + play-level + special teams), keeping the base
// model as a fallback for games that lack the extra inputs.
export function fitLayer1(train: GameSignals[], alpha = LAYER1_ALPHA): Layer1 | null {
  const base = fitOn(train, [...BASE_EFF, ...TAIL], alpha);
  if (!base) return null;
  const have = (names: string[]) => train.filter((s) => s.g.completed && l1Row(s, names) != null).length;
  const candidates: string[][] = [];
  const richest = [...BASE_EFF, ...PLAY_EFF, "st", ...TAIL];
  candidates.push(richest, [...BASE_EFF, ...PLAY_EFF, ...TAIL], [...BASE_EFF, "st", ...TAIL]);
  for (const names of candidates) {
    if (have(names) < MIN_RICH_ROWS) continue;
    const rich = fitOn(train, names, alpha);
    if (rich) return { ...rich, fallback: base };
  }
  return base;
}

export function predictLayer1(m: Layer1, s: GameSignals): number | null {
  const r = l1Row(s, m.features);
  if (!r) return m.fallback ? predictLayer1(m.fallback, s) : null;
  return m.intercept + r.reduce((a, v, j) => a + ((v - m.mean[j]) / m.sd[j]) * m.coef[j], 0);
}

// ---------------------------------------------------------------- edge response
// Disagreements beyond 8 points are too rare in the data to extrapolate from and are more often a stale rating
// or news the ratings can't see than a real mispricing.
export const EDGE_CAP = 8;
const clip = (v: number, c = EDGE_CAP) => Math.max(-c, Math.min(c, v));

// Edge = the model's home margin + the opening spread: the points by which the model says the home side beats
// the number. Positive = home side.
export const edgeOf = (modelMargin: number, open: number) => modelMargin + open;

export interface EdgeResponse {
  // points of expected cover / line move per point of edge, separately for weeks 1-3 and week 4+
  coverEarly: number;
  coverLate: number;
  moveEarly: number; // + = the line later moves toward the home side
  moveLate: number;
}

export function fitEdgeResponse(train: GameSignals[], l1: Layer1, alpha = 100): EdgeResponse | null {
  const X: number[][] = [];
  const yCover: number[] = [];
  const Xm: number[][] = [];
  const yMove: number[] = [];
  for (const s of train) {
    if (!s.g.completed) continue;
    const m = predictLayer1(l1, s);
    if (m == null) continue;
    const e = clip(edgeOf(m, s.g.open!));
    const late = s.late ? 1 : 0;
    const row = [e * late, e * (1 - late)];
    X.push(row);
    yCover.push(margin(s.g) + s.g.open!);
    if (s.g.close != null) {
      Xm.push(row);
      yMove.push(s.g.open! - s.g.close);
    }
  }
  if (X.length < 300 || Xm.length < 300) return null;
  const c = fitDenseRidge(X, yCover, alpha);
  const mv = fitDenseRidge(Xm, yMove, alpha);
  return { coverLate: c.coef[0], coverEarly: c.coef[1], moveLate: mv.coef[0], moveEarly: mv.coef[1] };
}

export interface EdgePrediction {
  edge: number; // clipped edge vs the open (positive = home side)
  cover: number; // expected points the HOME side covers the open by (negative = away side)
  move: number; // expected line move toward the home side, open → close
}
export function predictEdge(resp: EdgeResponse, s: GameSignals, modelMargin: number): EdgePrediction {
  const edge = clip(edgeOf(modelMargin, s.g.open!));
  return { edge, cover: edge * (s.late ? resp.coverLate : resp.coverEarly), move: edge * (s.late ? resp.moveLate : resp.moveEarly) };
}

// ---------------------------------------------------------------- walk-forward evaluation
export interface BetResult {
  g: DGame;
  edge: number;
  side: 1 | -1;
  won: boolean | null; // null = push
  moveToUs: number | null; // points the line moved toward our side, open → close (closing-line value)
  cover: number;
}

// Each test season is predicted by models fit ONLY on earlier seasons.
export function evaluateWalkForward(signals: GameSignals[], opts: { testSeasons: number[]; alpha1?: number }): BetResult[] {
  const results: BetResult[] = [];
  for (const S of opts.testSeasons) {
    const train = signals.filter((s) => s.g.season < S && s.g.completed);
    const l1 = fitLayer1(train, opts.alpha1);
    if (!l1) continue;
    for (const s of signals) {
      if (s.g.season !== S || !s.g.completed) continue;
      const m = predictLayer1(l1, s);
      if (m == null) continue;
      const edge = edgeOf(m, s.g.open!);
      if (edge === 0) continue;
      const side: 1 | -1 = edge > 0 ? 1 : -1;
      const cov = side * (margin(s.g) + s.g.open!);
      results.push({
        g: s.g,
        edge,
        side,
        won: cov === 0 ? null : cov > 0,
        moveToUs: s.g.close == null ? null : side * (s.g.open! - s.g.close),
        cover: cov,
      });
    }
  }
  return results;
}

export interface ThresholdRow {
  minEdge: number;
  n: number;
  w: number;
  l: number;
  atsPct: number;
  avgMoveToUs: number; // closing-line value, in points
  movedOurWayPct: number; // of games whose line moved at all
}
export function thresholdTable(results: BetResult[], thresholds: number[]): ThresholdRow[] {
  return thresholds.map((t) => {
    const sub = results.filter((r) => Math.abs(r.edge) >= t);
    const w = sub.filter((r) => r.won === true).length;
    const l = sub.filter((r) => r.won === false).length;
    const mv = sub.filter((r) => r.moveToUs != null);
    const moved = mv.filter((r) => r.moveToUs !== 0);
    return {
      minEdge: t,
      n: sub.length,
      w,
      l,
      atsPct: w + l === 0 ? 0 : (100 * w) / (w + l),
      avgMoveToUs: mv.length === 0 ? 0 : mv.reduce((a, r) => a + r.moveToUs!, 0) / mv.length,
      movedOurWayPct: moved.length === 0 ? 0 : (100 * moved.filter((r) => r.moveToUs! > 0).length) / moved.length,
    };
  });
}
