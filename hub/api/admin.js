// POST { action, ... }: kill switch and watchlist edits. Requires x-bot-password.
import { authorized, sb, send } from "./_lib.js";
import { pmMedian, ycprAwaySpreads } from "./_bot.mjs";

/** The rebuilt books are only safe to trade once the tower's runner knows them (see enableRebuildBooks). */
async function requireNewRunner() {
  const runs = await sb("bot_runs?select=host,started_at,v:summary->codeVersion&mode=eq.paper&order=started_at.desc&limit=40");
  const tower = runs.find((r) => r.host === "tower" && Date.now() - new Date(r.started_at).getTime() < 20 * 60e3);
  if (tower && !(Number(tower.v) >= 3))
    throw new Error("The tower is still running older code. On the tower run: cd ~/YCPR && git pull && npm install && sudo systemctl restart ycpr-bot, wait for a cycle, then try again.");
}

/** Adds (or re-enables) the paper books for the rebuilt logic: "Shrunk" (the original ladder engine priced from the shrunk fair value) and "Target" (target-position rebalancing). */
async function enableBooks() {
  const rows = [
    { name: "Shrunk", enabled: true, pro_edge: 0.02, anti_edge: 0.04, take_edge: 0.03, edge_step: 0.01, max_worst_case_loss: 10, per_rung_cap: 1, fair_mode: "shrunk", method: "ladder", notes: "Original ladder engine priced from the shrunk fair value (PM median + beta · capped gap), for comparison" },
    { name: "Target", enabled: true, pro_edge: 0.02, anti_edge: 0.04, take_edge: 0.005, edge_step: 0.01, max_worst_case_loss: 10, per_rung_cap: 3, fair_mode: "shrunk", method: "target", notes: "Target-position rebalancing across venues: Kelly ramp from the shrunk edge, takes only, caps per game / team / conference / portfolio" },
  ];
  return sb("bot_strategies?on_conflict=name", { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(rows) });
}

const NUMERIC = ["ycpr_weight", "beta", "my_home_margin", "max_worst_case_loss", "pro_edge", "anti_edge", "take_edge", "edge_step", "profit_target"];
const INTS = ["per_rung_cap", "order_size", "stop_minutes_before"];
const SHAPE_NUMERIC = ["market_floor", "against_limit", "blowout_margin"];

/** Shaped positions (§21): on/off plus three limits; blank = the default in code. */
function cleanShape(body, out) {
  if (body.shape !== undefined) out.shape = body.shape == null ? null : !!body.shape;
  for (const k of SHAPE_NUMERIC) if (body[k] !== undefined) out[k] = body[k] === "" || body[k] === null ? null : Number(body[k]);
  for (const k of SHAPE_NUMERIC) if (out[k] != null && !Number.isFinite(out[k])) throw new Error(`${k} must be a number`);
  if (out.against_limit != null && (out.against_limit < 0 || out.against_limit > 1000)) throw new Error("max loss moderately against must be between 0 and 1000");
  if (out.market_floor != null && (out.market_floor < -1000 || out.market_floor > 1000)) throw new Error("minimum P&L at the market line must be between -1000 and 1000");
  if (out.blowout_margin != null && (out.blowout_margin < 1 || out.blowout_margin > 60)) throw new Error("blowout margin must be between 1 and 60 points");
  return out;
}

