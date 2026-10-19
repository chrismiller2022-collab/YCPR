import { supabase } from "./supabaseClient";
import { fetchMonteCarloRuns } from "./api/monteCarlo";

// The Weekly Run: every step of the admin week in order, with where it's done, when it's due and whether it's done.
// "Auto" steps read their status from the database (a pull logged, a week saved, a sim run); the rest are check-offs
// stored in admin_weekly_checklist under week key "run-<season>-w<week>" (updated_at is the time it was checked).

export type AdminViewKey = string;

export interface RunStep {
  key: string;
  label: string;
  view: AdminViewKey; // admin view the row links to
  /** Day offset from the run's Sunday (0 = Sun … 6 = Sat) plus hour/minute, or "firstKickoff". */
  due: { day: number; hour: number; minute?: number } | "firstKickoff";
  auto?: AutoCheck;
}

type AutoCheck = "cfbdPull" | "ratingsAny" | "ratingsAll" | "monteCarlo" | "ycSaved" | "sosSaved" | "resumeSaved" | "totalsSaved" | "locks";

export const RUN_STEPS: RunStep[] = [
  { key: "sync", label: "Sync week data (scores, stats, closing lines)", view: "gameslines", due: { day: 0, hour: 7 }, auto: "cfbdPull" },
  { key: "grade", label: "Grade last week (performance)", view: "bethistory", due: { day: 0, hour: 7 } },
  { key: "drogba", label: "Run DROGBA", view: "drogba", due: { day: 0, hour: 7 } },
  { key: "openers", label: "Bet DROGBA openers", view: "pm", due: { day: 0, hour: 10 } },
  { key: "totals", label: "Run Totals", view: "gametotals", due: { day: 0, hour: 10 }, auto: "totalsSaved" },
  { key: "ratings", label: "Update rating systems (Sync All)", view: "ratingsystems", due: { day: 0, hour: 11 }, auto: "ratingsAny" },
  { key: "ratingsall", label: "Make sure all are updated (Fill gaps)", view: "ratingsystems", due: { day: 0, hour: 14 }, auto: "ratingsAll" },
  { key: "mc", label: "Run Monte Carlo", view: "montecarlo", due: { day: 0, hour: 11 }, auto: "monteCarlo" },
  { key: "srs", label: "Send SRS to rating systems", view: "ratingsystems", due: { day: 0, hour: 11 } },
  { key: "ycpr", label: "Save YCPR (Save as Week + Push YC)", view: "ratingsystems", due: { day: 0, hour: 11 }, auto: "ycSaved" },
  { key: "bets", label: "Make YCPR bets", view: "placedbets", due: { day: 0, hour: 15 } },
  { key: "sos", label: "Save SOS to new week", view: "sos", due: { day: 0, hour: 15 }, auto: "sosSaved" },
  { key: "resume", label: "Save résumé to new week", view: "resumerating", due: { day: 0, hour: 15 }, auto: "resumeSaved" },
  { key: "lock", label: "Lock week (freeze games before kickoff)", view: "lockgames", due: "firstKickoff", auto: "locks" },
  { key: "midweek", label: "Midweek socials post", view: "imagedump", due: { day: 3, hour: 16 } },
  { key: "cfbdpool", label: "CFBD pool picks", view: "pools", due: "firstKickoff" },
  { key: "britpool", label: "Brit pool picks", view: "pools", due: { day: 2, hour: 17 } },
  { key: "pools", label: "All other pool picks", view: "pools", due: { day: 6, hour: 12 } },
  { key: "eow", label: "End-of-week socials post", view: "imagedump", due: { day: 5, hour: 14 } },
];

export const runChecklistWeek = (season: number, week: number) => `run-${season}-w${week}`;

