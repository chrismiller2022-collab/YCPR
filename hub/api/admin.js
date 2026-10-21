// POST { action, ... }: kill switch and watchlist edits. Requires x-bot-password.
import { authorized, sb, send } from "./_lib.js";

const NUMERIC = ["ycpr_weight", "my_home_margin", "max_worst_case_loss", "pro_edge", "anti_edge", "take_edge", "edge_step", "profit_target"];
const INTS = ["per_rung_cap", "order_size", "stop_minutes_before"];

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
  if (body.enabled !== undefined) w.enabled = !!body.enabled;
  if (body.notes !== undefined) w.notes = String(body.notes).slice(0, 500);
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
        if (body.notes !== undefined) st.notes = String(body.notes).slice(0, 300);
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
