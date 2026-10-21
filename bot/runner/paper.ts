// One paper-trading cycle for every enabled watchlist game. Run by
// .github/workflows/bot-paper.yml every ~10 min; safe to run by hand:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx bot/runner/paper.ts
//
// Paper mode never touches an exchange account: it reads Kalshi's public
// books and trades, decides orders with the ladder engine, and simulates
// fills (bot/runner/paperFills.ts). The repo is public, so Actions logs are
// public: log counts only, never prices, positions or picks.

import { matchTeamName } from "../../src/lib/teamNameMatch";
import { marginPmf } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { blendedHomeMargin, impliedHomeMargin, ladderOrders, type LadderConfig, type Position, type Rung } from "../ladder/engine";
import { diffOrders, fillFee, paperFills, type Trade } from "./paperFills";
import { db, eventMarkets, openSpreadEvents, tradesSince, type LiveEvent, type LiveMarket } from "./io";
import { ycprAwaySpreads, type YcprGame } from "./ycpr";

const MODE = "paper";
const now = () => Math.floor(Date.now() / 1000);
const iso = () => new Date().toISOString();
const canon = (s: string) => matchTeamName(s.trim()).matched;
const num = (v: unknown) => (v == null ? null : Number(v));

interface Watch {
  id: number;
  game_id: string;
  home_team: string;
  away_team: string;
  kickoff: string | null;
  pick: "home" | "away";
  /** Optional typed override (home margin = away spread); null = use YCPR. */
  my_home_margin: number | null;
  ycpr_home_margin: number | null;
  kalshi_home_margin: number | null;
  /** Per-game trust in our number; null = use bot_state.default_ycpr_weight. */
  ycpr_weight: number | null;
  max_worst_case_loss: number;
  per_rung_cap: number;
  order_size: number;
  pro_edge: number;
  anti_edge: number;
  take_edge: number;
  edge_step: number;
  profit_target: number | null;
  stop_minutes_before: number;
  kalshi_event: string | null;
}

interface Strategy {
  id: number;
  name: string;
  pro_edge: number;
  anti_edge: number;
  take_edge: number;
  edge_step: number;
  max_worst_case_loss: number;
  per_rung_cap: number;
  ycpr_weight: number | null;
  stop_minutes_before: number;
}

interface RestingRow {
  id: number;
  strategy_id: number | null;
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  kind: "quote" | "take";
  fair: number | null;
  created_at: string;
}

/** One independent paper book on a game: the Board (strategyId null) or a lab strategy. */
interface Book {
  strategyId: number | null;
  weight: number;
  stopMinutes: number;
  cfg: LadderConfig;
}

const placedAt = (r: { created_at: string }) => Math.floor(new Date(r.created_at).getTime() / 1000);

export function toRungs(w: Watch, markets: LiveMarket[]): Rung[] {
  const rungs: Rung[] = [];
  for (const m of markets) {
    const team = canon(m.yes_sub_title.replace(/\s+wins by over.*$/i, ""));
    const side = team === w.home_team ? "home" : team === w.away_team ? "away" : null;
    if (!side || m.status !== "active") continue;
    const bid = Number(m.yes_bid_dollars);
    const ask = Number(m.yes_ask_dollars);
    rungs.push({ ticker: m.ticker, side, strike: Number(m.floor_strike), bid: bid > 0 ? bid : null, ask: ask > 0 && ask < 1 ? ask : null });
  }
  return rungs;
}

export function findEvent(w: Watch, events: LiveEvent[]): LiveEvent | null {
  for (const e of events) {
    const names = e.title.replace(/:\s*Spread$/i, "").split(/\s+(?:vs\.?|at|@)\s+/i).map(canon);
    if (names.length === 2 && names.includes(w.home_team) && names.includes(w.away_team)) return e;
  }
  return null;
}

async function bookHomeMargin(gameId: string): Promise<number | null> {
  const rows = await db.select<{ provider: string; spread: number | null }>("betting_lines", `select=provider,spread&game_id=eq.${gameId}&spread=not.is.null`);
  const rank = (p: string) => (p === "market_median" ? 0 : p === "consensus" ? 1 : 2);
  const best = rows.sort((a, b) => rank(a.provider) - rank(b.provider))[0];
  return best ? -Number(best.spread) : null; // betting_lines.spread is home-relative
}

