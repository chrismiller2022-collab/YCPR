// The recorder's game list: every upcoming game with an FBS team, plus FCS vs FCS games only once they're on the watchlist.
import { beforeEach, describe, expect, it, vi } from "vitest";

const venue = vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.BOT_QUIET_HOURS = "off";
  return { on: false, bid: 0.4 };
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pgStub, type Row } from "./pgStub";

vi.mock("../venues", () => {
  const off = { available: () => false, prepare: async () => {}, ladder: async () => null, trades: async () => [], tick: 0.01, fee: () => () => 0, id: "x", label: "x" };
  const kalshi = {
    ...off, id: "kalshi", label: "Kalshi", available: () => venue.on, volume: () => 5,
    ladder: async () => ({ eventKey: "EV", rungs: [{ ticker: "K-H3.5", side: "home", strike: 3.5, bid: venue.bid, ask: venue.bid + 0.02 }] }),
  };
  return { VENUES: ["kalshi"], makeAdapters: () => ({ kalshi }) };
});
vi.mock("./ycpr", () => ({ ycprAwaySpreads: async () => new Map() }));

const soon = new Date(Date.now() + 24 * 3600e3).toISOString();
const game = (id: string, home: string, away: string, hc: string, ac: string): Row => ({
  id, season: 2026, week: 11, start_date: soon, home_team: home, away_team: away, neutral_site: false, home_classification: hc, away_classification: ac,
});
let db: Record<string, Row[]>;
let calls: string[];

beforeEach(() => {
  vi.resetModules(); // each test reads its own state folder
  venue.on = false;
  venue.bid = 0.4;
  process.env.BOT_CACHE_DIR = mkdtempSync(join(tmpdir(), "record-test-"));
  db = {
    games: [
      game("FBS1", "Ohio State", "Michigan", "fbs", "fbs"),
      game("MIX1", "Florida", "Samford", "fbs", "fcs"),
      game("FCS1", "Montana", "Montana State", "fcs", "fcs"),
      game("FCS2", "Villanova", "Delaware State", "fcs", "fcs"),
    ],
    bot_watchlist: [{ id: 1, game_id: "FCS1", enabled: true }, { id: 2, game_id: "FCS2", enabled: false }],
    bot_runs: [], bot_mkt_games: [], betting_lines: [], bot_state: [{ id: 1, polymarket_mode: "read" }], bot_mkt_last: [], bot_mkt_snaps: [], bot_mkt_trades: [],
  };
  const stub = pgStub(db);
  calls = stub.calls;
  vi.stubGlobal("fetch", stub.fetchStub);
});

describe("recorder games", () => {
  it("records FBS games and watched FCS vs FCS games, not unwatched ones", async () => {
    const { runRecord } = await import("./record");
    await runRecord();
    const recorded = db.bot_mkt_games.map((g) => g.game_id).sort();
    expect(recorded).toEqual(["FBS1", "FCS1", "MIX1"]);
  });
});

describe("recorder's last-price copy", () => {
  const lastReads = () => calls.filter((c) => c.startsWith("bot_mkt_last?select")).length;

  it("downloads bot_mkt_last once, then works from its own copy", async () => {
    venue.on = true;
    const { runRecord } = await import("./record");
    await runRecord();
    expect(lastReads()).toBe(1);
    expect(db.bot_mkt_snaps.length).toBe(3); // first sighting of the rung in each recorded game
    await runRecord();
    expect(lastReads()).toBe(1); // second run: no download
    expect(db.bot_mkt_snaps.length).toBe(3); // and unchanged prices aren't re-saved
    venue.bid = 0.45;
    await runRecord();
    expect(lastReads()).toBe(1);
    expect(db.bot_mkt_snaps.length).toBe(6); // a price change is
  });

  it("reloads from the database after a run that was cut off", async () => {
    venue.on = true;
    const { runRecord } = await import("./record");
    await runRecord();
    const file = join(process.env.BOT_CACHE_DIR!, "mkt-last.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.dirty).toBe(false);
    const { writeState } = await import("./localState");
    writeState("mkt-last.json", { ...saved, dirty: true });
    await runRecord();
    expect(lastReads()).toBe(2);
  });
});
