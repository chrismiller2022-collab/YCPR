// ESPN backup + failover, for ycpr-bot's /api/espn (cron-job.org, e.g. every 10 min on Saturdays).
// The tower's paper cycle already saves ESPN finals every ~90 s; this covers the tower being down:
// - a paper cycle finished in the last 10 minutes → only save ESPN finals (cheap; no ESPN call
//   unless a game that started 2+ h ago isn't final);
// - otherwise → run a full paper cycle here instead (it saves finals too, and keeps trading).
// Logged in bot_runs as mode 'espn' so the dashboard's health panel shows the backup ran.

import { db } from "./io";
import { syncEspnFinals } from "./espnFinals";
import { runCycle } from "./paper";

/** No finished paper cycle for this long = the tower is down; trade from here. */
export const FAILOVER_MS = 10 * 60e3;

export interface EspnJobResult {
  failover: boolean;
  pending?: number;
  saved: number;
  games?: number;
  overlapped?: boolean;
  /** Minutes since the last finished paper cycle, when this run started. */
  quietMin?: number | null;
}

export async function runEspnJob(opts: { onFailover?: () => void; now?: () => number } = {}): Promise<EspnJobResult> {
  const now = opts.now ?? Date.now;
  const recent = await db.select("bot_runs", `select=id&mode=eq.espn&finished_at=is.null&started_at=gte.${new Date(now() - 5 * 60e3).toISOString()}`);
  if (recent.length) return { failover: false, saved: 0, overlapped: true };
  const [run] = await db.insert<{ id: number }>("bot_runs", { mode: "espn" });
  let result: EspnJobResult = { failover: false, saved: 0 };
  let error: string | null = null;
  try {
    const [last] = await db.select<{ finished_at: string }>("bot_runs", "select=finished_at&mode=eq.paper&finished_at=not.is.null&error=is.null&order=finished_at.desc&limit=1");
    const quiet = last ? now() - new Date(last.finished_at).getTime() : null;
    const quietMin = quiet == null ? null : Math.round(quiet / 60e3);
    if (quiet == null || quiet > FAILOVER_MS) {
      opts.onFailover?.();
      const totals = await runCycle();
      result = { failover: true, saved: totals.espnFinals ?? 0, games: totals.games, overlapped: totals.overlapped, quietMin };
    } else {
      const f = await syncEspnFinals();
      result = { failover: false, pending: f.pending, saved: f.saved, quietMin };
    }
    return result;
  } catch (err) {
    error = String(err instanceof Error ? err.message : err).slice(0, 2000);
    throw err;
  } finally {
    await db.update("bot_runs", `id=eq.${run.id}`, { finished_at: new Date().toISOString(), games: result.saved, error, summary: result }).catch(() => {});
  }
}
