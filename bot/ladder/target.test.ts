import { describe, expect, it } from "vitest";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { marginPmf } from "../fairPrice/marginDistribution";
import { modelWith } from "../fairPrice/shrink";
import { kalshiFeeWith } from "../venues/fees";
import { backedSide, DEFAULT_TARGET, gameRoom, targetOrders, worstLoss, type Held, type TargetConfig, type TargetOrder, type VenueBook } from "./target";
import type { FeeFn, Rung } from "./engine";

const free: FeeFn = () => 0;
const kalshi = kalshiFeeWith("quadratic_with_maker_fees", 1);

/** A ladder priced around `mid` (home margin), bid/ask `half` either side, both teams' rungs, strikes up to `max`. */
function ladder(venue: string, tag: string, mid: number, half = 0.005, max = 24.5, fee = free): VenueBook {
  const pmf = marginPmf(mid, modelWith(15));
  const rungs: Rung[] = [];
  for (let k = 0.5; k <= max; k += 1)
    for (const side of ["home", "away"] as const) {
      const p = kalshiSpreadYesProb(pmf, side, k);
      if (p < 0.03 || p > 0.97) continue;
      rungs.push({ ticker: `${tag}-${side[0]}${k}`, side, strike: k, bid: Math.round((p - half) * 1000) / 1000, ask: Math.round((p + half) * 1000) / 1000 });
    }
  return { venue, rungs, fee };
}

const fairPmf = (mean: number) => marginPmf(mean, modelWith(15));
const cfg = (over: Partial<TargetConfig> = {}): TargetConfig => ({ ...DEFAULT_TARGET, bankroll: 4000, kellyFrac: 0.25, takeEdge: 0.005, gameCap: 10, ...over });

/** Apply orders as fills to a position list (what the runner does after a cycle). */
function fill(held: Held[], orders: TargetOrder[], books: VenueBook[]): Held[] {
  const meta = new Map(books.flatMap((b) => b.rungs.map((r) => [r.ticker, { r, fee: b.fee }] as const)));
  const m = new Map(held.map((h) => [h.ticker, { ...h }]));
  for (const o of orders) {
    const { r, fee } = meta.get(o.ticker)!;
    const h = m.get(o.ticker) ?? { venue: o.venue, ticker: o.ticker, side: r.side, strike: r.strike, yes: 0, cost: 0 };
    const d = o.action === "buy" ? o.count : -o.count;
    h.yes += d;
    h.cost += d * o.price + fee(o.price, { count: o.count });
    m.set(o.ticker, h);
  }
  return [...m.values()];
}

