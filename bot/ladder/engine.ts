// Ladder engine: decides what to quote on every rung of one game's Kalshi
// spread ladder, given the side we lean toward, the blended fair price, and
// what we already hold. Pure functions, no I/O — the runner (paper/demo/live)
// feeds it books and positions and executes the orders it returns.
//
// Conventions (see docs/kalshi-bot-handoff.md §14):
// - Margins are HOME − AWAY. A rung's YES backs `side` winning by over `strike`.
// - "Pro-pick" = an order that adds exposure to the side we picked
//   (buy YES on the pick's rungs, or sell YES on the opponent's rungs).
//   "Anti-pick" = the reverse. Selling YES is the same as buying the other team.
// - Prices are dollars per $1 contract; positions are net YES contracts
//   (negative = short YES) with `cost` = dollars paid (negative = received),
//   fees included, so the loss cap covers fees too.

import { kalshiFee } from "../fairPrice/kalshi";
import { kalshiSpreadYesProb, type Side } from "../fairPrice/lines";
import { DEFAULT_MARGIN_MODEL, marginPmf, type MarginModel, type MarginPmf } from "../fairPrice/marginDistribution";
import { shapedOrders } from "./shape";

export interface Rung {
  ticker: string;
  side: Side;
  strike: number;
  /** Best YES bid/ask (null = none). */
  bid: number | null;
  ask: number | null;
}

export interface Position {
  ticker: string;
  yes: number;
  cost: number;
}

export interface LadderConfig {
  pick: Side;
  /** Max loss across every possible final margin, dollars. */
  maxWorstCaseLoss: number;
  /** Max |net YES| on any one rung. */
  perRungCap: number;
  /** Contracts per order. */
  orderSize: number;
  /** Edge required on pro-pick quotes (after maker fee), dollars. */
  proEdge: number;
  /** Extra edge required per contract of pro-pick exposure already held (adds carefully into adverse moves). */
  edgeStep: number;
  /** Edge required on anti-pick quotes (sell back / other side), dollars. */
  antiEdge: number;
  /** Edge required to TAKE a resting price instead of quoting (after taker fee). */
  takeEdge: number;
  /** Stop adding once realized + open P&L on the game reaches this, dollars (null = no target). */
  profitTarget: number | null;
  /** Price grid. */
  tick: number;
  /** Fee per fill for this venue; defaults to Kalshi's schedule. */
  fee?: FeeFn;
  /** Shaped positions (§21, bot/ladder/shape.ts) instead of the rung-by-rung ladder. */
  shape?: boolean;
  /** Shape: minimum P&L from the market line up, dollars (default 0). */
  marketFloor?: number | null;
  /** Shape: max loss when the pick falls short by less than a blowout, dollars (default 10% of maxWorstCaseLoss). */
  againstLimit?: number | null;
  /** Shape: pick losing by this many points or more is a blowout, where only maxWorstCaseLoss applies (default 10). */
  blowoutMargin?: number | null;
}

/** Venue fee for a fill at `price`; `maker` = a resting quote that got filled. */
export type FeeFn = (price: number, opts?: { count?: number; maker?: boolean }) => number;

export const DEFAULT_LADDER_CONFIG: Omit<LadderConfig, "pick"> = {
  maxWorstCaseLoss: 5,
  perRungCap: 1,
  orderSize: 1,
  proEdge: 0.02,
  edgeStep: 0.01,
  antiEdge: 0.04,
  takeEdge: 0.03,
  profitTarget: null,
  tick: 0.01,
};

export interface Order {
  ticker: string;
  action: "buy" | "sell"; // YES
  price: number;
  count: number;
  /** "quote" rests (post-only); "take" crosses the spread now. */
  kind: "quote" | "take";
  direction: "pro" | "anti";
  fair: number;
  reason: string;
}

// ---------- Fair price

