// GET ?game=<id>&since=<cursor>&g=1&range=15m|1h|6h|24h|all&lines=1&wl=1&day=<iso> → Live desk rows newer than the cursor.
// The desk polls this through hub/live/feed.js every few seconds, so a poll sends only what changed: new or closed
// orders, new fills, new ladder rows, new trades and new implied-line points. No cursor = a full load; g=1 = the
// focused game changed (reload its ladder, tape and lines); lines=1 = the chart range changed; wl=1 = resend the
// watchlist now (it otherwise goes out once a minute). day = the viewer's local midnight, for "today" in the blotter.
// Cursor "v1.<ms>.<order>.<fill>.<mktSnap>.<botSnap>.<trade>.<impliedMs>.<watchlistMs>": the poll time, the last id
// seen per table (ids only grow), the newest implied-line time, and when the watchlist was last sent.
// Requires the x-bot-password header.
import { authorized, sb, send } from "./_lib.js";

const MODE = "paper";
const RANGES = { "15m": 15 * 60e3, "1h": 3600e3, "6h": 6 * 3600e3, "24h": 86400e3, all: null };
const OVERLAP_MS = 90e3; // orders closed this close to the last poll are re-sent; the feed dedupes by id
const WATCH_EVERY_MS = 60e3;
const ORDER_COLS = "id,venue,strategy_id,game_id,ticker,action,price,count,kind,direction,fair,status,created_at,closed_at";
const FILL_COLS = "id,order_id,venue,strategy_id,game_id,ticker,side,strike,action,price,count,fee,fair_at_fill,mid_at_fill,filled_at,close_mid,result,o:bot_orders(kind,direction)";
const WATCH_COLS = "id,game_id,away_team,home_team,kickoff,pick,my_home_margin,ycpr_home_margin,kalshi_home_margin,kalshi_updated_at,venue_margins,venues,max_worst_case_loss,stop_minutes_before,enabled";
const SNAP_COLS = "id,game_id,venue,ticker,side,strike,bid,ask,fair,taken_at";

export function parseCursor(s) {
  const p = String(s || "").split(".");
  if (p[0] !== "v1" || p.length !== 9 || p.slice(1).some((x) => !/^\d+$/.test(x))) return null;
  const [t, o, f, mktSnap, botSnap, trade, implied, watch] = p.slice(1).map(Number);
  return { t, o, f, mktSnap, botSnap, trade, implied, watch };
}
export const formatCursor = (c) => ["v1", c.t, c.o, c.f, c.mktSnap, c.botSnap, c.trade, c.implied, c.watch].join(".");

const maxId = (rows, prev) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), prev);
const enc = encodeURIComponent;

