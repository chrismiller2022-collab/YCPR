// Add games / Manage games server side: /api/data?part=picker and /api/admin addWatches / updateWatches,
// against the in-memory PostgREST stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pgStub, type Row } from "./pgStub";

vi.mock("../../hub/api/_bot.mjs", async () => {
  const shrink = await import("../fairPrice/shrink");
  return {
    ycprAwaySpreads: async (games: Row[]) => new Map(games.map((g) => [String(g.id), g.id === "3" ? null : -7])),
    outcomeRanges: () => ({ ranges: [], expected: 0 }),
    marginPmf: () => ({ maxMargin: 0, probs: [1] }),
    boardChanges: () => ({}),
    espnScoreGame: (e: Row) => ({ id: String(e.id), state: e.state }),
    espnDate: () => "20261024",
    pmMedian: shrink.pmMedian,
    shrinkFrom: shrink.shrinkFrom,
    shrunkHomeMargin: shrink.shrunkHomeMargin,
  };
});
import data, { lineSummary } from "../../hub/api/data.js";
import admin from "../../hub/api/admin.js";

const game = (id: string, week: number, completed: boolean, extra: Row = {}) => ({
  id, season: 2026, week, season_type: "regular", start_date: `2026-10-${20 + Number(id)}T23:00:00Z`, home_team: `Home${id}`, away_team: `Away${id}`,
  neutral_site: false, home_conference: "MAC", away_conference: "MAC", home_classification: "fbs", away_classification: "fbs", completed, ...extra,
});

async function call(handler: any, url: string, body?: Row) {
  const res: any = { statusCode: 0, setHeader() {}, end(b: string) { this.body = JSON.parse(b); } };
  await handler({ url, method: body ? "POST" : "GET", headers: { "x-bot-password": "pw" }, body }, res);
  if (res.statusCode !== 200) throw new Error(res.body?.error || String(res.statusCode));
  return res.body;
}

