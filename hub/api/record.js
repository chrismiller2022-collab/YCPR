// Records every FBS game's ladders and trades on every venue (for Hypotheticals).
// Started by /api/cycle each cycle, with the same "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from "node:crypto";
import { send } from "./_lib.js";
import { runRecord, runHypo, db } from "./_bot.mjs";

function cronAuthorized(req) {
  const want = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  const started = Date.now();
  try {
    const record = await runRecord();
    // Hypotheticals catch up hourly, with whatever time this function has left.
    let hypo = null;
    const [last] = await db.select("bot_runs", "select=started_at&mode=eq.hypo&order=started_at.desc&limit=1");
    if (!last || Date.now() - new Date(last.started_at).getTime() > 55 * 60e3) hypo = await runHypo(Math.max(30e3, 270e3 - (Date.now() - started)));
    send(res, 200, { record, hypo });
  } catch (err) {
    send(res, 500, { error: String(err.message || err).slice(0, 300) });
  }
}
