// Hypotheticals: replay the ladder engine over recorded market history
// (bot_mkt_snaps / bot_mkt_trades) for any game, method and set of venues,
// with the same fill rules as paper trading. Pure and incremental: advance()
// takes a saved state and only the steps after it, so a job can keep every
// game × method × venue set current cheaply as new data is recorded.

import { marginPmf } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import {
  blendedHomeMargin,
  exposureSummary,
  impliedHomeMargin,
  ladderOrders,
  pnlByMargin,
  type FeeFn,
  type LadderConfig,
  type Position,
  type Rung,
} from "../ladder/engine";
import { diffOrders, paperFills } from "../runner/paperFills";
import type { VenueId } from "../venues/types";

export type VenueSet = VenueId | "all";
export const VENUE_SETS: VenueSet[] = ["kalshi", "novig", "prophetx", "all"];
const MAXM = 60;

export interface SnapRow {
  venue: VenueId;
  ticker: string;
  side: "home" | "away";
  strike: number;
  bid: number | null;
  ask: number | null;
}
export interface TradeRow {
  venue: VenueId;
  ticker: string;
  t: number;
  yesPrice: number;
}
/** One recorder cycle: the rungs that changed then, and the trades since the previous step. */
export interface Step {
  t: number;
  snaps: SnapRow[];
  trades: TradeRow[];
  /** Each changed venue's implied home margin after this step (see annotateSteps); method-independent. */
  implied?: Partial<Record<VenueId, number | null>>;
}

/**
 * Pre-compute every venue's implied margin after each step, once for all methods (the fit is the
 * slow part of a replay). `books` = the rungs known before the first step, keyed `${venue}|${ticker}`.
 */
export function annotateSteps(steps: Step[], books: Record<string, SnapRow> = {}, known?: Map<string, number | null>): Step[] {
  const cur = { ...books };
  return steps.map((st) => {
    const changed = new Set<VenueId>();
    for (const sn of st.snaps) {
      cur[`${sn.venue}|${sn.ticker}`] = sn;
      changed.add(sn.venue);
    }
    const implied: Partial<Record<VenueId, number | null>> = {};
    for (const v of changed)
      implied[v] = known?.has(`${v}|${st.t}`) ? known.get(`${v}|${st.t}`)! : impliedHomeMargin(Object.values(cur).filter((x) => x.venue === v).map((x) => ({ ticker: x.ticker, side: x.side, strike: Number(x.strike), bid: x.bid, ask: x.ask })));
    return { ...st, implied };
  });
}

export interface HypoGame {
  /** Our number (home margin = away spread). */
  ycpr: number | null;
  /** Sportsbook home margin. */
  book: number | null;
  /** Unix seconds. */
  kickoff: number;
  /** Final home margin once the game is over. */
  final: number | null;
}

export interface Method {
  key: string;
  label: string;
  kind: "ladder" | "early" | "late";
  /** Ladder settings (pick and tick are filled in per game/venue). */
  cfg: Omit<LadderConfig, "pick" | "tick" | "fee">;
  /** Trust in our number (0–1). */
  weight: number;
  stopMinutes: number;
}

export interface VenueRules {
  tick: number;
  fee: (hoursToKickoff: number) => FeeFn;
}

interface Resting {
  venue: VenueId;
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  placedAt: number;
  fair: number | null;
}
export interface HypoFill {
  venue: VenueId;
  ticker: string;
  side: "home" | "away";
  strike: number;
  action: "buy" | "sell";
  price: number;
  count: number;
  fee: number;
  t: number;
  fair: number | null;
}
export interface HypoState {
  /** Last step processed (unix seconds); 0 = nothing yet. */
  t: number;
  pick: "home" | "away" | null;
  books: Record<string, SnapRow>; // `${venue}|${ticker}`
  resting: Resting[];
  fills: HypoFill[];
  /** Baselines (early/late) place their one bet once. */
  done?: boolean;
  /** Latest implied home margin per venue. */
  implied?: Partial<Record<VenueId, number | null>>;
  /** Last pregame mid per rung, frozen at the stop time (for CLV). */
  closeMid?: Record<string, number>;
  nextId?: number;
}

export const emptyState = (): HypoState => ({ t: 0, pick: null, books: {}, resting: [], fills: [], nextId: 1 });

const venuesOf = (set: VenueSet): VenueId[] => (set === "all" ? ["kalshi", "novig", "prophetx"] : [set]);

function rungsOf(state: HypoState, venue: VenueId): Rung[] {
  return Object.values(state.books)
    .filter((s) => s.venue === venue)
    .map((s) => ({ ticker: s.ticker, side: s.side, strike: Number(s.strike), bid: s.bid, ask: s.ask }));
}

