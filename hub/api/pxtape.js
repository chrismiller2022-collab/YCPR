// Listens to ProphetX's public trade broadcast for most of a cycle and records the prints
// (bot/runner/pxtape.ts). Started by /api/cycle with the same "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from "node:crypto";
import { send } from "./_lib.js";
import { runPxTape } from "./_bot.mjs";

function cronAuthorized(req) {
  const want = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  try {
    const t = await runPxTape(285e3);
    send(res, 200, { trades: t.trades, unmatched: t.unmatched, channels: t.channels, error: t.error ?? null });
  } catch (err) {
    send(res, 500, { error: String(err.message || err).slice(0, 300) });
  }
}
