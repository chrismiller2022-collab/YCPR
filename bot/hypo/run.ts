// Keeps Hypotheticals current: for every recorded game, every method (built-ins + lab
// strategies) and every venue set, continue the saved replay with the steps recorded since,
// and save state + summary to bot_hypo_results. Also serves on-demand what-ifs (customReplay).
// Runs after the market recorder (/api/record) and in the hourly GitHub backup.
// Logs counts only (the repo's Actions logs are public).

import { shrinkFrom } from "../fairPrice/shrink";
import { db, RUN_HOST } from "../runner/io";
import { makeAdapters, type VenueId } from "../venues";
import {
  advance, annotateSteps, builtinMethods, emptyState, methodHash, strategyMethod, summarize, VENUE_SETS,
  type HypoGame, type HypoState, type HypoSummary, type Method, type SnapRow, type Step, type VenueRules, type VenueSet,
} from "./replay";

const MODE = "hypo";
const iso = () => new Date().toISOString();
const unix = (s: string) => Math.floor(new Date(s).getTime() / 1000);
/** Leave the newest 2 minutes alone: the recorder may still be writing that cycle's trades. */
const SETTLE_S = 120;

export function venueRules(): Record<VenueId, VenueRules> {
  const a = makeAdapters();
  return { kalshi: { tick: a.kalshi.tick, fee: a.kalshi.fee }, novig: { tick: a.novig.tick, fee: a.novig.fee }, prophetx: { tick: a.prophetx.tick, fee: a.prophetx.fee } };
}

interface GameRow {
  game_id: string;
  home_team: string;
  away_team: string;
  kickoff: string;
  ycpr_home_margin: number | null;
  book_home_margin: number | null;
}

export async function methodsNow(): Promise<{ methods: Method[]; defaultTrust: number }> {
  const [state] = await db.select<{ default_ycpr_weight: number; beta: number | null; hump_cap: number | null; hump_fall: number | null; sigma: number | null; bankroll: number | null; kelly_frac: number | null }>("bot_state", "select=default_ycpr_weight,beta,hump_cap,hump_fall,sigma,bankroll,kelly_frac&id=eq.1");
  const shrink = shrinkFrom(state);
  const defaultTrust = state?.default_ycpr_weight == null ? 1 : Number(state.default_ycpr_weight);
  const strategies = await db.select<Parameters<typeof strategyMethod>[0]>("bot_strategies", "select=*&order=id");
  const tgt = { bankroll: Number(state?.bankroll ?? 1000), kellyFrac: Number(state?.kelly_frac ?? 0.25) };
  // Strategies on the rebuilt logic (shrunk fair value / target positions) are replayed as the built-in methods "Shrunk ladder" and
  // "Target positions", which use the current global settings; runners that predate them would otherwise replay these rows as plain ladders.
  const rows = strategies.filter((st) => (st as { method?: string }).method !== "target" && (st as { fair_mode?: string }).fair_mode !== "shrunk");
  return { methods: [...builtinMethods(defaultTrust, shrink, tgt), ...rows.map((st) => strategyMethod(st, defaultTrust, shrink, tgt))], defaultTrust };
}

export async function finals(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db.select<{ id: string; completed: boolean; home_points: number | null; away_points: number | null }>("games", `select=id,completed,home_points,away_points&id=in.(${ids.join(",")})`);
  return new Map(rows.filter((g) => g.completed && g.home_points != null && g.away_points != null).map((g) => [String(g.id), g.home_points! - g.away_points!]));
}

