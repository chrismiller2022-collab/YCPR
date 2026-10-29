// Fill markouts (BOT_REBUILD_HANDOFF.md §5.4): what the same market's mid was 1, 15 and 60 minutes after each fill.
//
//   markout = direction · (later mid − fill price),   direction = +1 for a buy, −1 for a sell, per contract, before fees
//
// Positive = the market moved the way the fill needed (good price). The mid comes from bot_mkt_snaps, which stores a quote only when
// it changes, so "the mid at time t" is the last recorded two-sided quote at or before t. Because the recorder runs every few minutes,
// the 1-minute figure often equals the mid at the fill itself; the report prints the recorder's real resolution next to it.
// To close (CLV) and settlement are already on the fill (close_mid, result).

import { db } from "../runner/io";

export interface Snap {
  /** Unix seconds. */
  t: number;
  bid: number | null;
  ask: number | null;
}

/** Mid of the last two-sided quote at or before `t` in a series sorted by t; null when there is none. */
export function midAt(series: Snap[], t: number): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = at; i >= 0; i--) {
    const s = series[i];
    if (s.bid != null && s.ask != null) return (s.bid + s.ask) / 2;
  }
  return null;
}

export interface Mids {
  mid0: number | null;
  mid1: number | null;
  mid15: number | null;
  mid60: number | null;
}

export function fillMids(series: Snap[], filledAt: number): Mids {
  return { mid0: midAt(series, filledAt), mid1: midAt(series, filledAt + 60), mid15: midAt(series, filledAt + 15 * 60), mid60: midAt(series, filledAt + 60 * 60) };
}

/** direction · (mid − price), per contract, in dollars; null without a mid. */
export const markout = (action: "buy" | "sell", price: number, mid: number | null): number | null => (mid == null ? null : (action === "buy" ? 1 : -1) * (mid - price));

/** The first recorded quotes in this environment are from here; earlier fills have no history to measure against. */
export const MARKOUT_SINCE = "2026-10-21T21:10:00Z";

interface FillRef {
  id: number;
  game_id: string;
  venue: string;
  ticker: string;
  filled_at: string;
}

/**
 * Fill in mid_1m / mid_15m / mid_60m for fills older than 61 minutes that haven't been done (newest data last, so a catch-up
 * never starves new fills). Returns how many fills were updated.
 */
export async function runMarkouts(budgetMs = 120e3, batch = 600): Promise<{ done: number; remaining: boolean }> {
  const started = Date.now();
  const cutoff = new Date(Date.now() - 61 * 60e3).toISOString();
  const todo = await db.select<FillRef>("bot_fills", `select=id,game_id,venue,ticker,filled_at&markout_at=is.null&filled_at=lt.${cutoff}&filled_at=gte.${MARKOUT_SINCE}&order=id&limit=${batch}`);
  const byGame = new Map<string, FillRef[]>();
  for (const f of todo) (byGame.get(f.game_id) ?? byGame.set(f.game_id, []).get(f.game_id)!).push(f);
  let done = 0;
  for (const [gameId, fills] of byGame) {
    if (Date.now() - started > budgetMs) return { done, remaining: true };
    const lastFill = Math.max(...fills.map((f) => new Date(f.filled_at).getTime())) + 61 * 60e3;
    const rows = await db.selectAll<{ venue: string; ticker: string; bid: number | null; ask: number | null; taken_at: string }>(
      "bot_mkt_snaps",
      `select=venue,ticker,bid,ask,taken_at&game_id=eq.${gameId}&taken_at=lte.${new Date(lastFill).toISOString()}&order=taken_at,id`
    );
    const series = new Map<string, Snap[]>();
    for (const r of rows) {
      const k = `${r.venue}|${r.ticker}`;
      (series.get(k) ?? series.set(k, []).get(k)!).push({ t: Math.floor(new Date(r.taken_at).getTime() / 1000), bid: r.bid == null ? null : Number(r.bid), ask: r.ask == null ? null : Number(r.ask) });
    }
    const pool = [...fills];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let f = pool.pop(); f; f = pool.pop()) {
          const m = fillMids(series.get(`${f.venue}|${f.ticker}`) ?? [], Math.floor(new Date(f.filled_at).getTime() / 1000));
          await db.update("bot_fills", `id=eq.${f.id}`, { mid_1m: m.mid1, mid_15m: m.mid15, mid_60m: m.mid60, markout_at: new Date().toISOString() });
          done++;
        }
      })
    );
  }
  return { done, remaining: todo.length >= batch };
}
