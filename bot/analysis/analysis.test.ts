import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
});

import { pgStub, type Row } from "../runner/pgStub";
import { fillMids, markout, midAt, runMarkouts, MARKOUT_SINCE, type Snap } from "./markouts";
import { calibration, fillStats, methodTotals, olsThroughOrigin, pmAt, renderCalibration, renderFillTable, shapeByMargin, type FillRow, type GameLine } from "./report";

const snap = (t: number, bid: number | null, ask: number | null): Snap => ({ t, bid, ask });

describe("mid at a time", () => {
  const s = [snap(100, 0.4, 0.44), snap(200, 0.46, 0.5), snap(300, null, 0.52), snap(400, 0.5, 0.54)];
  it("is the last two-sided quote at or before t", () => {
    expect(midAt(s, 99)).toBeNull();
    expect(midAt(s, 100)).toBeCloseTo(0.42, 10);
    expect(midAt(s, 250)).toBeCloseTo(0.48, 10);
    expect(midAt(s, 350)).toBeCloseTo(0.48, 10); // the one-sided quote at 300 is skipped
    expect(midAt(s, 9999)).toBeCloseTo(0.52, 10);
    expect(midAt([], 5)).toBeNull();
  });
  it("reads the +1 / +15 / +60 minute mids", () => {
    const series = [snap(0, 0.4, 0.44), snap(30, 0.41, 0.45), snap(1000, 0.5, 0.54), snap(5000, 0.6, 0.64)];
    const m = fillMids(series, 0);
    expect(m.mid0).toBeCloseTo(0.42, 10);
    expect(m.mid1).toBeCloseTo(0.43, 10);
    expect(m.mid15).toBeCloseTo(0.43, 10); // the 0.52 quote lands at 1000 s, after +15 min (900 s)
    expect(m.mid60).toBeCloseTo(0.52, 10);
  });
  it("markout is positive when the market moves our way", () => {
    expect(markout("buy", 0.5, 0.53)).toBeCloseTo(0.03, 10);
    expect(markout("sell", 0.5, 0.53)).toBeCloseTo(-0.03, 10);
    expect(markout("sell", 0.5, 0.45)).toBeCloseTo(0.05, 10);
    expect(markout("buy", 0.5, null)).toBeNull();
  });
});

describe("fill stats", () => {
  const f = (over: Partial<FillRow>): FillRow => ({ id: 1, game_id: "g", venue: "kalshi", strategy_id: null, action: "buy", price: 0.5, count: 1, fee: 0.01, fair_at_fill: 0.56, mid_at_fill: 0.49, close_mid: 0.52, result: 1, mid_1m: 0.49, mid_15m: 0.5, mid_60m: 0.51, kind: "take", ...over });
  it("averages per contract, weighted by size, and treats a sell as the opposite direction", () => {
    const s = fillStats([f({}), f({ id: 2, action: "sell", price: 0.6, fair_at_fill: 0.55, close_mid: 0.52, result: 0, mid_at_fill: 0.61, mid_60m: 0.58, count: 3, fee: 0.03 })]);
    expect(s.contracts).toBe(4);
    expect(s.claimedEdge).toBeCloseTo((0.06 * 1 + 0.05 * 3) / 4, 10);
    expect(s.moClose).toBeCloseTo((0.02 * 1 + 0.08 * 3) / 4, 10);
    expect(s.realized).toBeCloseTo((1 * (1 - 0.5) - 0.01 + 3 * (-1 * (0 - 0.6)) - 0.03) / 4, 10);
    expect(s.nClose).toBe(2);
  });
  it("leaves out fills that lack an input", () => {
    const s = fillStats([f({ close_mid: null, result: null, mid_1m: null })]);
    expect(s.moClose).toBeNull();
    expect(s.realized).toBeNull();
    expect(s.mo1).toBeNull();
    expect(s.mo15).not.toBeNull();
  });
  it("renders", () => {
    expect(renderFillTable([{ label: "Board · take", stats: fillStats([f({})]) }])).toContain("Board · take");
  });
});

describe("calibration against entry lines", () => {
  // YC is 2 points more bullish on the home team than the entry line in every game; games land 0.4 of the way (= 0.8) toward it.
  const games: GameLine[] = Array.from({ length: 40 }, (_, i) => ({ gameId: String(i), yc: i % 2 ? 2 : -2, entry: 0, close: i % 2 ? 0.5 : -0.5, final: (i % 2 ? 0.8 : -0.8) + (i % 4 < 2 ? 3 : -3) * (i % 3 === 0 ? 1 : -1) * 0 }));
  it("estimates beta through the origin", () => {
    const o = olsThroughOrigin([2, 4, -2], [1, 2, -1]);
    expect(o.beta).toBeCloseTo(0.5, 10);
    expect(o.se).toBeCloseTo(0, 10);
    expect(olsThroughOrigin([], []).beta).toBeNaN();
  });
  it("beta, CLV and the gap buckets", () => {
    const cal = calibration(games);
    expect(cal.n).toBe(40);
    expect(cal.betaEntry.beta).toBeCloseTo(0.4, 10);
    expect(cal.clvAll).toBeCloseTo(0.5, 10); // the line moved half a point toward YC in every game
    expect(cal.buckets.find((b) => b.label === "0-2")!.n).toBe(0);
    expect(cal.buckets.find((b) => b.label === "2-4")!.n).toBe(40);
    expect(cal.buckets.find((b) => b.label === "2-4")!.movedToward).toBe(1);
    expect(renderCalibration(cal)).toContain("2-4");
  });
  it("PM median at a time uses each venue's latest margin at or before it", () => {
    const h = [
      { venue: "kalshi", t: 10, margin: 1 }, { venue: "novig", t: 10, margin: 3 }, { venue: "kalshi", t: 50, margin: 2 }, { venue: "prophetx", t: 60, margin: 9 },
    ];
    expect(pmAt(h, 20)).toBe(2); // median of 1 and 3
    expect(pmAt(h, 55)).toBe(2.5); // kalshi 2, novig 3
    expect(pmAt(h, 70)).toBe(3); // 2, 3, 9
    expect(pmAt(h, 5)).toBeNull();
  });
});

