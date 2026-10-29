import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { impliedHomeMargin } from "../ladder/engine";
import { polymarketFee } from "./fees";
import { pmCanon, pmEventMatches, pmEventSides, pmSpreadRungs, pmSpreadSlugs, polymarketAdapter, type PmEvent } from "./polymarket";

// A slimmed real snapshot (2026-10-29): Troy at James Madison, the moneyline plus the full-game spreads between Troy −2.5 and +25.5 and two half-time spreads.
const ev = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/polymarket-troy-jmu.json", import.meta.url)), "utf8")) as PmEvent;

describe("Polymarket US parsing", () => {
  it("home and away come from the team ordering on the market sides, and names resolve to the site's canonical names", () => {
    const s = pmEventSides(ev)!;
    expect([s.away.name, s.home.name]).toEqual(["Troy", "James Madison"]);
    expect(pmEventMatches(ev, { home_team: "James Madison", away_team: "Troy" })).toBe(true);
    expect(pmEventMatches(ev, { home_team: "Troy", away_team: "James Madison" })).toBe(false); // sides swapped: not the same game
    expect(pmCanon("K-State")).toBe("Kansas State");
    expect(pmCanon("Troy")).toBe("Troy");
    expect(pmCanon("Not A Team")).toBeNull();
  });

  it("builds the spread slugs a game can have", () => {
    const slugs = pmSpreadSlugs(ev.slug);
    expect(slugs).toContain("asc-cfb-troy-jmad-2026-10-29-neg-1pt5");
    expect(slugs).toContain("asc-cfb-troy-jmad-2026-10-29-pos-19pt5");
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBe(26 + 71);
  });

  it("maps a market's long side and signed line to an engine rung: Troy −1.5 = Troy wins by over 1.5, Troy +9.5 = Troy wins by over −9.5", () => {
    const sides = pmEventSides(ev)!;
    const { rungs, coef } = pmSpreadRungs(ev.markets!, sides);
    expect(coef).toBe(0.0695);
    const by = new Map(rungs.map((r) => [r.ticker, r]));
    const neg = by.get("PM:asc-cfb-troy-jmad-2026-10-29-neg-1pt5")!;
    expect(neg).toMatchObject({ side: "away", strike: 1.5 });
    const pos = by.get("PM:asc-cfb-troy-jmad-2026-10-29-pos-9pt5")!;
    expect(pos).toMatchObject({ side: "away", strike: -9.5 });
    // Prices are the long side's: Troy +9.5 is worth far more than Troy −1.5.
    expect(pos.bid!).toBeGreaterThan(neg.ask!);
    // Half-time spreads and anything that isn't the full game never become rungs.
    expect(rungs.every((r) => r.ticker.includes("-neg-") || r.ticker.includes("-pos-"))).toBe(true);
    expect(ev.markets!.some((m) => m.sportsMarketType === "football_team_first_half_spread")).toBe(true);
    expect(rungs.length).toBe(ev.markets!.filter((m) => m.sportsMarketType === "football_team_full_game_spread").length);
  });

  it("the ladder implies James Madison as a big home favorite (the same game Kalshi and Novig price)", () => {
    const { rungs } = pmSpreadRungs(ev.markets!, pmEventSides(ev)!);
    const m = impliedHomeMargin(rungs)!;
    expect(m).toBeGreaterThan(14);
    expect(m).toBeLessThan(23);
  });

  it("skips whole-number lines (pushes), closed or suspended markets, and a long side that is neither team", () => {
    const sides = pmEventSides(ev)!;
    const base = ev.markets!.find((m) => m.sportsMarketType === "football_team_full_game_spread")!;
    const mk = (over: object) => ({ ...base, slug: "x", ...over });
    expect(pmSpreadRungs([mk({ line: 3 })], sides).rungs).toEqual([]);
    expect(pmSpreadRungs([mk({ status: "MARKET_STATUS_SUSPENDED" })], sides).rungs).toEqual([]);
    expect(pmSpreadRungs([mk({ closed: true })], sides).rungs).toEqual([]);
    expect(pmSpreadRungs([mk({ marketSides: [{ long: true, teamId: 999 }] })], sides).rungs).toEqual([]);
    expect(pmSpreadRungs([mk({ bestBidQuote: null, bestAskQuote: { value: "0.1000" } })], sides).rungs[0]).toMatchObject({ bid: null, ask: 0.1 });
  });

  it("fee: taker 0.0695 · p · (1 − p), makers free; follows the market's own coefficient", () => {
    expect(polymarketFee()(0.5, { count: 100 })).toBeCloseTo(1.7375, 10);
    expect(polymarketFee()(0.5, { count: 100, maker: true })).toBe(0);
    expect(polymarketFee(0.1)(0.5, { count: 10 })).toBeCloseTo(0.25, 10);
  });
});

