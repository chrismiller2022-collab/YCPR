import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARGIN_MODEL,
  fitKeyWeights,
  marginPmf,
  meanLogLikelihood,
  pAt,
  pmfMean,
  type MarginModel,
  type MarginObservation,
} from "./marginDistribution";
import { americanFromProb, evPerContract, fairPrice, kalshiSpreadYesProb, spreadOutcome, winProb } from "./lines";
import { bestYesQuotes, kalshiFee, parseKalshiSpreadTitle } from "./kalshi";
import { gameMarginPmf, projectedHomeMargin } from "./projection";
import type { GameWithLines } from "../../src/lib/api/gamesLines";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("marginPmf", () => {
  it("is a distribution with no ties and the projected mean", () => {
    for (const mean of [-24, -7, -3, 0, 2.5, 14]) {
      const pmf = marginPmf(mean);
      expect(sum(pmf.probs)).toBeCloseTo(1, 10);
      expect(pAt(pmf, 0)).toBe(0);
      expect(pmfMean(pmf)).toBeCloseTo(mean, 4);
    }
  });

  it("is symmetric around a pick'em", () => {
    const pmf = marginPmf(0);
    for (const k of [1, 3, 7, 10, 14, 30]) expect(pAt(pmf, k)).toBeCloseTo(pAt(pmf, -k), 10);
  });

  it("puts extra mass on key numbers", () => {
    const keyed = marginPmf(-2.5);
    const plain = marginPmf(-2.5, DEFAULT_MARGIN_MODEL, false);
    // Away favored by 2.5: an away win by exactly 3 is home margin −3.
    expect(pAt(keyed, -3)).toBeGreaterThan(1.8 * pAt(plain, -3));
    expect(pAt(keyed, -3)).toBeGreaterThan(pAt(keyed, -2));
    expect(pAt(keyed, -3)).toBeGreaterThan(pAt(keyed, -4));
    expect(pAt(keyed, -7)).toBeGreaterThan(pAt(keyed, -6));
    expect(pAt(keyed, -7)).toBeGreaterThan(pAt(keyed, -8));
  });

  it("fitted defaults look like college football", () => {
    expect(DEFAULT_MARGIN_MODEL.sigma).toBeGreaterThan(14);
    expect(DEFAULT_MARGIN_MODEL.sigma).toBeLessThan(17);
    expect(DEFAULT_MARGIN_MODEL.keyWeights[3]).toBeGreaterThan(2);
    expect(DEFAULT_MARGIN_MODEL.keyWeights[7]).toBeGreaterThan(1.8);
  });
});

describe("lines", () => {
  const pmf = marginPmf(1); // home favored by 1

  it("outcomes sum to 1 and half-point lines never push", () => {
    for (const line of [-7, -3, -2.5, 0.5, 3, 3.5, 10]) {
      for (const side of ["home", "away"] as const) {
        const o = spreadOutcome(pmf, side, line);
        expect(o.win + o.push + o.lose).toBeCloseTo(1, 10);
        if (!Number.isInteger(line)) expect(o.push).toBe(0);
      }
    }
  });

  it("+3 wins exactly when +2.5 wins, and adds the push on 3", () => {
    const plus3 = spreadOutcome(pmf, "away", 3);
    const plus25 = spreadOutcome(pmf, "away", 2.5);
    expect(plus3.win).toBeCloseTo(plus25.win, 12);
    expect(plus3.push).toBeCloseTo(pAt(pmf, 3), 12);
    expect(plus3.lose + plus3.push).toBeCloseTo(plus25.lose, 12);
  });

  it("handoff example: the +3 edge comes from the push", () => {
    // Model home (SC) by 1; Tennessee +3 at 54.75 vs +2.5 at 53.5.
    const plus3 = spreadOutcome(pmf, "away", 3);
    const plus25 = spreadOutcome(pmf, "away", 2.5);
    expect(evPerContract(plus3, 0.5475)).toBeGreaterThan(evPerContract(plus25, 0.535));
    expect(fairPrice(plus3)).toBeGreaterThan(fairPrice(plus25));
    expect(evPerContract(plus25, fairPrice(plus25))).toBeCloseTo(0, 12);
  });

  it("win probabilities and complementary Kalshi markets add to 1", () => {
    expect(winProb(pmf, "home") + winProb(pmf, "away")).toBeCloseTo(1, 10);
    expect(winProb(pmf, "home")).toBeGreaterThan(0.5);
    // "Home wins by over 7.5" and "away wins by over −7.5" are opposite outcomes.
    expect(kalshiSpreadYesProb(pmf, "home", 7.5) + kalshiSpreadYesProb(pmf, "away", -7.5)).toBeCloseTo(1, 10);
    // Same thing as the spread bet laying 7.5.
    expect(kalshiSpreadYesProb(pmf, "home", 7.5)).toBeCloseTo(spreadOutcome(pmf, "home", -7.5).win, 12);
  });

  it("Kalshi ladder decreases with the strike", () => {
    let prev = 1;
    for (let s = 0.5; s <= 30.5; s++) {
      const p = kalshiSpreadYesProb(pmf, "home", s);
      expect(p).toBeLessThan(prev);
      prev = p;
    }
  });

  it("converts to American odds", () => {
    expect(americanFromProb(0.5238095)).toBeCloseTo(-110, 1);
    expect(americanFromProb(0.4)).toBeCloseTo(150, 6);
  });
});

