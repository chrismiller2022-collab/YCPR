// Target-position rebalancing (BOT_REBUILD_HANDOFF.md §5.2). Replaces "quote, fill, take profit at points" with:
// decide the position the shrunk edge justifies, hold the sum of what every venue has filled, and trade the difference.
//
// Canonical ladder. Every venue's rung is "<side> wins by over <strike>"; here each becomes a contract on one number,
//   C(x) = "home margin > x"            (x a half point)
// A home rung with strike k is C(k); an away rung with strike k is NOT C(−k). So all venues sit on the same x axis,
// positions add across venues, and for each x the cheapest place to buy and the best place to sell are found after fees.
//
// Target. With the fair margin shifted `edgePts` points from the market and spread sigma, the Kelly-optimal payoff is
// linear in the final margin with slope  s = kellyFrac · bankroll · |edgePts| / sigma²  dollars per point, i.e.
// s contracts on each C(x) (long them when the fair margin is above the market, short them when below). Only strikes
// where the edge after fees clears `takeEdge` are opened; a strike that isn't there is simply not held, and the size is
// NEVER pushed onto other strikes.
//
// Trading is take-only (no resting quotes):
//  - open / add: net edge after the venue's fee ≥ takeEdge, up to the target;
//  - reduce / close (the take-profit): when the exit price after fees is within `reduceSlack` of fair value, i.e. giving
//    little or nothing up, so edge that has been competed away is sold automatically; or when a risk cap forces it;
//  - caps: the whole position's worst case (all venues, after fees) stays inside `gameCap`; if the position is already
//    over, only risk-reducing trades are made, cutting the cheapest-to-cut contracts first.
//
// Pure functions, no I/O. Margins are HOME − AWAY. Prices are dollars per $1 contract.

import { pHomeMarginAbove, type MarginPmf } from "../fairPrice/marginDistribution";
import type { Side } from "../fairPrice/lines";
import { exposureSummary, pnlByMargin, type FeeFn, type Position, type Rung } from "./engine";

export type VenueKey = string;

export interface VenueBook {
  venue: VenueKey;
  rungs: Rung[];
  fee: FeeFn;
}

/** A net position on one ticker of one venue (cost includes fees). */
export interface Held {
  venue: VenueKey;
  ticker: string;
  side: Side;
  strike: number;
  yes: number;
  cost: number;
}

export interface TargetConfig {
  /** Paper bankroll the Kelly sizing scales with, dollars. */
  bankroll: number;
  /** Fraction of full Kelly (0.25 = quarter Kelly). */
  kellyFrac: number;
  /** Stddev of the final margin (the pmf's sigma). */
  sigma: number;
  /** Net edge per contract after fees, dollars, needed to open or add. */
  takeEdge: number;
  /** Edge, dollars, willing to give up to cut a position that is above its target. */
  reduceSlack: number;
  /** Max |net contracts| on any one canonical strike across all venues. */
  maxPerStrike: number;
  /** Worst-case loss allowed on this game across all venues, dollars (already net of team / conference / portfolio room). */
  gameCap: number;
  /** Only open strikes whose fair probability is inside [minFair, 1 − minFair]. */
  minFair: number;
}

export const DEFAULT_TARGET: TargetConfig = {
  bankroll: 1000,
  kellyFrac: 0.25,
  sigma: 15,
  takeEdge: 0.005,
  reduceSlack: 0.01,
  maxPerStrike: 5,
  gameCap: 10,
  minFair: 0.05,
};

export interface TargetOrder {
  venue: VenueKey;
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  /** "pro" = adds to the position the edge points to; "anti" = cuts a position. */
  direction: "pro" | "anti";
  /** Fair YES probability of this ticker. */
  fair: number;
  /** Canonical strike x of C(x). */
  x: number;
  reason: string;
  /** Made only because a risk cap required it. */
  forced?: boolean;
}

