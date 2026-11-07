// Paper-trading fill rules. Conservative on purpose:
//  - a resting quote only fills if the market traded THROUGH our price (not just at it, where we'd have been behind
//    other orders in the queue), or if the book itself moved through it;
//  - and only for as many contracts as actually traded through it (or were shown at the crossing price). The rest stays
//    resting. Several of our orders on one contract share the same trades, best-priced first, so no trade is counted
//    twice. Without this, a large paper order "filled" off a 3-contract trade and big sizes looked far better than any
//    real market could give.
// A venue that doesn't report a size counts each trade (and each displayed price) as UNKNOWN_SIZE contracts.

import { kalshiFee } from "../fairPrice/kalshi";

export const UNKNOWN_SIZE = 1;

export interface RestingOrder {
  id: number;
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  /** Unix seconds the order was placed. */
  placedAt: number;
}

export interface Trade {
  ticker: string;
  /** Unix seconds. */
  t: number;
  yesPrice: number;
  /** Contracts traded (undefined when the venue doesn't say). */
  count?: number;
}

export interface Top {
  bid: number | null;
  ask: number | null;
  /** Contracts shown at the best bid / ask (undefined when the venue doesn't say). */
  bidSize?: number | null;
  askSize?: number | null;
}

export interface PaperFill extends RestingOrder {
  /** Contracts filled (count) and still resting after this fill. */
  remaining: number;
}

const sizeOf = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n >= 0 ? n : UNKNOWN_SIZE);

/** Which resting orders filled since they were placed, and for how many contracts (count). */
export function paperFills(orders: RestingOrder[], trades: Trade[], books: Map<string, Top>): PaperFill[] {
  const usedTrade = new Map<Trade, number>();
  const usedBook = new Map<string, number>();
  // Most aggressive first: the highest bid and the lowest offer get the volume before ours further back.
  const queue = [...orders].sort((a, b) => (a.action === b.action ? (a.action === "buy" ? b.price - a.price : a.price - b.price) : 0));
  const out: PaperFill[] = [];
  for (const o of queue) {
    let got = 0;
    const want = o.count;
    const book = books.get(o.ticker);
    if (book) {
      const crossed = o.action === "buy" ? book.ask != null && book.ask < o.price : book.bid != null && book.bid > o.price;
      if (crossed) {
        const key = `${o.ticker}|${o.action}`;
        const avail = sizeOf(o.action === "buy" ? book.askSize : book.bidSize) - (usedBook.get(key) ?? 0);
        const take = Math.max(0, Math.min(want, avail));
        usedBook.set(key, (usedBook.get(key) ?? 0) + take);
        got += take;
      }
    }
    for (const t of trades) {
      if (got >= want) break;
      if (t.ticker !== o.ticker || t.t <= o.placedAt) continue;
      if (!(o.action === "buy" ? t.yesPrice < o.price : t.yesPrice > o.price)) continue;
      const avail = sizeOf(t.count) - (usedTrade.get(t) ?? 0);
      if (avail <= 0) continue;
      const take = Math.min(want - got, avail);
      usedTrade.set(t, (usedTrade.get(t) ?? 0) + take);
      got += take;
    }
    const n = Math.floor(got + 1e-9);
    if (n >= 1) out.push({ ...o, count: n, remaining: o.count - n });
  }
  return out;
}

/** Contracts a take can get right now: what's shown at the best price on the other side (UNKNOWN_SIZE if not shown). */
export function capTakes<O extends { ticker: string; action: "buy" | "sell"; count: number }>(
  orders: O[],
  topOf: (ticker: string) => Top | undefined
): O[] {
  const used = new Map<string, number>();
  const out: O[] = [];
  for (const o of orders) {
    const top = topOf(o.ticker);
    const key = `${o.ticker}|${o.action}`;
    const shown = sizeOf(o.action === "buy" ? top?.askSize : top?.bidSize);
    const n = Math.floor(Math.min(o.count, shown - (used.get(key) ?? 0)) + 1e-9);
    if (n < 1) continue;
    used.set(key, (used.get(key) ?? 0) + n);
    out.push(n === o.count ? o : { ...o, count: n });
  }
  return out;
}

/** Fee on a fill: makers for resting quotes, takers for takes. */
export function fillFee(price: number, count: number, kind: "quote" | "take"): number {
  return kalshiFee(price, { count, maker: kind === "quote" });
}

export interface DesiredOrder {
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  kind: "quote" | "take";
}

/**
 * Diff what's resting against what the engine wants: keep identical orders
 * (so they keep their queue position), cancel the rest, place the new ones.
 * With `tolerance`, a resting quote also survives if it's within that much
 * of the new price on the safer side (a bid at or below, an ask at or above),
 * so a fair price drifting by a fraction of a cent doesn't churn the book.
 */
export function diffOrders<R extends { id: number; ticker: string; action: string; price: number; count: number }, D extends DesiredOrder>(
  resting: R[],
  desired: D[],
  tolerance = 0
): { keep: R[]; cancel: R[]; place: D[] } {
  const quotes = desired.filter((d) => d.kind === "quote");
  const unmatched = new Set(quotes);
  const keep: R[] = [];
  const cancel: R[] = [];
  for (const r of resting) {
    const rp = Number(r.price);
    const match = [...unmatched].find((d) => {
      if (d.ticker !== r.ticker || d.action !== r.action || d.count !== r.count) return false;
      const diff = d.action === "buy" ? d.price - rp : rp - d.price; // ≥ 0 means resting is the safer price
      return Math.abs(diff) < 1e-9 || (diff > 0 && diff <= tolerance + 1e-9);
    });
    if (match) {
      unmatched.delete(match);
      keep.push(r);
    } else cancel.push(r);
  }
  return { keep, cancel, place: [...unmatched, ...desired.filter((d) => d.kind === "take")] };
}
