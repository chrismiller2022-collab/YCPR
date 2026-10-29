// Per-venue fee schedules, with where each number came from. Nothing here is a bare constant in an
// adapter any more: Kalshi's type and multiplier are read from its public API (series + per-event
// overrides), and the Novig / ProphetX rates carry their source and whether they were confirmed.
//
// Checked 2026-10-29:
//  - Kalshi: kalshi.com/docs/kalshi-fee-schedule.pdf (taker = round_up(M · 0.07 · C · P · (1−P)); maker fees apply only when a
//    resting order executes; per-series multiplier M), docs.kalshi.com (/series/fee_changes, /events/fee_changes, Fee Rounding).
//    KXNCAAFSPREAD reports fee_type "quadratic_with_maker_fees", fee_multiplier 1 (since 2026-01-01), no event overrides.
//    The 0.0175 maker rate is 0.25 × the taker formula (Kalshi's "standard 0.25" maker multiplier); the schedule PDF was
//    rate-limited when checked, so the maker coefficient is the one number here not read straight from Kalshi's own page.
//  - Novig: secondary sources only (Dimers 2026-10-05, Action Network): pre-game straight trades are free for both sides;
//    live taker fee = coefficient · P · (1−P) · C with coefficient 0.03, and 0.06 for college football spreads/totals
//    (Action Network). Makers pay nothing. Novig's own schedule was not reachable (novig.us/fees redirects to a landing page).
//  - ProphetX: no official fee page found; reviews say 2% of net winnings (1% / 3% tiers also mentioned, unconfirmed).
//    The commission is account-configurable, so it is a setting (PROPHETX_COMMISSION), default 2%.
//  - Polymarket US: docs.polymarket.us/fees.md (taker 0.0695 · p · (1−p), makers free) and each market's own feeCoefficient; see below.

import type { FeeFn } from "../ladder/engine";

export const FEE_SOURCES = {
  kalshi: { verified: true, note: "Kalshi fee schedule + live series API; maker coefficient inferred (0.25 × taker)", checked: "2026-10-29" },
  novig: { verified: false, note: "Secondary sources (Dimers, Action Network); pre-game free, live CFB taker 0.06", checked: "2026-10-29" },
  prophetx: { verified: false, note: "Reviews: 2% of net winnings; account-configurable", checked: "2026-10-29" },
} as const;

// ---------- Kalshi

export const KALSHI_TAKER_RATE = 0.07;
/** quadratic_with_maker_fees: makers pay 0.25 × the taker formula. */
export const KALSHI_MAKER_SHARE = 0.25;

export interface KalshiFeeSchedule {
  /** "quadratic" (takers only), "quadratic_with_maker_fees" or "flat" (unknown to this model; treated like the former, conservatively). */
  feeType: string;
  multiplier: number;
  /** event_ticker → override that replaces the series' type/multiplier for that event. */
  overrides: Record<string, { feeType: string | null; multiplier: number | null }>;
  source: "api" | "fallback";
  fetchedAt: number;
}

export const KALSHI_FALLBACK: KalshiFeeSchedule = { feeType: "quadratic_with_maker_fees", multiplier: 1, overrides: {}, source: "fallback", fetchedAt: 0 };

/** Fee in dollars for `count` contracts at `price`. Kalshi rounds each fill up to $0.000001; that is far below a cent and ignored. */
export function kalshiFeeWith(feeType: string, multiplier: number): FeeFn {
  return (price, opts = {}) => {
    const taker = KALSHI_TAKER_RATE * multiplier * (opts.count ?? 1) * price * (1 - price);
    if (!opts.maker) return taker;
    return feeType === "quadratic" ? 0 : taker * KALSHI_MAKER_SHARE;
  };
}

/** The fee function for one Kalshi event (its override, else the series' type and multiplier). */
export function kalshiFeeFor(s: KalshiFeeSchedule, eventTicker?: string | null): FeeFn {
  const o = eventTicker ? s.overrides[eventTicker] : undefined;
  return kalshiFeeWith(o?.feeType ?? s.feeType, o?.multiplier ?? s.multiplier);
}