function positionsOf(fills: HypoFill[]): { positions: Position[]; rungs: Pick<Rung, "ticker" | "side" | "strike">[] } {
  const m = new Map<string, Position>();
  const r = new Map<string, Pick<Rung, "ticker" | "side" | "strike">>();
  for (const f of fills) {
    const p = m.get(f.ticker) ?? { ticker: f.ticker, yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    m.set(f.ticker, { ticker: f.ticker, yes: p.yes + d, cost: p.cost + d * f.price + f.fee });
    r.set(f.ticker, { ticker: f.ticker, side: f.side, strike: f.strike });
  }
  return { positions: [...m.values()], rungs: [...r.values()] };
}

/** The market margin a venue implies right now, else any selected venue's. */
function marketMargin(state: HypoState, venue: VenueId, set: VenueSet): number | null {
  const own = state.implied?.[venue];
  if (own != null) return own;
  for (const v of venuesOf(set)) {
    const m = state.implied?.[v];
    if (m != null) return m;
  }
  return null;
}

/** Last pregame mid of every rung this method traded (for CLV). */
function freezeClose(state: HypoState) {
  if (state.closeMid) return;
  state.closeMid = {};
  for (const f of state.fills) {
    const k = `${f.venue}|${f.ticker}`;
    const b = state.books[k];
    if (b?.bid != null && b?.ask != null) state.closeMid[k] = (b.bid + b.ask) / 2;
  }
}

/**
 * A straight bet on the pick at the line nearest a coin flip, sized to the loss cap: buy YES on a
 * pick-side rung at its ask, or sell YES (= buy NO) on an opponent rung at its bid, whichever
 * costs closest to 50¢.
 */
function straightBet(state: HypoState, game: HypoGame, method: Method, set: VenueSet, rules: Record<VenueId, VenueRules>, t: number) {
  if (!state.pick) return;
  let best: { venue: VenueId; r: Rung; action: "buy" | "sell"; price: number; cost: number } | null = null;
  for (const v of venuesOf(set))
    for (const r of rungsOf(state, v)) {
      const c = r.side === state.pick
        ? r.ask == null ? null : { action: "buy" as const, price: r.ask, cost: r.ask }
        : r.bid == null ? null : { action: "sell" as const, price: r.bid, cost: 1 - r.bid };
      if (!c || c.cost <= 0.02 || c.cost >= 0.98) continue;
      if (!best || Math.abs(c.cost - 0.5) < Math.abs(best.cost - 0.5)) best = { venue: v, r, ...c };
    }
  if (!best) return;
  const fee = rules[best.venue].fee((game.kickoff - t) / 3600);
  let count = Math.floor(method.cfg.maxWorstCaseLoss / best.cost);
  while (count > 0 && count * best.cost + fee(best.price, { count }) > method.cfg.maxWorstCaseLoss) count--;
  if (count <= 0) return;
  state.fills.push({ venue: best.venue, ticker: best.r.ticker, side: best.r.side, strike: best.r.strike, action: best.action, price: best.price, count, fee: fee(best.price, { count }), t, fair: null });
  state.done = true;
}

/**
 * Process `steps` (sorted, all after state.t) for one game × method × venue set.
 * `now` lets the late baseline and the close freeze happen once the stop time has passed.
 */
export function advance(state: HypoState, steps: Step[], game: HypoGame, method: Method, set: VenueSet, rules: Record<VenueId, VenueRules>, now: number): HypoState {
  const s: HypoState = JSON.parse(JSON.stringify(state));
  const venues = venuesOf(set);
  const stopAt = game.kickoff - method.stopMinutes * 60;
  for (const step of steps) {
    if (step.t <= s.t) continue;
    if (step.t >= stopAt) break; // nothing trades after the stop; remaining steps are after it too
    const changed = new Set<VenueId>();
    for (const sn of step.snaps)
      if (venues.includes(sn.venue)) {
        s.books[`${sn.venue}|${sn.ticker}`] = { ...sn, strike: Number(sn.strike) };
        changed.add(sn.venue);
      }
    for (const v of changed) (s.implied ??= {})[v] = step.implied && v in step.implied ? step.implied[v]! : impliedHomeMargin(rungsOf(s, v));
    const hours = (game.kickoff - step.t) / 3600;

    // Pick: the side our number favors versus the market, fixed the first time both are known.
    if (!s.pick && game.ycpr != null) {
      const mkt = venues.map((v) => s.implied?.[v]).find((m) => m != null) ?? game.book;
      if (mkt != null && Math.abs(game.ycpr - mkt) > 1e-9) s.pick = game.ycpr > mkt ? "home" : "away";
    }

    if (method.kind === "early") {
      if (!s.done) straightBet(s, game, method, set, rules, step.t);
      s.t = step.t;
      continue;
    }
    if (method.kind === "late") {
      s.t = step.t;
      continue;
    }

    for (const v of venues) {
      const rungs = rungsOf(s, v);
      if (!rungs.length) continue;
      const fee = rules[v].fee(hours);
      // 1. Fills on what rested since the last step: trades through the price, or the book crossing it.
      const mine = s.resting.filter((r) => r.venue === v);
      const books = new Map(rungs.map((r) => [r.ticker, { bid: r.bid, ask: r.ask }]));
      const filled = paperFills(
        mine.map((r, i) => ({ id: i, ticker: r.ticker, action: r.action, price: r.price, count: r.count, placedAt: r.placedAt })),
        step.trades.filter((t) => t.venue === v),
        books
      );
      const filledSet = new Set(filled.map((f) => f.id));
      for (const f of filled) {
        const r = mine[f.id];
        const rung = s.books[`${v}|${r.ticker}`];
        s.fills.push({ venue: v, ticker: r.ticker, side: rung?.side ?? "home", strike: Number(rung?.strike ?? 0), action: r.action, price: r.price, count: r.count, fee: fee(r.price, { count: r.count, maker: true }), t: step.t, fair: r.fair });
      }
      let resting = mine.filter((_, i) => !filledSet.has(i));
      s.resting = s.resting.filter((r) => r.venue !== v);
      if (game.ycpr == null || !s.pick) continue;

      // 2. Fair price and the no-edge rule, as in the runner.
      const market = marketMargin(s, v, set);
      const center = blendedHomeMargin({ ycpr: game.ycpr, kalshi: market, book: game.book, hoursToKickoff: hours }, { ycprWeight: method.weight, fade: false });
      if (center == null) continue;
      const ref = market ?? center;
      if (!(s.pick === "home" ? center > ref : center < ref)) continue; // quotes pulled
      const pmf = marginPmf(center);

      // 3. Orders, with the cap covering this method's positions on the other selected venues.
      const here = positionsOf(s.fills.filter((f) => f.venue === v));
      const there = positionsOf(s.fills.filter((f) => f.venue !== v));
      const otherPnl = there.positions.length ? pnlByMargin(there.rungs, there.positions, pmf.maxMargin) : undefined;
      const { orders } = ladderOrders(rungs, here.positions, pmf, { ...method.cfg, pick: s.pick, tick: rules[v].tick, fee }, { otherPnl, marketHomeMargin: market ?? game.book ?? center });
      const withIds = resting.map((r, i) => ({ ...r, id: i }));
      const plan = diffOrders(withIds, orders, rules[v].tick);
      const cancel = new Set(plan.cancel.map((r) => r.id));
      resting = withIds.filter((r) => !cancel.has(r.id)).map(({ id: _id, ...r }) => r);
      for (const o of plan.place) {
        const full = orders.find((x) => x.ticker === o.ticker && x.action === o.action && x.price === o.price && x.kind === o.kind);
        if (o.kind === "take") {
          const rung = s.books[`${v}|${o.ticker}`];
          s.fills.push({ venue: v, ticker: o.ticker, side: rung.side, strike: Number(rung.strike), action: o.action, price: o.price, count: o.count, fee: fee(o.price, { count: o.count, maker: false }), t: step.t, fair: full?.fair ?? null });
        } else resting.push({ venue: v, ticker: o.ticker, action: o.action, price: o.price, count: o.count, placedAt: step.t, fair: full?.fair ?? null });
      }
      s.resting.push(...resting);
    }
    s.t = step.t;
  }
  // Past the stop: quotes are pulled, the close is frozen, the late baseline bets on the last book.
  if (now >= stopAt) {
    s.resting = [];
    if (method.kind === "late" && !s.done) straightBet(s, game, method, set, rules, stopAt);
    freezeClose(s);
  }
  return s;
}

export interface HypoSummary {
  pick: "home" | "away" | null;
  fills: number;
  contracts: number;
  fees: number;
  /** P&L for every final home margin −60..60 (index = margin + 60), after fees. */
  curve: number[];
  worst: number;
  best: number;
  /** Expected value under our number's distribution, and under the market's last implied margin. */
  expected: number;
  marketExpected: number | null;
  settled: number | null;
  clv: number | null;
  resting: number;
  asOf: number;
}

export function summarize(state: HypoState, game: HypoGame, set: VenueSet): HypoSummary {
  const { positions, rungs } = positionsOf(state.fills);
  const curve = pnlByMargin(rungs, positions, MAXM).map((v) => Math.round(v * 100) / 100);
  const has = state.fills.length > 0;
  const pmfY = game.ycpr == null ? null : marginPmf(game.ycpr);
  const mkt = venuesOf(set).map((v) => state.implied?.[v]).find((m) => m != null) ?? game.book;
  const ev = (center: number) => {
    const pmf = marginPmf(center);
    return exposureSummary(pnlByMargin(rungs, positions, pmf.maxMargin), pmf).expected;
  };
  const clvRows = state.closeMid ? state.fills.filter((f) => state.closeMid![`${f.venue}|${f.ticker}`] != null) : [];
  const n = clvRows.reduce((a, f) => a + f.count, 0);
  const clv = n
    ? clvRows.reduce((a, f) => {
        const close = state.closeMid![`${f.venue}|${f.ticker}`];
        return a + f.count * (f.action === "buy" ? close - f.price : f.price - close);
      }, 0) / n
    : null;
  return {
    pick: state.pick,
    fills: state.fills.length,
    contracts: state.fills.reduce((a, f) => a + f.count, 0),
    fees: Math.round(state.fills.reduce((a, f) => a + f.fee, 0) * 10000) / 10000,
    curve,
    worst: has ? Math.min(...curve) : 0,
    best: has ? Math.max(...curve) : 0,
    expected: has && pmfY ? Math.round(ev(game.ycpr!) * 1000) / 1000 : 0,
    marketExpected: has && mkt != null ? Math.round(ev(mkt) * 1000) / 1000 : null,
    settled: game.final == null ? null : has ? curve[Math.max(-MAXM, Math.min(MAXM, game.final)) + MAXM] : 0,
    clv,
    resting: state.resting.length,
    asOf: state.t,
  };
}

/** Fair YES price of a rung under a margin (exported for the UI's ladder view). */
export const fairYes = (center: number, side: "home" | "away", strike: number) => kalshiSpreadYesProb(marginPmf(center), side, strike);

/** Built-in methods. `base` = the lab's Default settings, so every method risks the same cap. */
export function builtinMethods(defaultTrust: number): Method[] {
  const base = { maxWorstCaseLoss: 10, perRungCap: 1, orderSize: 1, proEdge: 0.02, antiEdge: 0.04, takeEdge: 0.03, edgeStep: 0.01, profitTarget: null };
  const ladder = (key: string, label: string, over: Partial<Method["cfg"]> = {}, weight = defaultTrust): Method => ({ key, label, kind: "ladder", cfg: { ...base, ...over }, weight, stopMinutes: 30 });
  return [
    ladder("ladder", `Ladder (trust ${Math.round(defaultTrust * 100)}%)`),
    // Trust variations (the default level is already the plain ladder).
    ...[0.25, 0.5, 0.75, 1].filter((w) => Math.abs(w - defaultTrust) > 1e-9).map((w) => ladder(`trust${Math.round(w * 100)}`, `Ladder · trust ${Math.round(w * 100)}%`, {}, w)),
    // Shaped positions (§21): the same cap, solved as one position with the default payoff rules.
    ladder("shaped", "Shaped", { shape: true }),
    ladder("shaped2", "Shaped · floor $2", { shape: true, marketFloor: 2 }),
    ladder("maker", "Maker only (never take)", { takeEdge: 9 }),
    ladder("taker", "Take only (no resting quotes)", { proEdge: 9, antiEdge: 9 }),
    { key: "early", label: "Straight bet · early", kind: "early", cfg: base, weight: defaultTrust, stopMinutes: 30 },
    { key: "late", label: "Straight bet · near kickoff", kind: "late", cfg: base, weight: defaultTrust, stopMinutes: 30 },
  ];
}

/** A lab strategy as a method. */
export function strategyMethod(st: {
  id: number; name: string; pro_edge: number; anti_edge: number; take_edge: number; edge_step: number;
  max_worst_case_loss: number; per_rung_cap: number; ycpr_weight: number | null; stop_minutes_before: number;
  shape?: boolean | null; market_floor?: number | null; against_limit?: number | null; blowout_margin?: number | null;
}, defaultTrust: number): Method {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    key: `lab${st.id}`,
    label: `Lab · ${st.name}`,
    kind: "ladder",
    cfg: {
      maxWorstCaseLoss: Number(st.max_worst_case_loss), perRungCap: st.per_rung_cap, orderSize: 1,
      proEdge: Number(st.pro_edge), antiEdge: Number(st.anti_edge), takeEdge: Number(st.take_edge), edgeStep: Number(st.edge_step), profitTarget: null,
      // Only shaped strategies carry the shape keys, so other strategies' hashes (and saved replays) don't change.
      ...(st.shape ? { shape: true, marketFloor: n(st.market_floor), againstLimit: n(st.against_limit), blowoutMargin: n(st.blowout_margin) } : {}),
    },
    weight: st.ycpr_weight == null ? defaultTrust : Number(st.ycpr_weight),
    stopMinutes: st.stop_minutes_before,
  };
}

/** Stable hash of what affects a method's replay, so edits restart it from scratch. */
export function methodHash(m: Method): string {
  return JSON.stringify([m.kind, m.cfg, m.weight, m.stopMinutes]);
}
