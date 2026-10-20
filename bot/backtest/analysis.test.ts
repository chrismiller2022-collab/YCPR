import { describe, expect, it } from "vitest";
import { blendProb, fitBlend, gameBootstrap, logLoss, quoteAt, rng, simulateTaker, type Rung } from "./analysis";
import { kalshiFee } from "../fairPrice/kalshi";

const rung = (over: Partial<Rung>): Rung => ({
  gameId: "g1",
  week: 3,
  ticker: "T",
  kickoff: 10_000,
  result: 1,
  fair: 0.6,
  bookFair: 0.55,
  quotes: [],
  ...over,
});

describe("scoring", () => {
  it("log loss rewards confident correct forecasts", () => {
    expect(logLoss(0.9, 1)).toBeLessThan(logLoss(0.6, 1));
    expect(logLoss(0.9, 0)).toBeGreaterThan(logLoss(0.6, 0));
    expect(Number.isFinite(logLoss(1, 0))).toBe(true); // clamped
  });

  it("quoteAt takes the last quote at or before the time", () => {
    const r = rung({ quotes: [{ t: 100, bid: 0.4, ask: 0.45 }, { t: 9_000, bid: 0.5, ask: 0.52 }, { t: 11_000, bid: 0.9, ask: 0.95 }] });
    expect(quoteAt(r)!.t).toBe(9_000);
    expect(quoteAt(r, 500)!.t).toBe(100);
    expect(quoteAt(r, 50)).toBeNull();
  });

  it("game bootstrap brackets the mean and counts games", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ gameId: `g${i % 20}`, v: (i % 3) - 1 }));
    const b = gameBootstrap(items);
    expect(b.games).toBe(20);
    expect(b.lo).toBeLessThanOrEqual(b.mean);
    expect(b.hi).toBeGreaterThanOrEqual(b.mean);
  });
});

describe("fitBlend", () => {
  it("puts weight on a model that knows the truth and none on noise", () => {
    const rand = rng(3);
    const rows: { market: number; model: number; y: number }[] = [];
    const noise: { market: number; model: number; y: number }[] = [];
    for (let i = 0; i < 4000; i++) {
      const truth = 0.1 + 0.8 * rand();
      const y = rand() < truth ? 1 : 0;
      const market = Math.min(0.95, Math.max(0.05, truth + (rand() - 0.5) * 0.3));
      rows.push({ market, model: truth, y });
      noise.push({ market: truth, model: 0.1 + 0.8 * rand(), y });
    }
    expect(fitBlend(rows)[2]).toBeGreaterThan(0.5);
    expect(Math.abs(fitBlend(noise)[2])).toBeLessThan(0.15);
    const b = fitBlend(rows);
    expect(blendProb(b, 0.5, 0.8)).toBeGreaterThan(0.5);
  });
});

describe("simulateTaker", () => {
  it("buys the first ask far enough below fair and scores it at settlement", () => {
    const r = rung({
      fair: 0.6,
      result: 1,
      quotes: [
        { t: 1_000, bid: 0.55, ask: 0.58 }, // edge 0.02 − fee: too small at 4¢
        { t: 2_000, bid: 0.5, ask: 0.53 }, // edge 0.07 − fee ≈ 0.053 → buy
        { t: 9_000, bid: 0.62, ask: 0.64 }, // close
      ],
    });
    const [t] = simulateTaker([r], { minEdge: 0.04 });
    expect(t.side).toBe("buy");
    expect(t.price).toBe(0.53);
    expect(t.pnl).toBeCloseTo(1 - 0.53 - kalshiFee(0.53), 10);
    expect(t.clv).toBeCloseTo(0.63 - 0.53, 10);
  });

  it("sells when the bid is above fair, and respects the pre-kickoff cutoff", () => {
    const r = rung({ fair: 0.3, result: 0, quotes: [{ t: 9_500, bid: 0.45, ask: 0.47 }] });
    expect(simulateTaker([r], { minEdge: 0 })).toHaveLength(0); // inside last 30 min
    const early = rung({ fair: 0.3, result: 0, quotes: [{ t: 5_000, bid: 0.45, ask: 0.47 }] });
    const [t] = simulateTaker([early], { minEdge: 0.05 });
    expect(t.side).toBe("sell");
    expect(t.pnl).toBeCloseTo(0.45 - 0 - kalshiFee(0.45), 10);
  });

  it("keeps only the biggest edge per game when asked", () => {
    const a = rung({ ticker: "A", fair: 0.6, quotes: [{ t: 1_000, bid: 0.5, ask: 0.52 }] });
    const b = rung({ ticker: "B", fair: 0.6, quotes: [{ t: 1_000, bid: 0.4, ask: 0.42 }] });
    const trades = simulateTaker([a, b], { minEdge: 0, onePerGame: true });
    expect(trades).toHaveLength(1);
    expect(trades[0].ticker).toBe("B");
  });
});
