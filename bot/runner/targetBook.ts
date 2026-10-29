// The target-position book (method 'target'): one decision per game across every venue, with the caps shared between games.
// Pure: the runner reads fills and ladders, calls decideTarget, then records the orders as paper takes.

import { marginPmf } from "../fairPrice/marginDistribution";
import { modelWith } from "../fairPrice/shrink";
import type { Side } from "../fairPrice/lines";
import type { FeeFn, Rung } from "../ladder/engine";
import { backedSide, DEFAULT_TARGET, gameRoom, targetOrders, worstLoss, type Held, type TargetOrder, type TargetPlan } from "../ladder/target";

export interface FillLike {
  venue: string;
  ticker: string;
  side: Side;
  strike: number;
  action: "buy" | "sell";
  price: number;
  count: number;
  fee: number;
}

/** Net position per ticker across all venues (cost includes fees, so the caps count them). */
export function heldFrom(fills: FillLike[]): Held[] {
  const m = new Map<string, Held>();
  for (const f of fills) {
    const h = m.get(f.ticker) ?? { venue: f.venue, ticker: f.ticker, side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    h.yes += d;
    h.cost += d * Number(f.price) + Number(f.fee);
    m.set(f.ticker, h);
  }
  return [...m.values()].filter((h) => h.yes !== 0 || h.cost !== 0);
}

/** What one game of a book risks, for the caps shared across games. */
export interface RiskEntry {
  gameId: string;
  worst: number;
  team: string | null;
  conf: string | null;
}

export interface GameNames {
  home: string;
  away: string;
  homeConf: string | null;
  awayConf: string | null;
}

export function riskEntry(gameId: string, held: Held[], g: GameNames): RiskEntry {
  const side = backedSide(held);
  return {
    gameId,
    worst: worstLoss(held),
    team: side === "home" ? g.home : side === "away" ? g.away : null,
    conf: side === "home" ? g.homeConf : side === "away" ? g.awayConf : null,
  };
}

export interface TargetSettings {
  bankroll: number | null;
  kelly_frac: number | null;
  team_cap: number | null;
  conf_cap: number | null;
  portfolio_cap: number | null;
}

export const DEFAULT_CAPS = { portfolio: 100, team: 10, conf: 30 };

export interface TargetDecision {
  orders: TargetOrder[];
  plan: TargetPlan;
  notes: string[];
  /** The worst-case loss this game was allowed after the shared caps. */
  room: number;
}

/**
 * Decide the orders for one game. `fair` is the shrunk fair home margin, `edgePts` = fair − PM median.
 * `others` = what the same book risks on its other games.
 */
export function decideTarget(x: {
  books: { venue: string; rungs: Rung[]; fee: FeeFn }[];
  fills: FillLike[];
  fair: number;
  edgePts: number;
  sigma: number;
  strategy: { max_worst_case_loss: number; per_rung_cap: number; take_edge: number };
  settings: TargetSettings;
  others: RiskEntry[];
  game: GameNames;
}): TargetDecision {
  const num = (v: unknown, d: number) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  const held = heldFrom(x.fills);
  const leanHome = x.edgePts > 0;
  const heldSide = backedSide(held);
  // Caps are charged to the team the position backs (the lean while there is no position yet).
  const side = heldSide ?? (x.edgePts === 0 ? null : leanHome ? "home" : "away");
  const mine = { team: side === "home" ? x.game.home : side === "away" ? x.game.away : null, conf: side === "home" ? x.game.homeConf : side === "away" ? x.game.awayConf : null };
  const caps = { portfolio: num(x.settings.portfolio_cap, DEFAULT_CAPS.portfolio), team: num(x.settings.team_cap, DEFAULT_CAPS.team), conf: num(x.settings.conf_cap, DEFAULT_CAPS.conf) };
  const room = gameRoom(num(x.strategy.max_worst_case_loss, DEFAULT_TARGET.gameCap), x.others, mine, caps);
  const pmf = marginPmf(x.fair, modelWith(x.sigma));
  const { orders, plan, notes } = targetOrders(x.books, held, pmf, x.edgePts, {
    ...DEFAULT_TARGET,
    bankroll: num(x.settings.bankroll, DEFAULT_TARGET.bankroll),
    kellyFrac: num(x.settings.kelly_frac, DEFAULT_TARGET.kellyFrac),
    sigma: x.sigma,
    takeEdge: num(x.strategy.take_edge, DEFAULT_TARGET.takeEdge),
    maxPerStrike: Math.max(1, Math.round(num(x.strategy.per_rung_cap, DEFAULT_TARGET.maxPerStrike))),
    gameCap: room,
  });
  if (room < num(x.strategy.max_worst_case_loss, DEFAULT_TARGET.gameCap) - 1e-9) notes.push(`room for this game is $${room.toFixed(2)} after the portfolio / team / conference caps`);
  return { orders, plan, notes, room };
}