/** The Sunday (local midnight) that starts a week's run: the Sunday on or before its first kickoff. */
export function runSunday(firstKickoff: string | null): Date {
  const d = firstKickoff ? new Date(firstKickoff) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function dueAt(step: RunStep, sunday: Date, firstKickoff: string | null): Date | null {
  if (step.due === "firstKickoff") return firstKickoff ? new Date(firstKickoff) : null;
  const d = new Date(sunday);
  d.setDate(d.getDate() + step.due.day);
  d.setHours(step.due.hour, step.due.minute ?? 0, 0, 0);
  return d;
}

export interface AutoStatus {
  done: boolean;
  at: string | null;
  note?: string;
}

const RATING_SOURCES = ["cfbd", "sheet", "sagarin", "mcillece", "jpplus", "tr"];

// A row's own timestamp, whichever name the table uses.
function stampOf(row: any): string | null {
  return row?.updated_at ?? row?.created_at ?? row?.inserted_at ?? row?.saved_at ?? row?.run_at ?? null;
}

async function weekRow(table: string, season: number, week: number): Promise<any | null> {
  const { data, error } = await supabase.from(table).select("*").eq("season", season).eq("week", week).limit(1);
  if (error) return null;
  return data?.[0] ?? null;
}

/** Status for every auto step, for the run whose Sunday is `sunday` and whose games are `week`. */
export async function fetchAutoStatuses(season: number, week: number, sunday: Date): Promise<Partial<Record<AutoCheck, AutoStatus>>> {
  const since = sunday.toISOString();
  const [pulls, mcRuns, yc, sos, resume, totals] = await Promise.all([
    supabase.from("rating_pull_runs").select("source, ran_at, ok").gte("ran_at", since).order("ran_at", { ascending: false }).limit(500),
    fetchMonteCarloRuns(season).catch(() => []),
    weekRow("weekly_power_ratings", season, week),
    weekRow("team_sos", season, week),
    weekRow("team_resume_ratings", season, week),
    weekRow("game_total_snapshots", season, week),
  ]);
  const runs = (pulls.data ?? []) as { source: string; ran_at: string; ok: boolean }[];
  const out: Partial<Record<AutoCheck, AutoStatus>> = {};

  const cfbd = runs.find((r) => r.ok && r.source.startsWith("cfbd:"));
  out.cfbdPull = { done: !!cfbd, at: cfbd?.ran_at ?? null };

  const ratingOk = RATING_SOURCES.map((s) => runs.find((r) => r.ok && r.source === s)).filter(Boolean) as { ran_at: string }[];
  const latestRating = ratingOk.map((r) => r.ran_at).sort().pop() ?? null;
  out.ratingsAny = { done: ratingOk.length > 0, at: latestRating, note: `${ratingOk.length}/${RATING_SOURCES.length} sources` };
  out.ratingsAll = { done: ratingOk.length === RATING_SOURCES.length, at: ratingOk.length === RATING_SOURCES.length ? latestRating : null, note: `${ratingOk.length}/${RATING_SOURCES.length} sources pulled` };

  const mc = mcRuns.find((r) => r.run_at >= since);
  out.monteCarlo = { done: !!mc, at: mc?.run_at ?? null };

  out.ycSaved = { done: !!yc, at: stampOf(yc) };
  out.sosSaved = { done: !!sos, at: stampOf(sos) };
  out.resumeSaved = { done: !!resume, at: stampOf(resume) };
  out.totalsSaved = { done: !!totals, at: stampOf(totals) };
  return out;
}

export async function fetchRunCheckoffs(season: number, week: number): Promise<Record<string, { checked: boolean; at: string | null }>> {
  const { data, error } = await supabase
    .from("admin_weekly_checklist")
    .select("item_key, checked, updated_at")
    .eq("week", runChecklistWeek(season, week));
  if (error) throw error;
  const out: Record<string, { checked: boolean; at: string | null }> = {};
  for (const r of (data ?? []) as { item_key: string; checked: boolean; updated_at: string | null }[]) out[r.item_key] = { checked: r.checked, at: r.updated_at };
  return out;
}
