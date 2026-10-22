// Live desk feed. The desk screen never reads the database: it renders the snapshots this module hands to
// onSnapshot. Today the feed polls GET /api/live every few seconds with a cursor and merges the changes; later it
// becomes a subscription to the tower worker that delivers the same snapshot shape (docs/kalshi-bot-handoff.md §19).
import { positions, worstBest, expectedPnl, marginPmf, marketMargin, oursOf, gameStatus } from "./model.js";

export const POLL_MS = 7000;
const MOVE_GROUP_MS = 60e3; // a cancel and a place on the same rung this close together are one re-price

const localMidnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
const num = (x) => (x == null || x === "" ? null : Number(x));

async function defaultGet(path) {
  let pw = "";
  try { pw = localStorage.getItem("botpw") || ""; } catch {}
  const res = await fetch(path, { headers: { "x-bot-password": pw } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

/**
 * Start feeding desk snapshots for one focused game.
 * opts: { gameId, range: "15m"|"1h"|"6h"|"24h"|"all", book: null (Board) | strategy id, get: (path) => json, pollMs }.
 * Returns controls: setGame, setRange, setBook, refresh (e.g. after an admin action), pause/resume, stop.
 */
export function startFeed(onSnapshot, opts = {}) {
  let gameId = opts.gameId ?? null;
  let range = opts.range ?? "6h";
  let book = opts.book ?? null;
  const get = opts.get ?? defaultGet;
  const pollMs = opts.pollMs ?? POLL_MS;
  const S = {
    cursor: null, asOf: null, receivedAt: 0, error: null,
    state: null, runs: { paper: [], record: null }, watchlist: [], strategies: [], mktGame: null,
    orders: new Map(), fills: new Map(), rungs: new Map(), ladder: new Map(), trades: [], lines: [], live: [],
  };
  let gameFresh = false, linesFresh = false, watchFresh = false;
  let timer = null, stopped = false, paused = false, busy = false, again = false;

  function resetGame() {
    S.ladder.clear();
    S.trades = [];
    S.lines = [];
    S.live = [];
    S.mktGame = null;
  }

  function merge(d) {
    S.cursor = d.cursor;
    S.asOf = d.asOf;
    S.receivedAt = Date.now();
    S.error = null;
    S.state = d.state ?? S.state;
    S.runs = d.runs ?? S.runs;
    if (d.strategies) S.strategies = d.strategies;
    if (d.watchlist) {
      S.watchlist = d.watchlist;
      // Each cycle refreshes the watchlist's per-venue implied margins: a live point on the chart between the
      // hourly implied-line backfills.
      const w = d.watchlist.find((x) => x.game_id === gameId);
      if (w) for (const [venue, m] of Object.entries(w.venue_margins || {})) {
        if (m == null) continue;
        const t = w.kalshi_updated_at || d.asOf;
        const prev = S.live.filter((p) => p.venue === venue).at(-1);
        if (!prev || prev.t !== t) S.live.push({ venue, t, margin: Number(m), live: true });
      }
    }
    if (d.mktGame !== undefined) S.mktGame = d.mktGame;
    for (const o of d.orders || []) S.orders.set(o.id, o);
    for (const f of d.fills || []) S.fills.set(f.id, f);
    for (const r of d.rungs || []) S.rungs.set(`${r.venue}|${r.ticker}`, r);
    for (const f of d.fills || []) S.rungs.set(`${f.venue}|${f.ticker}`, { venue: f.venue, ticker: f.ticker, side: f.side, strike: f.strike });
    for (const r of d.ladder || []) {
      const k = `${r.venue}|${r.ticker}`;
      const cur = S.ladder.get(k);
      const fair = r.fair !== undefined ? r.fair : cur?.fair;
      const fairAt = r.fair !== undefined ? r.taken_at : cur?.fairAt;
      if (!cur || ms(r.taken_at) >= ms(cur.taken_at)) S.ladder.set(k, { ...r, fair, fairAt, prev: cur ? { bid: cur.bid, ask: cur.ask } : null });
      else if (r.fair !== undefined && ms(r.taken_at) >= ms(cur.fairAt)) cur.fair = r.fair, cur.fairAt = r.taken_at;
      S.rungs.set(k, { venue: r.venue, ticker: r.ticker, side: r.side, strike: r.strike });
    }
    if (d.trades?.length) {
      const seen = new Set(S.trades.map((t) => t.id));
      S.trades = [...d.trades.filter((t) => !seen.has(t.id)).map((t) => ({ ...t, fresh: !d.gameFull })), ...S.trades.map((t) => ({ ...t, fresh: false }))]
        .sort((a, b) => ms(b.t) - ms(a.t)).slice(0, 400);
    } else S.trades = S.trades.map((t) => (t.fresh ? { ...t, fresh: false } : t));
    if (d.lines) {
      if (d.linesReplace) S.lines = d.lines;
      else {
        const seen = new Set(S.lines.map((l) => `${l.venue}|${l.t}`));
        S.lines.push(...d.lines.filter((l) => !seen.has(`${l.venue}|${l.t}`)));
      }
    }
  }

  async function poll() {
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(timer);
    const p = new URLSearchParams({ range, day: localMidnight() });
    if (gameId) p.set("game", gameId);
    if (S.cursor) p.set("since", S.cursor);
    if (gameFresh) p.set("g", "1");
    if (linesFresh) p.set("lines", "1");
    if (watchFresh) p.set("wl", "1");
    const sentGame = gameId;
    const flags = [gameFresh, linesFresh, watchFresh];
    gameFresh = linesFresh = watchFresh = false;
    try {
      const d = await get(`/api/live?${p}`);
      if (!stopped && sentGame === gameId) {
        merge(d);
        onSnapshot(snapshot());
      } else if (sentGame !== gameId) gameFresh = true;
    } catch (e) {
      S.error = e.message || String(e);
      if (e.message === "unauthorized") stopped = true;
      // Ask again for whatever this poll was meant to reload.
      gameFresh ||= flags[0]; linesFresh ||= flags[1]; watchFresh ||= flags[2];
      onSnapshot(snapshot());
    } finally {
      busy = false;
      if (again) { again = false; poll(); }
      else schedule();
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (stopped || paused) return;
    timer = setTimeout(() => (typeof document !== "undefined" && document.hidden ? schedule() : poll()), S.error ? pollMs * 2 : pollMs);
  }

  // ---------- Snapshot (the only thing the screen sees)

  function snapshot() {
    const strat = book == null ? null : S.strategies.find((s) => s.id === book);
    const inBook = (r) => (r.strategy_id ?? null) === book;
    const orders = [...S.orders.values()];
    const fills = [...S.fills.values()];
    const w = S.watchlist.find((x) => x.game_id === gameId) ?? null;
    const capOf = (x) => num(strat ? strat.max_worst_case_loss : x.max_worst_case_loss) ?? 0;

    const games = S.watchlist.map((x) => {
      const gf = fills.filter((f) => f.game_id === x.game_id && inBook(f));
      const pos = positions(gf);
      const { worst, best } = worstBest(pos);
      const cap = capOf(x);
      const ours = oursOf(x), mkt = marketMargin(x);
      const resting = orders.filter((o) => o.game_id === x.game_id && o.status === "resting" && inBook(o)).length;
      const used = cap > 0 ? Math.max(0, -worst) / cap : 0;
      const byVenue = {};
      for (const p of pos) byVenue[p.venue] = (byVenue[p.venue] ?? 0) + Math.abs(p.yes);
      return {
        game_id: x.game_id, label: `${x.away_team} @ ${x.home_team}`, away: x.away_team, home: x.home_team, kickoff: x.kickoff, pick: x.pick,
        worst, best, cap, used, ours, market: mkt, venue_margins: x.venue_margins || {},
        expected: ours == null ? null : expectedPnl(pos, marginPmf(ours)),
        marketExpected: mkt == null ? null : expectedPnl(pos, marginPmf(mkt)),
        fills: gf.length, resting, byVenue, enabled: x.enabled,
        status: gameStatus({ w: x, used, resting }),
      };
    });

    const rungOf = (venue, ticker) => S.rungs.get(`${venue}|${ticker}`) ?? null;
    const gameFills = w ? fills.filter((f) => f.game_id === gameId && inBook(f)).sort((a, b) => ms(b.filled_at) - ms(a.filled_at)) : [];
    const tape = [
      ...S.trades.map((t) => ({ venue: t.venue, ticker: t.ticker, t: t.t, yes_price: Number(t.yes_price), fresh: t.fresh })),
      ...gameFills.map((f) => ({ venue: f.venue, ticker: f.ticker, t: f.filled_at, yes_price: Number(f.price), action: f.action, ours: f.kind, fair: num(f.fair_at_fill), fresh: S.receivedAt - ms(f.filled_at) < pollMs * 2 })),
    ].sort((a, b) => ms(b.t) - ms(a.t)).slice(0, 300);

    return {
      asOf: S.asOf, cursor: S.cursor, receivedAt: S.receivedAt, error: S.error,
      book, range, strategies: S.strategies, state: S.state, runs: S.runs,
      game: w && {
        id: w.id, game_id: w.game_id, away: w.away_team, home: w.home_team, kickoff: w.kickoff, pick: w.pick,
        ours: oursOf(w), market: marketMargin(w), cap: capOf(w), venue_margins: w.venue_margins || {}, venues: w.venues,
        book: num(S.mktGame?.book_home_margin), enabled: w.enabled, stop_minutes_before: w.stop_minutes_before,
      },
      ladder: w ? [...S.ladder.values()].filter((r) => r.side != null) : [],
      quotes: w ? orders.filter((o) => o.game_id === gameId && o.status === "resting" && inBook(o)).map((o) => ({ ...o, side: rungOf(o.venue, o.ticker)?.side ?? null, strike: rungOf(o.venue, o.ticker)?.strike ?? null })) : [],
      fills: gameFills,
      tape,
      lines: w ? [...S.lines, ...S.live].sort((a, b) => ms(a.t) - ms(b.t)) : [],
      games,
      activity: activity(orders, fills, rungOf),
    };
  }

  /** One blotter row per thing the bot did: quote placed, cancelled, moved (cancel + place), make, take, sell-back. */
  function activity(orders, fills, rungOf) {
    const rows = [];
    const cancelled = orders.filter((o) => o.status === "cancelled" && o.closed_at).sort((a, b) => ms(a.closed_at) - ms(b.closed_at));
    const used = new Set();
    const placedQuotes = orders.filter((o) => o.kind === "quote").sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const replacedBy = new Map();
    for (const o of placedQuotes) {
      // The cancel it replaced: same book, game, venue, rung and action, closed within a minute of this placement.
      const prev = cancelled.find((x) => !used.has(x.id) && x.id !== o.id && (x.strategy_id ?? null) === (o.strategy_id ?? null) && x.game_id === o.game_id
        && x.venue === o.venue && x.ticker === o.ticker && x.action === o.action && Math.abs(ms(x.closed_at) - ms(o.created_at)) <= MOVE_GROUP_MS);
      if (prev) { used.add(prev.id); replacedBy.set(o.id, prev); }
    }
    const base = (o) => {
      const r = rungOf(o.venue, o.ticker);
      return { game_id: o.game_id, venue: o.venue, ticker: o.ticker, side: r?.side ?? null, strike: r?.strike ?? null, action: o.action, book: o.strategy_id ?? null, count: o.count };
    };
    const edge = (action, fair, price) => (fair == null ? null : action === "buy" ? Number(fair) - Number(price) : Number(price) - Number(fair));
    for (const o of placedQuotes) {
      const prev = replacedBy.get(o.id);
      const status = o.status === "resting" ? "open" : o.status;
      rows.push({ ...base(o), id: `o${o.id}`, t: o.created_at, type: prev ? "moved" : "placed", price: Number(o.price), prevPrice: prev ? Number(prev.price) : null,
        edge: edge(o.action, o.fair, o.price), status, open: o.status === "resting" });
    }
    for (const o of cancelled) {
      if (used.has(o.id) || o.kind !== "quote") continue;
      rows.push({ ...base(o), id: `c${o.id}`, t: o.closed_at, type: "cancelled", price: Number(o.price), prevPrice: null, edge: edge(o.action, o.fair, o.price), status: "cancelled", open: false });
    }
    for (const f of fills) {
      rows.push({ game_id: f.game_id, venue: f.venue, ticker: f.ticker, side: f.side, strike: f.strike, action: f.action, book: f.strategy_id ?? null, count: f.count,
        id: `f${f.id}`, t: f.filled_at, type: f.kind, price: Number(f.price), prevPrice: null, edge: edge(f.action, f.fair_at_fill, f.price), fee: Number(f.fee), status: "filled", open: false });
    }
    return rows.sort((a, b) => ms(b.t) - ms(a.t));
  }

  poll();
  return {
    setGame(id) { if (id === gameId) return; gameId = id; resetGame(); gameFresh = true; poll(); },
    setRange(r) { if (r === range) return; range = r; linesFresh = true; poll(); },
    setBook(b) { book = b ?? null; onSnapshot(snapshot()); },
    refresh() { watchFresh = true; poll(); },
    pause() { paused = true; clearTimeout(timer); },
    resume() { paused = false; poll(); },
    snapshot,
    stop() { stopped = true; clearTimeout(timer); },
  };
}
