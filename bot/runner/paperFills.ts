// Paper-trading fill rules. Conservative on purpose: a resting quote only
// counts as filled if the market traded THROUGH our price (not just at it,
// where we'd have been behind other orders in the queue), or if the book
// itself moved through it.

import { kalshiFee } from "../fairPrice/kalshi";

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
}

export interface Top {
  bid: number | null;
  ask: number | null;
}

/** Which resting orders filled since they were placed. */
export function paperFills(orders: RestingOrder[], trades: Trade[], books: Map<string, Top>): RestingOrder[] {
  return orders.filter((o) => {
    const book = books.get(o.ticker);
    if (book) {
      if (o.action === "buy" && book.ask != null && book.ask < o.price) return true;
      if (o.action === "sell" && book.bid != null && book.bid > o.price) return true;
    }
    return trades.some((t) => t.ticker === o.ticker && t.t > o.placedAt && (o.action === "buy" ? t.yesPrice < o.price : t.yesPrice > o.price));
  });
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