describe("Add games / Manage games API", () => {
  let db: Record<string, Row[]>;
  beforeEach(() => {
    db = {
      games: [game("1", 8, true), game("2", 9, false), game("3", 9, false), game("4", 9, false, { home_classification: "fcs", away_classification: "fcs" })],
      betting_lines: [{ game_id: "2", provider: "DraftKings", spread: 4 }, { game_id: "2", provider: "market_median", spread: 3.5 }],
      bot_mkt_games: [{ game_id: "2", venue_margins: { kalshi: -3.6 }, venue_events: {}, updated_at: "x" }],
      bot_watchlist: [{ id: 1, game_id: "3", enabled: true, pick: "away", max_worst_case_loss: 5 }],
      bot_strategies: [{ id: 7, name: "Patient", enabled: true, pro_edge: 0.02, anti_edge: 0.03, take_edge: 0.08, edge_step: 0.01, max_worst_case_loss: 10, per_rung_cap: 1, ycpr_weight: null, stop_minutes_before: 30 }],
    };
    vi.stubGlobal("fetch", pgStub(db).fetchStub);
    process.env.SUPABASE_URL = "http://db";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.BOT_ADMIN_PASSWORD = "pw";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("picker: the current week's FBS games with YC, Vegas (median first), venues and watched flag", async () => {
    const d = await call(data, "/api/data?part=picker&season=2026");
    expect(d.weeks).toEqual([8, 9]);
    expect([d.current, d.week]).toEqual([9, 9]);
    expect(d.games.map((g: Row) => g.id)).toEqual(["2", "3"]); // FCS-only game left out
    const g2 = d.games.find((g: Row) => g.id === "2");
    expect(g2).toMatchObject({ home_spread: 3.5, yc_away_spread: -7, venue_margins: { kalshi: -3.6 }, watch: null });
    // The trading line: PM median −3.6 plus 0.1 of the −3.4 gap.
    expect(g2.lines.pm).toBe(-3.6);
    expect(g2.lines.shrunk).toBeCloseTo(-3.94, 10);
    expect(d.games.find((g: Row) => g.id === "3").watch).toMatchObject({ id: 1, enabled: true });
    expect(d.strategies[0].name).toBe("Patient");
    const w8 = await call(data, "/api/data?part=picker&season=2026&week=8");
    expect(w8.games.map((g: Row) => g.id)).toEqual(["1"]);
  });

  it("addWatches: several games, one settings block, each with its own lean and override", async () => {
    const r = await call(admin, "/api/admin", {
      action: "addWatches",
      settings: { pro_edge: 0.02, anti_edge: 0.03, take_edge: 0.08, edge_step: 0.01, max_worst_case_loss: 10, per_rung_cap: 1, ycpr_weight: null, stop_minutes_before: 30, strategy_preset: 7, enabled: true },
      games: [{ game_id: "2", pick: "away", my_home_margin: null }, { game_id: "1", pick: "home", my_home_margin: -2.5 }],
    });
    expect(r.watch).toHaveLength(2);
    const w2 = db.bot_watchlist.find((w) => w.game_id === "2")!;
    expect(w2).toMatchObject({ pick: "away", my_home_margin: null, take_edge: 0.08, max_worst_case_loss: 10, strategy_preset: 7, enabled: true, home_team: "Home2", week: 9 });
    expect(db.bot_watchlist.find((w) => w.game_id === "1")).toMatchObject({ pick: "home", my_home_margin: -2.5 });
    await expect(call(admin, "/api/admin", { action: "addWatches", settings: {}, games: [{ game_id: "2" }] })).rejects.toThrow(/pick is required/);
  });

  it("updateWatches: one change to many games, only the fields sent", async () => {
    db.bot_watchlist.push({ id: 2, game_id: "2", enabled: true, pick: "home", max_worst_case_loss: 5, take_edge: 0.03 });
    await call(admin, "/api/admin", { action: "updateWatches", ids: [1, 2], patch: { take_edge: 0.05, venues: ["kalshi"], pick: "home" } });
    for (const w of db.bot_watchlist) expect(w).toMatchObject({ take_edge: 0.05, venues: ["kalshi"], max_worst_case_loss: 5 });
    expect(db.bot_watchlist[0].pick).toBe("away"); // the lean is per game, never bulk-changed
    await call(admin, "/api/admin", { action: "updateWatches", ids: [2], patch: { enabled: false } });
    expect(db.bot_watchlist.map((w) => w.enabled)).toEqual([true, false]);
    await expect(call(admin, "/api/admin", { action: "updateWatches", ids: [1], patch: {} })).rejects.toThrow(/nothing to change/);
  });

  it("week: the watched games of the next week to finish, every book's fills, finals and Vegas", async () => {
    const soon = new Date(Date.now() + 3600e3).toISOString(), old = new Date(Date.now() - 9 * 86400e3).toISOString();
    db.bot_watchlist = [
      { id: 1, game_id: "1", week: 8, kickoff: old, pick: "away", enabled: true },
      { id: 2, game_id: "2", week: 9, kickoff: soon, pick: "home", enabled: true },
    ];
    db.bot_fills = [{ id: 1, mode: "paper", strategy_id: null, game_id: "2", venue: "kalshi", ticker: "t", side: "home", strike: 1.5, action: "buy", price: 0.5, count: 1, fee: 0 }, { id: 2, mode: "paper", strategy_id: 7, game_id: "1" }];
    const d = await call(data, "/api/data?part=week");
    expect([d.weeks, d.week]).toEqual([[8, 9], 9]);
    expect(d.games.map((g: Row) => [g.game_id, g.home_spread])).toEqual([["2", 3.5]]);
    expect(d.fills.map((f: Row) => f.id)).toEqual([1]);
    expect(d.finals.map((f: Row) => f.id)).toEqual(["2"]);
    expect((await call(data, "/api/data?part=week&week=8")).fills.map((f: Row) => f.id)).toEqual([2]);
  });

  it("scores: ESPN games for the asked ids only, one fetch per day and division, cached", async () => {
    const espn: string[] = [];
    const db2 = pgStub(db).fetchStub;
    vi.stubGlobal("fetch", async (url: string, init?: Row) => {
      if (!url.includes("espn.com")) return db2(url, init);
      espn.push(url);
      return { ok: true, json: async () => ({ events: [{ id: "2", state: "in" }, { id: "99", state: "in" }] }) };
    });
    const q = `/api/data?part=scores&ids=2,b%20ad&kickoffs=${encodeURIComponent("2026-10-24T23:00:00Z")}`;
    const d = await call(data, q);
    expect(d.scores).toEqual({ "2": { id: "2", state: "in" } });
    expect(espn).toHaveLength(2);
    await call(data, q);
    expect(espn).toHaveLength(2); // served from the 10 s cache
  });

  it("line summary: original YC, the line in use, PM median and the shrunk trading line", () => {
    const w = { ycpr_original: -6, ycpr_home_margin: -7, my_home_margin: null, venue_margins: { kalshi: -1, novig: -2, prophetx: -3 }, beta: null };
    const L = lineSummary(w, { beta: 0.2, hump_cap: 5.5, sigma: 15 });
    expect(L).toMatchObject({ ycOriginal: -6, yc: -7, pm: -2, beta: 0.2 });
    expect(L.gap).toBe(-5);
    expect(L.shrunk).toBeCloseTo(-3, 10);
    // A typed override is what the bot prices from; a per-game beta beats the global one; the gap is capped at the hump.
    const o = lineSummary({ ...w, my_home_margin: -20, beta: 0.5 }, { beta: 0.2, hump_cap: 5.5 });
    expect(o.yc).toBe(-20);
    expect(o.ycOriginal).toBe(-6);
    expect(o.shrunk).toBeCloseTo(-2 - 0.5 * 5.5, 10);
    expect(lineSummary({ ycpr_home_margin: -7, venue_margins: {} }, {}).shrunk).toBeNull(); // no venue, no trading line (the book is never a fallback)
  });

  describe("weekly workflow", () => {
    const future = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();
    beforeEach(() => {
      db.games = [game("2", 9, false, { start_date: future(2) }), game("3", 9, false, { start_date: future(2) }), game("5", 9, false, { start_date: future(3) }), game("6", 9, false, { start_date: new Date(Date.now() - 3600e3).toISOString() })];
      db.bot_mkt_games = [{ game_id: "2", venue_margins: { kalshi: -3.6, novig: -3.4 }, venue_events: {}, updated_at: "x" }];
      db.bot_watchlist = [{ id: 1, game_id: "3", enabled: true, pick: "away", ycpr_home_margin: null, ycpr_original: null }];
      db.bot_strategies = [];
      db.bot_runs = [{ id: 1, mode: "paper", host: "tower", started_at: new Date().toISOString(), summary: { codeVersion: 3 } }];
    });

    it("adds the games that aren't watched (for the rebuilt books only), syncs YC, reports the gaps, turns the books on", async () => {
      const r = await call(admin, "/api/admin", { action: "weeklyWorkflow", season: 2026, week: 9 });
      expect(r).toMatchObject({ games: 3, added: 2, alreadyWatched: 1, books: ["Shrunk", "Target"] }); // game 6 already kicked off
      const w2 = db.bot_watchlist.find((w) => w.game_id === "2")!;
      expect(w2).toMatchObject({ legacy: false, enabled: true, pick: "away", ycpr_home_margin: -7, ycpr_original: -7 });
      expect(r.noVenue).toEqual(expect.arrayContaining(["Away3 @ Home3", "Away5 @ Home5"]));
      expect(r.noVenue).not.toContain("Away2 @ Home2");
      expect(r.noYc).toEqual(["Away3 @ Home3"]);
      expect(db.bot_strategies.map((s) => [s.name, s.method, s.fair_mode, s.enabled])).toEqual([["Shrunk", "ladder", "shrunk", true], ["Target", "target", "shrunk", true]]);
      // Run again: nothing is added twice, the original YC line is not touched, YC is not "synced" when it hasn't changed.
      const again = await call(admin, "/api/admin", { action: "weeklyWorkflow", season: 2026, week: 9 });
      expect(again).toMatchObject({ added: 0, alreadyWatched: 3, synced: 0 });
      expect(db.bot_watchlist.filter((w) => w.game_id === "2")).toHaveLength(1);
    });

    it("keeps the original YC line when YC's number changes, and refreshes the current one", async () => {
      await call(admin, "/api/admin", { action: "weeklyWorkflow", season: 2026, week: 9 });
      db.bot_watchlist.find((w) => w.game_id === "2")!.ycpr_home_margin = -5; // as if ratings had moved before the next sync
      const again = await call(admin, "/api/admin", { action: "weeklyWorkflow", season: 2026, week: 9 });
      expect(again.synced).toBe(1);
      expect(db.bot_watchlist.find((w) => w.game_id === "2")).toMatchObject({ ycpr_home_margin: -7, ycpr_original: -7 });
    });

    it("refuses while the tower is still running an older runner", async () => {
      db.bot_runs = [{ id: 1, mode: "paper", host: "tower", started_at: new Date().toISOString(), summary: { codeVersion: 2 } }];
      await expect(call(admin, "/api/admin", { action: "weeklyWorkflow", season: 2026, week: 9 })).rejects.toThrow(/tower is still running older code/);
      await expect(call(admin, "/api/admin", { action: "enableRebuildBooks" })).rejects.toThrow(/tower is still running older code/);
      expect(db.bot_watchlist).toHaveLength(1);
      expect(db.bot_strategies).toHaveLength(0);
      db.bot_runs = [{ id: 1, mode: "paper", host: "tower", started_at: new Date(Date.now() - 3 * 3600e3).toISOString(), summary: {} }]; // a tower that has gone quiet doesn't block
      await call(admin, "/api/admin", { action: "enableRebuildBooks" });
      expect(db.bot_strategies).toHaveLength(2);
    });
  });
});
