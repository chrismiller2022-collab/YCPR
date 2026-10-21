// GET: Strategy lab — every paper strategy's results on the watchlist games, side by side.
// Strategies trade the same games and books as the Board but keep their own orders/fills.
import { authorized, sb, send } from "./_lib.js";
import { outcomeRanges, marginPmf } from "./_bot.mjs";

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const [strategies, watchlist, fills, orders] = await Promise.all([
      sb("bot_strategies?select=*&order=id"),
      sb("bot_watchlist?select=game_id,away_team,home_team,pick,kickoff,my_home_margin,ycpr_home_margin,kalshi_home_margin,enabled"),
      sb("bot_fills?select=strategy_id,game_id,ticker,side,strike,action,price,count,fee,fair_at_fill,close_mid,result,filled_at&mode=eq.paper&strategy_id=not.is.null&order=filled_at.desc&limit=5000"),
      sb("bot_orders?select=strategy_id,game_id&mode=eq.paper&status=eq.resting&strategy_id=not.is.null"),
    ]);
    const games = new Map(watchlist.map((w) => [w.game_id, w]));

    const rows = strategies.map((st) => {
      const sf = fills.filter((f) => f.strategy_id === st.id);
      const byGame = new Map();
      for (const f of sf) (byGame.get(f.game_id) || byGame.set(f.game_id, []).get(f.game_id)).push(f);
      let worst = 0, best = 0, ev = 0, evK = 0, settled = 0, settledN = 0;
      const perGame = [];
      for (const [gid, gf] of byGame) {
        const w = games.get(gid);
        const held = new Map();
        for (const f of gf) {
          const h = held.get(f.ticker) || { side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
          const d = f.action === "buy" ? f.count : -f.count;
          h.yes += d;
          h.cost += d * Number(f.price) + Number(f.fee);
          held.set(f.ticker, h);
        }
        const center = w ? w.my_home_margin ?? w.ycpr_home_margin : null;
        const market = w?.kalshi_home_margin ?? null;
        const o = center == null ? null : outcomeRanges([...held.values()], marginPmf(Number(center)), 60, market == null ? undefined : marginPmf(Number(market)));
        const gw = o ? Math.min(...o.ranges.map((r) => r.pnl)) : 0;
        const gb = o ? Math.max(...o.ranges.map((r) => r.pnl)) : 0;
        worst += gw; best += gb; ev += o?.expected ?? 0; evK += o?.marketExpected ?? 0;
        const gs = gf.filter((f) => f.result != null);
        const gsPnl = gs.reduce((s, f) => s + (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee, 0);
        settled += gsPnl; settledN += gs.length;
        perGame.push({
          game_id: gid, game: w ? `${w.away_team} @ ${w.home_team}` : gid, fills: gf.length, worst: gw, best: gb,
          expected: o?.expected ?? null, marketExpected: o?.marketExpected ?? null, settled: gs.length ? gsPnl : null,
          resting: orders.filter((x) => x.strategy_id === st.id && x.game_id === gid).length,
        });
      }
      const clvs = sf.filter((f) => f.close_mid != null).map((f) => (f.action === "buy" ? f.close_mid - f.price : f.price - f.close_mid));
      const edges = sf.filter((f) => f.fair_at_fill != null).map((f) => (f.action === "buy" ? f.fair_at_fill - f.price : f.price - f.fair_at_fill));
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const risked = sf.reduce((s, f) => s + f.count * (f.action === "buy" ? Number(f.price) : 1 - Number(f.price)), 0);
      return {
        ...st,
        stats: {
          fills: sf.length, resting: orders.filter((x) => x.strategy_id === st.id).length, games: byGame.size,
          worst, best, expected: ev, marketExpected: evK, settled: settledN ? settled : null, settledFills: settledN,
          avgClv: avg(clvs), clvFills: clvs.length, avgEdgeAtFill: avg(edges), fees: sf.reduce((s, f) => s + Number(f.fee), 0),
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
