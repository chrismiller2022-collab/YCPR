// GET ?mode=paper|record|hypo|pxtape|all&before=<iso>&limit=50 → run history, newest first, for Settings.
import { authorized, sb, send } from "./_lib.js";

const MODES = ["paper", "record", "hypo", "pxtape"];

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Wrong or missing password" });
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const mode = MODES.includes(q.get("mode")) ? q.get("mode") : q.get("mode") === "all" ? null : "paper";
    const before = q.get("before");
    const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
    if (before && Number.isNaN(Date.parse(before))) return send(res, 400, { error: "bad before" });
    const rows = await sb(
      `bot_runs?select=id,mode,started_at,finished_at,games,orders_placed,orders_cancelled,fills,error,venues:summary->venues,venueErrors:summary->venueErrors,snaps:summary->snaps,trades:summary->trades,combos:summary->combos,labFills:summary->labFills` +
        `${mode ? `&mode=eq.${mode}` : ""}${before ? `&started_at=lt.${encodeURIComponent(before)}` : ""}&order=started_at.desc&limit=${limit}`
    );
    send(res, 200, { runs: rows, more: rows.length === limit });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
}
