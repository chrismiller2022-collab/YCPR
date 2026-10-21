import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kalshiFee } from "../fairPrice/kalshi";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { marginPmf } from "../fairPrice/marginDistribution";
import { novigRungs, type NovigBook, type NovigMarket } from "../venues/novig";
import type { VenueId } from "../venues/types";
import { advance, annotateSteps, builtinMethods, emptyState, summarize, VENUE_SETS, type HypoGame, type SnapRow, type Step, type VenueRules } from "./replay";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../venues/fixtures/novig-cmu.json", import.meta.url)), "utf8")) as { markets: NovigMarket[]; books: Record<string, NovigBook> };
const novig = novigRungs(fx.markets, new Map(Object.entries(fx.books)), true).rungs; // CMU (home) rungs, market ≈ Miami −2.5

const rules: Record<VenueId, VenueRules> = {
  kalshi: { tick: 0.01, fee: () => kalshiFee },
  novig: { tick: 0.005, fee: (h) => (p, o = {}) => (h > 0 || o.maker ? 0 : 0.06 * (o.count ?? 1) * p * (1 - p)) },
  prophetx: { tick: 0.01, fee: () => (p, o = {}) => 0.02 * (o.count ?? 1) * (1 - p) },
};

const T0 = 1_800_000_000;
const kickoff = T0 + 48 * 3600;
// Our number: Miami (away) by 7 vs a market near Miami −2.5 → pick away.
const game: HypoGame = { ycpr: -7, book: -2.5, kickoff, final: -10 };

/** A Kalshi-like ladder on Miami (away) around a market margin, 1¢ wide. */
function kalshiLadder(center: number): SnapRow[] {
  const pmf = marginPmf(center);
  return [1.5, 2.5, 3.5, 4.5, 6.5, 7.5, 9.5, 10.5].map((k) => {
    const mid = kalshiSpreadYesProb(pmf, "away", k);
    return { venue: "kalshi" as const, ticker: `K${k}`, side: "away" as const, strike: k, bid: Math.round(mid * 100 - 1) / 100, ask: Math.round(mid * 100 + 1) / 100 };
  });
}

/** 30 recorder cycles over 2.5 hours: the market drifts toward our number, with prints both ways. */
function makeSteps(): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < 30; i++) {
    const t = T0 + i * 300;
    const snaps: SnapRow[] = [...kalshiLadder(-2.5 - i * 0.05)];
    if (i === 0 || i % 7 === 0) snaps.push(...novig.map((r) => ({ venue: "novig" as const, ticker: r.ticker, side: r.side, strike: r.strike, bid: r.bid, ask: r.ask })));
    const trades = i % 5 === 4 ? [...snaps.slice(0, 6).map((s) => ({ venue: s.venue, ticker: s.ticker, t: t - 10, yesPrice: i % 10 === 4 ? 0.01 : 0.99 }))] : [];
    steps.push({ t, snaps, trades });
  }
  return steps;
}

describe("Hypotheticals replay", () => {
  const raw = makeSteps();
  const steps = annotateSteps(raw);
  const methods = builtinMethods(1);
  const now = T0 + 40 * 3600; // still before the stop

  it("is incremental: replaying in two parts equals one pass", () => {
    for (const m of methods)
      for (const set of VENUE_SETS) {
        const once = advance(emptyState(), steps, game, m, set, rules, now);
        const half = advance(emptyState(), steps.slice(0, 13), game, m, set, rules, now);
        const twice = advance(half, steps.slice(13), game, m, set, rules, now);
        expect(twice, `${m.key}/${set}`).toEqual(once);
      }
  });

  it("never exceeds the loss cap, on one venue or across all of them", () => {
    for (const m of methods)
      for (const set of VENUE_SETS) {
        const sum = summarize(advance(emptyState(), steps, game, m, set, rules, now), game, set);
        expect(sum.worst, `${m.key}/${set}`).toBeGreaterThanOrEqual(-m.cfg.maxWorstCaseLoss - 1e-6);
      }
  });

  it("picks the side our number favors and trades it", () => {
    const sum = summarize(advance(emptyState(), steps, game, methods[0], "all", rules, now), game, "all");
    expect(sum.pick).toBe("away");
    expect(sum.fills).toBeGreaterThan(0);
    expect(sum.expected).toBeGreaterThan(0);
  });

  it("maker-only never takes and take-only never rests", () => {
    const maker = methods.find((m) => m.key === "maker")!;
    const taker = methods.find((m) => m.key === "taker")!;
    const mk = advance(emptyState(), steps, game, maker, "kalshi", rules, now);
    expect(mk.fills.every((f) => f.fee === kalshiFee(f.price, { count: f.count, maker: true }))).toBe(true);
    const tk = advance(emptyState(), steps, game, taker, "kalshi", rules, now);
    expect(tk.resting).toHaveLength(0);
  });

  it("straight bets: early bets once at the start, late bets on the last book before the stop", () => {
    const early = methods.find((m) => m.key === "early")!;
    const late = methods.find((m) => m.key === "late")!;
    const e = advance(emptyState(), steps, game, early, "kalshi", rules, now);
    expect(e.fills).toHaveLength(1);
    expect(e.fills[0].t).toBe(T0);
    const cost = e.fills[0].count * e.fills[0].price + e.fills[0].fee;
    expect(cost).toBeLessThanOrEqual(10);
    expect(advance(emptyState(), steps, game, late, "kalshi", rules, now).fills).toHaveLength(0); // stop not reached
    const after = advance(emptyState(), steps, game, late, "kalshi", rules, kickoff);
    expect(after.fills).toHaveLength(1);
    // On Novig every rung is quoted on CMU, so betting Miami means selling YES.
    const nv = advance(emptyState(), steps, game, early, "novig", rules, now);
    expect(nv.fills[0].action).toBe("sell");
  });

  it("gives the same result with or without pre-computed implied margins", () => {
    for (const set of VENUE_SETS) expect(advance(emptyState(), raw, game, methods[0], set, rules, now)).toEqual(advance(emptyState(), steps, game, methods[0], set, rules, now));
  });

  it("settles at the final margin and records CLV once the stop has passed", () => {
    const st = advance(emptyState(), steps, game, methods[0], "kalshi", rules, kickoff + 4 * 3600);
    const sum = summarize(st, game, "kalshi");
    expect(sum.settled).toBe(sum.curve[game.final! + 60]);
    expect(sum.resting).toBe(0);
    if (sum.fills) expect(sum.clv).not.toBeNull();
  });
});
