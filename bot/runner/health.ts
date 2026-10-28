// Is the bot actually running? Read from bot_runs: when each job last showed signs of life, whether
// its runs finish, and what failed. Pure, so the dashboard (/api/data) and tests share it.
//
// The tower runs the paper cycle (~every 90 s), the market recorder (~5 min), the ProphetX
// listener (back to back) and Hypotheticals (hourly). When all of the tower's jobs go quiet at
// about the same moment, the machine (or WSL) stopped, not the code. Each run also records where it
// ran (`host`: tower, github, vercel), so cycles from the backups (GitHub Actions, /api/espn,
// /api/cycle) don't make a downed tower look healthy.

export type Level = "ok" | "warn" | "bad" | "off";
export type JobMode = "paper" | "record" | "pxtape" | "hypo" | "espn";

export interface RunRow {
  mode: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  venueErrors?: Record<string, string> | null;
  /** Where the run ran: "tower", "github", "vercel", "local"; null on runs from before hosts were saved. */
  host?: string | null;
}

export interface JobHealth {
  mode: JobMode;
  name: string;
  level: Level;
  /** Last sign of life: the newest start or finish. */
  last: string | null;
  note: string;
}

export interface Health {
  level: Level;
  /** Short pill text, e.g. "Live", "Slow", "Down". */
  label: string;
  /** One line on what's wrong and where. */
  detail: string;
  source: "tower" | "paper" | "venue" | "job" | null;
  /** Where the last finished paper cycle ran (null = not recorded). */
  lastCycleHost: string | null;
  /** When the problem started (last good sign), if known. */
  since: string | null;
  /** Last finished paper cycle (the pill counts its age live). */
  lastCycle: string | null;
  jobs: JobHealth[];
  asOf: string;
}

const MIN = 60e3;
/** Per job: how long after its last sign of life it counts as stopped, and how long a run may take before it was cut off. */
export const JOBS: Record<JobMode, { name: string; staleMs: number; runMs: number; tower: boolean }> = {
  paper: { name: "Paper cycle", staleMs: 6 * MIN, runMs: 6 * MIN, tower: true },
  record: { name: "Market recorder", staleMs: 12 * MIN, runMs: 8 * MIN, tower: true },
  pxtape: { name: "ProphetX listener", staleMs: 10 * MIN, runMs: 8 * MIN, tower: true },
  hypo: { name: "Hypotheticals", staleMs: 90 * MIN, runMs: 25 * MIN, tower: true },
  espn: { name: "ESPN backup", staleMs: 30 * MIN, runMs: 6 * MIN, tower: false },
};
/** Paper cycle age past which the pill turns amber ("Slow"); past JOBS.paper.staleMs it's red. */
export const PAPER_SLOW_MS = 3 * MIN;

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);
const lastOf = (r: RunRow) => Math.max(t(r.started_at), Number.isNaN(t(r.finished_at)) ? -Infinity : t(r.finished_at));

/** A run that never finished and has been going longer than its job allows (the process died mid-run). */
export function cutOff(r: Pick<RunRow, "mode" | "started_at" | "finished_at" | "error">, now: number): boolean {
  if (r.error === "timed out") return true;
  const job = JOBS[r.mode as JobMode];
  return !r.finished_at && !!job && now - t(r.started_at) > job.runMs;
}

const agoText = (ms: number) =>
  ms < 90e3 ? `${Math.round(ms / 1000)}s` : ms < 90 * MIN ? `${Math.round(ms / MIN)} min` : ms < 48 * 3600e3 ? `${(ms / 3600e3).toFixed(1)} h` : `${(ms / 86400e3).toFixed(1)} days`;
export const HOST_NAME: Record<string, string> = { tower: "the tower", github: "GitHub", vercel: "Vercel", local: "a manual run" };
const hostText = (h: string | null | undefined) => (h ? HOST_NAME[h] ?? h : null);
const venueText = (e: Record<string, string>) => Object.entries(e).map(([v, m]) => `${v[0].toUpperCase()}${v.slice(1)}: ${String(m).slice(0, 80)}`).join("; ");

/**
 * `runs` = the newest few runs of each mode, newest first within a mode. `towerLast` = the newest start or finish
 * of any run the tower made (it may be older than every run in `runs` when only backups have run since).
 */
