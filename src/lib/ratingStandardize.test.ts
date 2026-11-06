import { describe, expect, it } from "vitest";
import { TEAMS } from "../data/teams";
import { scaleOf, standardizeWeek, rebuildRawComposites, REBUILT_RAW_YC_KEY } from "./ratingStandardize";

const fbs = TEAMS.filter((t) => t.div === "FBS").map((t) => t.team);
const fcs = TEAMS.filter((t) => t.div === "FCS").map((t) => t.team);

function week(valueOf: (i: number) => number, key = "sp", teams = fbs) {
  const out: Record<string, Record<string, number>> = {};
  teams.forEach((t, i) => (out[t] = { [key]: valueOf(i) }));
  return out;
}

describe("standardizeWeek", () => {
  it("is unchanged by any positive linear rescale (no unscaling needed)", () => {
    const raw = week((i) => Math.sin(i) * 20 + i * 0.1);
    const minMaxed = week((i) => 3.7 * (Math.sin(i) * 20 + i * 0.1) - 12);
    const a = standardizeWeek(raw, { multiplier: 13.5 }).byTeam;
    const b = standardizeWeek(minMaxed, { multiplier: 13.5 }).byTeam;
    for (const t of fbs) expect(b[t].sp).toBeCloseTo(a[t].sp, 9);
  });

  it("gives FBS teams mean 0 and SD equal to the multiplier", () => {
    const res = standardizeWeek(week((i) => (i % 17) * 2.3), { multiplier: 13.5 });
    const vals = fbs.map((t) => res.byTeam[t].sp);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeCloseTo(0, 9);
    expect(scaleOf(vals)!.scale).toBeCloseTo(13.5, 9);
  });

  it("measures FCS teams against the FBS baseline without letting them into it", () => {
    const base = week((i) => i % 10);
    const withFcs = { ...base };
    fcs.forEach((t) => (withFcs[t] = { sp: 500 }));
    const a = standardizeWeek(base, { multiplier: 1 }).byTeam;
    const b = standardizeWeek(withFcs, { multiplier: 1 }).byTeam;
    for (const t of fbs) expect(b[t].sp).toBeCloseTo(a[t].sp, 9);
    expect(b[fcs[0]].sp).toBeGreaterThan(10);
  });

  it("drops a system-week with no spread (e.g. saved as all zeros)", () => {
    const res = standardizeWeek(week(() => 0), { multiplier: 13.5 });
    expect(res.scales.sp).toBeNull();
    expect(res.byTeam[fbs[0]].sp).toBeUndefined();
  });

  it("re-standardizes the rebuilt YC to the multiplier", () => {
    const bt: Record<string, Record<string, number>> = {};
    fbs.forEach((t, i) => (bt[t] = { sp: i, fpi: (i * 7) % 50 }));
    const res = standardizeWeek(bt, { multiplier: 13.5, weights: { sp: 1, fpi: 1 } });
    expect(scaleOf(fbs.map((t) => res.byTeam[t].yc))!.scale).toBeCloseTo(13.5, 9);
  });

  it("rebuilds raw YC as the weighted average of stored inputs", () => {
    const out = rebuildRawComposites({ A: { sp: 10, fpi: 20 } }, { sp: 3, fpi: 1 });
    expect(out.A[REBUILT_RAW_YC_KEY]).toBeCloseTo(12.5, 9);
  });
});
