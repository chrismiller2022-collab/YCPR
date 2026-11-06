// The recorder's game list: every upcoming game with an FBS team, plus FCS vs FCS games only once they're on the watchlist.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.BOT_QUIET_HOURS = "off";
});

import { pgStub, type Row } from "./pgStub";

vi.mock("../venues", () => {
  const off = { available: () => false, prepare: async () => {}, ladder: async () => null, trades: async () => [], tick: 0.01, fee: () => () => 0, id: "x", label: "x" };
  return { VENUES: ["kalshi"], makeAdapters: () => ({ kalshi: off }) };
});
vi.mock("./ycpr", () => ({ ycprAwaySpreads: async () => new Map() }));

const soon = new Date(Date.now() + 24 * 3600e3).toISOString();
const game = (id: string, home: string, away: string, hc: string, ac: string): Row => ({
  id, season: 2026, week: 11, start_date: soon, home_team: home, away_team: away, neutral_site: false, home_classification: hc, away_classification: ac,
});
let db: Record<string, Row[]>;

beforeEach(() => {
  db = {
    games: [
      game("FBS1", "Ohio State", "Michigan", "fbs", "fbs"),
      game("MIX1", "Florida", "Samford", "fbs", "fcs"),
      game("FCS1", "Montana", "Montana State", "fcs", "fcs"),
      game("FCS2", "Villanova", "Delaware State", "fcs", "fcs"),
    ],
    bot_watchlist: [{ id: 1, game_id: "FCS1", enabled: true }, { id: 2, game_id: "FCS2", enabled: false }],
    bot_runs: [], bot_mkt_games: [], betting_lines: [], bot_state: [{ id: 1, polymarket_mode: "read" }],
  };
  vi.stubGlobal("fetch", pgStub(db).fetchStub);
});

describe("recorder games", () => {
  it("records FBS games and watched FCS vs FCS games, not unwatched ones", async () => {
    const { runRecord } = await import("./record");
    await runRecord();
    const recorded = db.bot_mkt_games.map((g) => g.game_id).sort();
    expect(recorded).toEqual(["FBS1", "FCS1", "MIX1"]);
  });
});
