import { describe, expect, it } from "vitest";
import { effectiveGap, pmMedian, shrinkFrom, shrunkFromMargins, shrunkHomeMargin, DEFAULT_SHRINK } from "./shrink";
import { marginPmf } from "./marginDistribution";
import { modelWith } from "./shrink";
import { kalshiSpreadYesProb } from "./lines";

describe("PM median", () => {
  it("takes the median of the venues that have a margin", () => {
    expect(pmMedian({ kalshi: 0.5, novig: 0.69, prophetx: 0.75 })).toBe(0.69);
    expect(pmMedian({ kalshi: -10.06, novig: -10.06, prophetx: -10 })).toBe(-10.06);
    expect(pmMedian({ kalshi: 2, novig: null, prophetx: 4 })).toBe(3);
    expect(pmMedian({ kalshi: 2 })).toBe(2);
  });
  it("is null with no venue", () => {
    expect(pmMedian({})).toBeNull();
    expect(pmMedian(null)).toBeNull();
    expect(pmMedian({ kalshi: null })).toBeNull();
  });
});

describe("hump", () => {
  const s = { humpCap: 5.5, humpFall: 0 };
  it("is linear up to the cap and flat after it", () => {
    expect(effectiveGap(3, s)).toBe(3);
    expect(effectiveGap(-5.5, s)).toBe(-5.5);
    expect(effectiveGap(9, s)).toBe(5.5);
    expect(effectiveGap(-20, s)).toBe(-5.5);
  });
  it("can fall back to zero past the cap", () => {
    const f = { humpCap: 5, humpFall: 4 };
    expect(effectiveGap(5, f)).toBe(5);
    expect(effectiveGap(7, f)).toBeCloseTo(2.5, 10);
    expect(effectiveGap(9, f)).toBe(0);
    expect(effectiveGap(15, f)).toBe(0);
    expect(effectiveGap(-7, f)).toBeCloseTo(-2.5, 10);
  });
});

describe("shrunk fair value", () => {
  const s = { ...DEFAULT_SHRINK }; // beta 0.1, cap 5.5, sigma 15
  it("sits beta of the way from the market to our number", () => {
    const r = shrunkHomeMargin(-4.79, 0.69, s); // K-State @ Colorado: YC away by 4.8, market PK
    expect(r.gap).toBeCloseTo(-5.48, 2);
    expect(r.edgePts).toBeCloseTo(-0.548, 3);
    expect(r.fair).toBeCloseTo(0.142, 3);
    expect(r.lean).toBe("away");
  });
  it("moves when the market moves; our number does not", () => {
    const a = shrunkHomeMargin(-6, -2, s).fair!;
    const b = shrunkHomeMargin(-6, -3, s).fair!;
    expect(b).toBeLessThan(a);
    expect(a - -2).toBeCloseTo(-0.4, 10);
    expect(b - -3).toBeCloseTo(-0.3, 10);
  });
  it("edge stops growing past the hump", () => {
    const small = shrunkHomeMargin(-5.5, 0, s).edgePts!;
    const huge = shrunkHomeMargin(-25, 0, s).edgePts!;
    expect(huge).toBe(small);
  });
  it("has no fair value without a model line or a market (the book is never a fallback)", () => {
    expect(shrunkHomeMargin(null, 1, s).fair).toBeNull();
    expect(shrunkHomeMargin(2, null, s).fair).toBeNull();
    expect(shrunkFromMargins(2, {}, s).fair).toBeNull();
  });
  it("beta 0 is exactly the market; beta 1 under the cap is our number", () => {
    expect(shrunkHomeMargin(3, 1, { ...s, beta: 0 }).fair).toBe(1);
    expect(shrunkHomeMargin(3, 1, { ...s, beta: 1 }).fair).toBe(3);
  });
  it("a 6-point raw gap is worth only about 1 point of fair: the cover price at the market strike moves ~1.5 cents", () => {
    const market = 0;
    const flat = kalshiSpreadYesProb(marginPmf(market, modelWith(15)), "home", 0.5);
    const shr = shrunkHomeMargin(-6, market, s);
    const p = kalshiSpreadYesProb(marginPmf(shr.fair!, modelWith(15)), "home", 0.5);
    expect(flat - p).toBeGreaterThan(0.01);
    expect(flat - p).toBeLessThan(0.03);
  });
});

describe("settings", () => {
  it("falls back to defaults for missing or invalid values", () => {
    expect(shrinkFrom(null)).toEqual(DEFAULT_SHRINK);
    expect(shrinkFrom({ beta: "x", sigma: 1000, hump_cap: -2 })).toEqual(DEFAULT_SHRINK);
  });
  it("reads bot_state and lets a game override beta", () => {
    const st = { beta: 0.2, hump_cap: 6, hump_fall: 3, sigma: 14 };
    expect(shrinkFrom(st)).toEqual({ beta: 0.2, humpCap: 6, humpFall: 3, sigma: 14 });
    expect(shrinkFrom(st, 0.05).beta).toBe(0.05);
    expect(shrinkFrom(st, null).beta).toBe(0.2);
    expect(shrinkFrom(st, 5).beta).toBe(0.2); // out of range: ignored
  });
});
