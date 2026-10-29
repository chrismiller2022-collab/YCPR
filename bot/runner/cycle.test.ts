// One full paper cycle against the in-memory PostgREST stub and a fake Kalshi ladder: the original book
// (our number only) piles in when we are 7.6 points off a pick'em market; the shrunk book, priced from the
// PM median + beta · capped gap, takes nothing there. Fills carry the context columns used for markouts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
});

import { marginPmf } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { kalshiFeeWith } from "../venues/fees";
import { pgStub, type Row } from "./pgStub";

const mids = { kalshi: 0, novig: 1.2, poly: 6, withNovig: false, withPoly: false };
const ladder = (mid: number, tag: string) => {
  const pmf = marginPmf(mid);
  const rungs = [];
  for (let k = 0.5; k <= 24.5; k += 1)
    for (const side of ["home", "away"] as const) {
      const p = kalshiSpreadYesProb(pmf, side, k);
      if (p < 0.03 || p > 0.97) continue;
      rungs.push({ ticker: `${tag}-${side[0].toUpperCase()}${k}`, side, strike: k, bid: Math.round((p - 0.01) * 100) / 100, ask: Math.round((p + 0.01) * 100) / 100 });
    }
  return { eventKey: "EV1", rungs };
};

vi.mock("../venues", () => {
  const off = { available: () => false, prepare: async () => {}, ladder: async () => null, trades: async () => [], tick: 0.01, fee: () => () => 0, id: "x", label: "x" };
  const novig = { ...off, id: "novig", label: "Novig", tick: 0.005, available: () => mids.withNovig, ladder: async () => ladder(mids.novig, "NV"), fee: () => () => 0 }; // pre-game: free
  return {
    VENUES: ["kalshi", "novig", "prophetx", "polymarket"],
    makeAdapters: () => ({
      kalshi: { id: "kalshi", label: "Kalshi", tick: 0.01, available: () => true, prepare: async () => {}, ladder: async () => ladder(mids.kalshi, "K"), trades: async () => [], fee: () => kalshiFeeWith("quadratic_with_maker_fees", 1) },
      novig,
      prophetx: off,
      polymarket: { ...off, id: "polymarket", label: "Polymarket", tick: 0.005, available: () => mids.withPoly, ladder: async () => ladder(mids.poly, "PM"), fee: () => (p: number, o: { count?: number; maker?: boolean } = {}) => (o.maker ? 0 : 0.0695 * (o.count ?? 1) * p * (1 - p)) },
    }),
  };
});
vi.mock("./ycpr", () => ({ ycprAwaySpreads: async () => new Map([["G1", -7.6]]) }));
vi.mock("./espnFinals", () => ({ syncEspnFinals: async () => ({ saved: 0 }) }));

const kickoff = new Date(Date.now() + 48 * 3600e3).toISOString();
let db: Record<string, Row[]>;

const watch = (): Row => ({
  id: 1, game_id: "G1", season: 2026, week: 9, home_team: "Colorado", away_team: "Kansas State", kickoff, pick: "away",
  my_home_margin: null, ycpr_home_margin: null, ycpr_original: null, kalshi_home_margin: null, ycpr_weight: null, beta: null,
  max_worst_case_loss: 10, per_rung_cap: 1, order_size: 1, pro_edge: 0.02, anti_edge: 0.04, take_edge: 0.03, edge_step: 0.01,
  profit_target: null, stop_minutes_before: 30, kalshi_event: null, venues: ["kalshi", "novig", "prophetx"], venue_events: {}, venue_margins: {},
  shape: null, market_floor: null, against_limit: null, blowout_margin: null, enabled: true,
});
const strat = (id: number, name: string, fair_mode: string): Row => ({
  id, name, enabled: true, pro_edge: 0.02, anti_edge: 0.04, take_edge: 0.03, edge_step: 0.01, max_worst_case_loss: 10, per_rung_cap: 1,
  ycpr_weight: null, stop_minutes_before: 30, shape: null, market_floor: null, against_limit: null, blowout_margin: null, fair_mode, method: "ladder",
});

beforeEach(() => {
  mids.kalshi = 0;
  mids.novig = 1.2;
  mids.withNovig = false;
  mids.withPoly = false;
  mids.poly = 6;
  db = {
    bot_state: [{ id: 1, mode: "paper", kill_switch: false, default_ycpr_weight: 1, beta: 0.1, hump_cap: 5.5, hump_fall: 0, sigma: 15, bankroll: 1000, kelly_frac: 0.25, team_cap: 10, conf_cap: 30, portfolio_cap: 100 }],
    bot_watchlist: [watch()],
    bot_strategies: [strat(1, "Default", "blend"), strat(5, "Shrunk", "shrunk")],
    games: [{ id: "G1", season: 2026, week: 9, home_team: "Colorado", away_team: "Kansas State", neutral_site: false, start_date: kickoff, home_conference: "Big 12", away_conference: "Big 12" }],
    bot_runs: [], bot_orders: [], bot_fills: [], bot_snapshots: [], betting_lines: [], bot_plans: [],
  };
  vi.stubGlobal("fetch", pgStub(db).fetchStub);
});