/** Market-implied home margin: the pmf center that best fits the ladder's mids (tighter quotes weigh more). */
export function impliedHomeMargin(rungs: Rung[], model: MarginModel = DEFAULT_MARGIN_MODEL): number | null {
  const quoted = rungs
    .filter((r) => r.bid != null && r.ask != null && r.ask > r.bid)
    .map((r) => ({ r, mid: (r.bid! + r.ask!) / 2, w: 1 / Math.max(0.01, r.ask! - r.bid!) }));
  // Fit on the middle of the ladder: long-shot rungs tend to be overpriced and
  // would drag the implied margin toward the tails.
  const middle = quoted.filter((p) => p.mid >= 0.15 && p.mid <= 0.85);
  const pts = middle.length >= 2 ? middle : quoted.filter((p) => p.mid > 0.03 && p.mid < 0.97);
  if (pts.length === 0) return null;
  const err = (mean: number) => {
    const pmf = marginPmf(mean, model);
    return pts.reduce((s, p) => s + p.w * (kalshiSpreadYesProb(pmf, p.r.side, p.r.strike) - p.mid) ** 2, 0);
  };
  let best = 0;
  let bestErr = Infinity;
  for (let m = -60; m <= 60; m += 1) {
    const e = err(m);
    if (e < bestErr) [best, bestErr] = [m, e];
  }
  for (let step = 0.5; step >= 0.05; step /= 2) {
    for (const m of [best - step, best + step]) {
      const e = err(m);
      if (e < bestErr) [best, bestErr] = [m, e];
    }
  }
  return Math.round(best * 100) / 100;
}

export interface FairInputs {
  ycpr: number | null;
  kalshi: number | null;
  book: number | null;
  hoursToKickoff: number;
}

/**
 * Blended home margin. With `fade` (default), YCPR's weight starts at
 * `ycprWeight` a week out and fades linearly to 0 at kickoff (the backtest
 * found it adds nothing at the close); with `fade: false` it stays at
 * `ycprWeight` (1 = trade our number outright). The rest is split between
 * Kalshi and the sportsbooks.
 */
export function blendedHomeMargin(x: FairInputs, opts: { ycprWeight?: number; fade?: boolean; fadeHours?: number; kalshiShare?: number } = {}): number | null {
  const base = opts.ycprWeight ?? 0.35;
  const wY = x.ycpr == null ? 0 : opts.fade === false ? base : base * Math.min(1, Math.max(0, x.hoursToKickoff) / (opts.fadeHours ?? 144));
  const share = opts.kalshiShare ?? 0.6;
  let wK = x.kalshi == null ? 0 : share;
  let wB = x.book == null ? 0 : 1 - share;
  if (wK + wB === 0) return x.ycpr;
  const scale = (1 - wY) / (wK + wB);
  wK *= scale;
  wB *= scale;
  return wY * (x.ycpr ?? 0) + wK * (x.kalshi ?? 0) + wB * (x.book ?? 0);
}

// ---------- Exposure

const settles = (r: { side: Side; strike: number }, homeMargin: number) => (r.side === "home" ? homeMargin : -homeMargin) > r.strike;

/** P&L for every final home margin in [-maxMargin, maxMargin] (index = margin + maxMargin). */
export function pnlByMargin(rungs: Pick<Rung, "ticker" | "side" | "strike">[], positions: Position[], maxMargin = 80): number[] {
  const byTicker = new Map(rungs.map((r) => [r.ticker, r]));
  const out = new Array<number>(2 * maxMargin + 1).fill(0);
  for (const p of positions) {
    const r = byTicker.get(p.ticker);
    if (!r || (p.yes === 0 && p.cost === 0)) continue;
    for (let m = -maxMargin; m <= maxMargin; m++) out[m + maxMargin] += p.yes * (settles(r, m) ? 1 : 0) - p.cost;
  }
  return out;
}

export function exposureSummary(pnl: number[], pmf: MarginPmf): { worst: number; best: number; expected: number } {
  let worst = Infinity;
  let best = -Infinity;
  let expected = 0;
  pnl.forEach((v, i) => {
    const m = i - (pnl.length - 1) / 2;
    if (m === 0) return; // no ties in CFB
    worst = Math.min(worst, v);
    best = Math.max(best, v);
    expected += v * (pmf.probs[m + pmf.maxMargin] ?? 0);
  });
  return { worst, best, expected };
}

