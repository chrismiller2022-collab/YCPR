// Scheduled rating pulls. Run hourly by .github/workflows/rating-pulls.yml
// (`npx tsx scripts/pull-ratings.ts`); each run decides from the current
// America/New_York time which sources are due, pulls them through the site's
// own /api/ratings endpoint (the same actions the Rating Systems page buttons
// use), matches team names with the site's matcher, saves, logs the run and
// sends a notification when something changed or broke.
//
// SAFETY: this only ever writes rating_pulls (the live "current" ratings) —
// via the "save" and "sync" actions. It never calls weekSave, so it cannot
// create or overwrite a saved week (weekly_power_ratings) or touch the public
// ratings; Save as Week and pushing YC stay manual.
//
// Schedule (ET, season Aug 1 – Feb 10 only):
//   sagarin, cfbd (FPI/SP+/SRS/Core/Elo): hourly Sun 6:00-12:00, otherwise once daily from 8:00
//   fei, tr, sheet:                       once daily from 8:00
//   jpplus:                               hourly Sun 6:00-9:00, stops for the window once it has updated
//   mcillece:                             hourly Sun 11:00 → Mon 11:00, stops for the window once it has updated
// "Once daily from 8:00" = due once per ET day after 8:00 if it hasn't run
// since, so a late GitHub run doesn't skip the day.
//
// Env: SITE_URL, ADMIN_PASSWORD (required); NTFY_TOPIC and/or
// DISCORD_WEBHOOK_URL (optional notifications); FORCE_SOURCES (comma list,
// runs those now regardless of schedule/season).

import { matchTeamRows } from "../src/lib/teamNameMatch";
import { parseSheetCsv } from "../src/lib/ratingsCsv";