/** Recorded steps for a game after `since` (unix) up to `until`, with implied margins (computed and saved if new). */
export async function loadSteps(gameId: string, since: number, until: number, prior: Record<string, SnapRow> = {}): Promise<Step[]> {
  const sinceIso = new Date(since * 1000).toISOString();
  const untilIso = new Date(until * 1000).toISOString();
  const snaps = await db.selectAll<SnapRow & { taken_at: string }>(
    "bot_mkt_snaps",
    `select=venue,ticker,side,strike,bid,ask,taken_at&game_id=eq.${gameId}&taken_at=gt.${sinceIso}&taken_at=lte.${untilIso}&order=taken_at,id`
  );
  if (!snaps.length) return [];
  const byT = new Map<number, SnapRow[]>();
  for (const s of snaps) {
    const t = unix(s.taken_at);
    (byT.get(t) ?? byT.set(t, []).get(t)!).push({ venue: s.venue, ticker: s.ticker, side: s.side, strike: Number(s.strike), bid: s.bid == null ? null : Number(s.bid), ask: s.ask == null ? null : Number(s.ask) });
  }
  const times = [...byT.keys()].sort((a, b) => a - b);
  const lastT = times[times.length - 1];
  const trades = await db.selectAll<{ venue: VenueId; ticker: string; t: string; yes_price: number }>(
    "bot_mkt_trades",
    `select=venue,ticker,t,yes_price&game_id=eq.${gameId}&t=gt.${sinceIso}&t=lte.${new Date(lastT * 1000).toISOString()}&order=t,id`
  );
  const known = new Map<string, number | null>();
  for (const r of await db.selectAll<{ venue: string; t: string; margin: number | null }>("bot_mkt_implied", `select=venue,t,margin&game_id=eq.${gameId}&t=gt.${sinceIso}&t=lte.${untilIso}&order=t`))
    known.set(`${r.venue}|${unix(r.t)}`, r.margin == null ? null : Number(r.margin));
  let ti = 0;
  let prev = since;
  const raw: Step[] = times.map((t) => {
    const tr = [];
    while (ti < trades.length && unix(trades[ti].t) <= t) {
      const x = trades[ti++];
      if (unix(x.t) > prev) tr.push({ venue: x.venue, ticker: x.ticker, t: unix(x.t), yesPrice: Number(x.yes_price) });
    }
    prev = t;
    return { t, snaps: byT.get(t)!, trades: tr };
  });
  const steps = annotateSteps(raw, prior, known);
  const fresh = steps.flatMap((st) => Object.entries(st.implied ?? {}).filter(([v]) => !known.has(`${v}|${st.t}`)).map(([v, m]) => ({ game_id: gameId, venue: v, t: new Date(st.t * 1000).toISOString(), margin: m })));
  for (let i = 0; i < fresh.length; i += 500) await db.upsert("bot_mkt_implied", fresh.slice(i, i + 500), "game_id,venue,t");
  return steps;
}

const gameOf = (g: GameRow, final: number | null): HypoGame => ({
  ycpr: g.ycpr_home_margin == null ? null : Number(g.ycpr_home_margin),
  book: g.book_home_margin == null ? null : Number(g.book_home_margin),
  kickoff: unix(g.kickoff),
  final,
});

export interface HypoTotals {
  games: number;
  combos: number;
  steps: number;
  restarted: number;
  deferred?: number;
  overlapped?: boolean;
}