function cleanWatch(body) {
  const w = {};
  if (body.pick != null) {
    if (body.pick !== "home" && body.pick !== "away") throw new Error("pick must be home or away");
    w.pick = body.pick;
  }
  for (const k of NUMERIC) if (body[k] !== undefined) w[k] = body[k] === "" || body[k] === null ? null : Number(body[k]);
  for (const k of INTS) if (body[k] !== undefined) w[k] = Math.round(Number(body[k]));
  for (const [k, v] of Object.entries(w)) if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${k} must be a number`);
  if (w.max_worst_case_loss != null && (w.max_worst_case_loss <= 0 || w.max_worst_case_loss > 1000)) throw new Error("max loss must be between 0 and 1000");
  if (w.ycpr_weight != null && (w.ycpr_weight < 0 || w.ycpr_weight > 1)) throw new Error("trust must be between 0 and 1");
  if (w.beta != null && (w.beta < 0 || w.beta > 1)) throw new Error("beta must be between 0 and 1");
  cleanShape(body, w);
  if (body.enabled !== undefined) w.enabled = !!body.enabled;
  if (body.venues !== undefined) {
    if (!Array.isArray(body.venues) || body.venues.some((v) => !["kalshi", "novig", "prophetx", "polymarket"].includes(v))) throw new Error("venues must be kalshi, novig, prophetx and/or polymarket");
    w.venues = [...new Set(body.venues)];
  }
  if (body.notes !== undefined) w.notes = String(body.notes).slice(0, 500);
  if (body.strategy_preset !== undefined) w.strategy_preset = body.strategy_preset == null || body.strategy_preset === "" ? null : Math.round(Number(body.strategy_preset));
  return w;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    switch (body.action) {
      case "kill": {
        const [row] = await sb("bot_state?id=eq.1", { method: "PATCH", body: JSON.stringify({ kill_switch: !!body.on, updated_at: new Date().toISOString() }) });
        return send(res, 200, { state: row });
      }
      case "defaultTrust": {
        const v = Number(body.value);
        if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error("trust must be between 0 and 1");
        const [row] = await sb("bot_state?id=eq.1", { method: "PATCH", body: JSON.stringify({ default_ycpr_weight: v, updated_at: new Date().toISOString() }) });
        return send(res, 200, { state: row });
      }
      case "shrinkSettings": {
        // The shrunk fair value (bot/fairPrice/shrink.ts): fair = PM median + beta · capped gap. Blank fields stay as they are.
        const patch = { updated_at: new Date().toISOString() };
        const rules = {
          beta: [0, 1], hump_cap: [0.5, 60], hump_fall: [0, 60], sigma: [5, 40],
          // Target-position books: paper bankroll, fraction of Kelly, and the loss caps shared between games (dollars).
          bankroll: [10, 1e7], kelly_frac: [0.01, 1], team_cap: [0, 1e5], conf_cap: [0, 1e5], portfolio_cap: [0, 1e6],
        };
        for (const [k, [lo, hi]] of Object.entries(rules)) {
          if (body[k] === undefined || body[k] === "" || body[k] === null) continue;
          const v = Number(body[k]);
          if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
          patch[k] = v;
        }
        const [row] = await sb("bot_state?id=eq.1", { method: "PATCH", body: JSON.stringify(patch) });
        return send(res, 200, { state: row });
      }
      case "polymarketMode": {
        // off = untouched; read = recorded and shown, never in the PM median, never traded; paper = a venue like the others (simulated fills only).
        if (!["off", "read", "paper"].includes(body.mode)) throw new Error("mode must be off, read or paper");
        const [row] = await sb("bot_state?id=eq.1", { method: "PATCH", body: JSON.stringify({ polymarket_mode: body.mode, updated_at: new Date().toISOString() }) });
        return send(res, 200, { state: row });
      }
      case "enableRebuildBooks": {
        // A runner that predates the rebuilt books would trade them as plain ladders, so this refuses until the tower runs the new code.
        await requireNewRunner();
        return send(res, 200, { strategies: await enableBooks() });
      }
      case "weeklyWorkflow": {
        // One button for the week: add every game, sync YC's lines (keeping the original), switch the rebuilt books on. The shrunk trading
        // line follows the market every cycle on its own, and each game's plan is rebuilt from its edge by the Target book.
        const season = Math.round(Number(body.season));
        const week = Math.round(Number(body.week));
        if (!Number.isFinite(season) || !Number.isFinite(week)) throw new Error("season and week are required");
        await requireNewRunner();
        const games = await sb(
          `games?select=id,season,week,start_date,home_team,away_team,neutral_site&season=eq.${season}&week=eq.${week}&season_type=eq.regular&or=(home_classification.eq.fbs,away_classification.eq.fbs)&order=start_date.asc&limit=400`
        );
        const nowMs = Date.now();
        const open = games.filter((g) => !g.start_date || new Date(g.start_date).getTime() > nowMs);
        if (!open.length) throw new Error(`No games left to add in week ${week}`);
        const inIds = `in.(${open.map((g) => encodeURIComponent(g.id)).join(",")})`;
        const [mkt, existing] = await Promise.all([
          sb(`bot_mkt_games?select=game_id,venue_margins&game_id=${inIds}`),
          sb(`bot_watchlist?select=id,game_id,ycpr_home_margin,ycpr_original&game_id=${inIds}`),
        ]);
        let yc = new Map();
        try {
          yc = await ycprAwaySpreads(open);
        } catch {}
        const vm = new Map(mkt.map((m) => [String(m.game_id), m.venue_margins || {}]));
        const have = new Map(existing.map((w) => [String(w.game_id), w]));
        const label = (g) => `${g.away_team} @ ${g.home_team}`;
        const stamp = new Date().toISOString();
        // 1. Add every game that isn't watched yet (never touching the ones that are).
        const fresh = open.filter((g) => !have.has(String(g.id)));
        const rows = fresh.map((g) => {
          const y = yc.get(String(g.id));
          const pm = pmMedian(vm.get(String(g.id)));
          return {
            game_id: String(g.id), season: g.season, week: g.week, home_team: g.home_team, away_team: g.away_team, kickoff: g.start_date,
            pick: y != null && pm != null && y > pm ? "home" : "away", enabled: true, legacy: false, my_home_margin: null, venues: ["kalshi", "novig", "prophetx", "polymarket"],
            ycpr_home_margin: y ?? null, ycpr_updated_at: y != null ? stamp : null, ycpr_original: y ?? null, ycpr_original_at: y != null ? stamp : null,
          };
        });
        let added = [];
        if (rows.length) added = await sb("bot_watchlist?on_conflict=game_id", { method: "POST", headers: { Prefer: "return=representation,resolution=ignore-duplicates" }, body: JSON.stringify(rows) });
        // 2. Sync YC's line for the games that were already watched: refresh the current number, stamp the original once.
        let synced = 0;
        for (const w of existing) {
          const y = yc.get(String(w.game_id));
          if (y == null) continue;
          const patch = {};
          if (w.ycpr_home_margin == null || Math.abs(Number(w.ycpr_home_margin) - y) > 1e-9) Object.assign(patch, { ycpr_home_margin: y, ycpr_updated_at: stamp });
          if (w.ycpr_original == null) Object.assign(patch, { ycpr_original: y, ycpr_original_at: stamp });
          if (Object.keys(patch).length) {
            await sb(`bot_watchlist?id=eq.${w.id}`, { method: "PATCH", body: JSON.stringify(patch) });
            synced++;
          }
        }
        // 3. The rebuilt books on.
        const books = await enableBooks();
        const noYc = open.filter((g) => yc.get(String(g.id)) == null).map(label);
        const noVenue = open.filter((g) => pmMedian(vm.get(String(g.id))) == null).map(label);
        return send(res, 200, {
          season, week, games: open.length, added: added.length, alreadyWatched: existing.length, synced, noYc, noVenue, books: books.map((b) => b.name),
          note: "The trading line (PM median + beta · capped gap) updates every cycle; each game's plan appears in its drawer within a cycle or two.",
        });
      }
      case "saveStrategy": {
        const st = {};
        if (body.name !== undefined) {
          st.name = String(body.name).trim().slice(0, 40);
          if (!st.name) throw new Error("name is required");
        }
        for (const k of ["pro_edge", "anti_edge", "take_edge", "edge_step", "max_worst_case_loss"]) if (body[k] !== undefined) st[k] = Number(body[k]);
        for (const k of ["per_rung_cap", "stop_minutes_before"]) if (body[k] !== undefined) st[k] = Math.round(Number(body[k]));
        if (body.ycpr_weight !== undefined) st.ycpr_weight = body.ycpr_weight === null || body.ycpr_weight === "" ? null : Number(body.ycpr_weight);
        if (body.enabled !== undefined) st.enabled = !!body.enabled;
        if (body.fair_mode !== undefined) {
          if (!["blend", "shrunk"].includes(body.fair_mode)) throw new Error("fair_mode must be blend or shrunk");
          st.fair_mode = body.fair_mode;
        }
        if (body.method !== undefined) {
          if (!["ladder", "target"].includes(body.method)) throw new Error("method must be ladder or target");
          st.method = body.method;
        }
        if (body.notes !== undefined) st.notes = String(body.notes).slice(0, 300);
        cleanShape(body, st);
        for (const [k, v] of Object.entries(st)) if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${k} must be a number`);
        if (st.ycpr_weight != null && (st.ycpr_weight < 0 || st.ycpr_weight > 1)) throw new Error("trust must be between 0 and 1");
        if (st.max_worst_case_loss != null && (st.max_worst_case_loss <= 0 || st.max_worst_case_loss > 1000)) throw new Error("max loss must be between 0 and 1000");
        const [saved] = body.id
          ? await sb(`bot_strategies?id=eq.${Number(body.id)}`, { method: "PATCH", body: JSON.stringify(st) })
          : await sb("bot_strategies", { method: "POST", body: JSON.stringify(st) });
        return send(res, 200, { strategy: saved });
      }
      case "addWatch": {
        const [g] = await sb(`games?select=id,season,week,start_date,home_team,away_team&id=eq.${encodeURIComponent(body.game_id)}`);
        if (!g) throw new Error("Unknown game");
        const w = cleanWatch(body);
        if (w.pick == null) throw new Error("pick is required");
        const row = { game_id: String(g.id), season: g.season, week: g.week, home_team: g.home_team, away_team: g.away_team, kickoff: g.start_date, ...w };
        const [saved] = await sb("bot_watchlist?on_conflict=game_id", { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(row) });
        return send(res, 200, { watch: saved });
      }
      case "addWatches": {
        // Several games at once with one settings block; each game brings its own pick and optional override.
        const items = Array.isArray(body.games) ? body.games.slice(0, 100) : [];
        if (!items.length) throw new Error("no games");
        const shared = cleanWatch({ ...body.settings, pick: undefined });
        const ids = items.map((x) => String(x.game_id));
        const games = await sb(`games?select=id,season,week,start_date,home_team,away_team&id=in.(${ids.map(encodeURIComponent).join(",")})`);
        const byId = new Map(games.map((g) => [String(g.id), g]));
        const rows = items.map((x) => {
          const g = byId.get(String(x.game_id));
          if (!g) throw new Error(`Unknown game ${x.game_id}`);
          const own = cleanWatch({ pick: x.pick, my_home_margin: x.my_home_margin });
          if (own.pick == null) throw new Error(`pick is required (${g.away_team} @ ${g.home_team})`);
          // PostgREST needs every row of a multi-row insert to carry the same keys.
          return { game_id: String(g.id), season: g.season, week: g.week, home_team: g.home_team, away_team: g.away_team, kickoff: g.start_date, enabled: true, ...shared, ...own, my_home_margin: own.my_home_margin ?? null };
        });
        const saved = await sb("bot_watchlist?on_conflict=game_id", { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify(rows) });
        return send(res, 200, { watch: saved });
      }
      case "updateWatches": {
        // The same change to several watched games; only the fields sent are changed.
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite).slice(0, 200);
        if (!ids.length) throw new Error("no games");
        const patch = cleanWatch(body.patch || {});
        delete patch.pick;
        if (!Object.keys(patch).length) throw new Error("nothing to change");
        const saved = await sb(`bot_watchlist?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify(patch) });
        return send(res, 200, { watch: saved });
      }
      case "updateWatch": {
        const [saved] = await sb(`bot_watchlist?id=eq.${Number(body.id)}`, { method: "PATCH", body: JSON.stringify(cleanWatch(body)) });
        return send(res, 200, { watch: saved });
      }
      case "removeWatch": {
        // Disable rather than delete so fills keep their game context.
        const [saved] = await sb(`bot_watchlist?id=eq.${Number(body.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
        return send(res, 200, { watch: saved });
      }
      default:
        return send(res, 400, { error: "Unknown action" });
    }
  } catch (err) {
    send(res, 400, { error: String(err.message || err) });
  }
}