/** Every row of a query, paging past PostgREST's 1,000-row cap (query must be ordered). */
async function all(path, pages = 10) {
  const out = [];
  for (let i = 0; i < pages; i++) {
    const rows = await sb(path, { headers: { Range: `${i * 1000}-${i * 1000 + 999}` } });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Last value per venue per time bucket, so a 24h or all-time chart stays a few hundred points. */
export function downsample(rows, spanMs, buckets = 240) {
  if (!rows.length) return rows;
  const size = Math.max(1, spanMs / buckets);
  const t0 = new Date(rows[0].t).getTime();
  const last = new Map();
  for (const r of rows) last.set(`${r.venue}|${Math.floor((new Date(r.t).getTime() - t0) / size)}`, r);
  return [...last.values()].sort((a, b) => new Date(a.t) - new Date(b.t));
}

/** Fill kind for the tape and blotter: a sell-back (anti order), a take (crossed the spread) or a make (resting quote filled). */
export const fillKind = (o) => (o?.direction === "anti" ? "sell" : o?.kind === "take" ? "take" : "make");

/** Newest row per venue|ticker (rows newest first). */
function newest(rows) {
  const seen = new Map();
  for (const r of rows) if (!seen.has(`${r.venue}|${r.ticker}`)) seen.set(`${r.venue}|${r.ticker}`, r);
  return [...seen.values()];
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const now = Date.now();
    const prev = parseCursor(q.get("since"));
    const full = !prev;
    const c = prev ?? { t: 0, o: 0, f: 0, mktSnap: 0, botSnap: 0, trade: 0, implied: 0, watch: 0 };
    const game = q.get("game") || "";
    const gameFull = full || q.get("g") === "1";
    const rangeKey = Object.hasOwn(RANGES, q.get("range")) ? q.get("range") : "6h";
    const wantLines = gameFull || q.get("lines") === "1";
    const sendWatch = gameFull || q.get("wl") === "1" || now - c.watch >= WATCH_EVERY_MS;
    const day = Date.parse(q.get("day") || "") || now - 86400e3;
    const dayIso = new Date(Math.min(now, Math.max(day, now - 86400e3))).toISOString();

    // Watched game ids scope every query; the full rows only go out once a minute.
    const watchlist = await sb(`bot_watchlist?select=${sendWatch ? WATCH_COLS : "game_id"}&order=kickoff.asc.nullslast`);
    const ids = watchlist.map((w) => w.game_id);
    const inIds = ids.length ? `&game_id=in.(${ids.map(enc).join(",")})` : "&game_id=eq.__none__";
    const since = new Date(c.t - OVERLAP_MS).toISOString();

    const [[state], paper, record, orders, fills, snaps, strategies] = await Promise.all([
      sb("bot_state?select=mode,kill_switch,updated_at&id=eq.1"),
      sb(`bot_runs?select=started_at,finished_at,error,venueErrors:summary->venueErrors&mode=eq.${MODE}&order=started_at.desc&limit=2`),
      sb("bot_runs?select=started_at,finished_at,error,venueErrors:summary->venueErrors&mode=eq.record&order=started_at.desc&limit=1"),
      full
        ? sb(`bot_orders?select=${ORDER_COLS}&mode=eq.${MODE}${inIds}&or=(status.eq.resting,created_at.gte.${dayIso},closed_at.gte.${dayIso})&order=id.desc&limit=3000`)
        : sb(`bot_orders?select=${ORDER_COLS}&mode=eq.${MODE}${inIds}&or=(id.gt.${c.o},closed_at.gt.${since})&order=id.desc&limit=3000`),
      full
        ? sb(`bot_fills?select=${FILL_COLS}&mode=eq.${MODE}${inIds}&order=id.desc&limit=5000`)
        : sb(`bot_fills?select=${FILL_COLS}&mode=eq.${MODE}${inIds}&id=gt.${c.f}&order=id.desc&limit=2000`),
      // The Board's ladder rows (with its fair) for every watched game: the focused game's feed the ladder,
      // the rest only name the rungs that orders point at.
      sb(`bot_snapshots?select=${SNAP_COLS}${inIds}${full ? "" : `&id=gt.${c.botSnap}`}&order=id.desc&limit=${full ? 5000 : 3000}`),
      full ? sb("bot_strategies?select=id,name,enabled,max_worst_case_loss&order=id") : null,
    ]);
    for (const f of fills) {
      f.kind = fillKind(f.o);
      delete f.o;
    }
    const botSnap = maxId(snaps, c.botSnap);
    const rungs = newest(snaps).filter((r) => r.side != null).map((r) => ({ venue: r.venue, ticker: r.ticker, side: r.side, strike: r.strike }));

    // Focused game: ladder, tape and implied lines.
    let ladder = [], trades = [], lines = null, mktGame;
    let { mktSnap, trade, implied } = c;
    if (game && ids.includes(game)) {
      const g = `game_id=eq.${enc(game)}`;
      const [mk, bs, tr] = await Promise.all([
        sb(`bot_mkt_snaps?select=id,venue,ticker,side,strike,bid,ask,taken_at&${g}${gameFull ? "" : `&id=gt.${mktSnap}`}&order=id.desc&limit=${gameFull ? 1500 : 1000}`),
        gameFull ? sb(`bot_snapshots?select=${SNAP_COLS}&${g}&order=id.desc&limit=1500`) : snaps.filter((s) => s.game_id === game),
        sb(`bot_mkt_trades?select=id,venue,ticker,t,yes_price&${g}${gameFull ? "" : `&id=gt.${trade}`}&order=id.desc&limit=${gameFull ? 150 : 300}`),
      ]);
      mktSnap = maxId(mk, gameFull ? 0 : mktSnap);
      trade = maxId(tr, gameFull ? 0 : trade);
      trades = tr;
      const strip = (r, src) => ({ venue: r.venue, ticker: r.ticker, side: r.side, strike: r.strike, bid: r.bid, ask: r.ask, ...(r.fair !== undefined ? { fair: r.fair } : {}), taken_at: r.taken_at, src });
      ladder = [...newest(mk).map((r) => strip(r, "mkt")), ...newest(bs).map((r) => strip(r, "bot"))];
      // On a fresh load, the recorder's last-seen prices bring every known rung up to date.
      if (gameFull && ladder.length) {
        const tickers = [...new Set(ladder.map((r) => r.ticker))];
        const last = await sb(`bot_mkt_last?select=venue,ticker,bid,ask&ticker=in.(${tickers.map((t) => enc(`"${t}"`)).join(",")})`);
        for (const l of last) {
          const base = ladder.find((r) => r.venue === l.venue && r.ticker === l.ticker && r.side != null);
          if (base) ladder.push({ venue: l.venue, ticker: l.ticker, side: base.side, strike: base.strike, bid: l.bid, ask: l.ask, taken_at: new Date(now).toISOString(), src: "last" });
        }
      }
      if (wantLines) {
        const span = RANGES[rangeKey];
        const from = span == null ? null : new Date(now - span).toISOString();
        const rows = await all(`bot_mkt_implied?select=venue,t,margin&${g}&margin=not.is.null${from ? `&t=gte.${from}` : ""}&order=t`);
        const spanMs = rows.length ? now - new Date(rows[0].t).getTime() : 0;
        lines = span == null || span > 6 * 3600e3 ? downsample(rows, spanMs) : rows;
        implied = rows.length ? new Date(rows[rows.length - 1].t).getTime() : gameFull ? 0 : implied;
      } else {
        lines = await sb(`bot_mkt_implied?select=venue,t,margin&${g}&margin=not.is.null&t=gt.${new Date(implied).toISOString()}&order=t&limit=500`);
        if (lines.length) implied = new Date(lines[lines.length - 1].t).getTime();
      }
      if (sendWatch) [mktGame = null] = await sb(`bot_mkt_games?select=book_home_margin,ycpr_home_margin&${g}`);
    }

    const cursor = formatCursor({ t: now, o: maxId(orders, c.o), f: maxId(fills, c.f), mktSnap, botSnap, trade, implied, watch: sendWatch ? now : c.watch });
    send(res, 200, {
      asOf: new Date(now).toISOString(),
      cursor,
      full,
      gameFull,
      range: rangeKey,
      state,
      runs: { paper, record: record[0] ?? null },
      ...(sendWatch ? { watchlist } : {}),
      ...(strategies ? { strategies } : {}),
      ...(mktGame !== undefined ? { mktGame } : {}),
      orders,
      fills,
      rungs,
      ladder,
      trades,
      lines,
      linesReplace: wantLines,
    });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
}