const KALSHI_API = "https://external-api.kalshi.com/trade-api/v2";
let kalshiCache: KalshiFeeSchedule | null = null;
const TTL_MS = 30 * 60e3;

/**
 * Kalshi's current fee type and multiplier for the NCAAF spread series plus any event overrides. Cached for 30 minutes per process;
 * a failed read keeps the last good schedule (or the documented fallback), so a rate limit never stops a cycle.
 */
export async function loadKalshiSchedule(
  getJson: (url: string) => Promise<any> = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Kalshi ${r.status}`);
    return r.json();
  },
  series = "KXNCAAFSPREAD",
  now = Date.now()
): Promise<KalshiFeeSchedule> {
  if (kalshiCache && now - kalshiCache.fetchedAt < TTL_MS) return kalshiCache;
  try {
    const s = (await getJson(`${KALSHI_API}/series/${series}`))?.series;
    if (!s?.fee_type || !Number.isFinite(Number(s.fee_multiplier))) throw new Error("series has no fee fields");
    const overrides: KalshiFeeSchedule["overrides"] = {};
    try {
      const ev = await getJson(`${KALSHI_API}/events/fee_changes?show_historical=false`);
      for (const c of ev?.event_fee_changes ?? []) {
        const t = c.event_ticker;
        if (!t || (c.scheduled_ts && new Date(c.scheduled_ts).getTime() > now)) continue; // only overrides already in force
        overrides[t] = { feeType: c.fee_type_override ?? null, multiplier: c.fee_multiplier_override == null ? null : Number(c.fee_multiplier_override) };
      }
    } catch {
      // overrides are rare; the series schedule still applies
    }
    kalshiCache = { feeType: String(s.fee_type), multiplier: Number(s.fee_multiplier), overrides, source: "api", fetchedAt: now };
  } catch {
    kalshiCache = kalshiCache ?? { ...KALSHI_FALLBACK, fetchedAt: now - TTL_MS + 5 * 60e3 }; // retry in 5 minutes
  }
  return kalshiCache;
}

/** Test hook. */
export const resetKalshiScheduleCache = () => {
  kalshiCache = null;
};

// ---------- Novig

/** Live taker coefficient for college football spreads (Action Network); pre-game is free; makers never pay. */
export const NOVIG_LIVE_TAKER_COEF = 0.06;

export const novigFee =
  (hoursToKickoff: number): FeeFn =>
  (price, opts = {}) =>
    hoursToKickoff > 0 || opts.maker ? 0 : NOVIG_LIVE_TAKER_COEF * (opts.count ?? 1) * price * (1 - price);

// ---------- ProphetX

/** Share of net winnings; account-configurable on ProphetX. */
export const prophetxCommission = (): number => {
  const v = Number(process.env.PROPHETX_COMMISSION);
  return Number.isFinite(v) && v >= 0 && v < 1 && process.env.PROPHETX_COMMISSION ? v : 0.02;
};

/** Expected commission when buying at `price`: the rate on the winnings (1 − price) a contract earns, charged on every fill (conservative: also charged on losing contracts' sells). */
export const prophetxFee =
  (): FeeFn =>
  (price, opts = {}) =>
    prophetxCommission() * (opts.count ?? 1) * (1 - price);

// ---------- Polymarket US

/**
 * Polymarket US (docs.polymarket.us/fees.md, effective 2026-10-19): taker fee = theta · C · p · (1 − p) with theta 0.0695, exposed per market as
 * `feeCoefficient` (read from the market data each cycle). Makers pay nothing; the maker rebate (tiered on prior-month maker volume, none below
 * $10M) is ignored, which is conservative. Combo fills use another formula and are not traded here.
 */
export const POLYMARKET_DEFAULT_COEF = 0.0695;

export const polymarketFee =
  (coef: number = POLYMARKET_DEFAULT_COEF): FeeFn =>
  (price, opts = {}) =>
    opts.maker ? 0 : coef * (opts.count ?? 1) * price * (1 - price);