/** Bring every game × method × venue set up to date. */
export async function runHypo(budgetMs = 200e3): Promise<HypoTotals> {
  const started = Date.now();
  const totals: HypoTotals = { games: 0, combos: 0, steps: 0, restarted: 0 };
  // The GitHub backup may run up to ~20 min; a run killed at a platform limit is closed after 25.
  const recent = await db.select("bot_runs", `select=id&mode=eq.${MODE}&finished_at=is.null&started_at=gte.${new Date(Date.now() - 25 * 60e3).toISOString()}`);
  if (recent.length) return { ...totals, overlapped: true };
  await db.update("bot_runs", `mode=eq.${MODE}&finished_at=is.null&started_at=lt.${new Date(Date.now() - 25 * 60e3).toISOString()}`, { finished_at: iso(), error: "timed out" });
  const [run] = await db.insert<{ id: number }>("bot_runs", { mode: MODE, host: RUN_HOST });
  try {
    const { methods } = await methodsNow();
    const rules = venueRules();
    const games = await db.select<GameRow>("bot_mkt_games", `select=game_id,home_team,away_team,kickoff,ycpr_home_margin,book_home_margin&kickoff=gte.${new Date(Date.now() - 10 * 86400e3).toISOString()}&order=kickoff`);
    const fin = await finals(games.map((g) => g.game_id));
    const now = Math.floor(Date.now() / 1000);
    for (const g of games) {
      if (Date.now() - started > budgetMs) {
        totals.deferred = (totals.deferred ?? 0) + 1;
        continue;
      }
      const game = gameOf(g, fin.get(g.game_id) ?? null);
      const until = Math.min(now - SETTLE_S, game.kickoff);
      // Cheap checks first: has anything been recorded since, did any method change, does a final need applying?
      const [pos] = await db.select<{ t: number; books: Record<string, SnapRow> }>("bot_hypo_games", `select=t,books&game_id=eq.${g.game_id}`);
      const sharedT = Number(pos?.t ?? 0);
      const heads = await db.select<{ method: string; venues: VenueSet; hash: string; settled: number | null }>("bot_hypo_results", `select=method,venues,hash,settled:summary->settled&game_id=eq.${g.game_id}`);
      const head = new Map(heads.map((h) => [`${h.method}|${h.venues}`, h]));
      const all = methods.flatMap((m) => VENUE_SETS.map((set) => ({ m, set, h: head.get(`${m.key}|${set}`) })));
      const stale = all.filter((c) => !c.h || c.h.hash !== methodHash(c.m));
      const [newest] = await db.select<{ taken_at: string }>("bot_mkt_snaps", `select=taken_at&game_id=eq.${g.game_id}&order=taken_at.desc&limit=1`);
      const hasNew = newest != null && unix(newest.taken_at) > sharedT && unix(newest.taken_at) <= until;
      const needsFinal = game.final != null && all.some((c) => c.h && c.h.settled == null);
      if (!hasNew && !stale.length && !needsFinal) continue;

      const states = new Map(
        (await db.select<{ method: string; venues: VenueSet; state: HypoState }>("bot_hypo_results", `select=method,venues,state&game_id=eq.${g.game_id}`)).map((r) => [`${r.method}|${r.venues}`, r.state])
      );
      const restart = stale.length > 0 && sharedT > 0;
      totals.restarted += stale.length;
      // Restarting any combo means walking the history from the start (the others skip what they've seen).
      const since = restart ? 0 : sharedT;
      const prior = since === 0 ? {} : pos?.books ?? {};
      const steps = await loadSteps(g.game_id, since, until, prior);
      // Shared books after the last step; saved states carry no books (resumed from these).
      const books: Record<string, SnapRow> = { ...prior };
      for (const st of steps) for (const sn of st.snaps) books[`${sn.venue}|${sn.ticker}`] = sn;
      const rows = all.map((c) => {
        const key = `${c.m.key}|${c.set}`;
        const fresh = !c.h || c.h.hash !== methodHash(c.m);
        const prev = fresh ? emptyState() : { ...(states.get(key) ?? emptyState()) };
        if (!fresh) prev.books = Object.fromEntries(Object.entries(pos?.books ?? {}).filter(([k]) => c.set === "all" || k.startsWith(`${c.set}|`)));
        const state = advance(prev, steps, game, c.m, c.set, rules, now);
        const summary = summarize(state, game, c.set);
        return { game_id: g.game_id, method: c.m.key, venues: c.set, hash: methodHash(c.m), state: { ...state, books: {} }, summary, updated_at: iso() };
      });
      for (let i = 0; i < rows.length; i += 50) await db.upsert("bot_hypo_results", rows.slice(i, i + 50), "game_id,method,venues");
      const lastT = steps.length ? steps[steps.length - 1].t : sharedT;
      await db.upsert("bot_hypo_games", [{ game_id: g.game_id, t: Math.max(lastT, since === 0 ? 0 : sharedT), books, updated_at: iso() }], "game_id");
      totals.games++;
      totals.combos += rows.length;
      totals.steps += steps.length;
    }
  } catch (e) {
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), error: String(e).slice(0, 2000) });
    throw e;
  } finally {
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), games: totals.games, summary: totals }).catch(() => {});
    console.log(`hypo: games ${totals.games}, combos ${totals.combos}, steps ${totals.steps}, restarted ${totals.restarted}`);
  }
  return totals;
}

/** A what-if method, replayed from scratch on the given games (not saved). */
export async function customReplay(method: Method, set: VenueSet, gameIds: string[], budgetMs = 240e3): Promise<{ results: Record<string, HypoSummary>; skipped: string[] }> {
  const started = Date.now();
  const rules = venueRules();
  const games = gameIds.length ? await db.select<GameRow>("bot_mkt_games", `select=game_id,home_team,away_team,kickoff,ycpr_home_margin,book_home_margin&game_id=in.(${gameIds.join(",")})`) : [];
  const fin = await finals(games.map((g) => g.game_id));
  const now = Math.floor(Date.now() / 1000);
  const results: Record<string, HypoSummary> = {};
  const skipped: string[] = [];
  for (const g of games) {
    if (Date.now() - started > budgetMs) {
      skipped.push(g.game_id);
      continue;
    }
    const game = gameOf(g, fin.get(g.game_id) ?? null);
    const steps = await loadSteps(g.game_id, 0, Math.min(now - SETTLE_S, game.kickoff));
    results[g.game_id] = summarize(advance(emptyState(), steps, game, method, set, rules, now), game, set);
  }
  return { results, skipped };
}

if (process.argv[1]?.endsWith("run.ts")) runHypo(Number(process.env.BOT_HYPO_BUDGET_MS) || 20 * 60e3).catch((e) => {
  console.error(e instanceof Error ? e.message.split(":")[0] : "hypo failed");
  process.exit(1);
});