/** Pro-pick contracts held: +1 per YES on the pick's rungs, +1 per short YES on the opponent's. */
export function proExposure(rungs: Rung[], positions: Position[], pick: Side): number {
  const side = new Map(rungs.map((r) => [r.ticker, r.side]));
  return positions.reduce((s, p) => s + (side.get(p.ticker) === pick ? p.yes : side.has(p.ticker) ? -p.yes : 0), 0);
}

/** Open P&L marked to fair, plus realized P&L passed in by the runner. */
export function gamePnl(rungs: Rung[], positions: Position[], pmf: MarginPmf, realized = 0): number {
  const byTicker = new Map(rungs.map((r) => [r.ticker, r]));
  let open = 0;
  for (const p of positions) {
    const r = byTicker.get(p.ticker);
    if (r) open += p.yes * kalshiSpreadYesProb(pmf, r.side, r.strike) - p.cost;
  }
  return realized + open;
}

// ---------- Quoting

const floorTick = (p: number, t: number) => Math.round(Math.floor(p / t + 1e-9) * t * 1e6) / 1e6;
const ceilTick = (p: number, t: number) => Math.round(Math.ceil(p / t - 1e-9) * t * 1e6) / 1e6;

/**
 * Orders to have resting (or to take now) on one game's ladder.
 * The runner cancels anything resting that isn't in this list.
 */
