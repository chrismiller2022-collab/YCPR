import { describe, expect, it } from "vitest";
import { boardChanges, boardSnapshot, type SnapFill, type SnapWatch } from "./boardSnapshot";
import { marginPmf } from "../fairPrice/marginDistribution";
import { outcomeRanges } from "../ladder/outcomes";

const w: SnapWatch = { game_id: "g1", my_home_margin: null, ycpr_home_margin: -10, kalshi_home_margin: -6, venue_margins: { kalshi: -6, novig: -5.5 } };
// Away −6.5 bought at 45¢ (YES = away wins by more than 6.5) plus a 2¢ fee.
const f = (over: Partial<SnapFill> = {}): SnapFill => ({ game_id: "g1", venue: "kalshi", ticker: "K-A6", side: "away", strike: 6.5, action: "buy", price: 0.45, count: 1, fee: 0.02, ...over });

describe("board snapshot", () => {
  it("worst/best and expected match the Board's formulas", () => {
    const s = boardSnapshot([w, { ...w, game_id: "g2" }], [f()]);
    expect(Object.keys(s)).toEqual(["g1"]); // no fills, no entry
    const [worst, best, exp, mkt] = s.g1.all;
    expect(worst).toBe(-0.47);
    expect(best).toBe(0.53);
    const o = outcomeRanges([{ side: "away", strike: 6.5, yes: 1, cost: 0.47 }], marginPmf(-10), 60, marginPmf(-6));
    expect(exp).toBe(Math.round(o.expected * 100) / 100);
    expect(mkt).toBe(Math.round(o.marketExpected! * 100) / 100);
    expect(s.g1.kalshi).toEqual(s.g1.all);
  });

  it("per-venue entries use that venue's market", () => {
    const s = boardSnapshot([w], [f(), f({ venue: "novig", ticker: "nv-1", fee: 0 })]);
    expect(Object.keys(s.g1).sort()).toEqual(["all", "kalshi", "novig"]);
    expect(s.g1.all[0]).toBe(-0.92);
    const nv = outcomeRanges([{ side: "away", strike: 6.5, yes: 1, cost: 0.45 }], marginPmf(-10), 60, marginPmf(-5.5));
    expect(s.g1.novig[3]).toBe(Math.round(nv.marketExpected! * 100) / 100); // Novig's own implied line
  });

  it("changes = latest − previous; a new game counts from zero", () => {
    const prev = boardSnapshot([w], [f()]);
    const cur = boardSnapshot([w, { ...w, game_id: "g2" }], [f(), f({ ticker: "K-A7", strike: 7.5, price: 0.4 }), f({ game_id: "g2" })]);
    const d = boardChanges(cur, prev);
    expect(d.g1.all[0]).toBe(-0.42);
    expect(d.g2.all[0]).toBe(-0.47);
    expect(d.g1.all[2]).toBeCloseTo((cur.g1.all[2] as number) - (prev.g1.all[2] as number), 6);
    const none = boardChanges(prev, prev);
    expect(none.g1.all).toEqual([0, 0, 0, 0]);
  });
});
