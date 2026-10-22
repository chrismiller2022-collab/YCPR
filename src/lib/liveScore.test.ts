import { describe, expect, it } from "vitest";
import { liveMargin, marginProbs, minutesPlayed, SD_MARGIN } from "./liveScore";

const g = (state: "pre" | "in" | "post", period: number, clock: string | null, home: number | null, away: number | null) => ({ state, period, clock, home: { score: home }, away: { score: away } });

describe("liveScore", () => {
  it("minutes played and the live margin follow the score bug's model", () => {
    expect(minutesPlayed(g("in", 3, "7:30", 14, 10))).toBe(37.5);
    const lm = liveMargin(g("in", 3, "7:30", 14, 10), -6)!; // pregame: away by 6
    const left = 22.5 / 60;
    expect(lm.now).toBe(4);
    expect(lm.mean).toBeCloseTo(4 - 6 * left, 9);
    expect(lm.sd).toBeCloseTo(SD_MARGIN * Math.sqrt(left), 9);
    expect(liveMargin(g("pre", 0, null, null, null), 3)).toBeNull();
    expect(liveMargin(g("post", 4, "0:00", 20, 27), 3)).toMatchObject({ now: -7, mean: -7, sd: 0 });
  });

  it("margin probabilities sum to 1, never land on a tie, and collapse when the game is over", () => {
    const d = marginProbs(0.3, 8);
    expect(d.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(d.probs[d.maxMargin]).toBe(0);
    expect(d.probs[d.maxMargin + 1]).toBeGreaterThan(d.probs[d.maxMargin + 2]);
    const f = marginProbs(-7, 0);
    expect(f.probs[f.maxMargin - 7]).toBe(1);
    expect(marginProbs(0, 0).probs[f.maxMargin + 1]).toBe(1);
  });
});
