// Shaped positions (docs/kalshi-bot-handoff.md §21): instead of buying every
// rung that looks cheap by our number (a staircase that only pays past the
// market line), solve for the whole position at once so the P&L curve has
// the shape the user asked for:
//   1. market floor:  P&L ≥ marketFloor        for pick margin ≥ ⌈M⌉
//   2. against band:  P&L ≥ −againstLimit       for −blowout < pick margin < ⌈M⌉
//   3. blowout:       P&L ≥ −maxWorstCaseLoss   for pick margin ≤ −blowout
// maximizing expected P&L under the trust-blended distribution. A small
// linear program over buys at the ask and sells at the bid on every rung.
// Pure functions, like engine.ts.

import solver from "javascript-lp-solver";
import { kalshiFee } from "../fairPrice/kalshi";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { pmfMean, type MarginPmf } from "../fairPrice/marginDistribution";
import { exposureSummary, pnlByMargin, type FeeFn, type LadderConfig, type Order, type Position, type Rung } from "./engine";

/** Final margins the payoff rules are checked at (pick-oriented and home both span this; no ties). */
export const SHAPE_RANGE = 60;

export const DEFAULT_SHAPE = {
  /** Minimum P&L from the market line up, dollars. */
  marketFloor: 0,
  /** Share of the game cap allowed as a loss when the pick falls short by less than a blowout. */
  againstShare: 0.1,
  /** Pick losing by this many points or more is a blowout (only the game cap applies), points. */
  blowoutMargin: 10,
};

/** The three payoff rules, resolved to dollars (against_limit defaults to 10% of the game cap). */
export function shapeLimits(cfg: Pick<LadderConfig, "maxWorstCaseLoss" | "marketFloor" | "againstLimit" | "blowoutMargin">) {
  return {
    floor: cfg.marketFloor ?? DEFAULT_SHAPE.marketFloor,
    against: cfg.againstLimit ?? DEFAULT_SHAPE.againstShare * cfg.maxWorstCaseLoss,
    blowout: cfg.blowoutMargin ?? DEFAULT_SHAPE.blowoutMargin,
    cap: cfg.maxWorstCaseLoss,
  };
}

/** Minimum P&L allowed at pick margin x, with M the market's margin from the pick's side. */
export function shapeBound(x: number, marketPick: number, lim: { floor: number; against: number; blowout: number; cap: number }): number {
  if (x >= Math.ceil(marketPick - 1e-9)) return lim.floor;
  if (x <= -lim.blowout) return -lim.cap;
  return -lim.against;
}

export interface ShapeResult {
  /** Target net YES per ticker (every rung of the ladder; unchanged = hold). */
  targets: Map<string, number>;
  /** "shaped" = all rules met; "relaxed" = market floor lowered to `floor`; "reduce" = rules can't be met, only unwinds. */
  mode: "shaped" | "relaxed" | "reduce";
  floor: number;
}

interface Var {
  name: string;
  rung: Rung;
  i: number;
  /** +1 = buy at the ask, −1 = sell at the bid. */
  dir: 1 | -1;
  price: number;
  /** Linearized fee per contract (the LP's estimate; checks use the real fee). */
  fee: number;
  ub: number;
}

const covers = (r: Pick<Rung, "side" | "strike">, homeMargin: number) => (r.side === "home" ? homeMargin : -homeMargin) > r.strike;

/**
 * Target net YES per rung so the game's P&L curve meets the three payoff rules
 * (see the top of this file), maximizing expected P&L under `pmf`.
 * `M` = the market's implied HOME margin; positions on other venues enter through `otherPnl`
 * (index = home margin + pmf.maxMargin, like pnlByMargin).
 */
