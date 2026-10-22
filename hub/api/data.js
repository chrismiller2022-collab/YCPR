// GET: everything the dashboard shows. Requires the x-bot-password header.
import { authorized, sb, send } from "./_lib.js";
import { ycprAwaySpreads, outcomeRanges, marginPmf, boardChanges } from "./_bot.mjs";

const STRAT_COLS = "id,name,enabled,pro_edge,anti_edge,take_edge,edge_step,max_worst_case_loss,per_rung_cap,ycpr_weight,stop_minutes_before";
const lineRank = (p) => (p === "market_median" ? 0 : p === "consensus" ? 1 : 2);

/** The college season a date falls in (Jan–Jul belongs to the previous fall). */
const seasonOf = (d) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

/**
 * ?part=picker&season=&week= : every game of a week for the Add games picker, with YC's number, the Vegas line,
 * which venues have a market (from the market recorder) and whether it's already watched. No week = the current
 * week (the one after the last week where every game is final, as the site's pools work it out).
 */
async function picker(q, res) {
  const season = Number(q.get("season")) || seasonOf(new Date());
  const all = await sb(`games?select=week,completed&season=eq.${season}&season_type=eq.regular&limit=5000`);
  const weeks = [...new Set(all.map((g) => g.week))].filter((w) => w != null).sort((a, b) => a - b);
  const done = weeks.filter((w) => all.filter((g) => g.week === w).every((g) => g.completed));
  const current = done.length ? Math.min(Math.max(...done) + 1, weeks.at(-1) ?? 1) : weeks[0] ?? 1;
  const week = Number(q.get("week")) || current;
  const games = await sb(
    `games?select=id,season,week,start_date,home_team,away_team,neutral_site,home_conference,away_conference,home_classification,away_classification,completed&season=eq.${season}&week=eq.${week}&season_type=eq.regular&or=(home_classification.eq.fbs,away_classification.eq.fbs)&order=start_date.asc&limit=400`
  );
  const ids = games.map((g) => g.id);
  const inIds = ids.length ? `in.(${ids.join(",")})` : "eq.__none__";
  const [lines, mkt, watched, strategies] = await Promise.all([
    ids.length ? sb(`betting_lines?select=game_id,provider,spread&game_id=${inIds}&spread=not.is.null`) : [],
    ids.length ? sb(`bot_mkt_games?select=game_id,venue_margins,venue_events,updated_at&game_id=${inIds}`) : [],
    sb("bot_watchlist?select=id,game_id,enabled"),
    sb(`bot_strategies?select=${STRAT_COLS}&order=id`),
  ]);
  const spread = {};
  for (const l of lines.sort((a, b) => lineRank(a.provider) - lineRank(b.provider))) if (spread[l.game_id] == null) spread[l.game_id] = Number(l.spread);
  const venues = new Map(mkt.map((m) => [m.game_id, m]));
  const watch = new Map(watched.map((w) => [w.game_id, w]));
  let yc = new Map();
  try {
    yc = await ycprAwaySpreads(games);
  } catch {}
  send(res, 200, {
    season, week, current, weeks, strategies,
    games: games.map((g) => ({
      ...g,
      home_spread: spread[g.id] ?? null,
      yc_away_spread: yc.get(String(g.id)) ?? null,
      venue_margins: venues.get(String(g.id))?.venue_margins ?? {},
      watch: watch.get(String(g.id)) ?? null,
    })),
  });
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const q = new URL(req.url, "http://x").searchParams;
    if (q.get("part") === "picker") return await picker(q, res);
    const mode = "paper";
    const [state] = await sb("bot_state?select=*&id=eq.1");
    const watchlist = await sb("bot_watchlist?select=*&order=kickoff.asc.nullslast");
    const ids = watchlist.map((w) => w.game_id);
    const inIds = ids.length ? `&game_id=in.(${ids.map(encodeURIComponent).join(",")})` : "&game_id=eq.__none__";
    const [orders, fills, runs, strategies] = await Promise.all([
      // The Board is strategy_id null; lab strategies live in /api/lab.
      sb(`bot_orders?select=id,venue,game_id,ticker,action,price,count,kind,direction,fair,reason,created_at&mode=eq.${mode}&status=eq.resting&strategy_id=is.null${inIds}&order=ticker`),
      sb(`bot_fills?select=*&mode=eq.${mode}&strategy_id=is.null${inIds}&order=filled_at.desc&limit=500`),
      sb("bot_runs?mode=eq.paper&select=id,mode,started_at,finished_at,games,orders_placed,orders_cancelled,fills,error,venues:summary->venues,venueErrors:summary->venueErrors,labFills:summary->labFills&order=started_at.desc&limit=25"),
      sb(`bot_strategies?select=${STRAT_COLS}&order=id`),
    ]);
    // Latest snapshot per rung for watched games.
    const snaps = ids.length ? await sb(`bot_snapshots?select=game_id,venue,ticker,side,strike,bid,ask,fair,taken_at${inIds}&order=taken_at.desc&limit=3000`) : [];
    const latest = {};
    for (const s of snaps) if (!latest[s.ticker]) latest[s.ticker] = s;

    // Upcoming FBS games (next 8 days) with the current market spread, for the "add game" form.
    const nowIso = new Date().toISOString();
    const soonIso = new Date(Date.now() + 8 * 86400e3).toISOString();
    const games = await sb(
      `games?select=id,season,week,start_date,home_team,away_team,neutral_site&start_date=gte.${nowIso}&start_date=lte.${soonIso}&home_classification=eq.fbs&away_classification=eq.fbs&order=start_date.asc&limit=200`
    );
    const lines = games.length ? await sb(`betting_lines?select=game_id,provider,spread&game_id=in.(${games.map((g) => g.id).join(",")})&spread=not.is.null`) : [];
    const rank = (p) => (p === "market_median" ? 0 : p === "consensus" ? 1 : 2);
    const spread = {};
    for (const l of lines.sort((a, b) => rank(a.provider) - rank(b.provider))) if (spread[l.game_id] == null) spread[l.game_id] = Number(l.spread);
    // YC's number for each upcoming game, computed exactly like Admin Matchups.
    let yc = new Map();
    try {
      yc = await ycprAwaySpreads(games);
    } catch {}
    const upcoming = games.map((g) => ({ ...g, home_spread: spread[g.id] ?? null, yc_away_spread: yc.get(String(g.id)) ?? null }));

    // Win/loss by final margin for each game, with each range's chance under our number:
    // combined across venues ("all") and per venue, each against that venue's implied margin.
    const outcomes = {};
    for (const w of watchlist) {
      const center = w.my_home_margin ?? w.ycpr_home_margin;
      if (center == null) continue;
      const vm = w.venue_margins || {};
      const gameFills = fills.filter((x) => x.game_id === w.game_id);
      const byVenue = {};
      for (const v of ["all", ...new Set(gameFills.map((f) => f.venue || "kalshi"))]) {
        const held = new Map();
        for (const f of gameFills.filter((x) => v === "all" || (x.venue || "kalshi") === v)) {
          const h = held.get(f.ticker) || { side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
          const d = f.action === "buy" ? f.count : -f.count;
          h.yes += d;
          h.cost += d * Number(f.price) + Number(f.fee);
          held.set(f.ticker, h);
        }
        const m = v === "all" ? vm.kalshi ?? w.kalshi_home_margin ?? vm.novig ?? vm.prophetx : vm[v] ?? (v === "kalshi" ? w.kalshi_home_margin : null);
        const market = m == null ? null : Number(m);
        if (held.size)
          byVenue[v] = {
            center: Number(center),
            market,
            ...outcomeRanges([...held.values()], marginPmf(Number(center)), 60, market == null ? undefined : marginPmf(market)),
          };
      }
      if (byVenue.all) outcomes[w.game_id] = byVenue;
    }

    // Change since the last run: the Board's numbers saved by the latest two cycles (bot_runs.summary.board).
    const snaps2 = await sb("bot_runs?select=started_at,board:summary->board&mode=eq.paper&finished_at=not.is.null&summary->board=not.is.null&order=started_at.desc&limit=2");
    const changes = snaps2.length === 2 ? { at: snaps2[0].started_at, since: snaps2[1].started_at, games: boardChanges(snaps2[0].board, snaps2[1].board) } : null;

    send(res, 200, { state, watchlist, orders, fills, snapshots: Object.values(latest), runs, upcoming, outcomes, changes, strategies });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
}
