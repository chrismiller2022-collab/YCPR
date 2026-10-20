// Kalshi-specific helpers for pricing: fee model and spread-market titles.
// Verified against Kalshi docs and the live public API on 2026-10-20
// (see docs/kalshi-bot-handoff.md §6). No order placement here.

/** Rates for fee_type "quadratic_with_maker_fees" (KXNCAAFSPREAD, KXNCAAFGAME, KXNCAAFTOTAL). */
export const KALSHI_TAKER_RATE = 0.07;
export const KALSHI_MAKER_RATE = 0.0175;

/**
 * Model fee in dollars: rate × count × P × (1 − P) × series fee_multiplier.
 * Kalshi rounds per fill to 6 decimals and settles balances in cents for
 * non-direct members, refunding rounding overpayment, so this is the
 * long-run cost. Pass roundUpToCent for the worst case on a single fill.
 */
export function kalshiFee(
  price: number,
  opts: { count?: number; maker?: boolean; multiplier?: number; roundUpToCent?: boolean } = {}
): number {
  const rate = opts.maker ? KALSHI_MAKER_RATE : KALSHI_TAKER_RATE;
  const fee = rate * (opts.count ?? 1) * price * (1 - price) * (opts.multiplier ?? 1);
  return opts.roundUpToCent ? Math.ceil(fee * 100 - 1e-9) / 100 : fee;
}

export interface KalshiSpreadTitle {
  team: string;
  strike: number;
}

/**
 * Parse a KXNCAAFSPREAD market's yes_sub_title, e.g.
 * "Oklahoma St. wins by over 7.5 points" → { team: "Oklahoma St.", strike: 7.5 }.
 * Resolve `team` through matchTeamName (src/lib/teamNameMatch.ts); prefer
 * the market's floor_strike field over the parsed strike when you have it.
 */
export function parseKalshiSpreadTitle(title: string): KalshiSpreadTitle | null {
  const m = /^(.+?) wins by over (\d+(?:\.\d+)?) points?$/i.exec(title.trim());
  return m ? { team: m[1].trim(), strike: Number(m[2]) } : null;
}

/** Order book levels as returned by GET /markets/{ticker}/orderbook (orderbook_fp). */
export interface KalshiOrderbook {
  yes_dollars: [string, string][];
  no_dollars: [string, string][];
}

/**
 * Best YES bid/ask from a book that lists bids only. Levels come back in
 * ascending price order (best bid last); this takes the max either way.
 * YES ask = 1 − best NO bid.
 */
export function bestYesQuotes(book: KalshiOrderbook): { bid: number | null; ask: number | null } {
  const top = (levels: [string, string][]) => (levels?.length ? Math.max(...levels.map(([p]) => Number(p))) : null);
  const yesBid = top(book.yes_dollars);
  const noBid = top(book.no_dollars);
  return { bid: yesBid, ask: noBid != null ? Math.round((1 - noBid) * 10000) / 10000 : null };
}
