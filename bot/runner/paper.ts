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
import { modelWith, pmMedian, shrinkFrom, shrunkHomeMargin } from "../fairPrice/shrink";
import { kalshiSpreadYesProb } from "../fairPrice/lines";
import { blendedHomeMargin, impliedHomeMargin, ladderOrders, pnlByMargin, type LadderConfig, type Position, type Rung } from "../ladder/engine";
import { makeAdapters, VENUES, type VenueAdapter, type VenueId, type VenueLadder } from "../venues";
import { diffOrders, paperFills, type Trade } from "./paperFills";
import { db, RUN_HOST } from "./io";
import { ycprAwaySpreads, type YcprGame } from "./ycpr";
import { syncEspnFinals } from "./espnFinals";
import { boardSnapshot, type BoardSnapshot, type SnapFill, type SnapWatch } from "./boardSnapshot";
import { decideTarget, heldFrom, riskEntry, type FillLike, type GameNames, type RiskEntry } from "./targetBook";

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
  /** The YC line as first synced; never overwritten (ycpr_home_margin is refreshed every cycle). */
  ycpr_original: number | null;
  kalshi_home_margin: number | null;
  /** Per-game trust in our number; null = use bot_state.default_ycpr_weight. */
  ycpr_weight: number | null;
  /** Per-game beta for the shrunk fair value; null = the global setting in bot_state. */
  beta: number | null;
  /** false = only the rebuilt books (shrunk fair value / target positions) trade this game; the Board and the original strategies skip it. */
  legacy: boolean | null;
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
  /** Shaped positions (§21); null = off. The three limits default in code (bot/ladder/shape.ts). */
  shape: boolean | null;
  market_floor: number | null;
  against_limit: number | null;
  blowout_margin: number | null;
}

/** The shape settings of a watch or strategy row, as ladder config. */
const shapeCfg = (x: { shape: boolean | null; market_floor: number | null; against_limit: number | null; blowout_margin: number | null }) => ({
  shape: !!x.shape, marketFloor: num(x.market_floor), againstLimit: num(x.against_limit), blowoutMargin: num(x.blowout_margin),
});

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
  shape: boolean | null;
  market_floor: number | null;
  against_limit: number | null;
  blowout_margin: number | null;
  /** "blend" (default) = the original fair value; "shrunk" = market + beta · capped gap (bot/fairPrice/shrink.ts). */
  fair_mode: "blend" | "shrunk" | null;
  /** 'ladder' = the original engine; 'target' = target-position rebalancing across venues (bot/ladder/target.ts). */
  method: "ladder" | "target" | null;
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
  method: "ladder" | "target";
  st?: Strategy;
  fairMode: "blend" | "shrunk";
  weight: number;
  stopMinutes: number;
  cfg: LadderConfig;
}

