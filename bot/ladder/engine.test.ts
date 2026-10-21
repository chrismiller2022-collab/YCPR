import { describe, expect, it } from "vitest";
import { marginPmf } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import {
  DEFAULT_LADDER_CONFIG,
  blendedHomeMargin,
  exposureSummary,
  impliedHomeMargin,
  ladderOrders,
  pnlByMargin,
  proExposure,
  type LadderConfig,
  type Position,
  type Rung,
} from "./engine";

// Handoff §14 example: Team B at home. Chris has B −4.3 (home margin 4.3); the market has B −6.5.
const mine = marginPmf(4.3);
const market = marginPmf(6.5);
const rungs: Rung[] = [
  ...[1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 9.5, 10.5, 13.5].map((k) => ({ ticker: `B${k}`, side: "home" as const, strike: k })),
  ...[1.5, 3.5, 6.5].map((k) => ({ ticker: `A${k}`, side: "away" as const, strike: k })),
].map((r) => {
  const mid = kalshiSpreadYesProb(market, r.side, r.strike);
  return { ...r, bid: Math.round((mid - 0.01) * 100) / 100, ask: Math.round((mid + 0.01) * 100) / 100 };
});
const cfg: LadderConfig = { ...DEFAULT_LADDER_CONFIG, pick: "away" }; // lean Team A
const byTicker = (t: string) => rungs.find((r) => r.ticker === t)!;
const fill = (orders: ReturnType<typeof ladderOrders>["orders"]): Position[] => {
  const m = new Map<string, Position>();
  for (const o of orders) {
    const p = m.get(o.ticker) ?? { ticker: o.ticker, yes: 0, cost: 0 };
    const d = o.action === "buy" ? o.count : -o.count;
    m.set(o.ticker, { ticker: o.ticker, yes: p.yes + d, cost: p.cost + d * o.price });
  }
  return [...m.values()];
};

describe("fair price inputs", () => {
  it("recovers the market's margin from its ladder", () => {
    expect(impliedHomeMargin(rungs)).toBeCloseTo(6.5, 0);
  });

  it("blends YCPR early in the week and fades it to the market by kickoff", () => {
    const week = blendedHomeMargin({ ycpr: 4.3, kalshi: 6.5, book: 6.5, hoursToKickoff: 144 })!;
    expect(week).toBeCloseTo(0.35 * 4.3 + 0.65 * 6.5, 6);
    expect(blendedHomeMargin({ ycpr: 4.3, kalshi: 6.5, book: 6.5, hoursToKickoff: 0 })).toBeCloseTo(6.5, 6);
    expect(blendedHomeMargin({ ycpr: 4.3, kalshi: null, book: 7, hoursToKickoff: 0 })).toBeCloseTo(7, 6);
    expect(blendedHomeMargin({ ycpr: 4.3, kalshi: null, book: null, hoursToKickoff: 50 })).toBe(4.3);
    // Trading our number outright: no fade, any time before kickoff.
    expect(blendedHomeMargin({ ycpr: 4.3, kalshi: 6.5, book: 6.5, hoursToKickoff: 1 }, { ycprWeight: 1, fade: false })).toBeCloseTo(4.3, 6);
    expect(blendedHomeMargin({ ycpr: 4.3, kalshi: 6.5, book: 6.5, hoursToKickoff: 1 }, { ycprWeight: 0.5, fade: false })).toBeCloseTo(5.4, 6);
  });
});

describe("exposure", () => {
  it("scores a middle: A +7.5 (short B over 7.5) plus B −4.5 (long B over 4.5) wins both on B by 5–7", () => {
    const pos: Position[] = [
      { ticker: "B7.5", yes: -1, cost: -0.43 },
      { ticker: "B4.5", yes: 1, cost: 0.53 },
    ];
    const pnl = pnlByMargin(rungs, pos);
    const at = (m: number) => pnl[m + 80];
    for (const m of [5, 6, 7]) expect(at(m)).toBeCloseTo(1 + 0.43 - 0.53, 10);
    for (const m of [3, 8, 20, -10]) expect(at(m)).toBeCloseTo(0.43 - 0.53, 10);
    expect(exposureSummary(pnl, mine).worst).toBeCloseTo(-0.1, 10);
  });

  it("counts pro-pick exposure from both ladders", () => {
    expect(proExposure(rungs, [{ ticker: "B6.5", yes: -2, cost: -1 }, { ticker: "A3.5", yes: 1, cost: 0.3 }], "away")).toBe(3);
  });
});

