// ESPN finals backup + tower failover. Point cron-job.org here (e.g. every 10 min, Saturday noon to Sunday 2 am ET)
// with header "Authorization: Bearer <CRON_SECRET>". Saves ESPN finals; if no paper cycle has finished for 10 minutes
// (the tower is down), runs a full cycle here instead and starts the recorder (bot/runner/espnJob.ts).
import { timingSafeEqual } from "node:crypto";
import { send } from "./_lib.js";
import { runEspnJob } from "./_bot.mjs";

function cronAuthorized(req) {
  const want = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Failover: the recorder and the ProphetX listener as their own function runs, like /api/cycle. */
function startRecorder(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return;
  for (const path of ["/api/record", "/api/pxtape"]) fetch(`https://${host}${path}`, { headers: { authorization: req.headers.authorization } }).catch(() => {});
}

export default async function handler(req, res) {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  try {
    send(res, 200, await runEspnJob({ onFailover: () => startRecorder(req) }));
  } catch (err) {
    send(res, 500, { error: String(err.message || err).slice(0, 300) });
  }
}
