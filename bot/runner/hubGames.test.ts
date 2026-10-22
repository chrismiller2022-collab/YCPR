// Add games / Manage games server side: /api/data?part=picker and /api/admin addWatches / updateWatches,
// against the in-memory PostgREST stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pgStub, type Row } from "./pgStub";

vi.mock("../../hub/api/_bot.mjs", () => ({
  ycprAwaySpreads: async (games: Row[]) => new Map(games.map((g) => [String(g.id), g.id === "3" ? null : -7])),
  outcomeRanges: () => ({ ranges: [], expected: 0 }),
  marginPmf: () => ({ maxMargin: 0, probs: [1] }),
  boardChanges: () => ({}),
}));
// @ts-expect-error plain JS API files
import data from "../../hub/api/data.js";
// @ts-expect-error plain JS API files
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
});
