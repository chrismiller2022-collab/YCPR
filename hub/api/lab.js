// GET: Strategy lab — every paper strategy's results on the watchlist games, side by side.
// Strategies trade the same games and books as the Board but keep their own orders/fills.
// Reads net positions from the bot_positions view (summed in the database): the raw fills are thousands of rows and the API
// returns at most 1,000 per request, which used to cut the lab down to the newest 1,000 fills.
import { authorized, sb, sbAll, send } from "./_lib.js";
import { outcomeRanges, marginPmf } from "./_bot.mjs";

const n = (v) => (v == null ? 0 : Number(v));

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const [strategies, watchlist, positions, orders] = await Promise.all([
      sb("bot_strategies?select=*&order=id"),
      sb("bot_watchlist?select=game_id,away_team,home_team,pick,kickoff,my_home_margin,ycpr_home_margin,kalshi_home_margin,enabled"),
      sbAll(
        "bot_positions?select=strategy_id,game_id,side,strike,yes,cost,fees,fills,settled_pnl,settled_fills,clv_sum,clv_n,edge_sum,edge_n,risked&mode=eq.paper&strategy_id=not.is.null&order=strategy_id,game_id,venue,ticker"
      ),
      sb("bot_orders?select=strategy_id,game_id&mode=eq.paper&status=eq.resting&strategy_id=not.is.null"),
    ]);
    const games = new Map(watchlist.map((w) => [w.game_id, w]));

    const rows = strategies.map((st) => {
      const sp = positions.filter((p) => p.strategy_id === st.id);
      const byGame = new Map();
      for (const p of sp) (byGame.get(p.game_id) || byGame.set(p.game_id, []).get(p.game_id)).push(p);
      let worst = 0, best = 0, ev = 0, evK = 0, settled = 0, settledN = 0;
      const perGame = [];
      for (const [gid, gp] of byGame) {
        const w = games.get(gid);
        const held = gp.map((p) => ({ side: p.side, strike: Number(p.strike), yes: n(p.yes), cost: n(p.cost) }));
        const center = w ? w.my_home_margin ?? w.ycpr_home_margin : null;
        const market = w?.kalshi_home_margin ?? null;
        const o = center == null ? null : outcomeRanges(held, marginPmf(Number(center)), 60, market == null ? undefined : marginPmf(Number(market)));
        const gw = o ? Math.min(...o.ranges.map((r) => r.pnl)) : 0;
        const gb = o ? Math.max(...o.ranges.map((r) => r.pnl)) : 0;
        worst += gw; best += gb; ev += o?.expected ?? 0; evK += o?.marketExpected ?? 0;
        const gSettledFills = gp.reduce((s, p) => s + n(p.settled_fills), 0);
        const gsPnl = gp.reduce((s, p) => s + n(p.settled_pnl), 0);
        settled += gsPnl; settledN += gSettledFills;
        perGame.push({
          game_id: gid, game: w ? `${w.away_team} @ ${w.home_team}` : gid, fills: gp.reduce((s, p) => s + n(p.fills), 0), worst: gw, best: gb,
          expected: o?.expected ?? null, marketExpected: o?.marketExpected ?? null, settled: gSettledFills ? gsPnl : null,
          resting: orders.filter((x) => x.strategy_id === st.id && x.game_id === gid).length,
        });
      }
      const sum = (f) => sp.reduce((s, p) => s + f(p), 0);
      const clvN = sum((p) => n(p.clv_n)), edgeN = sum((p) => n(p.edge_n));
      const risked = sum((p) => n(p.risked));
      return {
        ...st,
        stats: {
          fills: sum((p) => n(p.fills)), resting: orders.filter((x) => x.strategy_id === st.id).length, games: byGame.size,
          worst, best, expected: ev, marketExpected: evK, settled: settledN ? settled : null, settledFills: settledN,
          // Contract-weighted averages (a fill of several contracts counts as several).
          avgClv: clvN ? sum((p) => n(p.clv_sum)) / clvN : null, clvFills: clvN,
          avgEdgeAtFill: edgeN ? sum((p) => n(p.edge_sum)) / edgeN : null, fees: sum((p) => n(p.fees)),
          risked, evPerDollar: risked ? ev / risked : null,
        },
        perGame: perGame.sort((a, b) => b.fills - a.fills),
      };
    });
    send(res, 200, { strategies: rows });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
}