describe("Polymarket US adapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  const spreads = ev.markets!.filter((m) => m.sportsMarketType === "football_team_full_game_spread");
  const respond = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

  it("finds the game, reads its ladder in two slug requests, and keeps the market's fee coefficient", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("/v2/leagues/cfb/events")) return respond({ events: [{ slug: ev.slug, title: ev.title, markets: ev.markets!.filter((m) => m.sportsMarketType === "football_team_full_game_winner") }] });
      if (url.includes("/v1/markets?")) return respond({ markets: spreads });
      throw new Error(url);
    });
    const a = polymarketAdapter();
    await a.prepare();
    const L = await a.ladder({ home_team: "James Madison", away_team: "Troy", bookHomeMargin: 18.5, eventKey: null });
    expect(L?.eventKey).toBe(ev.slug);
    expect(L!.rungs.length).toBe(spreads.length * 2); // the same markets came back for both slug batches...
    expect(urls.filter((u) => u.includes("/v1/markets?")).length).toBe(2);
    expect(a.fee(10)(0.5, { count: 100 })).toBeCloseTo(1.7375, 10);
    expect(a.tick).toBe(0.005);
    expect(await a.trades([], 0)).toEqual([]);
  });

  it("refuses a game whose ladder doesn't look like it (sides can't be verified)", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("/v2/leagues/cfb/events")
        ? respond({ events: [{ slug: ev.slug, markets: ev.markets!.filter((m) => m.sportsMarketType === "football_team_full_game_winner") }] })
        : respond({ markets: spreads.slice(0, 20) })
    );
    const a = polymarketAdapter();
    await a.prepare();
    // The sportsbook says James Madison by 2.5; the ladder says 15+: not the same game, so no ladder.
    expect(await a.ladder({ home_team: "James Madison", away_team: "Troy", bookHomeMargin: 2.5, eventKey: null })).toBeNull();
    expect((a.diag?.() as { unresolved: string[] }).unresolved).toEqual(["Troy @ James Madison"]);
  });

  it("falls back to the full event when the slug scheme returns nothing, and reports games it doesn't list", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/v2/leagues/cfb/events")) return respond({ events: [{ slug: ev.slug, markets: ev.markets!.filter((m) => m.sportsMarketType === "football_team_full_game_winner") }] });
      if (url.includes("/v1/markets?")) return respond({ markets: [] });
      if (url.includes("/v1/events/slug/")) return respond({ event: ev });
      throw new Error(url);
    });
    const a = polymarketAdapter();
    await a.prepare();
    const L = await a.ladder({ home_team: "James Madison", away_team: "Troy", bookHomeMargin: null, eventKey: null });
    expect(L!.rungs.length).toBe(spreads.length);
    expect(await a.ladder({ home_team: "Ohio State", away_team: "Penn State", bookHomeMargin: null, eventKey: null })).toBeNull();
    expect((a.diag?.() as { notListed: string[]; fallback: number }).notListed).toEqual(["Penn State @ Ohio State"]);
    expect((a.diag?.() as { fallback: number }).fallback).toBe(1);
  });
});