export function solveShape(rungs: Rung[], positions: Position[], pmf: MarginPmf, M: number, cfg: LadderConfig, otherPnl?: number[]): ShapeResult {
  const fee: FeeFn = cfg.fee ?? kalshiFee;
  const lim = shapeLimits(cfg);
  const marketPick = cfg.pick === "home" ? M : -M;
  const held = new Map(positions.map((p) => [p.ticker, p]));
  const hold = () => new Map(rungs.map((r) => [r.ticker, held.get(r.ticker)?.yes ?? 0]));

  // Fixed P&L by home margin: what's held here (incl. rungs no longer listed) plus the other venues.
  const R = SHAPE_RANGE;
  const fixedRungs = [...rungs, ...positions.filter((p) => !rungs.some((r) => r.ticker === p.ticker)).map((p) => ({ ticker: p.ticker, side: "home" as const, strike: Infinity }))];
  const fixedAll = pnlByMargin(fixedRungs, positions, pmf.maxMargin);
  const margins: number[] = [];
  for (let h = -R; h <= R; h++) if (h !== 0) margins.push(h);
  const fixed = (h: number) => fixedAll[h + pmf.maxMargin] + (otherPnl?.[h + pmf.maxMargin] ?? 0);
  const pickX = (h: number) => (cfg.pick === "home" ? h : -h);

  // Variables: buy at the ask / sell at the bid, bounded by the per-rung cap (never forced to cut a position already over it).
  const vars: Var[] = [];
  const caps = rungs.map((r) => {
    const h0 = held.get(r.ticker)?.yes ?? 0;
    return { lo: Math.min(-cfg.perRungCap, h0) - h0, hi: Math.max(cfg.perRungCap, h0) - h0 };
  });
  rungs.forEach((r, i) => {
    const span = caps[i].hi - caps[i].lo;
    if (r.ask != null && r.ask > 0 && r.ask < 1 && caps[i].hi > 0) vars.push({ name: `b${i}`, rung: r, i, dir: 1, price: r.ask, fee: fee(r.ask, { count: 100 }) / 100, ub: span });
    if (r.bid != null && r.bid > 0 && r.bid < 1 && caps[i].lo < 0) vars.push({ name: `s${i}`, rung: r, i, dir: -1, price: r.bid, fee: fee(r.bid, { count: 100 }) / 100, ub: span });
  });
  if (!vars.length) return { targets: hold(), mode: "reduce", floor: lim.floor };
  const fair = rungs.map((r) => kalshiSpreadYesProb(pmf, r.side, r.strike));
  const ev = (v: Var) => v.dir * (fair[v.i] - v.price) - v.fee;

  // One row per distinct coverage pattern (P&L only changes at strikes), keeping the tightest requirement.
  const rows = new Map<string, { h: number; need: number }>();
  const rowsFor = (floor: number) => {
    rows.clear();
    const l = { ...lim, floor };
    for (const h of margins) {
      const key = vars.map((v) => (covers(v.rung, h) ? 1 : 0)).join("");
      const need = shapeBound(pickX(h), marketPick, l) - fixed(h);
      const cur = rows.get(key);
      if (!cur || need > cur.need) rows.set(key, { h, need });
    }
    return [...rows.values()];
  };
  const coef = (v: Var, h: number) => v.dir * ((covers(v.rung, h) ? 1 : 0) - v.price) - v.fee;

  const solveLp = (floor: number, reduceOnly: boolean, shift = 0) => {
    const constraints: Record<string, { min?: number; max?: number }> = {};
    const variables: Record<string, Record<string, number>> = {};
    const rs = rowsFor(floor);
    rs.forEach((row, k) => (constraints[`r${k}`] = { min: row.need - shift }));
    caps.forEach((c, i) => (constraints[`n${i}`] = { min: c.lo, max: c.hi }));
    for (const v of vars) {
      const h0 = held.get(v.rung.ticker)?.yes ?? 0;
      // Unwind-only: buy back at most what's short, sell at most what's long.
      const ub = reduceOnly ? (v.dir === 1 ? Math.max(0, -h0) : Math.max(0, h0)) : v.ub;
      constraints[`u_${v.name}`] = { max: ub };
      const col: Record<string, number> = { ev: reduceOnly ? 1e-3 * ev(v) : ev(v), [`n${v.i}`]: v.dir, [`u_${v.name}`]: 1 };
      rs.forEach((row, k) => (col[`r${k}`] = coef(v, row.h)));
      variables[v.name] = col;
    }
    if (reduceOnly) {
      // Maximize the smallest slack: t' = t + shift ≥ 0, every row's P&L − bound ≥ t.
      variables.t = { ev: 1 };
      rs.forEach((_, k) => (variables.t[`r${k}`] = -1));
    }
    const out = solver.Solve({ optimize: "ev", opType: "max", constraints, variables });
    if (!out.feasible) return null;
    return vars.map((v) => Math.max(0, Math.min(Number(out[v.name] ?? 0), v.ub)));
  };

  // Exact check of a whole-contract plan with the venue's real fees: the smallest slack over the rows.
  const slack = (amounts: number[], floor: number) => {
    let cost = 0;
    vars.forEach((v, k) => {
      if (amounts[k] > 0) cost += v.dir * amounts[k] * v.price + fee(v.price, { count: amounts[k] });
    });
    let min = Infinity;
    for (const h of margins) {
      let p = fixed(h) - cost;
      vars.forEach((v, k) => {
        if (amounts[k] > 0 && covers(v.rung, h)) p += v.dir * amounts[k];
      });
      min = Math.min(min, p - shapeBound(pickX(h), marketPick, { ...lim, floor }));
    }
    return min;
  };
  const evOf = (amounts: number[]) => vars.reduce((s, v, k) => s + amounts[k] * ev(v), 0);
  const netOk = (amounts: number[]) =>
    caps.every((c, i) => {
      const n = vars.reduce((s, v, k) => s + (v.i === i ? v.dir * amounts[k] : 0), 0);
      return n >= c.lo - 1e-9 && n <= c.hi + 1e-9;
    });

  /** Floor to whole contracts, repair what rounding broke, then add back rounded-off contracts that still fit. */
  const integerize = (cont: number[], floor: number, need: number, reduceOnly: boolean) => {
    const amounts = cont.map((x) => Math.floor(x + 1e-6));
    const maxOf = (k: number) => Math.ceil(cont[k] - 1e-6);
    let s = slack(amounts, floor);
    while (s < need - 1e-9) {
      let best: { k: number; d: number; s: number; ev: number } | null = null;
      for (let k = 0; k < vars.length; k++)
        for (const d of [-1, 1]) {
          const n = amounts[k] + d;
          if (n < 0 || n > (reduceOnly ? maxOf(k) : vars[k].ub)) continue;
          amounts[k] = n;
          if (netOk(amounts)) {
            const s2 = slack(amounts, floor);
            const e2 = evOf(amounts);
            if (!best || s2 > best.s + 1e-12 || (Math.abs(s2 - best.s) <= 1e-12 && e2 > best.ev)) best = { k, d, s: s2, ev: e2 };
          }
          amounts[k] = n - d;
        }
      if (!best || best.s <= s + 1e-12) break;
      amounts[best.k] += best.d;
      s = best.s;
    }
    const order = vars.map((_, k) => k).filter((k) => cont[k] - amounts[k] > 1e-6).sort((a, b) => cont[b] - amounts[b] - (cont[a] - amounts[a]));
    for (const k of order) {
      if (amounts[k] >= maxOf(k)) continue;
      amounts[k]++;
      const s2 = netOk(amounts) ? slack(amounts, floor) : -Infinity;
      // Keep it if the rules still hold and it either adds value or widens the margin of safety.
      if (s2 >= Math.min(need, s) - 1e-9 && (ev(vars[k]) >= 0 || s2 > s + 1e-9)) s = s2;
      else amounts[k]--;
    }
    return { amounts, s };
  };
  const targetsOf = (amounts: number[]) => {
    const t = hold();
    vars.forEach((v, k) => t.set(v.rung.ticker, t.get(v.rung.ticker)! + v.dir * amounts[k]));
    return t;
  };

  // 1. The rules as set, then the market floor lowered stepwise to −against_limit.
  const floors = [lim.floor];
  if (lim.floor > -lim.against) for (let q = 1; q <= 4; q++) floors.push(lim.floor - ((lim.floor + lim.against) * q) / 4);
  for (const floor of floors) {
    const cont = solveLp(floor, false);
    if (!cont) continue;
    const { amounts, s } = integerize(cont, floor, 0, false);
    if (s < -1e-9) continue; // whole contracts couldn't keep the rules: try a lower floor
    return { targets: targetsOf(amounts), mode: floor === lim.floor ? "shaped" : "relaxed", floor };
  }

  // 2. Still infeasible (e.g. a staircase already breaks the against band): unwind only, improving the worst rule.
  const floor = floors[floors.length - 1];
  const zero = vars.map(() => 0);
  const now = slack(zero, floor);
  const shift = Math.max(0, -now) + 1;
  const cont = solveLp(floor, true, shift);
  if (!cont) return { targets: hold(), mode: "reduce", floor };
  const { amounts, s } = integerize(cont, floor, now, true);
  if (s <= now + 1e-9) return { targets: hold(), mode: "reduce", floor };
  return { targets: targetsOf(amounts), mode: "reduce", floor };
}

