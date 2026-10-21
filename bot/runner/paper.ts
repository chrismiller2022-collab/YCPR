// One paper-trading cycle for every enabled watchlist game, on every enabled
// venue (Kalshi, Novig, ProphetX). Triggered by ycpr-bot's /api/cycle every
// ~5 min (GitHub Actions is an hourly backup); safe to run by hand:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx bot/runner/paper.ts
//
// Paper mode never touches an exchange account: it reads each venue's books
// and trades, decides orders with the ladder engine, and simulates fills
// (bot/runner/paperFills.ts). The Board (strategy_id null) and every Strategy
// lab book trade independently; each book's loss cap covers the whole game
// across venues. The repo is public, so Actions logs are public: log counts
// only, never prices, positions or picks.

import { marginPmf } from "../fairPrice/marginDistribution";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { blendedHomeMargin, impliedHomeMargin, ladderOrders, pnlByMargin, type LadderConfig, type Position, type Rung } from "../ladder/engine";
import { makeAdapters, VENUES, type VenueAdapter, type VenueId, type VenueLadder } from "../venues";
import { diffOrders, paperFills, type Trade } from "./paperFills";
import { db } from "./io";
import { ycprAwaySpreads, type YcprGame } from "./ycpr";

const MODE = "paper";
/** Stop starting new games after this long (ycpr-bot's /api/cycle allows 300 s). */
const BUDGET_MS = Number(process.env.BOT_CYCLE_BUDGET_MS) || 170e3;
const now = () => Math.floor(Date.now() / 1000);
const iso = () => new Date().toISOString();
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
  venues: VenueId[] | null;
  venue_events: Partial<Record<VenueId, string>> | null;
  venue_margins: Partial<Record<VenueId, number>> | null;
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
  venue: VenueId;
  ticker: string;
  action: "buy" | "sell";
  price: number;
  count: number;
  kind: "quote" | "take";
  fair: number | null;
  created_at: string;
}

interface FillRow {
  strategy_id: number | null;
  venue: VenueId;
  ticker: string;
  side: "home" | "away";
  strike: number;
  action: "buy" | "sell";
  price: number;
  count: number;
  fee: number;
}

/** One independent paper book on a game: the Board (strategyId null) or a lab strategy. */
interface Book {
  strategyId: number | null;
  weight: number;
  stopMinutes: number;
  cfg: LadderConfig;
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
  /** Board fills and ladders found, per venue. */
  venues: Partial<Record<VenueId, { ladders: number; fills: number; placed: number }>>;
  venueErrors?: Partial<Record<VenueId, string>>;
  overlapped?: boolean;
  /** Games left for the next cycle because this one hit its time budget. */
  deferred?: number;
  /** Per-venue response-shape notes (no prices or positions), for checking new adapters. */
  diag?: Partial<Record<VenueId, unknown>>;
}

const placedAt = (r: { created_at: string }) => Math.floor(new Date(r.created_at).getTime() / 1000);

async function bookHomeMargin(gameId: string): Promise<number | null> {
  const rows = await db.select<{ provider: string; spread: number | null }>("betting_lines", `select=provider,spread&game_id=eq.${gameId}&spread=not.is.null`);
  const rank = (p: string) => (p === "market_median" ? 0 : p === "consensus" ? 1 : 2);
  const best = rows.sort((a, b) => rank(a.provider) - rank(b.provider))[0];
  return best ? -Number(best.spread) : null; // betting_lines.spread is home-relative
}

