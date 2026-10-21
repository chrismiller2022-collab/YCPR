import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { impliedHomeMargin, ladderOrders, DEFAULT_LADDER_CONFIG, exposureSummary, pnlByMargin } from "../ladder/engine";
import { marginPmf } from "../fairPrice/marginDistribution";
import { codeScore, novigRungs, novigTeams, resolveFirstIsHome, type NovigBook, type NovigMarket } from "./novig";
import { bestPerOutcome, isGameSpread, oddsToProb, prophetxRungs } from "./prophetx";

// Real Novig snapshot (2026-10-21): Miami (OH) @ Central Michigan, 28 spread markets with books.
const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/novig-cmu.json", import.meta.url)), "utf8")) as {
  event: { description: string };
  markets: NovigMarket[];
  books: Record<string, NovigBook>;
};
const books = new Map(Object.entries(fx.books));
const game = { home_team: "Central Michigan", away_team: "Miami (OH)", bookHomeMargin: -2.5, eventKey: null };

describe("Novig", () => {
  it("maps event names to the site's teams", () => {
    expect(novigTeams(fx.event.description)).toEqual(["Miami (OH)", "Central Michigan"]);
    expect(novigTeams("North Carolina State @ Wake Forest")).toEqual(["NC State", "Wake Forest"]); // not South Carolina State
    expect(novigTeams("Championship Winner @ Nobody")).toBeNull();
    expect(novigTeams("Pittsburgh @ Miami Florida")).toEqual(["Pittsburgh", "Miami"]); // ProphetX spells it the same way
  });

  it("scores short codes against team names", () => {
    expect(codeScore("CMU", "Central Michigan")).toBeGreaterThan(codeScore("CMU", "Miami (OH)"));
    expect(codeScore("M-OH", "Miami (OH)")).toBeGreaterThan(codeScore("M-OH", "Central Michigan"));
    expect(codeScore("WYO", "Wyoming")).toBeGreaterThan(codeScore("WYO", "Air Force"));
  });

  it("decides home/away from the sportsbook line, and refuses when the line contradicts both ways", () => {
    expect(resolveFirstIsHome(fx.markets, books, game)).toBe(true); // outcomes[0] is "CMU …"
    expect(resolveFirstIsHome(fx.markets, books, { ...game, bookHomeMargin: 25 })).toBeNull();
  });

  it("builds a consistent ladder: asks above bids, prices fall as the strike rises, implied margin near the line", () => {
    const { rungs } = novigRungs(fx.markets, books, true);
    expect(rungs.length).toBeGreaterThan(20);
    for (const r of rungs) {
      expect(r.side).toBe("home");
      if (r.bid != null && r.ask != null) expect(r.ask).toBeGreaterThanOrEqual(r.bid - 1e-9);
    }
    const mids = rungs.filter((r) => r.bid != null && r.ask != null).sort((a, b) => a.strike - b.strike).map((r) => (r.bid! + r.ask!) / 2);
    for (let i = 1; i < mids.length; i++) expect(mids[i]).toBeLessThanOrEqual(mids[i - 1] + 0.03);
    const implied = impliedHomeMargin(rungs)!;
    expect(Math.abs(implied - -2.5)).toBeLessThan(3); // Miami favored by ~2.5
  });

  it("the engine quotes Novig at its 0.5¢ tick with zero pre-game fees", () => {
    const { rungs } = novigRungs(fx.markets, books, true);
    const fee = () => 0;
    const { orders } = ladderOrders(rungs, [], marginPmf(-4.3), { ...DEFAULT_LADDER_CONFIG, pick: "away", tick: 0.005, fee, maxWorstCaseLoss: 5 });
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) expect(Math.abs(o.price * 200 - Math.round(o.price * 200))).toBeLessThan(1e-6);
  });
});