export interface TargetPlan {
  /** Which way the edge points; null = no edge. */
  lean: "home" | "away" | null;
  edgePts: number;
  /** Contracts per strike the Kelly slope asks for (before the per-strike cap and risk scale). */
  slope: number;
  /** Strikes where opening was possible at the current prices. */
  openable: number;
  /** Share of the planned opens kept after the worst-case cap (1 = all). */
  scale: number;
  worstBefore: number;
  worstAfter: number;
  /** P&L by home margin −maxMargin..maxMargin (index = margin + maxMargin) now and after the planned orders. */
  curveBefore: number[];
  curveAfter: number[];
  /** Expected P&L of the position after the orders under the fair distribution. */
  expectedAfter: number;
  /** Net contracts on C(x) now, by x. */
  heldByX: Record<string, number>;
}

interface Leg {
  venue: VenueKey;
  ticker: string;
  action: "buy" | "sell";
  /** The rung's own YES price traded. */
  price: number;
  /** Per-contract cost to buy (price + fee) or proceeds from selling (price − fee). */
  net: number;
  fee: FeeFn;
}
interface Node {
  x: number;
  f: number;
  buy: Leg | null;
  sell: Leg | null;
  held: number;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const xOf = (r: { side: Side; strike: number }) => (r.side === "home" ? r.strike : -r.strike);

/** One canonical strike's best way to buy and to sell C(x) over all venues, after fees. */
function buildNodes(books: VenueBook[], held: Held[], pmf: MarginPmf): Map<number, Node> {
  const nodes = new Map<number, Node>();
  const node = (x: number): Node => {
    let n = nodes.get(x);
    if (!n) nodes.set(x, (n = { x, f: pHomeMarginAbove(pmf, x), buy: null, sell: null, held: 0 }));
    return n;
  };
  for (const b of books)
    for (const r of b.rungs) {
      const n = node(xOf(r));
      // Buying C(x): home rung = buy YES at the ask; away rung = sell YES at the bid (short NOT C = long C).
      const buyYes = r.side === "home";
      const buyPrice = buyYes ? r.ask : r.bid;
      if (buyPrice != null && buyPrice > 0 && buyPrice < 1) {
        const net = buyYes ? buyPrice + b.fee(buyPrice, { count: 1 }) : 1 - buyPrice + b.fee(buyPrice, { count: 1 });
        // Compare in C(x) terms: cost of one C(x) contract. A sold away-YES receives `price` for the NOT-C side, i.e. C costs 1 − price.
        if (!n.buy || net < n.buy.net) n.buy = { venue: b.venue, ticker: r.ticker, action: buyYes ? "buy" : "sell", price: buyPrice, net, fee: b.fee };
      }
      const sellPrice = buyYes ? r.bid : r.ask;
      if (sellPrice != null && sellPrice > 0 && sellPrice < 1) {
        const net = buyYes ? sellPrice - b.fee(sellPrice, { count: 1 }) : 1 - sellPrice - b.fee(sellPrice, { count: 1 });
        if (!n.sell || net > n.sell.net) n.sell = { venue: b.venue, ticker: r.ticker, action: buyYes ? "sell" : "buy", price: sellPrice, net, fee: b.fee };
      }
    }
  for (const h of held) node(xOf(h)).held += h.side === "home" ? h.yes : -h.yes;
  return nodes;
}

/** Positions after applying orders at their prices, fees on the whole order. */
function applyOrders(held: Held[], orders: TargetOrder[], rungOf: Map<string, { side: Side; strike: number; fee: FeeFn }>): Position[] {
  const m = new Map<string, Position>();
  for (const h of held) m.set(h.ticker, { ticker: h.ticker, yes: h.yes, cost: h.cost });
  for (const o of orders) {
    const meta = rungOf.get(o.ticker);
    const p = m.get(o.ticker) ?? { ticker: o.ticker, yes: 0, cost: 0 };
    const d = o.action === "buy" ? o.count : -o.count;
    m.set(o.ticker, { ticker: o.ticker, yes: p.yes + d, cost: p.cost + d * o.price + (meta ? meta.fee(o.price, { count: o.count }) : 0) });
  }
  return [...m.values()];
}

const MAXM = 80;
const curveOf = (rungMeta: Pick<Rung, "ticker" | "side" | "strike">[], positions: Position[]) => pnlByMargin(rungMeta, positions, MAXM);
const worstOf = (curve: number[]) => Math.min(...curve.filter((_, i) => i !== MAXM)); // margin 0 never happens

/**
 * The orders that move the position held across all venues toward the target, and a plan describing why.
 * `edgePts` = fair mean − market (home margin points); the pmf is the fair distribution.
 */
export function targetOrders(books: VenueBook[], held: Held[], pmf: MarginPmf, edgePts: number, cfg: TargetConfig): { orders: TargetOrder[]; plan: TargetPlan; notes: string[] } {
  const notes: string[] = [];
  const nodes = buildNodes(books, held, pmf);
  const rungOf = new Map<string, { side: Side; strike: number; fee: FeeFn }>();
  for (const b of books) for (const r of b.rungs) rungOf.set(r.ticker, { side: r.side, strike: r.strike, fee: b.fee });
  const meta: Pick<Rung, "ticker" | "side" | "strike">[] = [...rungOf].map(([ticker, r]) => ({ ticker, side: r.side, strike: r.strike }));
  for (const h of held) if (!rungOf.has(h.ticker)) meta.push({ ticker: h.ticker, side: h.side, strike: h.strike }), rungOf.set(h.ticker, { side: h.side, strike: h.strike, fee: () => 0 });

  const heldPos: Position[] = held.map((h) => ({ ticker: h.ticker, yes: h.yes, cost: h.cost }));
  const curveBefore = curveOf(meta, heldPos);
  const worstBefore = worstOf(curveBefore);

  const dir = edgePts > 1e-9 ? 1 : edgePts < -1e-9 ? -1 : 0;
  const slope = (cfg.kellyFrac * cfg.bankroll * Math.abs(edgePts)) / (cfg.sigma * cfg.sigma);
  const size = Math.min(cfg.maxPerStrike, Math.round(slope));

  interface Trade {
    node: Node;
    leg: Leg;
    qty: number;
    open: boolean;
  }
  const opens: Trade[] = [];
  const closes: Trade[] = [];
  let openable = 0;
  for (const n of [...nodes.values()].sort((a, b) => a.x - b.x)) {
    const enter = dir > 0 ? n.buy != null && n.f - n.buy.net >= cfg.takeEdge : dir < 0 ? n.sell != null && n.sell.net - n.f >= cfg.takeEdge : false;
    const inWindow = n.f >= cfg.minFair && n.f <= 1 - cfg.minFair;
    const ok = enter && inWindow && size > 0;
    if (ok) openable++;
    const target = ok ? dir * size : 0;
    const gap = target - n.held;
    if (gap > 0 && n.buy) {
      const cover = Math.min(gap, Math.max(0, -n.held)); // buying back shorts
      const open = gap - cover;
      if (cover > 0 && n.buy.net <= n.f + cfg.reduceSlack) closes.push({ node: n, leg: n.buy, qty: cover, open: false });
      if (open > 0) opens.push({ node: n, leg: n.buy, qty: open, open: true });
    } else if (gap < 0 && n.sell) {
      const sellQty = -gap;
      const close = Math.min(sellQty, Math.max(0, n.held)); // selling longs
      const open = sellQty - close;
      if (close > 0 && n.sell.net >= n.f - cfg.reduceSlack) closes.push({ node: n, leg: n.sell, qty: close, open: false });
      if (open > 0) opens.push({ node: n, leg: n.sell, qty: open, open: true });
    }
  }

  const toOrder = (t: Trade, qty: number, reason: string): TargetOrder => {
    // The ticker's own YES fair: a home rung is C(x), an away rung is NOT C(x).
    const fairYes = rungOf.get(t.leg.ticker)!.side === "home" ? t.node.f : 1 - t.node.f;
    return { venue: t.leg.venue, ticker: t.leg.ticker, action: t.leg.action, price: r6(t.leg.price), count: qty, direction: t.open ? "pro" : "anti", fair: r6(fairYes), x: t.node.x, reason };
  };
  const reasonOf = (t: Trade) => {
    const edge = t.node.buy === t.leg ? t.node.f - t.leg.net : t.leg.net - t.node.f;
    return t.open ? `open C(${t.node.x}): ${(edge * 100).toFixed(1)}¢ edge after fee on ${t.leg.venue}` : `cut C(${t.node.x}): exit within ${(cfg.reduceSlack * 100).toFixed(1)}¢ of fair on ${t.leg.venue}`;
  };

  /** P&L by margin of `count` more contracts traded at `price` (fee included): added to a running curve one contract at a time. */
  const unitDelta = (ticker: string, action: "buy" | "sell", price: number, fee: number) => {
    const r = rungOf.get(ticker)!;
    const d = action === "buy" ? 1 : -1;
    return curveBefore.map((_, i) => d * (((r.side === "home" ? i - MAXM : MAXM - i) > r.strike ? 1 : 0) - price) - fee);
  };
  const worstWith = (orders: TargetOrder[]) => worstOf(curveOf(meta, applyOrders(held, orders, rungOf)));

  // Closes first (they only cut risk or take profit), then open contracts one per strike per round, best edge first,
  // while the whole position's worst case stays inside the cap (and never worse than an existing breach).
  const closeOrders = closes.map((t) => toOrder(t, t.qty, reasonOf(t)));
  const allowed = Math.min(-cfg.gameCap, worstWith(closeOrders));
  let curve = curveOf(meta, applyOrders(held, closeOrders, rungOf));
  const edgeOf = (t: Trade) => (t.node.buy === t.leg ? t.node.f - t.leg.net : t.leg.net - t.node.f);
  const ranked = [...opens].sort((a, b) => edgeOf(b) - edgeOf(a));
  const placed = new Map<Trade, number>();
  const planned = opens.reduce((s2, t) => s2 + t.qty, 0);
  const maxQty = opens.reduce((m, t) => Math.max(m, t.qty), 0);
  let kept = 0;
  for (let round = 1; round <= maxQty; round++)
    for (const t of ranked) {
      if (t.qty < round) continue;
      const d = unitDelta(t.leg.ticker, t.leg.action, t.leg.price, t.leg.fee(t.leg.price, { count: 1 }));
      const c2 = curve.map((v, k) => v + d[k]);
      if (worstOf(c2) < allowed - 1e-9) continue;
      curve = c2;
      placed.set(t, (placed.get(t) ?? 0) + 1);
      kept++;
    }
  const scale = planned ? kept / planned : 1;
  let orders: TargetOrder[] = [...closeOrders];
  for (const [t, q] of placed) orders.push(toOrder(t, q, reasonOf(t)));

  // Still over the cap (positions already held): cut the contract whose removal helps the worst case most, one at a time.
  if (worstWith(orders) < -cfg.gameCap - 1e-9) {
    const book = new Map<string, { venue: VenueKey; bid: number | null; ask: number | null; fee: FeeFn }>();
    for (const b of books) for (const r of b.rungs) book.set(r.ticker, { venue: b.venue, bid: r.bid, ask: r.ask, fee: b.fee });
    curve = curveOf(meta, applyOrders(held, orders, rungOf));
    const net = new Map(applyOrders(held, orders, rungOf).map((p) => [p.ticker, p.yes]));
    for (let i = 0; i < 400 && worstOf(curve) < -cfg.gameCap - 1e-9; i++) {
      let best: { o: TargetOrder; curve: number[]; w: number } | null = null;
      for (const [ticker, y] of net) {
        const b = book.get(ticker);
        if (!b || y === 0) continue;
        const action: "buy" | "sell" = y > 0 ? "sell" : "buy";
        const price = action === "sell" ? b.bid : b.ask;
        if (price == null || price <= 0 || price >= 1) continue;
        const d = unitDelta(ticker, action, price, b.fee(price, { count: 1 }));
        const c2 = curve.map((v, k) => v + d[k]);
        const w = worstOf(c2);
        if (!best || w > best.w) {
          const r = rungOf.get(ticker)!;
          const xx = xOf(r);
          const f = nodes.get(xx)?.f ?? 0.5;
          best = { o: { venue: b.venue, ticker, action, price: r6(price), count: 1, direction: "anti", fair: r6(r.side === "home" ? f : 1 - f), x: xx, reason: `cut ${ticker}: over the $${cfg.gameCap.toFixed(0)} worst-case cap`, forced: true }, curve: c2, w };
        }
      }
      if (!best || best.w <= worstOf(curve) + 1e-12) break;
      orders.push(best.o);
      curve = best.curve;
      net.set(best.o.ticker, (net.get(best.o.ticker) ?? 0) + (best.o.action === "buy" ? 1 : -1));
    }
  }

  // Merge orders on the same ticker and side into one.
  const merged = new Map<string, TargetOrder>();
  for (const o of orders) {
    const k = `${o.ticker}|${o.action}|${o.direction}`;
    const m = merged.get(k);
    if (m) m.count += o.count;
    else merged.set(k, { ...o });
  }
  orders = [...merged.values()];

  const afterPos = applyOrders(held, orders, rungOf);
  const curveAfter = curveOf(meta, afterPos);
  const heldByX: Record<string, number> = {};
  for (const n of nodes.values()) if (n.held !== 0) heldByX[String(n.x)] = n.held;
  if (!dir) notes.push("no edge: nothing to open");
  else if (!openable) notes.push("edge is inside the fee dead zone at the current prices");
  if (scale < 1) notes.push(`${kept} of ${planned} planned contracts fit under the $${cfg.gameCap.toFixed(0)} worst-case cap`);
  return {
    orders,
    notes,
    plan: {
      lean: dir > 0 ? "home" : dir < 0 ? "away" : null,
      edgePts, slope, openable, scale,
      worstBefore, worstAfter: worstOf(curveAfter), curveBefore, curveAfter,
      expectedAfter: exposureSummary(curveAfter, pmf).expected,
      heldByX,
    },
  };
}

/** Worst-case loss (a positive number) of a set of positions on one game, all venues together. */
export function worstLoss(held: Held[]): number {
  if (!held.length) return 0;
  const meta = held.map((h) => ({ ticker: h.ticker, side: h.side, strike: h.strike }));
  const w = worstOf(curveOf(meta, held.map((h) => ({ ticker: h.ticker, yes: h.yes, cost: h.cost }))));
  return Math.max(0, -w);
}

/** Which team a book's position on a game backs: the side that wins when the margin is large. */
export function backedSide(held: Held[]): Side | null {
  if (!held.length) return null;
  const meta = held.map((h) => ({ ticker: h.ticker, side: h.side, strike: h.strike }));
  const c = curveOf(meta, held.map((h) => ({ ticker: h.ticker, yes: h.yes, cost: h.cost })));
  const home = c[MAXM + 40];
  const away = c[MAXM - 40];
  return home > away + 1e-9 ? "home" : away > home + 1e-9 ? "away" : null;
}

/** Room left under a game's cap after the caps shared with other games (portfolio, backed team, backed conference). */
export function gameRoom(strategyCap: number, others: { worst: number; team: string | null; conf: string | null }[], mine: { team: string | null; conf: string | null }, caps: { portfolio: number; team: number; conf: number }): number {
  const used = (pred: (o: (typeof others)[number]) => boolean) => others.filter(pred).reduce((s, o) => s + o.worst, 0);
  const room = [
    strategyCap,
    caps.portfolio - used(() => true),
    mine.team ? caps.team - used((o) => o.team === mine.team) : Infinity,
    mine.conf ? caps.conf - used((o) => o.conf === mine.conf) : Infinity,
  ];
  return Math.max(0, Math.min(...room));
}