describe("shadow totals and the shape", () => {
  const row = (method: string, gameId: string, over = {}) => ({ gameId, method, fills: 3, contracts: 3, fees: 0.05, worst: -2, best: 4, settled: 1, clv: 0.01, ...over });
  it("totals per method over the games that are over, ignoring games a method never traded", () => {
    const t = methodTotals([row("a", "1"), row("a", "2", { settled: -4 }), row("a", "3", { fills: 0, contracts: 0, settled: 0, clv: null }), row("b", "1", { settled: null }), row("a", "9")], new Set(["1", "2", "3"]));
    const a = t.find((x) => x.method === "a")!;
    expect(a.games).toBe(3);
    expect(a.gamesTraded).toBe(2);
    expect(a.pnl).toBeCloseTo(-3, 10);
    expect(a.worstGame).toBe(-4);
    expect(a.contracts).toBe(6);
    expect(a.pnlPerContract).toBeCloseTo(-0.5, 10);
    expect(t.find((x) => x.method === "b")!.pnl).toBe(0);
  });
  it("buckets P&L by how the game landed against the line", () => {
    const s = shapeByMargin([{ rel: -12, pnl: -5 }, { rel: -1, pnl: -1 }, { rel: -2, pnl: -3 }, { rel: 4, pnl: 2 }, { rel: 11, pnl: 8 }]);
    expect(s.find((b) => b.label === "≤ −10")!.mean).toBe(-5);
    expect(s.find((b) => b.label === "−3…0")).toMatchObject({ n: 2, mean: -2 });
    expect(s.find((b) => b.label === "0…3")!.mean).toBeNull();
    expect(s.find((b) => b.label === "≥ 10")!.mean).toBe(8);
  });
});

describe("markout job", () => {
  let db: Record<string, Row[]>;
  const at = (min: number) => new Date(Date.now() - 3 * 3600e3 + min * 60e3).toISOString();
  beforeEach(() => {
    db = {
      bot_fills: [
        { id: 1, game_id: "G1", venue: "novig", ticker: "NV:a", filled_at: at(0), markout_at: null },
        { id: 2, game_id: "G1", venue: "novig", ticker: "NV:zzz", filled_at: at(0), markout_at: null }, // never quoted
        { id: 3, game_id: "G1", venue: "novig", ticker: "NV:a", filled_at: new Date(Date.now() - 10 * 60e3).toISOString(), markout_at: null }, // too recent
        { id: 4, game_id: "G1", venue: "novig", ticker: "NV:a", filled_at: at(0), markout_at: "2026-10-28T00:00:00Z" }, // already done
      ],
      bot_mkt_snaps: [
        { id: 1, game_id: "G1", venue: "novig", ticker: "NV:a", bid: 0.4, ask: 0.44, taken_at: at(-30) },
        { id: 2, game_id: "G1", venue: "novig", ticker: "NV:a", bid: 0.45, ask: 0.49, taken_at: at(10) },
        { id: 3, game_id: "G1", venue: "novig", ticker: "NV:a", bid: 0.5, ask: 0.54, taken_at: at(90) },
      ],
    };
    vi.stubGlobal("fetch", pgStub(db).fetchStub);
  });
  it("stores the mids 1 / 15 / 60 minutes after each old-enough fill, once", () => {
    expect(new Date(at(0)).getTime()).toBeGreaterThan(new Date(MARKOUT_SINCE).getTime());
    return runMarkouts(30e3).then((r) => {
      expect(r.done).toBe(2);
      const f1 = db.bot_fills.find((f) => f.id === 1)!;
      expect(f1.mid_1m).toBeCloseTo(0.42, 10);
      expect(f1.mid_15m).toBeCloseTo(0.47, 10);
      expect(f1.mid_60m).toBeCloseTo(0.47, 10);
      expect(f1.markout_at).not.toBeNull();
      const f2 = db.bot_fills.find((f) => f.id === 2)!;
      expect(f2.mid_15m).toBeNull();
      expect(f2.markout_at).not.toBeNull(); // not retried forever
      expect(db.bot_fills.find((f) => f.id === 3)!.markout_at).toBeNull();
      return runMarkouts(30e3).then((again) => expect(again.done).toBe(0));
    });
  });
});
