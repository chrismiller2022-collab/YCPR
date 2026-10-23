import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { marginPmf } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { kalshiFee } from "../fairPrice/kalshi";
import { DEFAULT_LADDER_CONFIG, exposureSummary, impliedHomeMargin, ladderOrders, pnlByMargin, type LadderConfig, type Order, type Position, type Rung } from "./engine";
import { shapeBound, shapeLimits, solveShape, targetPositions, SHAPE_RANGE } from "./shape";
import { novigRungs, type NovigBook, type NovigMarket } from "../venues/novig";

// §21's example, Board, Air Force @ Wyoming: pick Air Force (away). Ours AF −11, market AF −6.3
// (home margins −11 and −6.3). Kalshi-style ladder on both teams, a 1–2¢ spread, long shots rich.
const OURS = -11;
const MARKET = -6.3;
const ours = marginPmf(OURS);
const mkt = marginPmf(MARKET);
const tick = (p: number) => Math.round(p * 100) / 100;
const kalshiStyle = (pmf = mkt): Rung[] =>
  [
    ...[1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 13.5, 14.5, 16.5, 17.5, 20.5, 21.5, 24.5, 27.5].map((k) => ({ ticker: `AF${k}`, side: "away" as const, strike: k })),
    ...[1.5, 3.5, 6.5, 9.5, 13.5].map((k) => ({ ticker: `WY${k}`, side: "home" as const, strike: k })),
  ].map((r) => {
    const p = kalshiSpreadYesProb(pmf, r.side, r.strike);
    const mid = p + (p < 0.2 ? 0.03 : 0); // favorite–long-shot bias
    return { ...r, bid: tick(Math.max(0.01, mid - 0.01)), ask: tick(Math.min(0.99, mid + 0.01)) };
  });
const rungs = kalshiStyle();
const CAP = 20;
const cfg: LadderConfig = { ...DEFAULT_LADDER_CONFIG, pick: "away", maxWorstCaseLoss: CAP, perRungCap: 3, shape: true };
const lim = shapeLimits(cfg);

/** Positions after every order fills at its price (fees included). */
function fillAll(start: Position[], orders: Order[], fee = kalshiFee): Position[] {
  const m = new Map(start.map((p) => [p.ticker, { ...p }]));
  for (const o of orders) {
    const p = m.get(o.ticker) ?? { ticker: o.ticker, yes: 0, cost: 0 };
    const d = o.action === "buy" ? o.count : -o.count;
    m.set(o.ticker, { ticker: o.ticker, yes: p.yes + d, cost: p.cost + d * o.price + fee(o.price, { count: o.count, maker: o.kind === "quote" }) });
  }
  return [...m.values()];
}
/** Positions at the target, bought/sold at the take prices the LP used (the conservative case). */
function atTargets(rs: Rung[], start: Position[], targets: Map<string, number>, fee = kalshiFee): Position[] {
  const held = new Map(start.map((p) => [p.ticker, p]));
  const orders = rs.flatMap((r): Order[] => {
    const d = (targets.get(r.ticker) ?? 0) - (held.get(r.ticker)?.yes ?? 0);
    if (Math.abs(d) < 1e-9) return [];
    return [{ ticker: r.ticker, action: d > 0 ? "buy" : "sell", price: d > 0 ? r.ask! : r.bid!, count: Math.abs(d), kind: "take", direction: "pro", fair: 0, reason: "" }];
  });
  return fillAll(start, orders, fee);
}
const pickPnl = (rs: Rung[], pos: Position[]) => {
  const curve = pnlByMargin(rs, pos);
  return (x: number) => curve[-x + 80]; // pick = away: pick margin x = −home margin
};
function checkRules(rs: Rung[], pos: Position[], M = MARKET, l = lim) {
  const at = pickPnl(rs, pos);
  for (let x = -SHAPE_RANGE; x <= SHAPE_RANGE; x++) if (x !== 0) expect(at(x)).toBeGreaterThanOrEqual(shapeBound(x, -M, l) - 1e-9);
}