describe("paper cycle", () => {
  it("the original book piles in when far from the market; the shrunk book does not; fills carry their context", async () => {
    const { runCycle } = await import("./paper");
    const t = await runCycle();
    expect(t.gameErrors).toBeUndefined();
    expect(t.games).toBe(1);

    const orig = db.bot_fills.filter((f) => f.strategy_id === 1);
    const shrunk = db.bot_fills.filter((f) => f.strategy_id === 5);
    expect(orig.length).toBeGreaterThan(5);
    expect(shrunk.length).toBe(0);

    // The shrunk strategy only rests quotes (its edge is too small to take).
    const sq = db.bot_orders.filter((o) => o.strategy_id === 5);
    expect(sq.length).toBeGreaterThan(0);
    expect(sq.every((o) => o.kind === "quote" && o.status === "resting")).toBe(true);

    const f = orig[0];
    expect(f.ycpr_at_fill).toBeCloseTo(-7.6, 6);
    expect(Math.abs(f.market_at_fill)).toBeLessThan(0.6); // the PM median of the one fake venue
    expect(f.shrunk_at_fill).toBeCloseTo(f.market_at_fill - 0.55, 1); // market + 0.1 · min(7.6, 5.5)
    expect(f.hours_to_kickoff).toBeGreaterThan(47);
    expect(f.is_maker).toBe(false);

    // The first sync stamps the original YC line and it is not touched again.
    expect(db.bot_watchlist[0].ycpr_original).toBe(-7.6);
    expect(db.bot_watchlist[0].ycpr_home_margin).toBe(-7.6);
  });

  it("a game's own beta changes the shrunk fair value", async () => {
    db.bot_watchlist[0].beta = 1; // trust the capped gap fully: fair = market − 5.5
    const { runCycle } = await import("./paper");
    await runCycle();
    expect(db.bot_fills.filter((f) => f.strategy_id === 5).length).toBeGreaterThan(5);
    expect(db.bot_fills.find((f) => f.strategy_id === 5)!.shrunk_at_fill).toBeLessThan(-4);
  });
});

