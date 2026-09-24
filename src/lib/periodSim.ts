import {
  PERIOD_COEF,
  PERIOD_INTERCEPT,
  PERIOD_MEAN,
  PERIOD_MODEL_VERSION,
  PERIOD_POOL,
  PERIOD_SCALE,
} from "./periodModelData";

// Period (quarter/half) scoring model for a single game.
//
// Inputs are the game's projected total and spread — the same "my" numbers
// the rest of the site already produces, unchanged. Output is a full
// scoreboard DISTRIBUTION: a few hundred real historical scoreboards
// (nearest games by spread/total) re-weighted so their quarter-by-quarter
// averages equal what the ridge model predicts for this game. So every
// outcome is a real, lumpy football scoreboard (0-0 quarters, 3s and 7s,
// halftime ties, 1H/2H correlation), and the ridge model — not the history
// — sets the levels. Probabilities are computed exactly from the weights
// (no sampling noise); sampleScoreboards() is there for anything that needs
// actual draws (e.g. correlating games later).
//
// Regulation only: overtime points are excluded, same as period markets.
// Full-game numbers here are therefore regulation (~0.4 pts/game lower
// total than final scores that include OT).

export { PERIOD_MODEL_VERSION };

export type PeriodKey = "game" | "h1" | "h2" | "q1" | "q2" | "q3" | "q4";
export const PERIOD_KEYS: PeriodKey[] = ["game", "h1", "h2", "q1", "q2", "q3", "q4"];
export const PERIOD_LABELS: Record<PeriodKey, string> = {
  game: "Game",
  h1: "1st Half",
  h2: "2nd Half",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
};

function sd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

const POOL_SPREAD_SD = sd(PERIOD_POOL.map((r) => r[0]));
const POOL_TOTAL_SD = sd(PERIOD_POOL.map((r) => r[1]));
const NEIGHBORS = 500;

export interface PeriodInput {
  /** Home-team spread, negative = home favored (site-wide raw convention). */
  homeSpread: number;
  total: number;
  neutralSite: boolean;
}

export interface PeriodDistribution {
  input: PeriodInput;
  /** Expected points per side/quarter, as predicted by the ridge model: [away Q1..Q4, home Q1..Q4]. */
  ridgeMeans: number[];
  /** Support points: each row [away Q1..Q4, home Q1..Q4] of one historical scoreboard. */
  boards: number[][];
  /** Probability weight of each board (sums to 1). */
  weights: number[];
}

// ---- ridge means (favorite/dog orientation) -------------------------
function ridgeMeans(absSpread: number, total: number, neutral: number, favHome: number): { fav: number[]; dog: number[] } {
  const favEp = (total + absSpread) / 2;
  const dogEp = (total - absSpread) / 2;
  function predict(epOwn: number, epOpp: number, isFav: number): number[] {
    const x = [epOwn, epOpp, total, absSpread, neutral, isFav, favHome];
    const z = x.map((v, i) => (v - PERIOD_MEAN[i]) / PERIOD_SCALE[i]);
    return PERIOD_COEF.map((coefRow, q) => PERIOD_INTERCEPT[q] + coefRow.reduce((s, c, j) => s + c * z[j], 0));
  }
  return { fav: predict(favEp, dogEp, 1), dog: predict(dogEp, favEp, 0) };
}

// ---- maximum-entropy re-weighting -----------------------------------
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

/** Weights w_i ∝ exp(λ·x_i) whose weighted mean of the rows of X equals `target` (regularized Newton on the convex dual). */
function tiltWeights(X: number[][], target: number[]): number[] {
  const n = X.length;
  const p = target.length;
  const reg = 1e-3;
  const Xc = X.map((row) => row.map((v, j) => v - target[j]));
  let lam = new Array(p).fill(0);

  const weightsFor = (l: number[]) => {
    const z = Xc.map((row) => row.reduce((s, v, j) => s + v * l[j], 0));
    const zmax = Math.max(...z);
    const e = z.map((v) => Math.exp(v - zmax));
    const sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / sum);
  };
  const objective = (l: number[]) => {
    const z = Xc.map((row) => row.reduce((s, v, j) => s + v * l[j], 0));
    const zmax = Math.max(...z);
    return zmax + Math.log(z.reduce((s, v) => s + Math.exp(v - zmax), 0)) + 0.5 * reg * l.reduce((s, v) => s + v * v, 0);
  };

  for (let it = 0; it < 60; it++) {
    const w = weightsFor(lam);
    const mean = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mean[j] += w[i] * Xc[i][j];
    const g = mean.map((v, j) => v + reg * lam[j]);
    if (Math.max(...g.map(Math.abs)) < 1e-6) break;
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) H[a][b] += w[i] * Xc[i][a] * Xc[i][b];
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) H[a][b] -= mean[a] * mean[b];
    for (let a = 0; a < p; a++) H[a][a] += reg;
    const step = solve(H, g);
    let t = 1;
    const f0 = objective(lam);
    while (t > 1e-6 && objective(lam.map((v, j) => v - t * step[j])) > f0) t /= 2;
    lam = lam.map((v, j) => v - t * step[j]);
  }
  return weightsFor(lam);
}

