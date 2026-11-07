// Market recorder for Hypotheticals: every FBS game in the next 8 days, on every
// venue, each cycle. Stores a rung only when its bid/ask changed, and pulls a
// ticker's trades only when its traded volume moved (ProphetX has no tape).
// Triggered by ycpr-bot's /api/record (kicked off by /api/cycle) and the hourly
// GitHub Actions backup. Reads public market data only; never places orders.
// The repo's Actions logs are public: log counts only.

import { impliedHomeMargin, type Rung } from "../ladder/engine";
import { makeAdapters, VENUES, type VenueId } from "../venues";
import { db, RUN_HOST, withEgress } from "./io";
import { isQuietHours } from "./quietHours";
import { readState, writeState } from "./localState";
import { errorLines, notifyErrors, notifyFailure } from "./notify";
import { ycprAwaySpreads, type YcprGame } from "./ycpr";

const MODE = "record";
const BUDGET_MS = Number(process.env.BOT_RECORD_BUDGET_MS) || 200e3;
const LAST_FILE = "mkt-last.json";
const LAST_RESYNC_MS = 6 * 3600e3;
const iso = () => new Date().toISOString();

interface Game extends YcprGame {
  start_date: string;
}
interface Last {
  venue: VenueId;
  ticker: string;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  last_trade_t: number | null;
}