/** Net position per ticker (fees in cost, so caps include them) plus the rung each ticker is. */
function positionsFrom(fills: FillRow[]): { positions: Position[]; rungs: Pick<Rung, "ticker" | "side" | "strike">[] } {
  const m = new Map<string, Position>();
  const rungs = new Map<string, Pick<Rung, "ticker" | "side" | "strike">>();
  for (const f of fills) {
    const p = m.get(f.ticker) ?? { ticker: f.ticker, yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    m.set(f.ticker, { ticker: f.ticker, yes: p.yes + d, cost: p.cost + d * Number(f.price) + Number(f.fee) });
    rungs.set(f.ticker, { ticker: f.ticker, side: f.side, strike: Number(f.strike) });
  }
  return { positions: [...m.values()], rungs: [...rungs.values()] };
}

async function cancelAll(gameId?: string): Promise<number> {
  const rows = await db.update("bot_orders", `mode=eq.${MODE}&status=eq.resting${gameId ? `&game_id=eq.${gameId}` : ""}`, { status: "cancelled", closed_at: iso() });
  return rows.length;
}

async function snapshot(gameId: string, venue: VenueId, rungs: Rung[], fairOf: (r: Rung) => number) {
  const last = await db.select<{ ticker: string; bid: number | null; ask: number | null; fair: number | null }>(
    "bot_snapshots",
    `select=ticker,bid,ask,fair&game_id=eq.${gameId}&venue=eq.${venue}&order=taken_at.desc&limit=${rungs.length * 3}`
  );
  const prev = new Map<string, (typeof last)[number]>();
  for (const s of last) if (!prev.has(s.ticker)) prev.set(s.ticker, s);
  const rows = rungs
    .map((r) => ({ game_id: gameId, venue, ticker: r.ticker, side: r.side, strike: r.strike, bid: r.bid, ask: r.ask, fair: Math.round(fairOf(r) * 1000) / 1000 }))
    .filter((s) => {
      const p = prev.get(s.ticker);
      return !p || num(p.bid) !== s.bid || num(p.ask) !== s.ask || Math.abs((num(p.fair) ?? -1) - s.fair) >= 0.002;
    });
  if (rows.length) await db.insert("bot_snapshots", rows);
}

/**
 * After the game: grade every fill from the final score (works for any venue: a rung's YES
 * is "side wins by over strike") and record the last pregame mid on its venue for CLV.
 */
async function settle(w: Watch) {
  const open = await db.select<{ id: number; venue: VenueId; ticker: string; side: string; strike: number; result: number | null; close_mid: number | null }>(
    "bot_fills",
    `select=id,venue,ticker,side,strike,result,close_mid&mode=eq.${MODE}&game_id=eq.${w.game_id}&or=(result.is.null,close_mid.is.null)`
  );
  if (!open.length) return;
  const [g] = await db.select<{ completed: boolean; home_points: number | null; away_points: number | null }>("games", `select=completed,home_points,away_points&id=eq.${w.game_id}`);
  const margin = g?.completed && g.home_points != null && g.away_points != null ? g.home_points - g.away_points : null;
  for (const f of open) {
    const patch: Record<string, number> = {};
    if (f.result == null && margin != null) patch.result = (f.side === "home" ? margin : -margin) > Number(f.strike) ? 1 : 0;
    if (f.close_mid == null && w.kickoff) {
      const [s] = await db.select<{ bid: number | null; ask: number | null }>(
        "bot_snapshots",
        `select=bid,ask&game_id=eq.${w.game_id}&venue=eq.${f.venue}&ticker=eq.${encodeURIComponent(f.ticker)}&taken_at=lte.${w.kickoff}&order=taken_at.desc&limit=1`
      );
      if (s?.bid != null && s?.ask != null) patch.close_mid = (Number(s.bid) + Number(s.ask)) / 2;
    }
    if (Object.keys(patch).length) await db.update("bot_fills", `id=eq.${f.id}`, patch);
  }
}

/**
 * One cycle. Triggered by ycpr-bot's /api/cycle (external scheduler) and GitHub Actions as a
 * backup, so it skips if another cycle started in the last 4 minutes and hasn't finished.
 */
export async function runCycle(): Promise<CycleTotals> {
  const totals: CycleTotals = { games: 0, placed: 0, cancelled: 0, fills: 0, skipped: 0, noEdge: 0, labFills: 0, venues: {} };
  const started = Date.now();
  const recent = await db.select<{ id: number }>("bot_runs", `select=id&mode=eq.${MODE}&finished_at=is.null&started_at=gte.${new Date(Date.now() - 4 * 60e3).toISOString()}`);
  if (recent.length) return { ...totals, overlapped: true };
  // Runs the platform killed at its time limit never reach `finally`; close them out.
  await db.update("bot_runs", `mode=eq.${MODE}&finished_at=is.null&started_at=lt.${new Date(Date.now() - 6 * 60e3).toISOString()}`, { finished_at: iso(), error: "timed out" });
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
    if (!watch.length) return totals;

    // Venues: skip any without credentials, or whose catalog can't be read this cycle.
    const adapters = makeAdapters();
    const active: VenueId[] = [];
    for (const v of VENUES) {
      if (!adapters[v].available()) continue;
      try {
        await adapters[v].prepare();
        active.push(v);
      } catch (err) {
        (totals.venueErrors ??= {})[v] = String(err instanceof Error ? err.message : err).slice(0, 200);
      }
    }
    const recordDiag = () => {
      for (const v of VENUES) {
        const d = adapters[v].diag?.();
        if (d) (totals.diag ??= {})[v] = d;
      }
    };

    // YCPR's current number for every watched game, computed like Admin Matchups.
    const games = await db.select<YcprGame>("games", `select=id,season,week,home_team,away_team,neutral_site&id=in.(${watch.map((w) => w.game_id).join(",")})`);
    const ycpr = await ycprAwaySpreads(games);
    for (const w of watch) {
      const yc = ycpr.get(String(w.game_id)) ?? null;
      if (yc != null && num(w.ycpr_home_margin) !== yc) {
        await db.update("bot_watchlist", `id=eq.${w.id}`, { ycpr_home_margin: yc, ycpr_updated_at: iso() });
        w.ycpr_home_margin = yc;
      }
    }

    // Time budget: stop starting games before the function limit; start from a different game each
    // cycle so a slow cycle never starves the same games.
    const deadline = started + BUDGET_MS;
    const off = run.id % watch.length;
    for (const w of [...watch.slice(off), ...watch.slice(0, off)]) {
      if (Date.now() > deadline) {
        totals.deferred = (totals.deferred ?? 0) + 1;
        continue;
      }
      if (!w.kickoff) {
        const [g] = await db.select<{ start_date: string }>("games", `select=start_date&id=eq.${w.game_id}`);
        if (g) w.kickoff = g.start_date;
      }
      const kickoff = w.kickoff ? Math.floor(new Date(w.kickoff).getTime() / 1000) : null;
      if (kickoff != null && now() > kickoff) {
        await settle(w);
        continue;
      }
      const hours = kickoff != null ? (kickoff - now()) / 3600 : 72;
      const ours = num(w.my_home_margin) ?? num(w.ycpr_home_margin);
      const sportsbook = await bookHomeMargin(w.game_id);

      // 0. Each enabled venue's ladder for this game.
      const ladders = new Map<VenueId, VenueLadder>();
      const events = { ...(w.venue_events ?? {}) };
      const margins: Partial<Record<VenueId, number>> = {};
      for (const v of active.filter((x) => (w.venues ?? VENUES).includes(x))) {
        try {
          const L = await adapters[v].ladder({
            home_team: w.home_team,
            away_team: w.away_team,
            bookHomeMargin: sportsbook,
            eventKey: v === "kalshi" ? w.kalshi_event : events[v] ?? null,
          });
          if (!L || !L.rungs.length) continue;
          ladders.set(v, L);
          (totals.venues[v] ??= { ladders: 0, fills: 0, placed: 0 }).ladders++;
          if (v !== "kalshi") events[v] = L.eventKey;
          const m = impliedHomeMargin(L.rungs);
          if (m != null) margins[v] = m;
        } catch (err) {
          (totals.venueErrors ??= {})[v] = String(err instanceof Error ? err.message : err).slice(0, 200);
        }
      }
      const kalshiEvent = ladders.get("kalshi")?.eventKey ?? w.kalshi_event;
      await db.update("bot_watchlist", `id=eq.${w.id}`, {
        venue_events: events,
        venue_margins: margins,
        kalshi_event: kalshiEvent,
        kickoff: w.kickoff,
        ...(margins.kalshi != null ? { kalshi_home_margin: margins.kalshi, kalshi_updated_at: iso() } : {}),
      });
      if (!ladders.size) {
        totals.skipped++;
        continue;
      }
      totals.games++;

      // Everything below is shared by the Board and every lab strategy: one read of resting
      // orders, fills and trades per game, then each book simulates and quotes on each venue.
      const allResting = await db.select<RestingRow>(
        "bot_orders",
        `select=id,strategy_id,venue,ticker,action,price,count,kind,fair,created_at&mode=eq.${MODE}&status=eq.resting&game_id=eq.${w.game_id}`
      );
      const allFills = await db.select<FillRow>(
        "bot_fills",
        `select=strategy_id,venue,ticker,side,strike,action,price,count,fee&mode=eq.${MODE}&game_id=eq.${w.game_id}`
      );
      const trades = new Map<VenueId, Trade[]>();
      for (const [v] of ladders) {
        const rv = allResting.filter((r) => r.venue === v);
        const tickers = [...new Set(rv.map((r) => r.ticker))];
        // A venue's tape failing (e.g. rate limit) only costs that venue's fills this cycle.
        try {
          const since = Math.min(...rv.map(placedAt));
          if (!tickers.length) trades.set(v, []);
          // Novig rate-limits its trade tape and ProphetX only broadcasts trades over a websocket, so
          // read what the recorder (/api/record) and the ProphetX listener (/api/pxtape) saved; a trade
          // saved after this cycle is picked up next cycle (fills go by placed time).
          else if (v === "novig" || v === "prophetx")
            trades.set(v, (await db.select<{ ticker: string; t: string; yes_price: number }>(
              "bot_mkt_trades",
              `select=ticker,t,yes_price&game_id=eq.${w.game_id}&venue=eq.${v}&t=gt.${new Date(since * 1000).toISOString()}&order=t&limit=5000`
            )).filter((x) => tickers.includes(x.ticker)).map((x) => ({ ticker: x.ticker, t: Math.floor(new Date(x.t).getTime() / 1000), yesPrice: Number(x.yes_price) })));
          else trades.set(v, await adapters[v].trades(tickers, since));
        } catch (err) {
          trades.set(v, []);
          (totals.venueErrors ??= {})[v] = String(err instanceof Error ? err.message : err).slice(0, 200);
        }
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
        const bookFills = allFills.filter((f) => (f.strategy_id ?? null) === sid);
        const count = (v: VenueId, kind: "fills" | "placed") => {
          if (sid != null) {
            if (kind === "fills") totals.labFills++;
            return;
          }
          totals[kind]++;
          (totals.venues[v] ??= { ladders: 0, fills: 0, placed: 0 })[kind]++;
        };

        for (const [v, L] of ladders) {
          const adapter: VenueAdapter = adapters[v];
          const fee = adapter.fee(hours);
          const books = new Map(L.rungs.map((r) => [r.ticker, { bid: r.bid, ask: r.ask }]));
          let resting = allResting.filter((r) => (r.strategy_id ?? null) === sid && r.venue === v);
          const fillRow = (orderId: number, o: { ticker: string; action: "buy" | "sell"; price: number; count: number }, maker: boolean, fair: number | null) => {
            const r = L.rungs.find((x) => x.ticker === o.ticker);
            const row: FillRow & Record<string, unknown> = {
              mode: MODE, venue: v, strategy_id: sid, order_id: orderId, game_id: w.game_id, ticker: o.ticker, side: r?.side ?? "home", strike: r?.strike ?? 0,
              action: o.action, price: o.price, count: o.count, fee: fee(o.price, { count: o.count, maker }), fair_at_fill: fair,
              mid_at_fill: r?.bid != null && r?.ask != null ? (r.bid + r.ask) / 2 : null,
            };
            bookFills.push(row);
            count(v, "fills");
            return row;
          };

          // 1. Simulate fills on what was resting since the last cycle.
          const filled = paperFills(
            resting.map((r) => ({ id: r.id, ticker: r.ticker, action: r.action, price: Number(r.price), count: r.count, placedAt: placedAt(r) })),
            trades.get(v) ?? [],
            books
          );
          if (filled.length) {
            await db.update("bot_orders", `id=in.(${filled.map((f) => f.id).join(",")})`, { status: "filled", closed_at: iso() });
            await db.insert("bot_fills", filled.map((f) => fillRow(f.id, f, true, resting.find((x) => x.id === f.id)!.fair)));
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
            if (sid == null && v === "kalshi") totals.skipped++;
            continue;
          }

          // 3. Fair price: our number blended with the market (this venue's implied margin, else Kalshi's) by trust.
          const market = margins[v] ?? margins.kalshi ?? null;
          const center = blendedHomeMargin({ ycpr: ours, kalshi: market, book: sportsbook, hoursToKickoff: hours }, { ycprWeight: bk.weight, fade: false });
          if (center == null) continue;
          // No edge to lean on if our blended number doesn't favor the pick versus this venue's market.
          const ref = market ?? center;
          if (!(w.pick === "home" ? center > ref : center < ref)) {
            if (sid == null) totals.noEdge++;
            await cancel(resting.filter((r) => r.kind === "quote"));
            continue;
          }
          const pmf = marginPmf(center);
          if (sid == null) await snapshot(w.game_id, v, L.rungs, (r) => kalshiSpreadYesProb(pmf, r.side, r.strike));

          // 4. Decide orders; the loss cap counts this book's positions on the other venues too.
          const here = positionsFrom(bookFills.filter((f) => f.venue === v));
          const there = positionsFrom(bookFills.filter((f) => f.venue !== v));
          const otherPnl = there.positions.length ? pnlByMargin(there.rungs, there.positions, pmf.maxMargin) : undefined;
          const { orders } = ladderOrders(L.rungs, here.positions, pmf, { ...bk.cfg, tick: adapter.tick, fee }, { otherPnl });
          const plan = diffOrders(resting, orders, adapter.tick);
          await cancel(plan.cancel);
          // One insert for every new order (PostgREST returns rows in order), one for the takes' fills.
          if (plan.place.length) {
            const fulls = plan.place.map((o) => orders.find((x) => x.ticker === o.ticker && x.action === o.action && x.price === o.price && x.kind === o.kind)!);
            const rows = await db.insert<{ id: number }>(
              "bot_orders",
              plan.place.map((o, i) => ({
                mode: MODE, venue: v, strategy_id: sid, game_id: w.game_id, ticker: o.ticker, action: o.action, price: o.price, count: o.count, kind: o.kind,
                direction: fulls[i].direction, fair: fulls[i].fair, reason: fulls[i].reason, status: o.kind === "take" ? "filled" : "resting", closed_at: o.kind === "take" ? iso() : null,
              }))
            );
            plan.place.forEach(() => count(v, "placed"));
            const takes = plan.place.map((o, i) => (o.kind === "take" ? fillRow(rows[i].id, o, false, fulls[i].fair) : null)).filter((x) => x != null);
            if (takes.length) await db.insert("bot_fills", takes);
          }
        }
      }
    }
    recordDiag();
  } catch (err) {
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), error: String(err).slice(0, 2000) });
    throw err;
  } finally {
    await db.update("bot_runs", `id=eq.${run.id}`, {
      finished_at: iso(), games: totals.games, orders_placed: totals.placed, orders_cancelled: totals.cancelled, fills: totals.fills, summary: totals,
    }).catch(() => {});
    const perVenue = Object.entries(totals.venues).map(([v, x]) => `${v} ${x!.ladders}/${x!.fills}`).join(" ");
    console.log(`games ${totals.games}, skipped ${totals.skipped}, no-edge ${totals.noEdge}, placed ${totals.placed}, cancelled ${totals.cancelled}, fills ${totals.fills}, lab fills ${totals.labFills}, venues(ladders/fills) ${perVenue}`);
  }
  return totals;
}

if (process.argv[1]?.endsWith("paper.ts")) runCycle().catch((err) => {
  console.error(err instanceof Error ? err.message.split(":")[0] : "run failed");
  process.exit(1);
});
