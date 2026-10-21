// GET: Review — post-mortems for games that have kicked off, and the season so far.
// Board results (strategy_id null) per game and venue, every lab strategy's settled
// results side by side, and your real bets on the same games (read-only from placed_bets;
// paper fills are never written to Bet History).
import { authorized, sb, send } from "./_lib.js";

const pnlOf = (f) => (f.result == null ? null : (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - Number(f.fee));
const clvOf = (f) => (f.close_mid == null ? null : f.action === "buy" ? f.close_mid - f.price : f.price - f.close_mid);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const wavg = (rows, val) => {
  const r = rows.filter((f) => val(f) != null);
  const n = sum(r.map((f) => f.count));
  return n ? sum(r.map((f) => val(f) * f.count)) / n : null;
};

/** Worst final-margin outcome of a set of fills, after fees (held to settlement). */
function worstCase(fills) {
  const pos = new Map();
  for (const f of fills) {
    const p = pos.get(f.ticker) || { side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    p.yes += d;
    p.cost += d * Number(f.price) + Number(f.fee);
    pos.set(f.ticker, p);
  }
  let worst = 0;
  for (let m = -70; m <= 70; m++) {
    if (m === 0) continue;
    let v = 0;
    for (const p of pos.values()) v += p.yes * ((p.side === "home" ? m : -m) > p.strike ? 1 : 0) - p.cost;
    worst = Math.min(worst, v);
  }
  return worst;
}

function summarize(fills) {
  const settled = fills.filter((f) => f.result != null);
  return {
    fills: fills.length,
    contracts: sum(fills.map((f) => f.count)),
    settled: settled.length ? sum(settled.map(pnlOf)) : null,
    unsettled: fills.length - settled.length,
    fees: sum(fills.map((f) => Number(f.fee))),
    clv: wavg(fills, clvOf),
    edgeAtFill: wavg(fills, (f) => (f.fair_at_fill == null ? null : f.action === "buy" ? f.fair_at_fill - f.price : f.price - f.fair_at_fill)),
    risked: -worstCase(fills),
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const nowIso = new Date().toISOString();
    const [watchlist, strategies] = await Promise.all([
      sb(`bot_watchlist?select=*&kickoff=lt.${nowIso}&order=kickoff.desc`),
      sb("bot_strategies?select=id,name,enabled&order=id"),
    ]);
    if (!watchlist.length) return send(res, 200, { games: [], strategies: [], season: null });
    const ids = watchlist.map((w) => w.game_id);
    const inIds = `in.(${ids.map(encodeURIComponent).join(",")})`;
    const [fills, games, bets] = await Promise.all([
      sb(`bot_fills?select=strategy_id,venue,game_id,ticker,side,strike,action,price,count,fee,fair_at_fill,close_mid,result,filled_at&mode=eq.paper&game_id=${inIds}&order=filled_at.asc&limit=10000`),
      sb(`games?select=id,week,completed,home_points,away_points&id=${inIds}`),
      sb(`placed_bets?select=game_id,book,bet_type,side,line_value,price,stake,to_win,result,placed_at&game_id=${inIds}&bet_type=eq.spread`),
    ]);
    const gameById = new Map(games.map((g) => [String(g.id), g]));

    const rows = watchlist.map((w) => {
      const g = gameById.get(String(w.game_id));
      const final = g?.completed && g.home_points != null && g.away_points != null ? g.home_points - g.away_points : null;
      const gf = fills.filter((f) => f.game_id === w.game_id);
      const board = gf.filter((f) => f.strategy_id == null);
      const vm = w.venue_margins || {};
      const close = vm.kalshi ?? w.kalshi_home_margin ?? vm.novig ?? vm.prophetx ?? null;
      const ours = w.my_home_margin ?? w.ycpr_home_margin;
      const venues = {};
      for (const v of [...new Set(board.map((f) => f.venue || "kalshi"))]) venues[v] = summarize(board.filter((f) => (f.venue || "kalshi") === v));
      const byStrategy = {};
      for (const st of strategies) {
        const sf = gf.filter((f) => f.strategy_id === st.id);
        if (sf.length) byStrategy[st.id] = summarize(sf);
      }
      return {
        game_id: w.game_id, week: g?.week ?? w.week, kickoff: w.kickoff, home_team: w.home_team, away_team: w.away_team, pick: w.pick,
        ours: ours == null ? null : Number(ours), close: close == null ? null : Number(close), venueClose: vm, final,
        completed: !!g?.completed,
        // Did the final land closer to our number than to the market's close?
        oursCloser: final == null || ours == null || close == null ? null : Math.abs(final - ours) < Math.abs(final - close),
        board: summarize(board), venues, byStrategy,
        fills: board,
        bets: bets.filter((b) => String(b.game_id) === String(w.game_id)),
      };
    });

    const settledGames = rows.filter((r) => r.board.settled != null);
    const allBoard = rows.flatMap((r) => r.fills);
    const season = {
      games: rows.length,
      settledGames: settledGames.length,
      won: settledGames.filter((r) => r.board.settled > 0).length,
      lost: settledGames.filter((r) => r.board.settled < 0).length,
      settled: settledGames.length ? sum(settledGames.map((r) => r.board.settled)) : null,
      risked: sum(settledGames.map((r) => r.board.risked)),
      fees: sum(rows.map((r) => r.board.fees)),
      clv: wavg(allBoard, clvOf),
      oursCloser: rows.filter((r) => r.oursCloser === true).length,
      graded: rows.filter((r) => r.oursCloser != null).length,
    };
    const strategyRows = strategies.map((st) => {
      const sf = fills.filter((f) => f.strategy_id === st.id);
      const per = rows.map((r) => r.byStrategy[st.id]).filter(Boolean);
      const settled = per.filter((p) => p.settled != null);
      return {
        ...st,
        games: per.length,
        settled: settled.length ? sum(settled.map((p) => p.settled)) : null,
        risked: sum(settled.map((p) => p.risked)),
        clv: wavg(sf, clvOf),
        fills: sf.length,
      };
    });
    send(res, 200, { games: rows, strategies: strategyRows, season });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
}