const SITE_URL = (process.env.SITE_URL ?? "").replace(/\/$/, "");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? "";
const DISCORD = process.env.DISCORD_WEBHOOK_URL ?? "";
const FORCE = (process.env.FORCE_SOURCES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

type SourceKey = "sagarin" | "cfbd" | "fei" | "jpplus" | "mcillece" | "tr" | "sheet";
const SOURCE_LABELS: Record<SourceKey, string> = {
  sagarin: "Sagarin",
  cfbd: "CFBD (FPI/SP+/SRS/Core/Elo)",
  fei: "FEI/F+",
  jpplus: "JP+",
  mcillece: "McIllece",
  tr: "TR",
  sheet: "Google Sheet",
};
const ALL_SOURCES = Object.keys(SOURCE_LABELS) as SourceKey[];

// ---------------------------------------------------------------------
// Time helpers (everything on the schedule is Eastern time)
// ---------------------------------------------------------------------
interface EtNow {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0 = Sunday
  hour: number;
  dateKey: string; // YYYY-MM-DD
}
function etNow(d = new Date()): EtNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return { year, month, day, weekday, hour, dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

/** Season runs Aug 1 – Feb 10. */
function inSeason(n: EtNow): boolean {
  return n.month >= 8 || n.month === 1 || (n.month === 2 && n.day <= 10);
}
/** The season's year for CFBD/FEI (Jan–Feb belong to the season that started the previous August). */
function seasonYear(n: EtNow): number {
  return n.month <= 2 ? n.year - 1 : n.year;
}

interface RunRow {
  source: string;
  ran_at: string;
  ok: boolean;
  changed: number | null;
  new_teams: number | null;
  error: string | null;
}

type Mode = { kind: "hourly"; stopOnceUpdated: boolean; windowStartHoursAgo: number } | { kind: "daily" } | null;

/** How a source is scheduled right now (null = not due by the clock). */
function modeFor(source: SourceKey, n: EtNow): Mode {
  const sun = n.weekday === 0;
  const mon = n.weekday === 1;
  switch (source) {
    case "sagarin":
    case "cfbd":
      if (sun && n.hour >= 6 && n.hour <= 12) return { kind: "hourly", stopOnceUpdated: source === "sagarin", windowStartHoursAgo: n.hour - 6 };
      return n.hour >= 8 ? { kind: "daily" } : null;
    case "fei":
    case "tr":
    case "sheet":
      return n.hour >= 8 ? { kind: "daily" } : null;
    case "jpplus":
      return sun && n.hour >= 6 && n.hour <= 9 ? { kind: "hourly", stopOnceUpdated: true, windowStartHoursAgo: n.hour - 6 } : null;
    case "mcillece":
      if (sun && n.hour >= 11) return { kind: "hourly", stopOnceUpdated: true, windowStartHoursAgo: n.hour - 11 };
      if (mon && n.hour <= 11) return { kind: "hourly", stopOnceUpdated: true, windowStartHoursAgo: 13 + n.hour };
      return null;
  }
}

// ---------------------------------------------------------------------
// Site API
// ---------------------------------------------------------------------
async function api(action: string, body: Record<string, any> = {}): Promise<any> {
  const res = await fetch(`${SITE_URL}/api/ratings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, action, ...body }),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error(data?.error ?? `${action} failed (${res.status}) ${text.slice(0, 120)}`);
  return data;
}

interface PullOutcome {
  fetched: number;
  matched: number;
  saved: number;
  changed: number;
  unchanged: number;
  newTeams: number;
  unmatched: string[];
  label?: string | null;
  detail?: any;
  errors?: string[]; // partial failures (e.g. one CFBD system errored)
}

/** Match team names, save to rating_pulls through the "save" action, and summarize. */
async function matchAndSave(scraped: { team: string; values: Record<string, number> }[], label?: string | null): Promise<PullOutcome> {
  const { matched, unmatched } = matchTeamRows(scraped, (r) => r.team);
  if (matched.length === 0) throw new Error(`0 of ${scraped.length} team names matched`);
  const result = await api("save", { rows: matched.map((m) => ({ team: m.team, values: m.row.values })) });
  let changed = 0;
  let unchanged = 0;
  let newTeams = 0;
  for (const s of Object.values<any>(result.bySystem ?? {})) {
    changed += s.changed;
    unchanged += s.unchanged;
    newTeams += s.newTeams;
  }
  return { fetched: scraped.length, matched: matched.length, saved: result.saved ?? 0, changed, unchanged, newTeams, unmatched: unmatched.map((u) => u.team), label };
}

async function runSource(source: SourceKey, year: number): Promise<PullOutcome> {
  switch (source) {
    case "sagarin": {
      const d = await api("sagarinProxy");
      return matchAndSave(d.rows);
    }
    case "fei": {
      const d = await api("fplusProxy", { year });
      return matchAndSave(d.rows);
    }
    case "mcillece": {
      const d = await api("mcilleceProxy");
      return matchAndSave(d.rows, d.year ? `${d.year}` : null);
    }
    case "jpplus": {
      const d = await api("jpplusProxy");
      return matchAndSave(d.rows, d.label);
    }
    case "tr": {
      const d = await api("teamrankingsProxy");
      return matchAndSave(d.rows);
    }
    case "sheet": {
      const d = await api("sheetProxy");
      const parsed = parseSheetCsv(d.csv);
      if (parsed.length === 0) throw new Error("Sheet parsed 0 rows — headers may have changed");
      return matchAndSave(parsed.map((r) => ({ team: r.team, values: r.values })));
    }
    case "cfbd": {
      // The server's sync action matches names itself (CFBD uses canonical names) and saves.
      const d = await api("sync", { year });
      let fetched = 0;
      let saved = 0;
      let changed = 0;
      let unchanged = 0;
      let newTeams = 0;
      const errors: string[] = [];
      const perSystem: Record<string, any> = {};
      for (const [key, r] of Object.entries<any>(d.results ?? {})) {
        perSystem[key] = { fetched: r.fetched, saved: r.saved, changed: r.changed, yearUsed: r.yearUsed, error: r.error };
        if (r.error) errors.push(`${key}: ${r.error}`);
        fetched += r.fetched ?? 0;
        saved += r.saved ?? 0;
        changed += r.changed ?? 0;
        unchanged += r.unchanged ?? 0;
        newTeams += r.newTeams ?? 0;
      }
      return { fetched, matched: fetched, saved, changed, unchanged, newTeams, unmatched: [], label: `${d.year}`, detail: perSystem, errors };
    }
  }
}

// ---------------------------------------------------------------------
// Notifications (optional: ntfy.sh topic and/or a Discord webhook)
// ---------------------------------------------------------------------
async function notify(title: string, message: string, priority: "default" | "high" = "default") {
  console.log(`NOTIFY: ${title} — ${message}`);
  const jobs: Promise<any>[] = [];
  if (NTFY_TOPIC) {
    jobs.push(
      fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
        method: "POST",
        headers: { Title: title, Priority: priority === "high" ? "high" : "default" },
        body: message,
      }).catch((e) => console.log("ntfy failed:", e?.message))
    );
  }
  if (DISCORD) {
    jobs.push(
      fetch(DISCORD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `**${title}**\n${message}`.slice(0, 1900) }),
      }).catch((e) => console.log("discord failed:", e?.message))
    );
  }
  await Promise.all(jobs);
}

// ---------------------------------------------------------------------
async function main() {
  if (!SITE_URL || !PASSWORD) throw new Error("SITE_URL and ADMIN_PASSWORD must be set");
  const now = etNow();
  const forced = FORCE.length > 0;
  console.log(`ET now: ${now.dateKey} weekday ${now.weekday} hour ${now.hour}; in season: ${inSeason(now)}${forced ? `; FORCED: ${FORCE.join(",")}` : ""}`);
  if (!forced && !inSeason(now)) {
    console.log("Off-season — nothing to do.");
    return;
  }

  const { runs } = (await api("getPullRuns", { since: new Date(Date.now() - 4 * 86400000).toISOString() })) as { runs: RunRow[] };
  const runsFor = (s: SourceKey) => runs.filter((r) => r.source === s);
  const year = seasonYear(now);

  let anyFailed = false;
  for (const source of ALL_SOURCES) {
    const isForced = FORCE.includes(source);
    if (forced && !isForced) continue;

    if (!isForced) {
      const mode = modeFor(source, now);
      if (!mode) continue;
      const past = runsFor(source);
      const lastAny = past[0];
      if (mode.kind === "daily") {
        // Due once per ET day: skip if it already ran (successfully) today after 8:00 ET.
        const ranToday = past.some((r) => r.ok && etNow(new Date(r.ran_at)).dateKey === now.dateKey && etNow(new Date(r.ran_at)).hour >= 8);
        if (ranToday) continue;
      } else {
        // Hourly window: skip a duplicate within ~50 minutes, and (for single-update sources) stop once it has updated this window.
        if (lastAny && Date.now() - new Date(lastAny.ran_at).getTime() < 50 * 60 * 1000) continue;
        if (mode.stopOnceUpdated) {
          const windowStart = Date.now() - (mode.windowStartHoursAgo + 1) * 3600 * 1000;
          const updated = past.some((r) => r.ok && new Date(r.ran_at).getTime() >= windowStart && (r.changed ?? 0) + (r.new_teams ?? 0) > 0);
          if (updated) {
            console.log(`${source}: already updated this window — skipping`);
            continue;
          }
        }
      }
    }

    const label = SOURCE_LABELS[source];
    const previous = runsFor(source)[0];
    try {
      const out = await runSource(source, year);
      const ok = !out.errors || out.errors.length === 0;
      const updated = out.changed + out.newTeams > 0;
      console.log(`${label}: fetched ${out.fetched}, matched ${out.matched}, saved ${out.saved}, changed ${out.changed}, new ${out.newTeams}, unmatched ${out.unmatched.length}${out.label ? ` [${out.label}]` : ""}`);
      await api("logPullRun", {
        source,
        trigger: isForced ? "manual" : "schedule",
        ok,
        error: out.errors?.join("; ") ?? null,
        fetched: out.fetched,
        matched: out.matched,
        saved: out.saved,
        changed: out.changed,
        unchanged: out.unchanged,
        newTeams: out.newTeams,
        unmatched: out.unmatched,
        label: out.label ?? null,
        detail: out.detail ?? null,
      });
      if (!ok) {
        anyFailed = true;
        if (!previous || previous.ok) await notify(`${label} pull had errors`, out.errors!.join("; "), "high");
      } else if (updated || out.unmatched.length > 0) {
        const bits = [];
        if (updated) bits.push(`${out.changed + out.newTeams} of ${out.matched} teams changed${out.label ? ` (${out.label})` : ""}`);
        if (out.unmatched.length > 0) bits.push(`${out.unmatched.length} unmatched team name(s): ${out.unmatched.slice(0, 8).join(", ")}${out.unmatched.length > 8 ? "…" : ""}`);
        await notify(`${label} ${updated ? "updated" : "pulled"}`, bits.join(". ") + ". Live ratings only — no saved week was touched.");
      }
    } catch (err: any) {
      anyFailed = true;
      const message = err?.message ?? String(err);
      console.log(`${label} FAILED: ${message}`);
      await api("logPullRun", { source, trigger: isForced ? "manual" : "schedule", ok: false, error: message }).catch(() => {});
      // Notify on the first failure in a row only, so an hourly window doesn't spam.
      if (!previous || previous.ok) await notify(`${label} pull FAILED`, message, "high");
    }
  }
  if (anyFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
