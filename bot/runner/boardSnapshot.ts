// The Board's headline numbers per game, saved at the end of every paper cycle (bot_runs.summary.board) so the
// dashboard can show what changed since the last run. Same formulas as the Board: worst/best over final margins
// −35…35 (hub/app.js curve), expected under our number and under the market (hub/api/data.js outcomes).

import { marginPmf } from "../fairPrice/marginDistribution";
import { outcomeRanges, type HeldRung } from "../ladder/outcomes";

export interface SnapWatch {
  game_id: string;
  my_home_margin: number | string | null;
  ycpr_home_margin: number | string | null;
  kalshi_home_margin: number | string | null;
  venue_margins: Record<string, number | string | null> | null;
}
export interface SnapFill {
  game_id: string;
  venue: string | null;
  ticker: string;
  side: "home" | "away";
  strike: number | string;
  action: "buy" | "sell";
  price: number | string;
  count: number;
  fee: number | string;
}
/** [worst, best, expected by our number, expected by the market], dollars rounded to cents; null = no number. */
export type BoardStats = [number, number, number | null, number | null];
/** game_id → "all" | venue → stats. Only games and venues with fills appear (no position = all zeros). */
export type BoardSnapshot = Record<string, Record<string, BoardStats>>;

const num = (x: number | string | null | undefined) => (x == null || x === "" ? null : Number(x));
const cents = (x: number) => Math.round(x * 100) / 100;

export function boardSnapshot(watch: SnapWatch[], fills: SnapFill[]): BoardSnapshot {
  const out: BoardSnapshot = {};
  for (const w of watch) {
    const gf = fills.filter((f) => f.game_id === w.game_id);
    if (!gf.length) continue;
    const center = num(w.my_home_margin) ?? num(w.ycpr_home_margin);
    const vm = w.venue_margins ?? {};
    const byVenue: Record<string, BoardStats> = {};
    for (const v of ["all", ...new Set(gf.map((f) => f.venue || "kalshi"))]) {
      const held = new Map<string, HeldRung>();
      for (const f of gf.filter((x) => v === "all" || (x.venue || "kalshi") === v)) {
        const h = held.get(f.ticker) ?? { side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
        const d = f.action === "buy" ? f.count : -f.count;
        h.yes += d;
        h.cost += d * Number(f.price) + Number(f.fee);
        held.set(f.ticker, h);
      }
      const rungs = [...held.values()];
      let worst = Infinity, best = -Infinity;
      for (let m = -35; m <= 35; m++) {
        if (m === 0) continue;
        const pnl = rungs.reduce((s, h) => s + h.yes * ((h.side === "home" ? m : -m) > h.strike ? 1 : 0) - h.cost, 0);
        worst = Math.min(worst, pnl);
        best = Math.max(best, pnl);
      }
      const market = v === "all" ? num(vm.kalshi) ?? num(w.kalshi_home_margin) ?? num(vm.novig) ?? num(vm.prophetx) : num(vm[v]) ?? (v === "kalshi" ? num(w.kalshi_home_margin) : null);
      const o = center == null ? null : outcomeRanges(rungs, marginPmf(center), 60, market == null ? undefined : marginPmf(market));
      byVenue[v] = [cents(worst), cents(best), o ? cents(o.expected) : null, o?.marketExpected != null ? cents(o.marketExpected) : null];
    }
    out[w.game_id] = byVenue;
  }
  return out;
}

/** Per game and venue, latest − previous (a side missing from a snapshot counts as no position: zeros). */
export function boardChanges(cur: BoardSnapshot, prev: BoardSnapshot): Record<string, Record<string, BoardStats>> {
  const out: Record<string, Record<string, BoardStats>> = {};
  const zero: BoardStats = [0, 0, 0, 0];
  for (const gid of new Set([...Object.keys(cur), ...Object.keys(prev)])) {
    const c = cur[gid] ?? {}, p = prev[gid] ?? {};
    for (const v of new Set([...Object.keys(c), ...Object.keys(p)])) {
      const a = c[v] ?? zero, b = p[v] ?? zero;
      const d = (i: number) => (a[i] == null || b[i] == null ? null : cents((a[i] as number) - (b[i] as number)));
      (out[gid] ??= {})[v] = [d(0)!, d(1)!, d(2), d(3)];
    }
  }
  return out;
}