export interface CycleTotals {
  /** Which generation of the runner wrote this run: 3 = shrunk fair value, target-position books and the legacy flag (the dashboard checks this before enabling those strategies). */
  codeVersion?: number;
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
  /** Per-game problems that were skipped so the rest of the cycle could run. */
  gameErrors?: string[];
  /** Games left for the next cycle because this one hit its time budget. */
  deferred?: number;
  /** Per-venue response-shape notes (no prices or positions), for checking new adapters. */
  diag?: Partial<Record<VenueId, unknown>>;
  /** The Board's worst/best/expected per game after this cycle, for "change since last run" on the dashboard. */
  board?: BoardSnapshot;
  /** Final scores saved from ESPN this cycle. */
  espnFinals?: number;
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
      // Kickoff as a Z timestamp: a "+00:00" offset would arrive as a space in the query string.
      const at = new Date(w.kickoff).toISOString();
      const q = `select=bid,ask&game_id=eq.${w.game_id}&venue=eq.${f.venue}&ticker=eq.${encodeURIComponent(f.ticker)}&taken_at=lte.${at}&order=taken_at.desc&limit=1`;
      // The Board's snapshots, else the market recorder's (covers lines only lab strategies traded).
      let [s] = await db.select<{ bid: number | null; ask: number | null }>("bot_snapshots", q);
      if (s?.bid == null || s?.ask == null) [s] = await db.select<{ bid: number | null; ask: number | null }>("bot_mkt_snaps", q);
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
  const totals: CycleTotals = { codeVersion: 3, games: 0, placed: 0, cancelled: 0, fills: 0, skipped: 0, noEdge: 0, labFills: 0, venues: {} };
  const started = Date.now();
  const recent = await db.select<{ id: number }>("bot_runs", `select=id&mode=eq.${MODE}&finished_at=is.null&started_at=gte.${new Date(Date.now() - 4 * 60e3).toISOString()}`);
  if (recent.length) return { ...totals, overlapped: true };
  // Runs the platform killed at its time limit never reach `finally`; close them out.
  await db.update("bot_runs", `mode=eq.${MODE}&finished_at=is.null&started_at=lt.${new Date(Date.now() - 6 * 60e3).toISOString()}`, { finished_at: iso(), error: "timed out" });
  const [run] = await db.insert<{ id: number }>("bot_runs", { mode: MODE, host: RUN_HOST });
  try {
    const [state] = await db.select<{ mode: string; kill_switch: boolean; default_ycpr_weight: number; beta: number | null; hump_cap: number | null; hump_fall: number | null; sigma: number | null; bankroll: number | null; kelly_frac: number | null; team_cap: number | null; conf_cap: number | null; portfolio_cap: number | null }>("bot_state", "select=mode,kill_switch,default_ycpr_weight,beta,hump_cap,hump_fall,sigma,bankroll,kelly_frac,team_cap,conf_cap,portfolio_cap&id=eq.1");
    const defaultTrust = num(state?.default_ycpr_weight) ?? 1;
    // Final scores from ESPN for games that should be over, so they grade without waiting for a CFBD sync.
    try {
      const f = await syncEspnFinals();
      if (f.saved) totals.espnFinals = f.saved;
    } catch (err) {
      (totals.gameErrors ??= []).push(`ESPN finals: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
    }
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
    // Paused or removed games aren't traded, but still get graded once they've kicked off.
    for (const w of await db.select<Watch>("bot_watchlist", `select=*&enabled=is.false&kickoff=lt.${iso()}`)) {
      try {
        await settle(w);
      } catch (err) {
        (totals.gameErrors ??= []).push(`settle ${w.away_team} @ ${w.home_team}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
      }
    }
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
    const games = await db.select<YcprGame & { home_conference: string | null; away_conference: string | null }>("games", `select=id,season,week,home_team,away_team,neutral_site,home_conference,away_conference&id=in.(${watch.map((w) => w.game_id).join(",")})`);
    const confOf = new Map(games.map((g) => [String(g.id), g]));
    const ycpr = await ycprAwaySpreads(games);
    for (const w of watch) {
      const yc = ycpr.get(String(w.game_id)) ?? null;
      const first = yc != null && num(w.ycpr_original) == null;
      if (yc != null && (num(w.ycpr_home_margin) !== yc || first)) {
        await db.update("bot_watchlist", `id=eq.${w.id}`, { ycpr_home_margin: yc, ycpr_updated_at: iso(), ...(first ? { ycpr_original: yc, ycpr_original_at: iso() } : {}) });
        w.ycpr_home_margin = yc;
        if (first) w.ycpr_original = yc;
      }
    }

    // What each target-position book risks now on every game, for the portfolio / team / conference caps shared between games.
    const namesOf = (w: Watch): GameNames => ({ home: w.home_team, away: w.away_team, homeConf: confOf.get(String(w.game_id))?.home_conference ?? null, awayConf: confOf.get(String(w.game_id))?.away_conference ?? null });
    const targetIds = strategies.filter((s) => s.method === "target").map((s) => s.id);
    const risk = new Map<number, Map<string, RiskEntry>>();
    if (targetIds.length) {
      const open = await db.selectAll<FillRow & { game_id: string; strategy_id: number }>(
        "bot_fills",
        `select=game_id,strategy_id,venue,ticker,side,strike,action,price,count,fee&mode=eq.${MODE}&strategy_id=in.(${targetIds.join(",")})&result=is.null&order=id`
      );
      for (const id of targetIds) {
        const m = new Map<string, RiskEntry>();
        for (const w of watch) {
          const f = open.filter((x) => x.strategy_id === id && String(x.game_id) === String(w.game_id));
          if (f.length) m.set(String(w.game_id), riskEntry(String(w.game_id), heldFrom(f as FillLike[]), namesOf(w)));
        }
        risk.set(id, m);
      }
    }

    // Time budget: stop starting games before the function limit; start from a different game each
    // cycle so a slow cycle never starves the same games.
    const deadline = started + BUDGET_MS;
    const off = run.id % watch.length;
    for (const w of [...watch.slice(off), ...watch.slice(0, off)]) {
      try {
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
          // A grading problem on one game must never stop the others from trading.
          try {
            await settle(w);
          } catch (err) {
            (totals.gameErrors ??= []).push(`settle ${w.away_team} @ ${w.home_team}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
          }
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

        // The shrunk fair value and the PM median it hangs from, for the books that use it and for every fill's context columns.
        const shrinkCfg = shrinkFrom(state, w.beta);
        const pm = pmMedian(margins);
        const sh = shrunkHomeMargin(ours, pm, shrinkCfg);

        const bookList: Book[] = [
          {
            strategyId: null,
            method: "ladder" as const,
            fairMode: "blend",
            weight: num(w.ycpr_weight) ?? defaultTrust, // per-game trust wins over the default
            stopMinutes: w.stop_minutes_before,
            cfg: {
              pick: w.pick, maxWorstCaseLoss: Number(w.max_worst_case_loss), perRungCap: w.per_rung_cap, orderSize: w.order_size,
              proEdge: Number(w.pro_edge), antiEdge: Number(w.anti_edge), takeEdge: Number(w.take_edge), edgeStep: Number(w.edge_step),
              profitTarget: num(w.profit_target), tick: 0.01, ...shapeCfg(w),
            },
          },
          ...strategies.map((st) => ({
            strategyId: st.id,
            method: st.method === "target" ? ("target" as const) : ("ladder" as const),
            st,
            fairMode: st.fair_mode === "shrunk" ? ("shrunk" as const) : ("blend" as const),
            weight: num(st.ycpr_weight) ?? defaultTrust,
            stopMinutes: st.stop_minutes_before,
            cfg: {
              pick: w.pick, maxWorstCaseLoss: Number(st.max_worst_case_loss), perRungCap: st.per_rung_cap, orderSize: 1,
              proEdge: Number(st.pro_edge), antiEdge: Number(st.anti_edge), takeEdge: Number(st.take_edge), edgeStep: Number(st.edge_step),
              profitTarget: null, tick: 0.01, ...shapeCfg(st),
            } as LadderConfig,
          })),
        ];

        for (const bk of bookList) {
          const sid = bk.strategyId;
          // Games the weekly workflow added are for the rebuilt books only.
          if (w.legacy === false && bk.method === "ladder" && bk.fairMode === "blend") continue;
          const bookFills = allFills.filter((f) => (f.strategy_id ?? null) === sid);
          const count = (v: VenueId, kind: "fills" | "placed") => {
            if (sid != null) {
              if (kind === "fills") totals.labFills++;
              return;
            }
            totals[kind]++;
            (totals.venues[v] ??= { ladders: 0, fills: 0, placed: 0 })[kind]++;
          };

          if (bk.method === "target") {
            // Target-position book: one decision for the game across every venue; takes only, no resting quotes.
            const st = bk.st!;
            if (kickoff != null && now() >= kickoff - bk.stopMinutes * 60) continue;
            if (sh.fair == null || pm == null) continue;
            const names = namesOf(w);
            const decision = decideTarget({
              books: [...ladders].map(([v, L]) => ({ venue: v, rungs: L.rungs, fee: adapters[v].fee(hours, L.eventKey) })),
              fills: bookFills as FillLike[],
              fair: sh.fair,
              edgePts: sh.edgePts ?? 0,
              sigma: shrinkCfg.sigma,
              strategy: { max_worst_case_loss: Number(st.max_worst_case_loss), per_rung_cap: st.per_rung_cap, take_edge: Number(st.take_edge) },
              settings: state,
              others: [...(risk.get(st.id)?.values() ?? [])].filter((r) => r.gameId !== String(w.game_id)),
              game: names,
            });
            if (decision.orders.length) {
              const rows = await db.insert<{ id: number }>(
                "bot_orders",
                decision.orders.map((o) => ({
                  mode: MODE, venue: o.venue, strategy_id: sid, game_id: w.game_id, ticker: o.ticker, action: o.action, price: o.price, count: o.count, kind: "take",
                  direction: o.direction, fair: o.fair, reason: o.reason.slice(0, 200), status: "filled", closed_at: iso(),
                }))
              );
              const fillRows = decision.orders.map((o, i) => {
                const L = ladders.get(o.venue as VenueId)!;
                const r = L.rungs.find((x) => x.ticker === o.ticker);
                return {
                  mode: MODE, venue: o.venue as VenueId, strategy_id: sid, order_id: rows[i].id, game_id: w.game_id, ticker: o.ticker, side: r?.side ?? "home", strike: r?.strike ?? 0,
                  action: o.action, price: o.price, count: o.count, fee: adapters[o.venue as VenueId].fee(hours, L.eventKey)(o.price, { count: o.count, maker: false }),
                  fair_at_fill: o.fair, mid_at_fill: r?.bid != null && r?.ask != null ? (r.bid + r.ask) / 2 : null,
                  ycpr_at_fill: ours, market_at_fill: pm, shrunk_at_fill: sh.fair, hours_to_kickoff: Math.round(hours * 1000) / 1000, is_maker: false,
                };
              });
              await db.insert("bot_fills", fillRows);
              bookFills.push(...(fillRows as unknown as FillRow[]));
              totals.labFills += fillRows.length;
            }
            (risk.get(st.id) ?? risk.set(st.id, new Map()).get(st.id)!).set(String(w.game_id), riskEntry(String(w.game_id), heldFrom(bookFills as FillLike[]), names));
            // The plan behind these orders, for the dashboard (a failing write never stops trading).
            try {
              const mid = (a: number[]) => a.slice(40, 121).map((v) => Math.round(v * 100) / 100);
              await db.upsert("bot_plans", [{
                game_id: w.game_id, strategy_id: sid, updated_at: iso(),
                plan: {
                  lean: decision.plan.lean, edgePts: decision.plan.edgePts, ycpr: ours, pmMedian: pm, shrunkFair: sh.fair, rawGap: sh.gap, beta: shrinkCfg.beta,
                  slope: decision.plan.slope, openable: decision.plan.openable, scale: decision.plan.scale, room: decision.room,
                  worstBefore: decision.plan.worstBefore, worstAfter: decision.plan.worstAfter, expectedAfter: decision.plan.expectedAfter,
                  curveBefore: mid(decision.plan.curveBefore), curveAfter: mid(decision.plan.curveAfter), heldByX: decision.plan.heldByX, notes: decision.notes,
                  orders: decision.orders.map((o) => ({ venue: o.venue, ticker: o.ticker, action: o.action, price: o.price, count: o.count, direction: o.direction, reason: o.reason, forced: o.forced ?? false })),
                },
              }], "game_id,strategy_id");
            } catch {}
            continue;
          }

          for (const [v, L] of ladders) {
            const adapter: VenueAdapter = adapters[v];
            const fee = adapter.fee(hours, L.eventKey);
            const books = new Map(L.rungs.map((r) => [r.ticker, { bid: r.bid, ask: r.ask }]));
            let resting = allResting.filter((r) => (r.strategy_id ?? null) === sid && r.venue === v);
            const fillRow = (orderId: number, o: { ticker: string; action: "buy" | "sell"; price: number; count: number }, maker: boolean, fair: number | null) => {
              const r = L.rungs.find((x) => x.ticker === o.ticker);
              const row: FillRow & Record<string, unknown> = {
                mode: MODE, venue: v, strategy_id: sid, order_id: orderId, game_id: w.game_id, ticker: o.ticker, side: r?.side ?? "home", strike: r?.strike ?? 0,
                action: o.action, price: o.price, count: o.count, fee: fee(o.price, { count: o.count, maker }), fair_at_fill: fair,
                mid_at_fill: r?.bid != null && r?.ask != null ? (r.bid + r.ask) / 2 : null,
                // Context for markouts and entry-line beta: the model line, the PM median and the shrunk fair at this moment.
                ycpr_at_fill: ours, market_at_fill: pm, shrunk_at_fill: sh.fair, hours_to_kickoff: Math.round(hours * 1000) / 1000, is_maker: maker,
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

            // 3. Fair price. Original books: our number blended with the market (this venue's implied margin, else Kalshi's) and
            //    the sportsbook by trust. Shrunk books: PM median + beta · capped gap, the same for every venue.
            const shrunk = bk.fairMode === "shrunk";
            const market = shrunk ? pm : margins[v] ?? margins.kalshi ?? null;
            const center = shrunk ? sh.fair : blendedHomeMargin({ ycpr: ours, kalshi: market, book: sportsbook, hoursToKickoff: hours }, { ycprWeight: bk.weight, fade: false });
            if (center == null) {
              if (shrunk) await cancel(resting.filter((r) => r.kind === "quote"));
              continue;
            }
            // No edge to lean on if our fair number doesn't favor the pick versus this market.
            const ref = market ?? center;
            if (!(w.pick === "home" ? center > ref : center < ref)) {
              if (sid == null) totals.noEdge++;
              await cancel(resting.filter((r) => r.kind === "quote"));
              continue;
            }
            const pmf = shrunk ? marginPmf(center, modelWith(shrinkCfg.sigma)) : marginPmf(center);
            if (sid == null) await snapshot(w.game_id, v, L.rungs, (r) => kalshiSpreadYesProb(pmf, r.side, r.strike));

            // 4. Decide orders; the loss cap counts this book's positions on the other venues too.
            const here = positionsFrom(bookFills.filter((f) => f.venue === v));
            const there = positionsFrom(bookFills.filter((f) => f.venue !== v));
            const otherPnl = there.positions.length ? pnlByMargin(there.rungs, there.positions, pmf.maxMargin) : undefined;
            const { orders } = ladderOrders(L.rungs, here.positions, pmf, { ...bk.cfg, tick: adapter.tick, fee }, { otherPnl, marketHomeMargin: shrunk ? market : market ?? sportsbook ?? center });
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
      } catch (err) {
        // One game failing (bad data, a venue hiccup) skips that game this cycle, not the whole cycle.
        (totals.gameErrors ??= []).push(`${w.away_team} @ ${w.home_team}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
      }
    }
    recordDiag();
    // A snapshot that fails to build never fails the cycle; the dashboard just shows no change for this run.
    try {
      const all = await db.select<SnapWatch>("bot_watchlist", "select=game_id,my_home_margin,ycpr_home_margin,kalshi_home_margin,venue_margins");
      const fills = all.length
        ? await db.selectAll<SnapFill>("bot_fills", `select=game_id,venue,ticker,side,strike,action,price,count,fee&mode=eq.${MODE}&strategy_id=is.null&game_id=in.(${all.map((w) => w.game_id).join(",")})&order=id`)
        : [];
      totals.board = boardSnapshot(all, fills);
    } catch {}
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
