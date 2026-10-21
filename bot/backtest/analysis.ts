// Pure backtest math: scoring forecasts against Kalshi prices and simulating
// taker trades on hourly quotes. No I/O, so it is unit-tested.

import { kalshiFee } from "../fairPrice/kalshi";

export interface Quote {
  /** Candle end, unix seconds. */
  t: number;
  bid: number;
  ask: number;
}

export interface Rung {
  gameId: string;
  week: number;
  ticker: string;
  /** Which team the market's YES backs ("<team> wins by over X"). */
  side?: "home" | "away";
  /** The market's floor_strike (X.5). */
  strike?: number;
  /** Unix seconds. */
  kickoff: number;
  /** 1 if the market settled YES. */
  result: 0 | 1;
  /** Our fair P(YES): pmf around the YCPR projection. */
  fair: number;
  /** Benchmark P(YES): same pmf shape around the sportsbook closing spread (null if no line). */
  bookFair: number | null;
  /** Same, around the sportsbook OPENING spread (known before Kalshi opens; no hindsight). */
  openFair?: number | null;
  /** Valid two-sided quotes before kickoff, oldest first. */
  quotes: Quote[];
}

export const clamp = (p: number, lo = 0.01, hi = 0.99) => Math.min(hi, Math.max(lo, p));
export const logLoss = (p: number, y: number) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));
export const mid = (q: Quote) => (q.bid + q.ask) / 2;
const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));

/** Last quote at or before `t` (default: kickoff). */
export function quoteAt(r: Rung, t = r.kickoff): Quote | null {
  let best: Quote | null = null;
  for (const q of r.quotes) if (q.t <= t) best = q;
  return best;
}

/** Deterministic RNG so bootstrap intervals are reproducible. */
export function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Mean of per-item values with a 90% interval from resampling whole games
 * (rungs on one game are strongly correlated, so items can't be resampled alone).
 */
export function gameBootstrap(items: { gameId: string; v: number }[], reps = 2000, seed = 7): { mean: number; lo: number; hi: number; n: number; games: number } {
  const byGame = new Map<string, number[]>();
  for (const it of items) (byGame.get(it.gameId) ?? byGame.set(it.gameId, []).get(it.gameId)!).push(it.v);
  const groups = [...byGame.values()];
  const n = items.length;
  const mean = n ? items.reduce((a, b) => a + b.v, 0) / n : NaN;
  if (groups.length < 2) return { mean, lo: NaN, hi: NaN, n, games: groups.length };
  const rand = rng(seed);
  const stats: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[Math.floor(rand() * groups.length)];
      for (const v of g) s += v;
      c += g.length;
    }
    stats.push(s / c);
  }
  stats.sort((a, b) => a - b);
  return { mean, lo: stats[Math.floor(reps * 0.05)], hi: stats[Math.floor(reps * 0.95)], n, games: groups.length };
}

/**
 * Logistic regression y ~ b0 + b1·logit(market) + b2·logit(model), by Newton's
 * method. b2 > 0 means our model carries information the market price lacks.
 */
export function fitBlend(rows: { market: number; model: number; y: number }[], ridge = 1e-6): [number, number, number] {
  let b = [0, 1, 0];
  for (let it = 0; it < 50; it++) {
    const g = [0, 0, 0];
    const H = [
      [ridge, 0, 0],
      [0, ridge, 0],
      [0, 0, ridge],
    ];
    for (const r of rows) {
      const x = [1, logit(r.market), logit(r.model)];
      const p = 1 / (1 + Math.exp(-(b[0] * x[0] + b[1] * x[1] + b[2] * x[2])));
      const w = p * (1 - p);
      for (let i = 0; i < 3; i++) {
        g[i] += (r.y - p) * x[i];
        for (let j = 0; j < 3; j++) H[i][j] += w * x[i] * x[j];
      }
    }
    const step = solve3(H, g);
    b = b.map((v, i) => v + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return b as [number, number, number];
}

export function blendProb(b: [number, number, number], market: number, model: number): number {
  return 1 / (1 + Math.exp(-(b[0] + b[1] * logit(market) + b[2] * logit(model))));
}

function solve3(A: number[][], y: number[]): number[] {
  const m = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c || m[c][c] === 0) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [0, 1, 2].map((i) => (m[i][i] === 0 ? 0 : m[i][3] / m[i][i]));
}

export interface TakerTrade {
  gameId: string;
  /** Team the traded market's YES backs. */
  rungSide?: "home" | "away";
  ticker: string;
  week: number;
  t: number;
  /** "buy" = bought YES at the ask; "sell" = sold YES at the bid (bought NO). */
  side: "buy" | "sell";
  price: number;
  fair: number;
  edge: number;
  fee: number;
  /** Settlement P&L per contract, after fee. */
  pnl: number;
  /** Closing mid minus entry (in our favor = positive), cents of a $1 contract. */
  clv: number;
}

/**
 * Taker strategy on hourly quotes: the first hour (before cutoff) where the
 * ask sits below fair by more than the taker fee + minEdge, buy one YES; or
 * where the bid sits above fair by that much, sell one. One trade per market.
 * With onePerGame, only the single largest-edge signal per game is kept.
 */
export function simulateTaker(
  rungs: Rung[],
  opts: { minEdge: number; cutoffSec?: number; onePerGame?: boolean; maxSpread?: number; fairOf?: (r: Rung) => number | null }
): TakerTrade[] {
  const cutoff = opts.cutoffSec ?? 30 * 60;
  const trades: TakerTrade[] = [];
  for (const r of rungs) {
    const close = quoteAt(r);
    const fair = opts.fairOf ? opts.fairOf(r) : r.fair;
    if (!close || fair == null) continue;
    for (const q of r.quotes) {
      if (q.t > r.kickoff - cutoff) break;
      if (opts.maxSpread != null && q.ask - q.bid > opts.maxSpread) continue;
      const buyFee = kalshiFee(q.ask);
      const sellFee = kalshiFee(q.bid);
      const buyEdge = fair - q.ask - buyFee;
      const sellEdge = q.bid - fair - sellFee;
      if (buyEdge >= opts.minEdge) {
        trades.push({ gameId: r.gameId, rungSide: r.side, ticker: r.ticker, week: r.week, t: q.t, side: "buy", price: q.ask, fair, edge: buyEdge, fee: buyFee, pnl: r.result - q.ask - buyFee, clv: mid(close) - q.ask });
        break;
      }
      if (sellEdge >= opts.minEdge) {
        trades.push({ gameId: r.gameId, rungSide: r.side, ticker: r.ticker, week: r.week, t: q.t, side: "sell", price: q.bid, fair, edge: sellEdge, fee: sellFee, pnl: q.bid - r.result - sellFee, clv: q.bid - mid(close) });
        break;
      }
    }
  }
  if (!opts.onePerGame) return trades;
  const best = new Map<string, TakerTrade>();
  for (const t of trades) if (!best.has(t.gameId) || t.edge > best.get(t.gameId)!.edge) best.set(t.gameId, t);
  return [...best.values()];
}