export interface RecordTotals {
  quiet?: boolean; // skipped for overnight quiet hours (see quietHours.ts)
  games: number;
  ladders: Partial<Record<VenueId, number>>;
  snaps: number;
  trades: number;
  deferred?: number;
  venueErrors?: Partial<Record<VenueId, string>>;
  overlapped?: boolean;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function runRecord(): Promise<RecordTotals> {
  const started = Date.now();
  const totals: RecordTotals = { games: 0, ladders: {}, snaps: 0, trades: 0 };
  if (isQuietHours()) return { ...totals, quiet: true }; // overnight: no recording, no database calls
  const recent = await db.select("bot_runs", `select=id&mode=eq.${MODE}&finished_at=is.null&started_at=gte.${new Date(Date.now() - 4 * 60e3).toISOString()}`);
  if (recent.length) return { ...totals, overlapped: true };
  await db.update("bot_runs", `mode=eq.${MODE}&finished_at=is.null&started_at=lt.${new Date(Date.now() - 6 * 60e3).toISOString()}`, { finished_at: iso(), error: "timed out" });
  const [run] = await db.insert<{ id: number }>("bot_runs", { mode: MODE, host: RUN_HOST });
  const err = (v: VenueId, e: unknown) => ((totals.venueErrors ??= {})[v] = String(e instanceof Error ? e.message : e).slice(0, 200));
  let saveLast: (() => void) | null = null; // set once the last-price copy is loaded; saved however the run ends
  try {
    const now = new Date();
    const window = `start_date=gte.${now.toISOString()}&start_date=lte.${new Date(now.getTime() + 8 * 86400e3).toISOString()}`;
    const cols = "select=id,season,week,start_date,home_team,away_team,neutral_site";
    const games = await db.select<Game>("games", `${cols}&${window}&or=(home_classification.eq.fbs,away_classification.eq.fbs)&order=start_date.asc&limit=300`);
    // FCS vs FCS games are recorded only once they're on the watchlist: there are ~60 a week, and recording them all would
    // roughly double this job's database reads for games nobody is trading.
    const watched = await db.select<{ game_id: string }>("bot_watchlist", "select=game_id&enabled=is.true");
    const have = new Set(games.map((g) => String(g.id)));
    const extraIds = watched.map((w) => String(w.game_id)).filter((id) => !have.has(id));
    if (extraIds.length) {
      const fcs = await db.select<Game>("games", `${cols}&${window}&id=in.(${extraIds.join(",")})&home_classification=eq.fcs&away_classification=eq.fcs`);
      games.push(...fcs);
    }
    if (!games.length) return totals;
    let ycpr = new Map<string, number>();
    try {
      ycpr = await ycprAwaySpreads(games);
    } catch {}
    const lines = await db.selectAll<{ game_id: string; provider: string; spread: number }>(
      "betting_lines",
      `select=game_id,provider,spread&game_id=in.(${games.map((g) => g.id).join(",")})&spread=not.is.null&order=game_id`
    );
    const rank = (p: string) => (p === "market_median" ? 0 : p === "consensus" ? 1 : 2);
    const book = new Map<string, number>();
    for (const l of lines.sort((a, b) => rank(a.provider) - rank(b.provider))) if (!book.has(String(l.game_id))) book.set(String(l.game_id), -Number(l.spread));
    const known = new Map((await db.select<{ game_id: string; venue_events: Partial<Record<VenueId, string>> }>("bot_mkt_games", `select=game_id,venue_events&game_id=in.(${games.map((g) => g.id).join(",")})`)).map((r) => [r.game_id, r.venue_events ?? {}]));

    // Polymarket: off = not recorded; read (default) = recorded and shown, kept out of the PM median; paper = a venue like the others.
    const [st] = await db.select<{ polymarket_mode: string | null }>("bot_state", "select=polymarket_mode&id=eq.1").catch(() => []);
    const pmMode = st?.polymarket_mode === "off" || st?.polymarket_mode === "paper" ? st.polymarket_mode : "read";
    const adapters = makeAdapters();
    const active: VenueId[] = [];
    for (const v of VENUES) {
      if (v === "polymarket" && pmMode === "off") continue;
      if (!adapters[v].available()) continue;
      try {
        await adapters[v].prepare();
        active.push(v);
      } catch (e) {
        err(v, e);
      }
    }
    // Every market's last price, volume and newest trade time, to skip unchanged prices and fetch only new trades. The tower
    // is the only writer, so it keeps its own copy (LAST_FILE) instead of downloading all ~17,000 rows every run; the copy
    // is refreshed from the database at least every LAST_RESYNC_MS.
    // A run that was cut off (still marked dirty) may have written rows its copy doesn't know about: reload then.
    const cached = readState<{ at: number; dirty?: boolean; rows: Last[] }>(LAST_FILE);
    const fresh = cached && !cached.dirty && Date.now() - cached.at < LAST_RESYNC_MS;
    const lastRowsAll = fresh ? cached.rows : await db.selectAll<Last>("bot_mkt_last", "select=*&order=venue,ticker");
    const lastAt = fresh ? cached.at : Date.now();
    const last = new Map<string, Last>();
    for (const r of lastRowsAll) last.set(`${r.venue}|${r.ticker}`, r);
    writeState(LAST_FILE, { at: lastAt, dirty: true, rows: lastRowsAll });
    saveLast = () => writeState(LAST_FILE, { at: lastAt, dirty: false, rows: [...last.values()] });

    await pool(games, 4, async (g) => {
      if (Date.now() > started + BUDGET_MS) {
        totals.deferred = (totals.deferred ?? 0) + 1;
        return;
      }
      const gid = String(g.id);
      const events = { ...(known.get(gid) ?? {}) };
      const margins: Partial<Record<VenueId, number>> = {};
      const ro: Partial<Record<VenueId, number>> = {};
      const snaps: object[] = [];
      const trades: object[] = [];
      const lastRows: Last[] = [];
      for (const v of active) {
        let rungs: Rung[];
        try {
          const L = await adapters[v].ladder({ home_team: g.home_team, away_team: g.away_team, bookHomeMargin: book.get(gid) ?? null, eventKey: events[v] ?? null });
          if (!L?.rungs.length) continue;
          events[v] = L.eventKey;
          rungs = L.rungs;
        } catch (e) {
          err(v, e);
          continue;
        }
        totals.ladders[v] = (totals.ladders[v] ?? 0) + 1;
        const m = impliedHomeMargin(rungs);
        if (m != null) (v === "polymarket" && pmMode !== "paper" ? ro : margins)[v] = Math.round(m * 100) / 100;
        const moved: string[] = [];
        let since = Infinity;
        for (const r of rungs) {
          const prev = last.get(`${v}|${r.ticker}`);
          const vol = adapters[v].volume?.(r.ticker) ?? null;
          const priceChanged = !prev || Number(prev.bid ?? -1) !== (r.bid ?? -1) || Number(prev.ask ?? -1) !== (r.ask ?? -1);
          if (priceChanged) snaps.push({ game_id: gid, venue: v, ticker: r.ticker, side: r.side, strike: r.strike, bid: r.bid, ask: r.ask });
          // First sighting: just remember the volume; afterwards, any change means trades to fetch.
          if (prev && vol != null && Number(prev.volume ?? 0) !== vol) {
            moved.push(r.ticker);
            since = Math.min(since, prev.last_trade_t ?? Math.floor(Date.now() / 1000) - 3600);
          }
          if (priceChanged || (vol != null && Number(prev?.volume ?? -1) !== vol))
            lastRows.push({ venue: v, ticker: r.ticker, bid: r.bid, ask: r.ask, volume: vol, last_trade_t: prev?.last_trade_t ?? null });
        }
        if (moved.length) {
          try {
            const got = await adapters[v].trades(moved, since);
            for (const t of got) {
              const prev = last.get(`${v}|${t.ticker}`);
              if (prev?.last_trade_t != null && t.t <= prev.last_trade_t) continue;
              trades.push({ game_id: gid, venue: v, ticker: t.ticker, t: new Date(t.t * 1000).toISOString(), yes_price: t.yesPrice });
            }
            for (const tk of moved) {
              const newest = Math.max(...got.filter((t) => t.ticker === tk).map((t) => t.t), last.get(`${v}|${tk}`)?.last_trade_t ?? 0);
              const row = lastRows.find((r) => r.ticker === tk && r.venue === v);
              if (row && newest > 0) row.last_trade_t = newest;
            }
          } catch (e) {
            err(v, e);
            // Leave volume unchanged so these trades are fetched next cycle.
            for (const row of lastRows) if (row.venue === v && moved.includes(row.ticker)) row.volume = last.get(`${v}|${row.ticker}`)?.volume ?? null;
          }
        }
      }
      if (snaps.length) await db.insertQuiet("bot_mkt_snaps", snaps);
      if (trades.length) await db.insertQuiet("bot_mkt_trades", trades);
      if (lastRows.length) {
        await db.upsert("bot_mkt_last", lastRows, "venue,ticker");
        for (const r of lastRows) last.set(`${r.venue}|${r.ticker}`, r);
      }
      await db.upsert("bot_mkt_games", [{
        game_id: gid, season: g.season, week: g.week, kickoff: g.start_date, home_team: g.home_team, away_team: g.away_team,
        ycpr_home_margin: ycpr.get(gid) ?? null, book_home_margin: book.get(gid) ?? null, venue_events: events, venue_margins: margins, ro_margins: ro, updated_at: iso(),
      }], "game_id");
      totals.games++;
      totals.snaps += snaps.length;
      totals.trades += trades.length;
    });
  } catch (e) {
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), error: String(e).slice(0, 2000) });
    throw e;
  } finally {
    saveLast?.();
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: iso(), games: totals.games, summary: withEgress(totals) }).catch(() => {});
    await notifyErrors("recorder", errorLines(totals));
    console.log(`record: games ${totals.games}, snaps ${totals.snaps}, trades ${totals.trades}, ladders ${JSON.stringify(totals.ladders)}`);
  }
  return totals;
}

if (process.argv[1]?.endsWith("record.ts")) runRecord().catch(async (e) => {
  console.error(e instanceof Error ? e.message.split(":")[0] : "record failed");
  await notifyFailure("recorder", e);
  process.exit(1);
});