export function buildPeriodDistribution(input: PeriodInput): PeriodDistribution {
  const absSpread = Math.abs(input.homeSpread);
  const favHome = input.homeSpread <= 0 ? 1 : 0;
  const neutral = input.neutralSite ? 1 : 0;
  const rm = ridgeMeans(absSpread, input.total, neutral, favHome);
  const targetFavDog = [...rm.fav, ...rm.dog];

  const scored = PERIOD_POOL.map((r, i) => ({
    i,
    d: ((r[0] - absSpread) / POOL_SPREAD_SD) ** 2 + ((r[1] - input.total) / POOL_TOTAL_SD) ** 2,
  }));
  scored.sort((a, b) => a.d - b.d);
  const near = scored.slice(0, NEIGHBORS).map((s) => PERIOD_POOL[s.i].slice(2)); // [fav Q1..4, dog Q1..4]

  const w = tiltWeights(near, targetFavDog);

  // Re-orient to [away Q1..Q4, home Q1..Q4].
  const boards = near.map((b) => {
    const fav = b.slice(0, 4);
    const dog = b.slice(4);
    const home = favHome ? fav : dog;
    const away = favHome ? dog : fav;
    return [...away, ...home];
  });
  const means = favHome ? [...rm.dog, ...rm.fav] : [...rm.fav, ...rm.dog];
  return { input, ridgeMeans: means, boards, weights: w };
}

// ---- reading a distribution -----------------------------------------
function periodQuarters(period: PeriodKey): number[] {
  switch (period) {
    case "game":
      return [0, 1, 2, 3];
    case "h1":
      return [0, 1];
    case "h2":
      return [2, 3];
    case "q1":
      return [0];
    case "q2":
      return [1];
    case "q3":
      return [2];
    default:
      return [3];
  }
}

/** [away points, home points] for `period` on one scoreboard. */
function pts(board: number[], period: PeriodKey): [number, number] {
  let a = 0;
  let h = 0;
  for (const q of periodQuarters(period)) {
    a += board[q];
    h += board[4 + q];
  }
  return [a, h];
}

export type PeriodMarket = "spread" | "total" | "teamTotalAway" | "teamTotalHome";

function valueOf(board: number[], period: PeriodKey, market: PeriodMarket): number {
  const [a, h] = pts(board, period);
  if (market === "total") return a + h;
  if (market === "teamTotalAway") return a;
  if (market === "teamTotalHome") return h;
  return h - a; // spread market: home margin
}

function weightedQuantile(values: number[], weights: number[], q: number): number {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  let cum = 0;
  for (const i of idx) {
    cum += weights[i];
    if (cum >= q) return values[i];
  }
  return values[idx[idx.length - 1]];
}

export interface PeriodSummary {
  meanAwaySpread: number; // site convention: negative = away favored
  medianAwaySpread: number;
  meanTotal: number;
  medianTotal: number;
  meanAwayTotal: number;
  meanHomeTotal: number;
  medianAwayTotal: number;
  medianHomeTotal: number;
}

export function summarize(dist: PeriodDistribution, period: PeriodKey): PeriodSummary {
  const margin = dist.boards.map((b) => valueOf(b, period, "spread")); // home - away
  const total = dist.boards.map((b) => valueOf(b, period, "total"));
  const away = dist.boards.map((b) => valueOf(b, period, "teamTotalAway"));
  const home = dist.boards.map((b) => valueOf(b, period, "teamTotalHome"));
  const mean = (v: number[]) => v.reduce((s, x, i) => s + x * dist.weights[i], 0);
  // Away spread is negative when away is favored; home margin (home - away) is exactly that number.
  return {
    meanAwaySpread: mean(margin),
    medianAwaySpread: weightedQuantile(margin, dist.weights, 0.5),
    meanTotal: mean(total),
    medianTotal: weightedQuantile(total, dist.weights, 0.5),
    meanAwayTotal: mean(away),
    meanHomeTotal: mean(home),
    medianAwayTotal: weightedQuantile(away, dist.weights, 0.5),
    medianHomeTotal: weightedQuantile(home, dist.weights, 0.5),
  };
}

export interface LinePrice {
  pOver: number; // spread market: away covers; totals: over
  pUnder: number;
  pPush: number;
  /** Fair American price for each side with pushes removed (no vig). */
  fairOver: number | null;
  fairUnder: number | null;
}

function fairAmerican(p: number): number | null {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/**
 * Price one line. For "spread", `line` is the AWAY spread (negative = away
 * favored) and "over" means away covers. For totals/team totals "over" is
 * the over. Pushes (exact hits) are exact because scoreboards are integers.
 */
export function priceLine(dist: PeriodDistribution, period: PeriodKey, market: PeriodMarket, line: number): LinePrice {
  let pOver = 0;
  let pUnder = 0;
  let pPush = 0;
  dist.boards.forEach((b, i) => {
    const v = valueOf(b, period, market);
    const w = dist.weights[i];
    if (market === "spread") {
      const awayMargin = -v; // away - home
      const cover = awayMargin + line; // away covers if > 0
      if (cover > 0) pOver += w;
      else if (cover < 0) pUnder += w;
      else pPush += w;
    } else if (v > line) pOver += w;
    else if (v < line) pUnder += w;
    else pPush += w;
  });
  const decided = pOver + pUnder;
  return {
    pOver,
    pUnder,
    pPush,
    fairOver: decided > 0 ? fairAmerican(pOver / decided) : null,
    fairUnder: decided > 0 ? fairAmerican(pUnder / decided) : null,
  };
}

/** Actual random draws (weighted resampling of the scoreboards) — for callers that need trials rather than exact probabilities. */
export function sampleScoreboards(dist: PeriodDistribution, n: number): number[][] {
  const cum: number[] = [];
  let s = 0;
  for (const w of dist.weights) cum.push((s += w));
  const out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const u = Math.random() * s;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    out.push(dist.boards[lo]);
  }
  return out;
}