describe("ladderOrders", () => {
  it("leans Team A on every rung and never fades the pick from a flat start", () => {
    const { orders } = ladderOrders(rungs, [], mine, cfg);
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(o.direction).toBe("pro");
      const r = byTicker(o.ticker);
      // Backing A = sell YES on "B wins by over X", buy YES on "A wins by over X".
      expect(o.action).toBe(r.side === "home" ? "sell" : "buy");
    }
  });

  it("counts fees toward the loss cap", () => {
    // Fill every order at its price plus the taker fee; the worst case must still respect the cap.
    const { orders } = ladderOrders(rungs, [], mine, { ...cfg, maxWorstCaseLoss: 3, perRungCap: 5, takeEdge: 0 });
    const withFees = fill(orders).map((p) => ({ ...p, cost: p.cost + orders.filter((o) => o.ticker === p.ticker).reduce((s, o) => s + 0.07 * o.count * o.price * (1 - o.price), 0) }));
    expect(exposureSummary(pnlByMargin(rungs, withFees), mine).worst).toBeGreaterThanOrEqual(-3 - 1e-9);
  });

  it("keeps the worst case within the cap even if every order fills", () => {
    for (const cap of [5, 1, 0.5]) {
      const { orders } = ladderOrders(rungs, [], mine, { ...cfg, maxWorstCaseLoss: cap, perRungCap: 5 });
      expect(exposureSummary(pnlByMargin(rungs, fill(orders)), mine).worst).toBeGreaterThanOrEqual(-cap - 1e-9);
    }
  });

  it("spends a tight loss budget on the middle of the ladder, not the tails", () => {
    const { orders } = ladderOrders(rungs, [], mine, { ...cfg, maxWorstCaseLoss: 1.2 });
    const dist = orders.map((o) => Math.abs(o.fair - 0.5));
    expect(orders.length).toBeGreaterThan(0);
    // Placed in order of closeness to 50¢, starting with the closest rung on the ladder.
    expect(dist).toEqual([...dist].sort((a, b) => a - b));
    const closest = Math.min(...rungs.map((r) => Math.abs(kalshiSpreadYesProb(mine, r.side, r.strike) - 0.5)));
    expect(dist[0]).toBeCloseTo(closest, 10);
    // The far tail (B over 13.5, fair ≈ 27¢) gets nothing when the budget is this tight.
    expect(orders.some((o) => o.ticker === "B13.5")).toBe(false);
  });

  it("resting quotes never cross the book; takes only when edge clears the taker fee", () => {
    const { orders } = ladderOrders(rungs, [], mine, cfg);
    for (const o of orders) {
      const r = byTicker(o.ticker);
      if (o.kind === "quote") {
        if (o.action === "buy") expect(o.price).toBeLessThan(r.ask!);
        else expect(o.price).toBeGreaterThan(r.bid!);
      } else {
        expect(o.action === "buy" ? o.fair - o.price : o.price - o.fair).toBeGreaterThan(cfg.takeEdge);
      }
    }
  });

  it("demands more edge per contract already held (adding into an adverse move)", () => {
    const roomy = { ...cfg, takeEdge: 1, perRungCap: 3, maxWorstCaseLoss: 50, edgeStep: 0.1 };
    const flat = ladderOrders(rungs, [], mine, roomy).orders.find((o) => o.ticker === "B13.5")!;
    const loaded = ladderOrders(rungs, [{ ticker: "B6.5", yes: -1, cost: -0.5 }], mine, roomy).orders.find(
      (o) => o.ticker === "B13.5" && o.direction === "pro"
    )!;
    expect(loaded.price).toBeGreaterThan(flat.price); // selling YES higher = more edge required
  });

  it("stops adding once the game's profit target is hit, but still exits", () => {
    const pos: Position[] = [{ ticker: "B6.5", yes: -1, cost: -0.9 }]; // sold B over 6.5 at 90¢: big open gain
    const { orders, notes } = ladderOrders(rungs, pos, mine, { ...cfg, profitTarget: 0.2 });
    expect(notes.join(" ")).toMatch(/profit target/);
    expect(orders.every((o) => o.direction === "anti")).toBe(true);
    expect(orders.some((o) => o.ticker === "B6.5" && o.action === "buy")).toBe(true);
  });

  it("sells back held exposure only at a wide edge, and allows a middle while still net long A", () => {
    const pos: Position[] = [{ ticker: "B7.5", yes: -1, cost: -0.43 }]; // holding A +7.5
    const { orders } = ladderOrders(rungs, pos, mine, { ...cfg, perRungCap: 2, maxWorstCaseLoss: 10 });
    const anti = orders.filter((o) => o.direction === "anti");
    expect(anti.length).toBeGreaterThan(0);
    for (const o of anti) expect(o.fair - o.price).toBeGreaterThanOrEqual(cfg.antiEdge); // buying YES (backing B) well below fair
    // Budget: one anti-pick contract total while we hold one pro-pick contract.
    expect(anti.reduce((s, o) => s + o.count, 0)).toBeGreaterThanOrEqual(1);
  });
});