describe("kalshi", () => {
  it("fees match the quadratic schedule", () => {
    expect(kalshiFee(0.5)).toBeCloseTo(0.0175, 10);
    expect(kalshiFee(0.5, { maker: true })).toBeCloseTo(0.004375, 10);
    expect(kalshiFee(0.5, { roundUpToCent: true })).toBe(0.02);
    expect(kalshiFee(0.9, { count: 10 })).toBeCloseTo(0.063, 10);
    expect(kalshiFee(0.5, { multiplier: 2 })).toBeCloseTo(0.035, 10);
  });

  it("parses spread market titles", () => {
    expect(parseKalshiSpreadTitle("Oklahoma St. wins by over 7.5 points")).toEqual({ team: "Oklahoma St.", strike: 7.5 });
    expect(parseKalshiSpreadTitle("Texas A&M wins by over 1.5 points")).toEqual({ team: "Texas A&M", strike: 1.5 });
    expect(parseKalshiSpreadTitle("Will it rain?")).toBeNull();
  });

  it("reads best bid/ask from a bids-only book (live sample, 2026-10-20)", () => {
    const book = {
      no_dollars: [["0.3500", "3567.20"], ["0.3600", "1906.00"], ["0.3700", "2717.00"]] as [string, string][],
      yes_dollars: [["0.6000", "1261.43"], ["0.6100", "538.00"], ["0.6200", "900.32"]] as [string, string][],
    };
    expect(bestYesQuotes(book)).toEqual({ bid: 0.62, ask: 0.63 });
    expect(bestYesQuotes({ yes_dollars: [], no_dollars: [] })).toEqual({ bid: null, ask: null });
  });
});

describe("fitKeyWeights", () => {
  // Deterministic sampler so the test never flakes.
  function rng(seed: number) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it("recovers planted key numbers from simulated games", () => {
    const truth: MarginModel = { sigma: 15, keyWeights: { 3: 2.6, 7: 2.2, 10: 1.4 }, maxMargin: 80 };
    const rand = rng(42);
    const obs: MarginObservation[] = [];
    for (let i = 0; i < 6000; i++) {
      const expected = Math.round((rand() * 40 - 20) * 2) / 2;
      const pmf = marginPmf(expected, truth);
      let u = rand();
      let m = -pmf.maxMargin;
      for (let j = 0; j < pmf.probs.length; j++) {
        u -= pmf.probs[j];
        if (u <= 0) {
          m = j - pmf.maxMargin;
          break;
        }
      }
      obs.push({ expected, actual: m });
    }
    const fit = fitKeyWeights(obs, { maxKey: 14 });
    expect(fit.keyWeights[3]).toBeGreaterThan(2.1);
    expect(fit.keyWeights[3]).toBeLessThan(3.1);
    expect(fit.keyWeights[7]).toBeGreaterThan(1.7);
    expect(fit.keyWeights[5]).toBeGreaterThan(0.7);
    expect(fit.keyWeights[5]).toBeLessThan(1.3);
    const fitted: MarginModel = { sigma: fit.sigma, keyWeights: fit.keyWeights, maxMargin: 80 };
    expect(meanLogLikelihood(obs, fitted, true)).toBeGreaterThan(meanLogLikelihood(obs, fitted, false));
  });
});

describe("projection (computeRow)", () => {
  const game = (neutral: boolean): GameWithLines =>
    ({
      id: 1,
      season: 2026,
      week: 8,
      season_type: "regular",
      start_date: "2026-10-24T19:00:00Z",
      neutral_site: neutral,
      completed: false,
      home_team: "Oklahoma State",
      away_team: "Colorado",
      home_points: null,
      away_points: null,
      lines: [],
    }) as unknown as GameWithLines;
  // Ratings are "points vs. average", lower = better.
  const live = { Colorado: { rating: 1.3, hfa: 3 }, "Oklahoma State": { rating: 10.26, hfa: 3 } };

  it("uses computeRow's projected spread as the home margin", () => {
    // Colorado 8.96 better, Oklahoma State gets 3 at home → OSU by −5.96.
    expect(projectedHomeMargin(game(false), live)).toBeCloseTo(1.3 - 10.26 + 3, 6);
    expect(projectedHomeMargin(game(true), live)).toBeCloseTo(1.3 - 10.26, 6);
    expect(projectedHomeMargin(game(false), live, { hfaMode: "flat" })).toBeCloseTo(1.3 - 10.26 + 2.4, 6);
  });

  it("a frozen lock wins over live ratings", () => {
    expect(projectedHomeMargin(game(false), live, { lock: { myAwaySpread: 4, myAwayWinPct: 0.4 } })).toBe(4);
  });

  it("builds a pmf centered on the projection", () => {
    const pmf = gameMarginPmf(game(false), live)!;
    expect(pmfMean(pmf)).toBeCloseTo(1.3 - 10.26 + 3, 4);
    expect(gameMarginPmf({ ...game(false), home_team: "Nowhere U" } as GameWithLines, live)).toBeNull();
  });
});
