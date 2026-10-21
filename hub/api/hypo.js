// Hypotheticals: every recorded game × method × venue set, replayed over recorded market
// history with the paper fill rules. Self-contained — never touches the Board, Fills or lab.
//   GET            → games, methods and every result's summary (no curves)
//   GET ?game=ID   → that game's results with P&L-by-margin curves
//   POST {custom, venues, games} → a what-if method replayed now on those games (not saved)
import { authorized, sb, send } from "./_lib.js";
import { customReplay, methodsNow, strategyMethod, VENUE_SETS } from "./_bot.mjs";

const FIELDS = ["pick", "fills", "contracts", "fees", "worst", "best", "expected", "marketExpected", "settled", "clv", "resting", "asOf"];

async function all(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await sb(path, { headers: { Range: `${from}-${from + 999}` } });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const c = body.custom || {};
      const set = VENUE_SETS.includes(body.venues) ? body.venues : "all";
      const ids = (Array.isArray(body.games) ? body.games : []).map(String).filter((x) => /^\d+$/.test(x)).slice(0, 200);
      const { defaultTrust } = await methodsNow();
      const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
      const method = {
        ...strategyMethod({
          id: 0, name: "Custom",
          pro_edge: num(c.pro_edge, 0, 9, 0.02), anti_edge: num(c.anti_edge, 0, 9, 0.04), take_edge: num(c.take_edge, 0, 9, 0.03), edge_step: num(c.edge_step, 0, 1, 0.01),
          max_worst_case_loss: num(c.max_worst_case_loss, 0.5, 1000, 10), per_rung_cap: Math.round(num(c.per_rung_cap, 1, 50, 1)),
          ycpr_weight: c.ycpr_weight == null ? null : num(c.ycpr_weight, 0, 1, 1), stop_minutes_before: Math.round(num(c.stop_minutes_before, 0, 600, 30)),
        }, defaultTrust),
        key: "custom",
        label: "Custom",
      };
      const out = await customReplay(method, set, ids, 240e3);
      return send(res, 200, { venues: set, ...out });
    }

    const game = req.query?.game ?? new URL(req.url, "http://x").searchParams.get("game");
    if (game) {
      if (!/^\d+$/.test(String(game))) return send(res, 400, { error: "bad game id" });
      const rows = await sb(`bot_hypo_results?select=method,venues,summary&game_id=eq.${game}`);
      return send(res, 200, { game_id: String(game), results: rows.map((r) => ({ method: r.method, venues: r.venues, ...r.summary })) });
    }

    const { methods } = await methodsNow();
    const since = new Date(Date.now() - 10 * 86400e3).toISOString();
    const [games, results, runs] = await Promise.all([
      sb(`bot_mkt_games?select=game_id,season,week,kickoff,home_team,away_team,ycpr_home_margin,book_home_margin,venue_margins&kickoff=gte.${since}&order=kickoff`),
      all(`bot_hypo_results?select=game_id,method,venues,${FIELDS.map((f) => `${f}:summary->${f}`).join(",")}&order=game_id,method,venues`),
      sb("bot_runs?select=started_at,finished_at,summary&mode=eq.hypo&order=started_at.desc&limit=1"),
    ]);
    const ids = games.map((g) => g.game_id);
    const fin = ids.length ? await sb(`games?select=id,completed,home_points,away_points&id=in.(${ids.join(",")})`) : [];
    const finals = new Map(fin.filter((g) => g.completed && g.home_points != null).map((g) => [String(g.id), g.home_points - g.away_points]));
    const out = games.map((g) => {
      const vm = g.venue_margins || {};
      const market = vm.kalshi ?? vm.novig ?? vm.prophetx ?? g.book_home_margin;
      const ycpr = g.ycpr_home_margin == null ? null : Number(g.ycpr_home_margin);
      const edge = ycpr == null || market == null ? null : ycpr - Number(market);
      return {
        ...g, ycpr, market: market == null ? null : Number(market), final: finals.get(String(g.game_id)) ?? null,
        // Positive = our number likes the home side more than the market does.
        edge, edgeSide: edge == null || edge === 0 ? null : edge > 0 ? "home" : "away",
      };
    });
    send(res, 200, {
      methods: methods.map((m) => ({ key: m.key, label: m.label, kind: m.kind, weight: m.weight, cfg: m.cfg })),
      games: out,
      results,
      lastRun: runs[0] ?? null,
    });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
}