export function ladderOrders(
  rungs: Rung[],
  positions: Position[],
  pmf: MarginPmf,
  cfg: LadderConfig,
  state: {
    realizedPnl?: number;
    /** P&L by final margin from this book's positions on OTHER venues for the same game (same index as pnlByMargin),
     *  so the loss cap covers the whole game across venues. */
    otherPnl?: number[];
    /** The market's implied home margin (the shape's market line); defaults to the pmf's mean. */
    marketHomeMargin?: number | null;
  } = {}
): { orders: Order[]; notes: string[] } {
  const pnl = gamePnl(rungs, positions, pmf, state.realizedPnl ?? 0);
  const targetHit = cfg.profitTarget != null && pnl >= cfg.profitTarget;
  if (cfg.shape) {
    const { orders, notes } = shapedOrders(rungs, positions, pmf, cfg, { ...state, profitTargetHit: targetHit });
    return { orders, notes };
  }
  const notes: string[] = [];
  const orders: Order[] = [];
  const pos = new Map(positions.map((p) => [p.ticker, p]));
  if (targetHit) notes.push(`profit target hit (${pnl.toFixed(2)} ≥ ${cfg.profitTarget}): exits only`);
  const pro = proExposure(rungs, positions, cfg.pick);
  const proEdgeNow = cfg.proEdge + cfg.edgeStep * Math.max(0, pro);

  // Caps are checked as if every pro-pick order placed so far in this call
  // also fills (they all rest at once), so 30 resting quotes can't jointly
  // blow through the loss cap. Anti-pick fills only reduce risk, so they
  // aren't assumed — that keeps the check conservative.
  const assumed = new Map(positions.map((p) => [p.ticker, { ...p }]));
  const fee: FeeFn = cfg.fee ?? kalshiFee;
  const withOther = (pnl: number[]) => (state.otherPnl ? pnl.map((v, i) => v + (state.otherPnl![i] ?? 0)) : pnl);
  const worstOf = (book: Map<string, Position>) => exposureSummary(withOther(pnlByMargin(rungs, [...book.values()], pmf.maxMargin)), pmf).worst;
  let antiBudget = Math.max(0, pro); // anti-pick contracts allowed without flipping the lean
  const fits = (o: { ticker: string; action: "buy" | "sell"; price: number; count: number }) => {
    const cur = assumed.get(o.ticker) ?? { ticker: o.ticker, yes: 0, cost: 0 };
    const delta = o.action === "buy" ? o.count : -o.count;
    if (Math.abs(cur.yes + delta) > cfg.perRungCap) return false;
    const next = new Map(assumed);
    next.set(o.ticker, { ticker: o.ticker, yes: cur.yes + delta, cost: cur.cost + delta * o.price + fee(o.price, { count: o.count }) });
    const before = worstOf(assumed);
    const after = worstOf(next);
    // Risk-reducing orders are always fine; others must stay within the loss cap.
    return after >= before - 1e-9 || after >= -cfg.maxWorstCaseLoss;
  };
  const accept = (o: Order) => {
    orders.push(o);
    if (o.direction === "anti") {
      antiBudget -= o.count;
      return;
    }
    const cur = assumed.get(o.ticker) ?? { ticker: o.ticker, yes: 0, cost: 0 };
    const delta = o.action === "buy" ? o.count : -o.count;
    assumed.set(o.ticker, { ticker: o.ticker, yes: cur.yes + delta, cost: cur.cost + delta * o.price + fee(o.price, { count: o.count }) });
  };

  // Spend the loss budget on the middle of the ladder first: near 50¢ is where
  // the liquidity is and where risk and reward per contract are balanced
  // (selling a 92¢-risk tail rung for 8¢ is a poor use of the cap).
  const fairOf = (r: Rung) => kalshiSpreadYesProb(pmf, r.side, r.strike);
  const byCenter = [...rungs].sort((a, b) => Math.abs(fairOf(a) - 0.5) - Math.abs(fairOf(b) - 0.5));
  for (const r of byCenter) {
    const fair = fairOf(r);
    const backsPick = r.side === cfg.pick;
    const h = pos.get(r.ticker)?.yes ?? 0;
    // Buying YES backs r.side; selling YES backs the other team.
    const plan: { action: "buy" | "sell"; direction: "pro" | "anti"; edge: number }[] = [
      { action: backsPick ? "buy" : "sell", direction: "pro", edge: proEdgeNow },
      { action: backsPick ? "sell" : "buy", direction: "anti", edge: cfg.antiEdge },
    ];
    for (const p of plan) {
      if (p.direction === "pro" && targetHit) continue;
      let count = cfg.orderSize;
      if (p.direction === "anti") {
        // Anti-pick: sell back what we hold here, or take the other side elsewhere
        // (a middle) only while we stay net long the pick overall.
        const unwind = p.action === "buy" ? Math.max(0, -h) : Math.max(0, h);
        count = Math.min(cfg.orderSize, Math.max(unwind, antiBudget));
        if (count <= 0) continue;
      }

      // Take a resting price when it beats fair by takeEdge after the taker fee.
      const takePrice = p.action === "buy" ? r.ask : r.bid;
      if (takePrice != null) {
        const edge = p.action === "buy" ? fair - takePrice - fee(takePrice) : takePrice - fair - fee(takePrice);
        const need = p.direction === "pro" ? Math.max(cfg.takeEdge, proEdgeNow) : Math.max(cfg.takeEdge, cfg.antiEdge);
        const o = { ticker: r.ticker, action: p.action, price: takePrice, count };
        if (edge >= need && fits(o)) {
          accept({ ...o, kind: "take", direction: p.direction, fair, reason: `take: ${(edge * 100).toFixed(1)}¢ edge after fee` });
          continue;
        }
      }

      // Otherwise rest a post-only quote at fair ∓ (edge + maker fee), never crossing the book.
      let price = p.action === "buy" ? floorTick(fair - p.edge - fee(fair, { maker: true }), cfg.tick) : ceilTick(fair + p.edge + fee(fair, { maker: true }), cfg.tick);
      if (p.action === "buy" && r.ask != null) price = Math.min(price, r.ask - cfg.tick);
      if (p.action === "sell" && r.bid != null) price = Math.max(price, r.bid + cfg.tick);
      if (price < cfg.tick || price > 1 - cfg.tick) continue;
      const o = { ticker: r.ticker, action: p.action, price: Math.round(price * 1e6) / 1e6, count };
      if (!fits(o)) continue;
      const edge = p.action === "buy" ? fair - o.price : o.price - fair;
      accept({ ...o, kind: "quote", direction: p.direction, fair, reason: `${p.direction} quote, ${(edge * 100).toFixed(1)}¢ from fair` });
    }
  }
  if (pro > 0) notes.push(`holding ${pro} pro-pick contracts: pro quotes need ${(proEdgeNow * 100).toFixed(1)}¢ edge`);
  return { orders, notes };
}
