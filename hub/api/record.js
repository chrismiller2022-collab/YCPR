// Records every FBS game's ladders and trades on every venue (for Hypotheticals).
// Started by /api/cycle each cycle, with the same "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from "node:crypto";
import { send } from "./_lib.js";
import { runRecord } from "./_bot.mjs";

function cronAuthorized(req) {
  const want = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  try {
    send(res, 200, await runRecord());
  } catch (err) {
    send(res, 500, { error: String(err.message || err).slice(0, 300) });
  }
}
