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

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