describe("target-position book", () => {
  const target = (): Row => ({ ...strat(6, "Target", "shrunk"), method: "target", per_rung_cap: 3, take_edge: 0.005 });
  const mine = () => db.bot_fills.filter((f) => f.strategy_id === 6);
  const net = (fills: Row[]) => {
    const m = new Map<string, Row>();
    for (const f of fills) {
      const p = m.get(f.ticker) ?? { ticker: f.ticker, side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
      const d = f.action === "buy" ? f.count : -f.count;
      p.yes += d;
      p.cost += d * Number(f.price) + Number(f.fee);
      m.set(f.ticker, p);
    }
    return [...m.values()];
  };
  const worst = (fills: Row[]) => {
    const pos = net(fills);
    let w = Infinity;
    for (let h = -60; h <= 60; h++) {
      if (!h) continue;
      w = Math.min(w, pos.reduce((s, p) => s + p.yes * ((p.side === "home" ? h : -h) > p.strike ? 1 : 0) - p.cost, 0));
    }
    return w;
  };

  it("opens where a venue's price is off the PM median, holds when nothing changes, and takes profit when the market comes to us", async () => {
    db.bot_strategies = [target()];
    mids.withNovig = true; // Kalshi at 0, Novig stale at +1.2: the PM median is +0.6
    const { runCycle } = await import("./paper");

    await runCycle();
    const first = mine();
    expect(first.length).toBeGreaterThan(3);
    expect(first.every((f) => f.venue === "novig")).toBe(true); // Kalshi's taker fee eats the edge there
    expect(first.every((f) => f.ticker.startsWith("NV-"))).toBe(true);
    expect(worst(first)).toBeGreaterThanOrEqual(-10 - 1e-6);
    const orders = db.bot_orders.filter((o) => o.strategy_id === 6);
    expect(orders.every((o) => o.kind === "take" && o.direction === "pro")).toBe(true);
    expect(db.bot_orders.filter((o) => o.strategy_id === 6 && o.status === "resting")).toEqual([]); // never rests a quote
    expect(first[0].ycpr_at_fill).toBeCloseTo(-7.6, 6);
    expect(first[0].is_maker).toBe(false);

    const plan = db.bot_plans.find((p) => p.game_id === "G1" && p.strategy_id === 6)!;
    expect(plan.plan.lean).toBe("away");
    expect(plan.plan.worstAfter).toBeGreaterThanOrEqual(-10 - 1e-6);
    expect(plan.plan.curveAfter.length).toBe(81);

    // Same market again: the position is already at its target, so nothing more is bought (no pileup).
    await runCycle();
    expect(mine().length).toBe(first.length);

    // The market itself moves to our number on both venues: the edge is gone, the target is zero, and the position is bought back
    // (it was sold high, so this realizes the move) without any exit level having been set.
    mids.kalshi = -7.6;
    mids.novig = -7.6;
    await runCycle();
    const later = mine().slice(first.length);
    expect(later.length).toBeGreaterThan(0);
    expect(db.bot_orders.filter((o) => o.strategy_id === 6).slice(first.length).every((o) => o.direction === "anti")).toBe(true);
  });

  it("stops when the game's loss room is used up by other games' risk", async () => {
    db.bot_strategies = [target()];
    db.bot_state[0].portfolio_cap = 0; // no room anywhere
    mids.withNovig = true;
    const { runCycle } = await import("./paper");
    await runCycle();
    expect(mine().length).toBe(0);
  });
});

describe("games added by the weekly workflow (legacy = false)", () => {
  it("are traded only by the rebuilt books; the Board and the original strategies skip them", async () => {
    db.bot_watchlist[0].legacy = false;
    db.bot_strategies = [strat(1, "Default", "blend"), strat(5, "Shrunk", "shrunk"), { ...strat(6, "Target", "shrunk"), method: "target", per_rung_cap: 3, take_edge: 0.005 }];
    mids.withNovig = true;
    mids.kalshi = 0;
    mids.novig = 1.2;
    mids.kalshi = 0;
    const { runCycle } = await import("./paper");
    await runCycle();
    expect(db.bot_fills.filter((f) => f.strategy_id == null || f.strategy_id === 1)).toEqual([]);
    expect(db.bot_orders.filter((o) => o.strategy_id == null || o.strategy_id === 1)).toEqual([]);
    expect(db.bot_fills.filter((f) => f.strategy_id === 6).length).toBeGreaterThan(0);
  });

  it("keep trading on the original books when legacy is left on", async () => {
    db.bot_strategies = [strat(1, "Default", "blend")];
    const { runCycle } = await import("./paper");
    await runCycle();
    expect(db.bot_fills.filter((f) => f.strategy_id == null).length).toBeGreaterThan(0);
    expect(db.bot_fills.filter((f) => f.strategy_id === 1).length).toBeGreaterThan(0);
  });
});

describe("Polymarket modes", () => {
  const target = (): Row => ({ ...strat(6, "Target", "shrunk"), method: "target", per_rung_cap: 3, take_edge: 0.005 });
  const setup = (mode: string) => {
    db.bot_strategies = [target()];
    db.bot_state[0].polymarket_mode = mode;
    db.bot_watchlist[0].venues = ["kalshi", "novig", "prophetx", "polymarket"];
    mids.withNovig = true;
    mids.withPoly = true; // Kalshi 0, Novig +1.2, Polymarket priced a stale +6
  };

  it("read-only (the default): recorded and shown, but out of the PM median and never traded", async () => {
    setup("read");
    const { runCycle } = await import("./paper");
    await runCycle();
    const w = db.bot_watchlist[0];
    expect(w.ro_margins.polymarket).toBeGreaterThan(4);
    expect(Object.keys(w.venue_margins).sort()).toEqual(["kalshi", "novig"]);
    expect(db.bot_fills.some((f) => String(f.ticker).startsWith("PM-"))).toBe(false);
    const plan = db.bot_plans.find((p) => p.strategy_id === 6)!;
    expect(plan.plan.pmMedian).toBeLessThan(1); // the median of Kalshi 0 and Novig 1.2, not dragged up by the +6
  });

  it("paper: part of the PM median and paper-traded like the other venues", async () => {
    setup("paper");
    const { runCycle } = await import("./paper");
    await runCycle();
    const w = db.bot_watchlist[0];
    expect(Object.keys(w.venue_margins).sort()).toEqual(["kalshi", "novig", "polymarket"]);
    expect(w.ro_margins).toEqual({});
    const plan = db.bot_plans.find((p) => p.strategy_id === 6)!;
    expect(plan.plan.pmMedian).toBeGreaterThan(1); // the median of 0, 1.2 and 6
    expect(db.bot_fills.some((f) => f.strategy_id === 6 && String(f.ticker).startsWith("PM-"))).toBe(true);
  });

  it("off: not touched at all", async () => {
    setup("off");
    const { runCycle } = await import("./paper");
    await runCycle();
    expect(db.bot_watchlist[0].ro_margins).toEqual({});
    expect(Object.keys(db.bot_watchlist[0].venue_margins)).not.toContain("polymarket");
  });
});