describe("target positions", () => {
  const M = 0;
  const books = [ladder("novig", "NV", M)];

  it("does nothing without an edge", () => {
    const { orders, plan } = targetOrders(books, [], fairPmf(M), 0, cfg());
    expect(orders).toEqual([]);
    expect(plan.lean).toBeNull();
  });

  it("opens a ramp toward the edge: only buys of the home side or sells of away rungs, only pro, inside the cap", () => {
    const { orders, plan } = targetOrders(books, [], fairPmf(M + 3), 3, cfg());
    expect(orders.length).toBeGreaterThan(3);
    expect(plan.lean).toBe("home");
    for (const o of orders) {
      expect(o.direction).toBe("pro");
      const home = o.ticker.includes("-h");
      expect(o.action).toBe(home ? "buy" : "sell"); // long C(x) either way
    }
    expect(plan.worstAfter).toBeGreaterThanOrEqual(-10 - 1e-6);
    expect(plan.expectedAfter).toBeGreaterThan(0);
    // The position is a ramp: the P&L curve rises with the home margin.
    const c = plan.curveAfter;
    expect(c[80 + 15]).toBeGreaterThan(c[80 - 15]);
  });

  it("an edge toward the away team mirrors it", () => {
    const { orders } = targetOrders(books, [], fairPmf(M - 3), -3, cfg());
    expect(orders.length).toBeGreaterThan(3);
    for (const o of orders) expect(o.action).toBe(o.ticker.includes("-a") ? "buy" : "sell");
  });

  it("sizes with the edge: twice the edge, about twice the contracts per strike", () => {
    const small = targetOrders(books, [], fairPmf(1.5), 1.5, cfg({ gameCap: 1000, bankroll: 800 }));
    const big = targetOrders(books, [], fairPmf(3), 3, cfg({ gameCap: 1000, bankroll: 800 }));
    expect(big.plan.slope / small.plan.slope).toBeCloseTo(2, 5);
    const perX = (o: TargetOrder[]) => o.reduce((m, x) => Math.max(m, x.count), 0);
    expect(perX(big.orders)).toBeGreaterThan(perX(small.orders));
  });

  it("respects the per-strike cap and the game cap", () => {
    const { orders, plan } = targetOrders(books, [], fairPmf(4), 4, cfg({ bankroll: 1e6, maxPerStrike: 2, gameCap: 3 }));
    expect(Math.max(...orders.map((o) => o.count))).toBeLessThanOrEqual(2);
    expect(plan.worstAfter).toBeGreaterThanOrEqual(-3 - 1e-6);
    expect(plan.scale).toBeLessThan(1);
  });

  it("stays out when fees eat the edge (Kalshi taker fee at 50¢ is 1.75¢)", () => {
    const k = [ladder("kalshi", "KX", M, 0.005, 24.5, kalshi)];
    const { orders, plan } = targetOrders(k, [], fairPmf(0.5), 0.5, cfg({ takeEdge: 0.005 }));
    expect(orders).toEqual([]);
    expect(plan.openable).toBe(0);
  });

  it("never pushes missing high-strike size onto lower strikes", () => {
    const few = [ladder("novig", "NV", M, 0.005, 3.5)]; // no strike above 3.5
    const all = targetOrders(books, [], fairPmf(3), 3, cfg({ bankroll: 1e5, gameCap: 1e4 }));
    const cut = targetOrders(few, [], fairPmf(3), 3, cfg({ bankroll: 1e5, gameCap: 1e4 }));
    const xs = (o: TargetOrder[]) => new Set(o.map((x) => x.x));
    expect(xs(cut.orders).size).toBeLessThan(xs(all.orders).size);
    const per = new Map<number, number>();
    for (const o of cut.orders) per.set(o.x, (per.get(o.x) ?? 0) + o.count);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(DEFAULT_TARGET.maxPerStrike);
  });

  it("holds the sum across venues: what one venue filled is not bought again on another", () => {
    const two = [ladder("novig", "NV", M), ladder("px", "PX", M)];
    const first = targetOrders(two, [], fairPmf(3), 3, cfg());
    const held = fill([], first.orders, two);
    const again = targetOrders(two, held, fairPmf(3), 3, cfg());
    expect(again.orders.filter((o) => o.direction === "pro")).toEqual([]);
  });

  it("routes each strike to the cheaper venue after fees", () => {
    const cheap = ladder("novig", "NV", M, 0.005, 24.5, free);
    const dear = ladder("kalshi", "KX", M, 0.005, 24.5, kalshi);
    const { orders } = targetOrders([dear, cheap], [], fairPmf(3), 3, cfg());
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.venue === "novig")).toBe(true);
  });

  it("takes profit by itself: when the market comes to us the edge is gone and the position is sold", () => {
    const first = targetOrders(books, [], fairPmf(3), 3, cfg());
    const held = fill([], first.orders, books);
    expect(held.length).toBeGreaterThan(0);
    // The market moves 3 points toward our number; prices now sit at the fair value.
    const moved = [ladder("novig", "NV", 3)];
    const out = targetOrders(moved, held, fairPmf(3), 0, cfg());
    const sells = out.orders.filter((o) => o.direction === "anti");
    expect(sells.length).toBeGreaterThan(0);
    expect(out.orders.every((o) => o.direction === "anti")).toBe(true);
    const after = fill(held, out.orders, moved);
    expect(after.reduce((s, h) => s + Math.abs(h.yes), 0)).toBeLessThan(held.reduce((s, h) => s + Math.abs(h.yes), 0));
  });

  it("does not dump a position at a bad price just because the edge shrank", () => {
    const first = targetOrders(books, [], fairPmf(3), 3, cfg());
    const held = fill([], first.orders, books);
    // Our edge is smaller now but bids are 4¢ under fair: the exit would give up more than the slack.
    const wide = [ladder("novig", "NV", M, 0.04)];
    const out = targetOrders(wide, held, fairPmf(0.2), 0.2, cfg());
    expect(out.orders.filter((o) => o.direction === "anti" && !o.forced)).toEqual([]);
  });

  it("cuts a position that is already over the cap, risk-reducing trades only", () => {
    const big = targetOrders(books, [], fairPmf(4), 4, cfg({ bankroll: 1e6, gameCap: 30, maxPerStrike: 5 }));
    const held = fill([], big.orders, books);
    const before = worstLoss(held);
    expect(before).toBeGreaterThan(8);
    const out = targetOrders(books, held, fairPmf(4), 4, cfg({ bankroll: 1e6, gameCap: 5 }));
    expect(out.orders.length).toBeGreaterThan(0);
    expect(out.orders.every((o) => o.direction === "anti")).toBe(true);
    expect(out.plan.worstAfter).toBeGreaterThan(out.plan.worstBefore);
  });
});

describe("caps shared across games", () => {
  it("room is the tightest of the strategy cap, portfolio, team and conference room", () => {
    const others = [
      { worst: 4, team: "Texas", conf: "Big 12" },
      { worst: 3, team: "Kansas", conf: "Big 12" },
      { worst: 2, team: "Ohio State", conf: "Big Ten" },
    ];
    const caps = { portfolio: 12, team: 6, conf: 8 };
    expect(gameRoom(10, others, { team: "Texas", conf: "SEC" }, caps)).toBe(2); // team: 6 − 4
    expect(gameRoom(10, others, { team: "Texas", conf: "Big 12" }, caps)).toBe(1); // conference binds first: 8 − 7
    expect(gameRoom(10, others, { team: "Baylor", conf: "Big 12" }, caps)).toBe(1); // conference: 8 − 7
    expect(gameRoom(10, others, { team: "Baylor", conf: "SEC" }, caps)).toBe(3); // portfolio: 12 − 9
    expect(gameRoom(2, others, { team: "Baylor", conf: "SEC" }, caps)).toBe(2); // the strategy's own cap
    expect(gameRoom(10, [{ worst: 20, team: null, conf: null }], { team: null, conf: null }, caps)).toBe(0);
  });

  it("the backed side follows the position", () => {
    const books = [ladder("novig", "NV", 0)];
    const home = fill([], targetOrders(books, [], fairPmf(3), 3, cfg()).orders, books);
    const away = fill([], targetOrders(books, [], fairPmf(-3), -3, cfg()).orders, books);
    expect(backedSide(home)).toBe("home");
    expect(backedSide(away)).toBe("away");
    expect(backedSide([])).toBeNull();
  });
});
