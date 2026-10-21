import { describe, expect, it } from "vitest";
import { marginPmf } from "../fairPrice/marginDistribution";
import { outcomeRanges } from "./outcomes";

describe("outcomeRanges", () => {
  const pmf = marginPmf(-5); // away favored by 5

  it("collapses a position into ranges that change only at strikes, with probabilities summing to 1", () => {
    // Bought "away wins by over 7.5" at 40¢ (fee included).
    const { ranges, expected } = outcomeRanges([{ side: "away", strike: 7.5, yes: 1, cost: 0.4 }], pmf);
    expect(ranges.map((r) => [r.from, r.to, r.pnl])).toEqual([
      [-60, -8, 0.6], // away by 8+: wins
      [-7, -1, -0.4],
      [1, 60, -0.4], // never spans 0
    ]);
    expect(ranges.reduce((s, r) => s + r.prob, 0)).toBeCloseTo(1, 9);
    expect(expected).toBeCloseTo(ranges.reduce((s, r) => s + r.pnl * r.prob, 0), 9);
  });

  it("shows a middle: away −4.5 (long over 4.5) plus home +7.5 (short over 7.5) wins both on away by 5–7", () => {
    const { ranges } = outcomeRanges(
      [
        { side: "away", strike: 4.5, yes: 1, cost: 0.55 },
        { side: "away", strike: 7.5, yes: -1, cost: -0.4 },
      ],
      pmf
    );
    const mid = ranges.find((r) => r.from === -7)!;
    expect([mid.from, mid.to, mid.pnl]).toEqual([-7, -5, 0.85]); // +0.45 and +0.40
    expect(ranges.filter((r) => r !== mid).every((r) => r.pnl === -0.15)).toBe(true); // lose the gap elsewhere
  });
});
