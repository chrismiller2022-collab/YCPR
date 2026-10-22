// Live desk: /api/live (hub/api/live.js) and the feed (hub/live/feed.js) against an in-memory PostgREST stub,
// plus the browser model's margin distribution against the bot's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marginPmf as botPmf } from "../fairPrice/marginDistribution";
import * as model from "../../hub/live/model.js";
import handler, { parseCursor, downsample, fillKind } from "../../hub/api/live.js";
import { startFeed } from "../../hub/live/feed.js";
import { pgStub as stub, type Row } from "./pgStub";


const T0 = Date.parse("2026-10-23T18:00:00Z");
const iso = (dt: number) => new Date(T0 + dt * 1000).toISOString();

function seed(): Record<string, Row[]> {
  const w = (id: number, game_id: string, away: string, home: string, ours: number, kal: number, extra: Row = {}) => ({
    id, game_id, away_team: away, home_team: home, kickoff: iso(86400), pick: "away", my_home_margin: null, ycpr_home_margin: ours,
    kalshi_home_margin: kal, kalshi_updated_at: iso(-60), venue_margins: { kalshi: kal, novig: kal - 0.2 }, venues: ["kalshi", "novig", "prophetx"],
    max_worst_case_loss: 20, stop_minutes_before: 30, enabled: true, ...extra,
  });
  return {
    bot_state: [{ id: 1, mode: "paper", kill_switch: false, updated_at: iso(-3600) }],
    bot_watchlist: [w(1, "g1", "Air Force", "Wyoming", -10.96, -5.4), w(2, "g2", "Army", "Tulsa", -2.32, -1.6)],
    bot_strategies: [{ id: 7, name: "Patient", enabled: true, max_worst_case_loss: 10 }],
    bot_runs: [
      { id: 1, mode: "paper", started_at: iso(-300), finished_at: iso(-280), error: null, summary: { venueErrors: { novig: "Novig 429 on /trades" } } },
      { id: 2, mode: "record", started_at: iso(-290), finished_at: iso(-200), error: null, summary: {} },
    ],
    bot_orders: [
      { id: 10, mode: "paper", venue: "kalshi", strategy_id: null, game_id: "g1", ticker: "K-AF6", action: "buy", price: 0.55, count: 1, kind: "quote", direction: "pro", fair: 0.6, status: "cancelled", created_at: iso(-900), closed_at: iso(-300) },
      { id: 11, mode: "paper", venue: "kalshi", strategy_id: null, game_id: "g1", ticker: "K-AF6", action: "buy", price: 0.56, count: 1, kind: "quote", direction: "pro", fair: 0.61, status: "resting", created_at: iso(-299), closed_at: null },
      { id: 12, mode: "paper", venue: "kalshi", strategy_id: null, game_id: "g1", ticker: "K-AF9", action: "buy", price: 0.4, count: 1, kind: "take", direction: "pro", fair: 0.45, status: "filled", created_at: iso(-299), closed_at: iso(-299) },
      { id: 13, mode: "paper", venue: "novig", strategy_id: 7, game_id: "g2", ticker: "nv-1", action: "buy", price: 0.5, count: 1, kind: "quote", direction: "pro", fair: 0.53, status: "resting", created_at: iso(-299), closed_at: null },
    ],
    bot_fills: [
      { id: 100, mode: "paper", order_id: 12, venue: "kalshi", strategy_id: null, game_id: "g1", ticker: "K-AF9", side: "away", strike: 8.5, action: "buy", price: 0.4, count: 1, fee: 0.02, fair_at_fill: 0.45, mid_at_fill: 0.41, filled_at: iso(-299) },
    ],
    bot_snapshots: [
      { id: 50, game_id: "g1", venue: "kalshi", ticker: "K-AF6", side: "away", strike: 5.5, bid: 0.55, ask: 0.58, fair: 0.6, taken_at: iso(-300) },
      { id: 51, game_id: "g1", venue: "kalshi", ticker: "K-AF9", side: "away", strike: 8.5, bid: 0.38, ask: 0.4, fair: 0.45, taken_at: iso(-300) },
      { id: 52, game_id: "g2", venue: "novig", ticker: "nv-1", side: "away", strike: 1.5, bid: 0.49, ask: 0.52, fair: 0.53, taken_at: iso(-300) },
    ],
    bot_mkt_snaps: [{ id: 500, game_id: "g1", venue: "kalshi", ticker: "K-AF6", side: "away", strike: 5.5, bid: 0.54, ask: 0.57, taken_at: iso(-250) }],
    bot_mkt_last: [{ venue: "kalshi", ticker: "K-AF6", bid: 0.53, ask: 0.57, volume: 10, last_trade_t: 0 }],
    bot_mkt_trades: [{ id: 900, game_id: "g1", venue: "kalshi", ticker: "K-AF6", t: iso(-400), yes_price: 0.56 }],
    bot_mkt_implied: Array.from({ length: 30 }, (_, i) => ({ game_id: "g1", venue: "kalshi", t: iso(-3600 * 30 + i * 3600), margin: -5 - i * 0.01 })),
    bot_mkt_games: [{ game_id: "g1", book_home_margin: -5.5, ycpr_home_margin: -10.96 }],
  };
}