describe("shaped positions: Air Force @ Wyoming (Kalshi-style ladder)", () => {
  const targets = targetPositions(rungs, [], ours, MARKET, cfg);
  const pos = atTargets(rungs, [], targets);
  const at = pickPnl(rungs, pos);

  it("recovers the market line from the fixture", () => {
    expect(impliedHomeMargin(rungs)).toBeCloseTo(MARKET, 0);
  });

  it("meets every payoff rule on the resulting curve", () => {
    expect([...targets.values()].some((v) => v !== 0)).toBe(true);
    checkRules(rungs, pos);
  });

  it("has positive expected value under our number", () => {
    expect(exposureSummary(pnlByMargin(rungs, pos), ours).expected).toBeGreaterThan(0);
  });

  it("makes at least the floor from the market line up, and more at our line", () => {
    expect(at(Math.ceil(-MARKET))).toBeGreaterThanOrEqual(lim.floor - 1e-9);
    expect(at(-OURS)).toBeGreaterThan(at(Math.ceil(-MARKET)) - 1e-9);
    expect(at(-OURS)).toBeGreaterThan(0);
  });

  it("keeps the worst case outside the blowout zone within the against limit", () => {
    for (let x = -lim.blowout + 1; x <= SHAPE_RANGE; x++) if (x !== 0) expect(at(x)).toBeGreaterThanOrEqual(-lim.against - 1e-9);
    for (let x = -SHAPE_RANGE; x <= -lim.blowout; x++) expect(at(x)).toBeGreaterThanOrEqual(-CAP - 1e-9);
  });

  it("holds rungs that pay from the market line up, little or nothing on far-tail rungs priced under 20¢", () => {
    // AF contracts that pay at the market outcome (AF wins by 7 = ⌈M⌉).
    const payAtMarket = rungs.filter((r) => r.side === "away" && r.strike < Math.ceil(-MARKET)).reduce((s, r) => s + Math.max(0, targets.get(r.ticker) ?? 0), 0);
    const tail = rungs.filter((r) => r.side === "away" && r.ask! < 0.2).reduce((s, r) => s + Math.max(0, targets.get(r.ticker) ?? 0), 0);
    expect(payAtMarket).toBeGreaterThan(0);
    expect(tail).toBeLessThan(payAtMarket);
  });

  it("ladderOrders with shape on: every order filling keeps the rules (quotes at or better than the take price)", () => {
    const { orders } = ladderOrders(rungs, [], ours, cfg, { marketHomeMargin: MARKET });
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      const r = rungs.find((x) => x.ticker === o.ticker)!;
      if (o.kind === "quote") {
        if (o.action === "buy") expect(o.price).toBeLessThan(r.ask!);
        else expect(o.price).toBeGreaterThan(r.bid!);
      }
    }
    checkRules(rungs, fillAll([], orders));
    expect(exposureSummary(pnlByMargin(rungs, fillAll([], orders)), ours).worst).toBeGreaterThanOrEqual(-CAP - 1e-9);
  });

  it("shape off keeps the old rung-by-rung behavior", () => {
    const off = ladderOrders(rungs, [], ours, { ...cfg, shape: false }).orders;
    const plain = ladderOrders(rungs, [], ours, { ...DEFAULT_LADDER_CONFIG, pick: "away", maxWorstCaseLoss: CAP, perRungCap: 3 }).orders;
    expect(off).toEqual(plain);
  });

  it("a higher market floor makes more at the market line", () => {
    const f2 = { ...cfg, marketFloor: 2 };
    const r2 = solveShape(rungs, [], ours, MARKET, f2);
    const p2 = atTargets(rungs, [], r2.targets);
    if (r2.mode === "shaped") {
      checkRules(rungs, p2, MARKET, shapeLimits(f2));
      expect(pickPnl(rungs, p2)(Math.ceil(-MARKET))).toBeGreaterThanOrEqual(2 - 1e-9);
    } else expect(r2.floor).toBeLessThan(2);
  });

  it("counts positions on other venues toward the rules (cross-venue)", () => {
    // Already long AF over 6.5 ×5 elsewhere, bought at the ask: the shape here should need less of it.
    const elsewhere = pnlByMargin(rungs, [{ ticker: "AF6.5", yes: 5, cost: 5 * rungs.find((r) => r.ticker === "AF6.5")!.ask! }]);
    const t2 = targetPositions(rungs, [], ours, MARKET, cfg, elsewhere);
    const here = atTargets(rungs, [], t2);
    const combined = pnlByMargin(rungs, here).map((v, i) => v + elsewhere[i]);
    for (let x = -SHAPE_RANGE; x <= SHAPE_RANGE; x++) if (x !== 0) expect(combined[-x + 80]).toBeGreaterThanOrEqual(shapeBound(x, -MARKET, lim) - 1e-9);
  });
});

