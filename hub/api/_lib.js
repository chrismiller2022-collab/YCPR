// Shared by hub/api/*: password check and service-role Supabase access.
// Env (ycpr-bot Vercel project): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOT_ADMIN_PASSWORD.
import { timingSafeEqual } from "node:crypto";

export function authorized(req) {
  const want = process.env.BOT_ADMIN_PASSWORD || "";
  const got = String(req.headers["x-bot-password"] || "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function sb(path, init = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Database error ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Every matching row. The database returns at most 1,000 rows per request whatever `limit` says (the Review tab silently lost everything past the
 * oldest 1,000 fills), so this pages with Range. `path` must carry a unique `order` (e.g. `order=id`) and no `limit`.
 */
export async function sbAll(path, pageSize = 1000, maxRows = 100000) {
  const out = [];
  for (let from = 0; out.length < maxRows; from += pageSize) {
    const rows = await sb(path, { headers: { Range: `${from}-${from + pageSize - 1}` } });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Net positions (rows of the bot_positions view) as fill-shaped rows, for code that builds positions from fills (hub/live/model.js positions(),
 * the Board's curves, the Scores tab). A position held is one fill of its net size at its average cost (cost incl. fees), carrying the real fees;
 * a flat position keeps its realized result as a buy of 1 at (cost - fees) and a sell of 1 at 0.
 */
export function fillsFromPositions(rows) {
  const out = [];
  for (const p of rows) {
    const yes = Number(p.yes), cost = Number(p.cost), fees = Number(p.fees ?? 0);
    const base = { id: `p:${p.strategy_id ?? "b"}:${p.game_id}:${p.venue}:${p.ticker}`, strategy_id: p.strategy_id ?? null, game_id: p.game_id, venue: p.venue, ticker: p.ticker, side: p.side, strike: p.strike, result: p.result ?? null, close_mid: p.close_mid ?? null, filled_at: p.last_at ?? null };
    if (yes !== 0) out.push({ ...base, action: yes > 0 ? "buy" : "sell", count: Math.abs(yes), price: (cost - fees) / yes, fee: fees });
    else {
      out.push({ ...base, action: "buy", count: 1, price: cost - fees, fee: fees });
      out.push({ ...base, action: "sell", count: 1, price: 0, fee: 0 });
    }
  }
  return out;
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
