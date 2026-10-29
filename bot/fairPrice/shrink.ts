// Shrunk, market-updating fair value (BOT_REBUILD_HANDOFF.md §5.1).
//
//   fair_mean = market + beta · gapEff(yc − market)
//
// `market` is the prediction-market median: the median of the margins each venue's ladder implies (Kalshi, Novig,
// ProphetX, later Polymarket). It is recomputed every cycle, so the fair mean moves when the market moves. The
// sportsbook line is NOT part of it. `yc` is the original model line and is never changed here.
//
// gapEff is the "hump": CLV rises with the raw gap up to about 5 points and is gone beyond 6 (§4b), so the gap that
// counts is capped at `humpCap`. With `humpFall` > 0 it then declines linearly to 0 over that many extra points
// (treating very large gaps as stale information or model error). Default is flat after the cap.
//
// Pure functions, no I/O. Margins are HOME − AWAY, like the rest of the bot.

import { DEFAULT_MARGIN_MODEL, type MarginModel } from "./marginDistribution";

export interface ShrinkSettings {
  /** Share of the (capped) gap that is treated as real edge. 0.1 until more weeks accumulate. */
  beta: number;
  /** Raw gap, in points, beyond which extra gap adds no edge. */
  humpCap: number;
  /** Points past humpCap over which the counted gap falls to 0 (0 = stays flat). */
  humpFall: number;
  /** Stddev of the final margin around the fair mean. */
  sigma: number;
}

export const DEFAULT_SHRINK: ShrinkSettings = { beta: 0.1, humpCap: 5.5, humpFall: 0, sigma: 15 };

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Settings from a bot_state row (and an optional per-game beta); anything missing or invalid falls back to the default. */
export function shrinkFrom(state: { beta?: unknown; hump_cap?: unknown; hump_fall?: unknown; sigma?: unknown } | null | undefined, gameBeta?: unknown): ShrinkSettings {
  const n = (v: unknown) => (v == null || v === "" ? NaN : Number(v));
  const pick = (v: number, ok: (x: number) => boolean, d: number) => (finite(v) && ok(v) ? v : d);
  return {
    beta: pick(n(gameBeta) as number, (x) => x >= 0 && x <= 1, pick(n(state?.beta), (x) => x >= 0 && x <= 1, DEFAULT_SHRINK.beta)),
    humpCap: pick(n(state?.hump_cap), (x) => x > 0 && x <= 60, DEFAULT_SHRINK.humpCap),
    humpFall: pick(n(state?.hump_fall), (x) => x >= 0 && x <= 60, DEFAULT_SHRINK.humpFall),
    sigma: pick(n(state?.sigma), (x) => x >= 5 && x <= 40, DEFAULT_SHRINK.sigma),
  };
}

/** Median of the venues' implied margins (ignores missing ones); null when no venue has a ladder. */
export function pmMedian(margins: Partial<Record<string, number | null | undefined>> | null | undefined): number | null {
  const xs = Object.values(margins ?? {}).filter(finite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** The part of a raw gap that counts as edge (signed): linear up to humpCap, then flat or falling. */
export function effectiveGap(gap: number, s: Pick<ShrinkSettings, "humpCap" | "humpFall">): number {
  const a = Math.abs(gap);
  const counted = a <= s.humpCap ? a : s.humpFall > 0 ? Math.max(0, s.humpCap * (1 - (a - s.humpCap) / s.humpFall)) : s.humpCap;
  return Math.sign(gap) * counted;
}

export interface Shrunk {
  /** The shrunk home margin to price from (the market when there is no edge); null without a model line or a market. */
  fair: number | null;
  /** The market anchor used. */
  market: number | null;
  /** yc − market (raw). */
  gap: number | null;
  /** beta · gapEff: the edge, in points, that the fair mean sits away from the market. */
  edgePts: number | null;
  /** Which way the edge points; null when it is 0. */
  lean: "home" | "away" | null;
}

/** fair = market + beta · gapEff(yc − market). No market anchor = no fair value (we do not fall back to a sportsbook line). */
export function shrunkHomeMargin(yc: number | null | undefined, market: number | null | undefined, s: ShrinkSettings): Shrunk {
  if (!finite(yc) || !finite(market)) return { fair: null, market: finite(market) ? market : null, gap: null, edgePts: null, lean: null };
  const gap = yc - market;
  const edgePts = s.beta * effectiveGap(gap, s);
  return { fair: market + edgePts, market, gap, edgePts, lean: edgePts > 0 ? "home" : edgePts < 0 ? "away" : null };
}

export const modelWith = (sigma: number): MarginModel => ({ ...DEFAULT_MARGIN_MODEL, sigma });

/** What a shrunk book prices from: the PM median of the given venue margins, and the shrunk fair around it. */
export function shrunkFromMargins(yc: number | null | undefined, margins: Partial<Record<string, number | null | undefined>> | null | undefined, s: ShrinkSettings): Shrunk {
  return shrunkHomeMargin(yc, pmMedian(margins), s);
}