describe("shaped positions: infeasible start (the staircase)", () => {
  // §21's staircase: one AF contract on every rung from AF +13.5 to AF −20.5, bought before the line
  // moved away from us (each 15¢ worse than today's price), so the against band is already broken and
  // unwinding at today's bids can't repair it.
  const stair: Position[] = rungs
    .filter((r) => r.side === "away")
    .map((r) => ({ ticker: r.ticker, yes: 1, cost: Math.min(0.99, r.ask! + 0.15) }))
    .concat(rungs.filter((r) => r.side === "home").map((r) => ({ ticker: r.ticker, yes: -1, cost: -Math.max(0.01, r.bid! - 0.15) })));
  const cfgS = { ...cfg, maxWorstCaseLoss: 40, perRungCap: 1 };

  it("really is infeasible: the held curve breaks the against band", () => {
    const at = pickPnl(rungs, stair);
    expect(at(-3)).toBeLessThan(-shapeLimits(cfgS).against);
    expect(solveShape(rungs, stair, ours, MARKET, cfgS).mode).toBe("reduce");
  });

  it("only produces risk-reducing orders, and never makes the worst broken rule worse", () => {
    const { orders } = ladderOrders(rungs, stair, ours, cfgS, { marketHomeMargin: MARKET });
    expect(orders.length).toBeGreaterThan(0);
    const held = new Map(stair.map((p) => [p.ticker, p.yes]));
    for (const o of orders) {
      const h = held.get(o.ticker) ?? 0;
      // Every order shrinks |position| on its rung (sell back what's long, buy back what's short), never past flat.
      expect(o.action === "sell" ? h : -h).toBeGreaterThanOrEqual(o.count);
      expect(o.direction).toBe("anti");
    }
    const l = { ...shapeLimits(cfgS), floor: -shapeLimits(cfgS).against };
    const worstSlack = (pos: Position[]) => {
      const at = pickPnl(rungs, pos);
      let m = Infinity;
      for (let x = -SHAPE_RANGE; x <= SHAPE_RANGE; x++) if (x !== 0) m = Math.min(m, at(x) - shapeBound(x, -MARKET, l));
      return m;
    };
    expect(worstSlack(fillAll(stair, orders))).toBeGreaterThanOrEqual(worstSlack(stair) - 1e-9);
  });
});

describe("shaped positions: Novig fixture (0.5¢ tick, no pre-game fee)", () => {
  // Real Novig snapshot: Miami (OH) @ Central Michigan, every rung on the home team's side.
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL("../venues/fixtures/novig-cmu.json", import.meta.url)), "utf8")) as { markets: NovigMarket[]; books: Record<string, NovigBook> };
  const { rungs: nv } = novigRungs(fx.markets, new Map(Object.entries(fx.books)), true);
  const M = impliedHomeMargin(nv)!;
  const fee = () => 0;
  // Pick Miami (away), ours 4 points better for Miami than the market.
  const c: LadderConfig = { ...DEFAULT_LADDER_CONFIG, pick: "away", maxWorstCaseLoss: 10, perRungCap: 10, tick: 0.005, fee, shape: true };
  const pmf = marginPmf(M - 4);

  it("meets every rule with positive EV, and quotes on the 0.5¢ grid", () => {
    const r = solveShape(nv, [], pmf, M, c);
    const pos = atTargets(nv, [], r.targets, fee);
    const l = { ...shapeLimits(c), floor: r.floor };
    expect(r.mode).not.toBe("reduce");
    checkRules(nv, pos, M, l);
    expect(exposureSummary(pnlByMargin(nv, pos), pmf).expected).toBeGreaterThan(0);
    const { orders } = ladderOrders(nv, [], pmf, c, { marketHomeMargin: M });
    for (const o of orders) expect(Math.abs(o.price * 200 - Math.round(o.price * 200))).toBeLessThan(1e-6);
  });
});