export function botHealth(runs: RunRow[], now = Date.now(), opts: { towerLast?: string | null } = {}): Health {
  const byMode = new Map<string, RunRow[]>();
  for (const r of runs) (byMode.get(r.mode) ?? byMode.set(r.mode, []).get(r.mode)!).push(r);
  for (const list of byMode.values()) list.sort((a, b) => t(b.started_at) - t(a.started_at));

  const jobs: JobHealth[] = (Object.keys(JOBS) as JobMode[]).map((mode) => {
    const job = JOBS[mode];
    const list = byMode.get(mode) ?? [];
    if (!list.length) return { mode, name: job.name, level: mode === "espn" ? "off" : "bad", last: null, note: mode === "espn" ? "not set up" : "no runs yet" };
    const last = Math.max(...list.map(lastOf));
    const age = now - last;
    const newest = list[0];
    const done = list.find((r) => r.finished_at && !cutOff(r, now));
    let level: Level = "ok";
    const where = newest.host && newest.host !== "tower" ? ` on ${hostText(newest.host)}` : "";
    let note = `last ran ${agoText(age)} ago${where}`;
    // The ESPN backup only runs on its own schedule (e.g. Saturdays), so a quiet one is idle, not broken.
    if (age > job.staleMs) [level, note] = job.tower ? ["bad", `stopped: nothing for ${agoText(age)}${where && ` (last run${where})`}`] : ["off", `idle: last ran ${agoText(age)} ago`];
    else if (done?.error) [level, note] = ["bad", `error: ${done.error.slice(0, 120)}`];
    else if (list.slice(0, 3).some((r) => cutOff(r, now))) [level, note] = ["warn", `a recent run was cut off · ${note}`];
    else if (done?.venueErrors && Object.keys(done.venueErrors).length) [level, note] = ["warn", `${venueText(done.venueErrors)} · ${note}`];
    if (level === "ok" && !newest.finished_at) note = `running now · ${note}`;
    return { mode, name: job.name, level, last: new Date(last).toISOString(), note };
  });

  const paperRuns = byMode.get("paper") ?? [];
  const lastCycleRun = paperRuns.find((r) => r.finished_at && !cutOff(r, now)) ?? null;
  const lastCycle = lastCycleRun?.finished_at ?? null;
  const lastCycleHost = lastCycleRun?.host ?? null;
  const base = { jobs, lastCycle, lastCycleHost, asOf: new Date(now).toISOString() };
  const job = (m: JobMode) => jobs.find((j) => j.mode === m)!;
  const others = jobs.filter((j) => j.mode !== "paper" && (j.level === "bad" || j.level === "warn"));
  // (an ESPN backup error still shows: it only runs when asked to)
  const otherNote = others.length ? ` · also: ${others.map((j) => `${j.name} ${j.level === "bad" ? "stopped" : "warning"}`).join(", ")}` : "";

  const paperAge = lastCycle ? now - t(lastCycle) : Infinity;

  // Hosts known (the newest paper run says where it ran): judge the tower by its own runs, not the backups'.
  if (paperRuns[0]?.host) {
    const towerLast = t(opts.towerLast);
    const towerAge = Number.isNaN(towerLast) ? Infinity : now - towerLast;
    if (towerAge > JOBS.paper.staleMs) {
      const since = Number.isNaN(towerLast) ? null : new Date(towerLast).toISOString();
      const down = since ? `Tower offline for ${agoText(towerAge)}` : "Tower offline (no tower run recorded yet)";
      const lastBackup = lastCycle ? `the last cycle ran on ${hostText(lastCycleHost) ?? "a backup"} ${agoText(paperAge)} ago` : "no cycle has finished";
      if (paperAge <= JOBS.paper.staleMs)
        return { ...base, level: "warn", label: "Backup", source: "tower", since, detail: `${down}. Trading on backups only: ${lastBackup}.${otherNote}` };
      return { ...base, level: "bad", label: "Down", source: "tower", since, detail: `${down}; ${lastBackup}. Check the PC, WSL and the ycpr-bot service; /api/espn every 10 min keeps trading meanwhile.` };
    }
  }

  if (paperAge > JOBS.paper.staleMs) {
    // Every tower job quiet, and their last signs of life within ~10 min of each other: the machine stopped.
    const tower = (["paper", "record", "pxtape"] as JobMode[]).map(job);
    const lasts = tower.map((j) => t(j.last)).filter((x) => !Number.isNaN(x));
    const allQuiet = tower.every((j) => j.level === "bad" && j.note.startsWith("stopped"));
    const lastSign = lasts.length ? Math.max(...lasts) : NaN;
    if (allQuiet && lasts.length === tower.length && lastSign - Math.min(...lasts) <= 10 * MIN)
      return { ...base, level: "bad", label: "Down", source: "tower", since: new Date(lastSign).toISOString(), detail: `Tower offline: every job stopped at once, ${agoText(now - lastSign)} ago. Check the PC, WSL and the ycpr-bot service.` };
    if (paperRuns[0]?.error && paperRuns[0].error !== "timed out")
      return { ...base, level: "bad", label: "Down", source: "paper", since: lastCycle, detail: `Paper cycle failing: ${paperRuns[0].error.slice(0, 160)}` };
    const alive = tower.filter((j) => j.mode !== "paper" && j.level !== "bad").map((j) => j.name.toLowerCase());
    return {
      ...base, level: "bad", label: "Down", source: "paper", since: lastCycle,
      detail: `No paper cycle has finished ${lastCycle ? `for ${agoText(paperAge)}` : "yet"}${alive.length ? ` (the ${alive.join(" and ")} still running, so the tower is up: check the paper loop)` : ""}.${otherNote}`,
    };
  }
  if (lastCycleRun?.error)
    return { ...base, level: "bad", label: "Error", source: "paper", since: lastCycle, detail: `Last paper cycle ended with an error: ${lastCycleRun.error.slice(0, 160)}${otherNote}` };
  if (paperAge > PAPER_SLOW_MS)
    return { ...base, level: "warn", label: "Slow", source: "paper", since: lastCycle, detail: `Last paper cycle finished ${agoText(paperAge)} ago (normally every ~90 s).${otherNote}` };
  if (lastCycleRun?.venueErrors && Object.keys(lastCycleRun.venueErrors).length)
    return { ...base, level: "warn", label: "Live", source: "venue", since: null, detail: `Venue error in the last cycle: ${venueText(lastCycleRun.venueErrors)}${otherNote}` };
  if (others.length)
    return { ...base, level: "warn", label: "Live", source: "job", since: null, detail: `Trading normally${otherNote}` };
  return { ...base, level: "ok", label: "Live", source: null, since: null, detail: "Every job is running." };
}
