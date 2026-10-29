import { afterEach, describe, expect, it } from "vitest";
import { kalshiFeeFor, kalshiFeeWith, KALSHI_FALLBACK, loadKalshiSchedule, novigFee, prophetxFee, resetKalshiScheduleCache } from "./fees";

afterEach(() => {
  resetKalshiScheduleCache();
  delete process.env.PROPHETX_COMMISSION;
});

describe("Kalshi fees", () => {
  it("taker is 0.07 · M · P · (1−P) per contract, maker a quarter of it, quadratic series have no maker fee", () => {
    const f = kalshiFeeWith("quadratic_with_maker_fees", 1);
    expect(f(0.5)).toBeCloseTo(0.0175, 10);
    expect(f(0.5, { maker: true })).toBeCloseTo(0.004375, 10);
    expect(f(0.9, { count: 10 })).toBeCloseTo(0.063, 10);
    expect(kalshiFeeWith("quadratic", 1)(0.5, { maker: true })).toBe(0);
    expect(kalshiFeeWith("quadratic_with_maker_fees", 2)(0.5)).toBeCloseTo(0.035, 10);
  });

  it("reads the series type and multiplier, and event overrides already in force", async () => {
    const urls: string[] = [];
    const s = await loadKalshiSchedule(async (u) => {
      urls.push(u);
      if (u.includes("/series/")) return { series: { fee_type: "quadratic_with_maker_fees", fee_multiplier: 0.5 } };
      return {
        event_fee_changes: [
          { event_ticker: "KXNCAAFSPREAD-A", fee_multiplier_override: 2, fee_type_override: null, scheduled_ts: "2020-01-01T00:00:00Z" },
          { event_ticker: "KXNCAAFSPREAD-LATER", fee_multiplier_override: 9, scheduled_ts: "2999-01-01T00:00:00Z" },
        ],
      };
    });
    expect(s.source).toBe("api");
    expect(s.multiplier).toBe(0.5);
    expect(kalshiFeeFor(s, "KXNCAAFSPREAD-A")(0.5)).toBeCloseTo(0.07 * 2 * 0.25, 10);
    expect(kalshiFeeFor(s, "KXNCAAFSPREAD-LATER")(0.5)).toBeCloseTo(0.07 * 0.5 * 0.25, 10); // not in force yet
    expect(kalshiFeeFor(s, null)(0.5)).toBeCloseTo(0.07 * 0.5 * 0.25, 10);
    await loadKalshiSchedule(async () => { throw new Error("must be cached"); });
    expect(urls.length).toBe(2);
  });

  it("falls back to the documented schedule when the API fails, and keeps the last good one", async () => {
    const s = await loadKalshiSchedule(async () => { throw new Error("429"); });
    expect(s.source).toBe("fallback");
    expect(s.feeType).toBe(KALSHI_FALLBACK.feeType);
    expect(s.multiplier).toBe(1);
  });
});

describe("Novig and ProphetX fees", () => {
  it("Novig: free pre-game and for makers, 0.06 · P · (1−P) for live takers", () => {
    expect(novigFee(5)(0.5)).toBe(0);
    expect(novigFee(0)(0.5, { maker: true })).toBe(0);
    expect(novigFee(-0.2)(0.5, { count: 10 })).toBeCloseTo(0.15, 10);
  });
  it("ProphetX: the commission rate (default 2%, set by PROPHETX_COMMISSION) on the winnings", () => {
    expect(prophetxFee()(0.6, { count: 10 })).toBeCloseTo(0.08, 10);
    process.env.PROPHETX_COMMISSION = "0.03";
    expect(prophetxFee()(0.6, { count: 10 })).toBeCloseTo(0.12, 10);
    process.env.PROPHETX_COMMISSION = "garbage";
    expect(prophetxFee()(0.6)).toBeCloseTo(0.008, 10);
  });
});