async function call(url: string) {
  const res: any = { statusCode: 0, headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = JSON.parse(b); } };
  await handler({ url, headers: { "x-bot-password": "pw" } }, res);
  if (res.statusCode !== 200) throw new Error(res.body?.error || String(res.statusCode));
  return res.body;
}

describe("live desk", () => {
  let db: Record<string, Row[]>;
  let calls: string[];
  beforeEach(() => {
    db = seed();
    const s = stub(db);
    calls = s.calls;
    vi.stubGlobal("fetch", s.fetchStub);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    process.env.SUPABASE_URL = "http://db";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.BOT_ADMIN_PASSWORD = "pw";
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("model's margin distribution matches the bot's", () => {
    for (const m of [-17.3, -3, 0, 2.5, 10.96]) {
      const a = model.marginPmf(m).probs, b = botPmf(m).probs;
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 12);
    }
  });

  it("full load, then only what changed", async () => {
    const d = await call("/api/live?game=g1&range=24h");
    expect(d.full).toBe(true);
    expect(d.watchlist).toHaveLength(2);
    expect(d.strategies).toHaveLength(1);
    expect(d.orders.map((o: Row) => o.id).sort()).toEqual([10, 11, 12, 13]);
    expect(d.fills[0].kind).toBe("take");
    expect(d.fills[0].o).toBeUndefined();
    // Ladder: newest row per source, plus the recorder's last-seen price for each known rung.
    expect(d.ladder.find((r: Row) => r.src === "last" && r.ticker === "K-AF6").bid).toBe(0.53);
    expect(d.trades).toHaveLength(1);
    expect(d.lines.length).toBeGreaterThan(20); // 24h of hourly points (downsampled, still all of them)
    expect(d.mktGame.book_home_margin).toBe(-5.5);
    expect(d.runs.paper[0].venueErrors.novig).toMatch(/429/);
    const c = parseCursor(d.cursor)!;
    expect(c).toMatchObject({ o: 13, f: 100, mktSnap: 500, botSnap: 52, trade: 900 });

    // Nothing new: an incremental poll sends no rows (and no watchlist inside the minute).
    vi.setSystemTime(T0 + 7000);
    const n = await call(`/api/live?game=g1&range=24h&since=${d.cursor}`);
    expect(n.full).toBe(false);
    expect(n.watchlist).toBeUndefined();
    expect([n.orders, n.fills, n.ladder, n.trades, n.lines, n.rungs].map((x) => x.length)).toEqual([0, 0, 0, 0, 0, 0]);

    // A cycle: the resting quote fills, one new trade, a new snapshot row, a new implied point.
    db.bot_orders.find((o) => o.id === 11)!.status = "filled";
    db.bot_orders.find((o) => o.id === 11)!.closed_at = iso(10);
    db.bot_fills.push({ id: 101, mode: "paper", order_id: 11, venue: "kalshi", strategy_id: null, game_id: "g1", ticker: "K-AF6", side: "away", strike: 5.5, action: "buy", price: 0.56, count: 1, fee: 0.004, fair_at_fill: 0.61, mid_at_fill: 0.55, filled_at: iso(10) });
    db.bot_mkt_trades.push({ id: 901, game_id: "g1", venue: "kalshi", ticker: "K-AF6", t: iso(5), yes_price: 0.56 });
    db.bot_mkt_trades.push({ id: 902, game_id: "g2", venue: "kalshi", ticker: "K-AR1", t: iso(5), yes_price: 0.5 });
    db.bot_snapshots.push({ id: 53, game_id: "g1", venue: "kalshi", ticker: "K-AF6", side: "away", strike: 5.5, bid: 0.57, ask: 0.6, fair: 0.62, taken_at: iso(10) });
    db.bot_mkt_implied.push({ game_id: "g1", venue: "kalshi", t: iso(10), margin: -6 });
    vi.setSystemTime(T0 + 14000);
    const m = await call(`/api/live?game=g1&range=24h&since=${n.cursor}`);
    expect(m.orders.map((o: Row) => o.id)).toEqual([11]);
    expect(m.fills.map((f: Row) => [f.id, f.kind])).toEqual([[101, "make"]]);
    expect(m.trades.map((t: Row) => t.id)).toEqual([901]); // the other game's trade stays out
    expect(m.ladder.map((r: Row) => [r.src, r.bid])).toEqual([["bot", 0.57]]);
    expect(m.lines).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("bot_mkt_last"))).toBe(true);
  });

  it("feed merges polls into desk snapshots", async () => {
    const snaps: any[] = [];
    const feed = startFeed((s: any) => snaps.push(s), { gameId: "g1", range: "6h", get: (p: string) => call(p), pollMs: 1e9 });
    await vi.waitFor(() => expect(snaps.length).toBe(1));
    const s = snaps[0];
    expect(s.game).toMatchObject({ game_id: "g1", away: "Air Force", ours: -10.96, market: -5.4, cap: 20, book: -5.5 });
    expect(s.quotes.map((q: Row) => [q.id, q.strike])).toEqual([[11, 5.5]]);
    expect(s.fills).toHaveLength(1);
    expect(s.tape.map((t: Row) => t.ours ?? "mkt")).toEqual(["take", "mkt"]);
    // Board's game row: one contract on Air Force +8.5 bought at 40¢ plus a 2¢ fee.
    const g1 = s.games.find((g: Row) => g.game_id === "g1");
    expect(g1.worst).toBeCloseTo(-0.42, 6);
    expect(g1.status.label).toBe("Quoting");
    expect(g1.expected).toBeGreaterThan(g1.marketExpected);
    // Blotter: the 55¢ → 56¢ re-price is one "moved" row; the take is a fill row.
    expect(s.activity.map((a: Row) => [a.type, a.price])).toEqual(expect.arrayContaining([["moved", 0.56], ["take", 0.4]]));
    expect(s.activity.some((a: Row) => a.type === "cancelled")).toBe(false);
    // Lab strategy book: its own quotes and caps, same feed, no refetch.
    const before = calls.length;
    feed.setBook(7);
    const lab = snaps.at(-1);
    expect(lab.quotes).toHaveLength(0);
    expect(lab.games.find((g: Row) => g.game_id === "g2")).toMatchObject({ resting: 1, cap: 10 });
    expect(calls.length).toBe(before);
    // Switching games reloads only the game's rows.
    feed.setGame("g2");
    await vi.waitFor(() => expect(snaps.at(-1).game?.game_id).toBe("g2"));
    expect(calls.some((c) => c.startsWith("bot_mkt_snaps") && c.includes("game_id=eq.g2") && !c.includes("id=gt."))).toBe(true);
    expect(snaps.at(-1).quotes.map((q: Row) => q.id)).toEqual([13]); // still the lab book
    feed.stop();
  });

  it("helpers", () => {
    expect(fillKind({ kind: "quote", direction: "anti" })).toBe("sell");
    expect(fillKind({ kind: "take", direction: "pro" })).toBe("take");
    expect(fillKind({ kind: "quote", direction: "pro" })).toBe("make");
    const rows = Array.from({ length: 1000 }, (_, i) => ({ venue: "kalshi", t: iso(i * 60), margin: i }));
    const ds = downsample(rows, 1000 * 60e3, 100);
    expect(ds.length).toBeLessThanOrEqual(101);
    expect(ds.at(-1)!.margin).toBe(999);
    expect(model.gameStatus({ w: { kickoff: iso(-1), enabled: true }, used: 0, resting: 0, now: T0 }).label).toBe("Final");
    expect(model.gameStatus({ w: { kickoff: iso(600), enabled: true, stop_minutes_before: 30 }, used: 0, resting: 0, now: T0 }).label).toBe("Stopped");
    const w = { kickoff: iso(86400), enabled: true, pick: "away", ycpr_home_margin: -6, venue_margins: { kalshi: -5.5 } };
    expect(model.gameStatus({ w, used: 0.85, resting: 1, now: T0 }).label).toBe("Near cap");
    expect(model.gameStatus({ w, used: 0.1, resting: 1, now: T0 }).label).toBe("Thin edge");
    expect(model.gameStatus({ w: { ...w, ycpr_home_margin: -5 }, used: 0.1, resting: 1, now: T0 }).label).toBe("No edge");
    expect(model.pickRung({ side: "home", strike: 3.5, bid: 0.4, ask: 0.45 }, "away")).toEqual({ k: -3.5, bid: 0.55, ask: 0.6, flip: true });
  });
});
