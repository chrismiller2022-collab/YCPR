// Runs one paper-trading cycle. Called every ~5 min by an external scheduler
// (e.g. cron-job.org) with header "Authorization: Bearer <CRON_SECRET>".
// _bot.mjs is bot/runner/paper.ts bundled at deploy time (see hub/vercel.json).
import { timingSafeEqual } from "node:crypto";
import { send } from "./_lib.js";
import { runCycle } from "./_bot.mjs";

/** Kick off the market recorder and the ProphetX trade listener as their own function runs (own time limits and locks). */
function startRecorder(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return;
  for (const path of ["/api/record", "/api/pxtape"]) fetch(`https://${host}${path}`, { headers: { authorization: req.headers.authorization } }).catch(() => {});
}

function cronAuthorized(req) {
  const want = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  startRecorder(req);
  try {
    const totals = await runCycle();
    send(res, 200, totals);
  } catch (err) {
    send(res, 500, { error: String(err.message || err).slice(0, 300) });
  }
}