describe("ProphetX parsing", () => {
  it("converts American and decimal odds", () => {
    expect(oddsToProb(-110)).toBeCloseTo(0.5238, 4);
    expect(oddsToProb(150)).toBeCloseTo(0.4, 6);
    expect(oddsToProb(2.5)).toBeCloseTo(0.4, 6);
    expect(oddsToProb(0.9)).toBeNull();
  });

  it("takes each outcome's best level from flat or nested selections", () => {
    expect(bestPerOutcome({ id: 1, selections: [[{ competitor_id: 1, price: 2 }, { competitor_id: 1, price: 1.9 }], [{ competitor_id: 2, price: 1.8 }]] }).map((s) => s.price)).toEqual([2, 1.8]);
    expect(bestPerOutcome({ id: 1, selections: [{ competitor_id: 1, price: 2 }, { competitor_id: 2, price: 1.8 }, { competitor_id: 1, price: 1.7 }] }).length).toBe(2);
  });

  it("turns a spread market into a rung: ask = cost to back A, bid = 1 − cost to back B", () => {
    const rungs = prophetxRungs(
      [{ id: 9, type: "spread", status: "open", selections: [{ competitor_id: 11, strike: -3.5, price: -110, strike_id: "s1" }, { competitor_id: 22, strike: 3.5, price: -105 }] }],
      "11",
      "22"
    );
    expect(rungs).toHaveLength(1);
    expect(rungs[0]).toMatchObject({ ticker: "PX:s1", side: "home", strike: 3.5 });
    expect(rungs[0].ask).toBeCloseTo(0.524, 3);
    expect(rungs[0].bid).toBeCloseTo(1 - 0.512, 3);
  });
});

describe("ProphetX v4 market_strikes", () => {
  it("reads each line from market_strikes and ignores half/quarter spreads", () => {
    const line = (strike: number, a: number, b: number, id: string) => ({
      id: id, strike, status: "active",
      selections: [[{ competitor_id: 11, strike, price: a, strike_id: id }], [{ competitor_id: 22, strike: -strike, price: b }]],
    });
    const markets = [
      { id: 1, type: "spread", name: "Spread", status: "active", market_strikes: [line(-3.5, -110, -110, "a"), line(-7.5, 150, -180, "b"), line(-7, 140, -170, "w")] },
      { id: 2, type: "spread", name: "1st Half Spread", status: "active", market_strikes: [line(-1.5, -110, -110, "h")] },
      { id: 3, type: "moneyline", name: "Moneyline", status: "active", selections: [] },
    ];
    const rungs = prophetxRungs(markets, "11", "22");
    expect(rungs.map((r) => r.ticker).sort()).toEqual(["PX:a", "PX:b"]); // whole line "w" and the half skipped
    expect(rungs.find((r) => r.ticker === "PX:b")).toMatchObject({ side: "home", strike: 7.5 });
    expect(isGameSpread({ id: 9, type: "spread", name: "Q1 Spread" })).toBe(false);
    expect(isGameSpread({ id: 9, type: "spread", name: "Spread", category_name: "Game Lines" })).toBe(true);
  });
});

describe("cross-venue loss cap", () => {
  it("counts positions on other venues toward the game's cap", () => {
    const { rungs } = novigRungs(fx.markets, books, true);
    const pmf = marginPmf(-4.3);
    const cfg = { ...DEFAULT_LADDER_CONFIG, pick: "away" as const, tick: 0.005, fee: () => 0, maxWorstCaseLoss: 3, perRungCap: 5 };
    const alone = ladderOrders(rungs, [], pmf, cfg).orders.length;
    // Pretend Kalshi already holds −$2.80 of worst case on this game.
    const otherPnl = new Array(161).fill(0).map((_, i) => (i - 80 > 0 ? -2.8 : 0.5));
    const withOther = ladderOrders(rungs, [], pmf, cfg, { otherPnl }).orders;
    expect(withOther.length).toBeLessThan(alone);
    const fill = new Map<string, { ticker: string; yes: number; cost: number }>();
    for (const o of withOther) {
      const p = fill.get(o.ticker) ?? { ticker: o.ticker, yes: 0, cost: 0 };
      const d = o.action === "buy" ? o.count : -o.count;
      fill.set(o.ticker, { ticker: o.ticker, yes: p.yes + d, cost: p.cost + d * o.price });
    }
    const pnl = pnlByMargin(rungs, [...fill.values()]).map((v, i) => v + otherPnl[i]);
    expect(exposureSummary(pnl, pmf).worst).toBeGreaterThanOrEqual(-3 - 1e-9);
  });
});