/** §21's entry point: target net YES per ticker. */
export function targetPositions(rungs: Rung[], positions: Position[], pmfFair: MarginPmf, M: number, cfg: LadderConfig, otherPnl?: number[]): Map<string, number> {
  return solveShape(rungs, positions, pmfFair, M, cfg, otherPnl).targets;
}

const floorTick = (p: number, t: number) => Math.round(Math.floor(p / t + 1e-9) * t * 1e6) / 1e6;
const ceilTick = (p: number, t: number) => Math.round(Math.ceil(p / t - 1e-9) * t * 1e6) / 1e6;

/**
 * Orders that move the held position toward the shaped targets. The LP is solved at take
 * prices; the difference is quoted post-only at better prices (a fill there only raises P&L
 * everywhere), taking only when `takeEdge` is met. Pro-pick orders are also held to the game
 * cap as if they all fill and nothing else does, like the plain ladder.
 */
export function shapedOrders(
  rungs: Rung[],
  positions: Position[],
  pmf: MarginPmf,
  cfg: LadderConfig,
  state: { realizedPnl?: number; otherPnl?: number[]; marketHomeMargin?: number | null; profitTargetHit?: boolean } = {}
): { orders: Order[]; notes: string[]; shape: ShapeResult } {
  const fee: FeeFn = cfg.fee ?? kalshiFee;
  const M = state.marketHomeMargin ?? pmfMean(pmf);
  const shape = solveShape(rungs, positions, pmf, M, cfg, state.otherPnl);
  const notes = [shape.mode === "shaped" ? "shaped" : shape.mode === "relaxed" ? `shaped, market floor relaxed to ${shape.floor.toFixed(2)}` : "shape rules broken: unwinds only"];
  if (state.profitTargetHit) notes.push("profit target hit: exits only");
  const held = new Map(positions.map((p) => [p.ticker, p]));
  const assumed = new Map(positions.map((p) => [p.ticker, { ...p }]));
  const withOther = (pnl: number[]) => (state.otherPnl ? pnl.map((v, i) => v + (state.otherPnl![i] ?? 0)) : pnl);
  const worstOf = (book: Map<string, Position>) => exposureSummary(withOther(pnlByMargin(rungs, [...book.values()], pmf.maxMargin)), pmf).worst;

  const wanted = rungs
    .map((r) => {
      const d = (shape.targets.get(r.ticker) ?? 0) - (held.get(r.ticker)?.yes ?? 0);
      const action: "buy" | "sell" = d > 0 ? "buy" : "sell";
      return { r, count: Math.round(Math.abs(d)), action, direction: (r.side === cfg.pick) === (action === "buy") ? ("pro" as const) : ("anti" as const) };
    })
    .filter((x) => x.count > 0 && !(state.profitTargetHit && x.direction === "pro"))
    // Unwinds and hedges first; pro-pick orders are then checked against the cap on top of what's held.
    .sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "anti" ? -1 : 1));

  const orders: Order[] = [];
  for (const { r, count, action, direction } of wanted) {
    const fair = kalshiSpreadYesProb(pmf, r.side, r.strike);
    const takePrice = action === "buy" ? r.ask : r.bid;
    let o: Order | null = null;
    if (takePrice != null) {
      const edge = action === "buy" ? fair - takePrice - fee(takePrice) : takePrice - fair - fee(takePrice);
      if (edge >= cfg.takeEdge) o = { ticker: r.ticker, action, price: takePrice, count, kind: "take", direction, fair, reason: `shape take: ${(edge * 100).toFixed(1)}¢ edge after fee` };
    }
    if (!o) {
      // Our usual edge from fair, but never behind the top of the book (the LP needs the fill) and never at or through the take price.
      const edge = direction === "pro" ? cfg.proEdge : cfg.antiEdge;
      let price = action === "buy" ? floorTick(fair - edge - fee(fair, { maker: true }), cfg.tick) : ceilTick(fair + edge + fee(fair, { maker: true }), cfg.tick);
      if (action === "buy") {
        if (r.bid != null) price = Math.max(price, r.bid + cfg.tick);
        if (r.ask != null) price = Math.min(price, r.ask - cfg.tick);
      } else {
        if (r.ask != null) price = Math.min(price, r.ask - cfg.tick);
        if (r.bid != null) price = Math.max(price, r.bid + cfg.tick);
      }
      price = Math.round(price * 1e6) / 1e6;
      if (price < cfg.tick || price > 1 - cfg.tick) continue;
      const vsFair = action === "buy" ? fair - price : price - fair;
      o = { ticker: r.ticker, action, price, count, kind: "quote", direction, fair, reason: `shape ${direction} quote, ${(vsFair * 100).toFixed(1)}¢ from fair` };
    }
    if (direction === "pro") {
      const cur = assumed.get(r.ticker) ?? { ticker: r.ticker, yes: 0, cost: 0 };
      const delta = action === "buy" ? count : -count;
      const next = new Map(assumed);
      next.set(r.ticker, { ticker: r.ticker, yes: cur.yes + delta, cost: cur.cost + delta * o.price + fee(o.price, { count }) });
      const before = worstOf(assumed);
      const after = worstOf(next);
      if (after < before - 1e-9 && after < -cfg.maxWorstCaseLoss) continue;
      assumed.set(r.ticker, next.get(r.ticker)!);
    }
    orders.push(o);
  }
  return { orders, notes, shape };
}