async function positionsFor(gameId: string, strategyId: number | null = null): Promise<{ positions: Position[]; fees: number }> {
  const fills = await db.select<{ ticker: string; action: string; price: number; count: number; fee: number }>(
    "bot_fills",
    `select=ticker,action,price,count,fee&mode=eq.${MODE}&game_id=eq.${gameId}&strategy_id=${strategyId == null ? "is.null" : `eq.${strategyId}`}`
  );
  const m = new Map<string, Position>();
  let fees = 0;
  for (const f of fills) {
    const p = m.get(f.ticker) ?? { ticker: f.ticker, yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    // Fees go into cost so worst-case exposure (and the loss cap) includes them.
    m.set(f.ticker, { ticker: f.ticker, yes: p.yes + d, cost: p.cost + d * Number(f.price) + Number(f.fee) });
    fees += Number(f.fee);
  }
  return { positions: [...m.values()], fees };
}

async function cancelAll(gameId?: string): Promise<number> {
  const rows = await db.update("bot_orders", `mode=eq.${MODE}&status=eq.resting${gameId ? `&game_id=eq.${gameId}` : ""}`, { status: "cancelled", closed_at: iso() });
  return rows.length;
}

async function snapshot(gameId: string, rungs: Rung[], fairOf: (r: Rung) => number) {
  const last = await db.select<{ ticker: string; bid: number | null; ask: number | null; fair: number | null }>(
    "bot_snapshots",
    `select=ticker,bid,ask,fair&game_id=eq.${gameId}&order=taken_at.desc&limit=${rungs.length * 3}`
  );
  const prev = new Map<string, (typeof last)[number]>();
  for (const s of last) if (!prev.has(s.ticker)) prev.set(s.ticker, s);
  const rows = rungs
    .map((r) => ({ game_id: gameId, ticker: r.ticker, bid: r.bid, ask: r.ask, fair: Math.round(fairOf(r) * 1000) / 1000 }))
    .filter((s) => {
      const p = prev.get(s.ticker);
      return !p || num(p.bid) !== s.bid || num(p.ask) !== s.ask || Math.abs((num(p.fair) ?? -1) - s.fair) >= 0.002;
    });
  if (rows.length) await db.insert("bot_snapshots", rows);
}

/** After kickoff: record each fill's market result and the last pregame mid (for CLV). */
async function settle(w: Watch) {
  const open = await db.select<{ id: number; ticker: string; result: number | null; close_mid: number | null }>(
    "bot_fills",
    `select=id,ticker,result,close_mid&mode=eq.${MODE}&game_id=eq.${w.game_id}&or=(result.is.null,close_mid.is.null)`
  );
  if (!open.length || !w.kalshi_event) return;
  const markets = new Map((await eventMarkets(w.kalshi_event)).map((m) => [m.ticker, m]));
  for (const f of open) {
    const patch: Record<string, number> = {};
    const m = markets.get(f.ticker);
    if (f.result == null && m && (m.result === "yes" || m.result === "no")) patch.result = m.result === "yes" ? 1 : 0;
    if (f.close_mid == null && w.kickoff) {
      const [s] = await db.select<{ bid: number | null; ask: number | null }>(
        "bot_snapshots",
        `select=bid,ask&game_id=eq.${w.game_id}&ticker=eq.${f.ticker}&taken_at=lte.${w.kickoff}&order=taken_at.desc&limit=1`
      );
      if (s?.bid != null && s?.ask != null) patch.close_mid = (Number(s.bid) + Number(s.ask)) / 2;
    }
    if (Object.keys(patch).length) await db.update("bot_fills", `id=eq.${f.id}`, patch);
  }
}

export interface CycleTotals {
  games: number;
  placed: number;
  cancelled: number;
  fills: number;
  skipped: number;
  noEdge: number;
  /** Fills across the lab strategies (the other counts are the Board only). */
  labFills: number;
  overlapped?: boolean;
}

/**
 * One cycle. Triggered by ycpr-bot's /api/cycle (external scheduler) and
 * GitHub Actions as a backup, so it skips if another cycle started in the
 * last 4 minutes and hasn't finished (two cycles at once would double-place).
 */
export async function runCycle(): Promise<CycleTotals> {
  const totals: CycleTotals = { games: 0, placed: 0, cancelled: 0, fills: 0, skipped: 0, noEdge: 0, labFills: 0 };
  const recent = await db.select<{ id: number }>("bot_runs", `select=id&finished_at=is.null&started_at=gte.${new Date(Date.now() - 4 * 60e3).toISOString()}`);
  if (recent.length) return { ...totals, overlapped: true };
  const [run] = await db.insert<{ id: number }>("bot_runs", { mode: MODE });
  try {
    const [state] = await db.select<{ mode: string; kill_switch: boolean; default_ycpr_weight: number }>("bot_state", "select=mode,kill_switch,default_ycpr_weight&id=eq.1");
    const defaultTrust = num(state?.default_ycpr_weight) ?? 1;
    if (state?.kill_switch) {
      totals.cancelled += await cancelAll();
      console.log(`kill switch on: cancelled ${totals.cancelled} resting paper orders`);
      return totals;
    }
    if (state?.mode !== MODE) {
      console.log(`mode is ${state?.mode}; only paper is implemented, nothing to do`);
      return totals;
    }

    const watch = await db.select<Watch>("bot_watchlist", "select=*&enabled=is.true");
    const strategies = await db.select<Strategy>("bot_strategies", "select=*&enabled=is.true&order=id");
    const events = watch.length ? await openSpreadEvents() : [];
    // YCPR's current number for every watched game, computed like Admin Matchups.
    const games = watch.length ? await db.select<YcprGame>("games", `select=id,season,week,home_team,away_team,neutral_site&id=in.(${watch.map((w) => w.game_id).join(",")})`) : [];
    const ycpr = await ycprAwaySpreads(games);
    for (const w of watch) {
      const yc = ycpr.get(String(w.game_id)) ?? null;
      if (yc != null && num(w.ycpr_home_margin) !== yc) {
        await db.update("bot_watchlist", `id=eq.${w.id}`, { ycpr_home_margin: yc, ycpr_updated_at: iso() });
        w.ycpr_home_margin = yc;
      }
    }
    for (const w of watch) {
      if (!w.kickoff) {
        const [g] = await db.select<{ start_date: string }>("games", `select=start_date&id=eq.${w.game_id}`);
        if (g) w.kickoff = g.start_date;
      }
      const kickoff = w.kickoff ? Math.floor(new Date(w.kickoff).getTime() / 1000) : null;
      if (kickoff != null && now() > kickoff) {
        await settle(w);
        continue;
      }
      let event = w.kalshi_event ? events.find((e) => e.event_ticker === w.kalshi_event) ?? null : findEvent(w, events);
      if (event && w.kalshi_event !== event.event_ticker) {
        await db.update("bot_watchlist", `id=eq.${w.id}`, { kalshi_event: event.event_ticker, kickoff: w.kickoff });
        w.kalshi_event = event.event_ticker;
      }
      if (!event) {
        totals.skipped++;
        continue;
      }
      totals.games++;
      const rungs = toRungs(w, event.markets);
      const books = new Map(rungs.map((r) => [r.ticker, { bid: r.bid, ask: r.ask }]));

      // Everything below is shared by the Board and every lab strategy: one read of the book and
      // trades per game, then each "book" (strategy_id null = Board) simulates and quotes on its own.
      const hours = kickoff != null ? (kickoff - now()) / 3600 : 72;
      const kalshiCenter = impliedHomeMargin(rungs);
      if (kalshiCenter != null && num(w.kalshi_home_margin) !== kalshiCenter) {
        await db.update("bot_watchlist", `id=eq.${w.id}`, { kalshi_home_margin: kalshiCenter, kalshi_updated_at: iso() });
      }
      const ours = num(w.my_home_margin) ?? num(w.ycpr_home_margin);
      const sportsbook = await bookHomeMargin(w.game_id);

      const allResting = await db.select<RestingRow>(
        "bot_orders",
        `select=id,strategy_id,ticker,action,price,count,kind,fair,created_at&mode=eq.${MODE}&status=eq.resting&game_id=eq.${w.game_id}`
      );
      const trades: Trade[] = [];
      for (const ticker of new Set(allResting.map((r) => r.ticker))) {
        const since = Math.min(...allResting.filter((r) => r.ticker === ticker).map(placedAt));
        for (const t of await tradesSince(ticker, since)) trades.push({ ticker, ...t });
      }

      const bookList: Book[] = [
        {
          strategyId: null,
          weight: num(w.ycpr_weight) ?? defaultTrust, // per-game trust wins over the default
          stopMinutes: w.stop_minutes_before,
          cfg: {
            pick: w.pick, maxWorstCaseLoss: Number(w.max_worst_case_loss), perRungCap: w.per_rung_cap, orderSize: w.order_size,
            proEdge: Number(w.pro_edge), antiEdge: Number(w.anti_edge), takeEdge: Number(w.take_edge), edgeStep: Number(w.edge_step),
            profitTarget: num(w.profit_target), tick: 0.01,
          },
        },
        ...strategies.map((st) => ({
          strategyId: st.id,
          weight: num(st.ycpr_weight) ?? defaultTrust,
          stopMinutes: st.stop_minutes_before,
          cfg: {
            pick: w.pick, maxWorstCaseLoss: Number(st.max_worst_case_loss), perRungCap: st.per_rung_cap, orderSize: 1,
            proEdge: Number(st.pro_edge), antiEdge: Number(st.anti_edge), takeEdge: Number(st.take_edge), edgeStep: Number(st.edge_step),
            profitTarget: null, tick: 0.01,
          } as LadderConfig,
        })),
      ];

      for (const bk of bookList) {
        const sid = bk.strategyId;
        let resting = allResting.filter((r) => (r.strategy_id ?? null) === sid);

        // 1. Simulate fills on what was resting since the last cycle.
        const filled = paperFills(
          resting.map((r) => ({ id: r.id, ticker: r.ticker, action: r.action, price: Number(r.price), count: r.count, placedAt: placedAt(r) })),
          trades,
          books
        );
        for (const f of filled) {
          const r = rungs.find((x) => x.ticker === f.ticker);
          const order = resting.find((x) => x.id === f.id)!;
          await db.update("bot_orders", `id=eq.${f.id}`, { status: "filled", closed_at: iso() });
          await db.insert("bot_fills", {
            mode: MODE, strategy_id: sid, order_id: f.id, game_id: w.game_id, ticker: f.ticker, side: r?.side ?? "home", strike: r?.strike ?? 0,
            action: f.action, price: f.price, count: f.count, fee: fillFee(f.price, f.count, "quote"), fair_at_fill: order.fair,
            mid_at_fill: r?.bid != null && r?.ask != null ? (r.bid + r.ask) / 2 : null,
          });
          if (sid == null) totals.fills++;
          else totals.labFills++;
        }
        resting = resting.filter((r) => !filled.some((f) => f.id === r.id));
        const cancel = async (rows: RestingRow[]) => {
          if (!rows.length) return;
          await db.update("bot_orders", `id=in.(${rows.map((r) => r.id).join(",")})`, { status: "cancelled", closed_at: iso() });
          if (sid == null) totals.cancelled += rows.length;
        };

        // 2. Stop quoting before kickoff (inventory is held to settlement).
        if (kickoff != null && now() >= kickoff - bk.stopMinutes * 60) {
          await cancel(resting);
          continue;
        }
        if (ours == null) {
          if (sid == null) totals.skipped++;
          continue;
        }

        // 3. Fair price: our number blended with Kalshi-implied + sportsbooks by this book's trust.
        const center = blendedHomeMargin({ ycpr: ours, kalshi: kalshiCenter, book: sportsbook, hoursToKickoff: hours }, { ycprWeight: bk.weight, fade: false });
        if (center == null) continue;
        // No edge to lean on if our blended number doesn't favor the pick versus the market.
        const market = kalshiCenter ?? center;
        if (!(w.pick === "home" ? center > market : center < market)) {
          if (sid == null) totals.noEdge++;
          await cancel(resting.filter((r) => r.kind === "quote"));
          continue;
        }
        const pmf = marginPmf(center);
        if (sid == null) await snapshot(w.game_id, rungs, (r) => kalshiSpreadYesProb(pmf, r.side, r.strike));

        // 4. Decide orders and reconcile with what's resting.
        const { positions } = await positionsFor(w.game_id, sid); // fees are already in positions' cost
        const { orders } = ladderOrders(rungs, positions, pmf, bk.cfg);
        const plan = diffOrders(resting, orders, 0.01);
        await cancel(plan.cancel);
        for (const o of plan.place) {
          const full = orders.find((x) => x.ticker === o.ticker && x.action === o.action && x.price === o.price && x.kind === o.kind)!;
          const [row] = await db.insert<{ id: number }>("bot_orders", {
            mode: MODE, strategy_id: sid, game_id: w.game_id, ticker: o.ticker, action: o.action, price: o.price, count: o.count, kind: o.kind,
            direction: full.direction, fair: full.fair, reason: full.reason, status: o.kind === "take" ? "filled" : "resting", closed_at: o.kind === "take" ? iso() : null,
          });
          if (sid == null) totals.placed++;
          if (o.kind === "take") {
            const r = rungs.find((x) => x.ticker === o.ticker)!;
            await db.insert("bot_fills", {
              mode: MODE, strategy_id: sid, order_id: row.id, game_id: w.game_id, ticker: o.ticker, side: r.side, strike: r.strike, action: o.action,
              price: o.price, count: o.count, fee: fillFee(o.price, o.count, "take"), fair_at_fill: full.fair,
              mid_at_fill: r.bid != null && r.ask != null ? (r.bid + r.ask) / 2 : null,
            });
            if (sid == null) totals.fills++;
            else totals.labFills++;
          }
        }
      }
    }
  } catch (err) {
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), error: String(err).slice(0, 2000) });
    throw err;
  } finally {
    await db.update("bot_runs", `id=eq.${run.id}`, {
      finished_at: iso(), games: totals.games, orders_placed: totals.placed, orders_cancelled: totals.cancelled, fills: totals.fills, summary: totals,
    }).catch(() => {});
    console.log(`games ${totals.games}, skipped ${totals.skipped}, no-edge ${totals.noEdge}, placed ${totals.placed}, cancelled ${totals.cancelled}, fills ${totals.fills}, lab fills ${totals.labFills}`);
  }
  return totals;
}

if (process.argv[1]?.endsWith("paper.ts")) runCycle().catch((err) => {
  console.error(err instanceof Error ? err.message.split(":")[0] : "run failed");
  process.exit(1);
});
