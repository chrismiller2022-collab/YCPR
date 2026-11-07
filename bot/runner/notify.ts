// Updates to the private "YCPR alerts" Discord server, through channel webhooks set in the tower's .env:
//   DISCORD_WEBHOOK_URL        #bot   — errors (and the default for everything)
//   DISCORD_USAGE_WEBHOOK_URL  #usage — the daily Supabase usage report (falls back to #bot)
// With no webhook set nothing is sent. Posting never throws: an alert must not be able to break a trading cycle.
import { db, RUN_HOST } from "./io";
import { readState, writeState } from "./localState";

type Channel = "bot" | "usage";
const DAY = 86_400_000;
const ERROR_REPEAT_MS = 30 * 60e3; // the same problem is posted at most once per 30 minutes
const FREE_EGRESS_MB_PER_DAY = 5000 / 30.4; // Supabase free plan: 5 GB a month
const MAX_LEN = 1900; // Discord's limit is 2,000 characters a message

const webhookFor = (channel: Channel): string | undefined =>
  (channel === "usage" ? process.env.DISCORD_USAGE_WEBHOOK_URL : undefined) || process.env.DISCORD_WEBHOOK_URL || undefined;

export async function postDiscord(channel: Channel, content: string): Promise<boolean> {
  const url = webhookFor(channel);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.length > MAX_LEN ? `${content.slice(0, MAX_LEN)}…` : content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ errors

// A problem's identity for throttling: which job, plus the message with numbers stripped, so "Supabase 402 on bot_runs"
// at 9:01 and 9:02 count as the same problem.
const problemKey = (job: string, message: string) => `${job}:${message.replace(/\d+(\.\d+)?/g, "#").slice(0, 80)}`;

/** Post a job's errors to #bot, grouped into one message, skipping any already posted in the last 30 minutes. */
export async function notifyErrors(job: string, messages: string[], nowMs: number = Date.now()): Promise<number> {
  if (!messages.length || !webhookFor("bot")) return 0;
  const sent = readState<Record<string, number>>("alerts-sent.json") ?? {};
  const fresh = [...new Set(messages)].filter((m) => nowMs - (sent[problemKey(job, m)] ?? 0) >= ERROR_REPEAT_MS);
  if (!fresh.length) return 0;
  const ok = await postDiscord("bot", `⚠️ **${job}** on ${RUN_HOST}\n${fresh.map((m) => `• ${m.slice(0, 300)}`).join("\n")}`);
  if (ok) {
    for (const m of fresh) sent[problemKey(job, m)] = nowMs;
    // Forget anything older than a day so the file stays small.
    for (const [k, t] of Object.entries(sent)) if (nowMs - t > DAY) delete sent[k];
    writeState("alerts-sent.json", sent);
  }
  return ok ? fresh.length : 0;
}

/** Every error a job recorded in its totals (per game, per venue, or for the whole run), as lines for notifyErrors. */
export function errorLines(totals: { gameErrors?: string[]; venueErrors?: Partial<Record<string, string>>; error?: string }): string[] {
  return [
    ...(totals.gameErrors ?? []),
    ...Object.entries(totals.venueErrors ?? {}).map(([venue, e]) => `${venue}: ${e}`),
    ...(totals.error ? [totals.error] : []),
  ];
}

/** For a job's top-level catch: post the failure (throttled like any other error). */
export async function notifyFailure(job: string, err: unknown): Promise<void> {
  await notifyErrors(job, [`run failed: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`]).catch(() => 0);
}

/** Post a message to #bot at most once per key per Eastern day (e.g. "the daily loss stop tripped"). */
export async function notifyOncePerDay(key: string, content: string, nowMs: number = Date.now()): Promise<boolean> {
  if (!webhookFor("bot")) return false;
  const day = etDate(nowMs);
  const sent = readState<Record<string, string>>("daily-alerts.json") ?? {};
  if (sent[key] === day) return false;
  const ok = await postDiscord("bot", content);
  if (ok) writeState("daily-alerts.json", { ...sent, [key]: day });
  return ok;
}

// ------------------------------------------------------------------ daily usage report

const etDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const mb = (bytes: number) => bytes / 1e6;
const fmtMb = (bytes: number) => (mb(bytes) >= 10 ? mb(bytes).toFixed(0) : mb(bytes).toFixed(1));

interface EgressSummary {
  bytes: number;
  jobs: { job: string; runs: number; bytes: number; requests: number }[];
  tables: { tbl: string; bytes: number }[];
}

export function formatUsageReport(day: string, yesterday: EgressSummary, month: EgressSummary, monthDays: number): string {
  const pct = (100 * mb(yesterday.bytes)) / FREE_EGRESS_MB_PER_DAY;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const lines = [
    `📊 **Bot Supabase usage, ${label}:** ${fmtMb(yesterday.bytes)} MB (${pct.toFixed(0)}% of the ~${FREE_EGRESS_MB_PER_DAY.toFixed(0)} MB/day free-plan budget)${pct > 100 ? " ⚠️ over budget" : ""}`,
    ...yesterday.jobs.map((j) => `• ${j.job}: ${fmtMb(j.bytes)} MB in ${j.runs} runs (${j.requests.toLocaleString("en-US")} requests)`),
  ];
  if (yesterday.tables.length) lines.push(`Top tables: ${yesterday.tables.map((t) => `${t.tbl} ${fmtMb(t.bytes)} MB`).join(", ")}`);
  const monthMb = mb(month.bytes);
  const projected = (monthMb / Math.max(1, monthDays)) * 30.4;
  lines.push(`Month so far (bot only): ${monthMb.toFixed(0)} MB of 5,000 MB · on pace for ~${projected.toFixed(0)} MB. The website's share is on Supabase's Usage page.`);
  return lines.join("\n");
}

/**
 * Once a day, on the first run at or after 9am Eastern: post yesterday's bot egress to #usage. A bot_runs row marks the
 * day as reported, so it's sent once whichever host gets there first.
 */
export async function maybeUsageReport(nowMs: number = Date.now()): Promise<boolean> {
  if (!webhookFor("usage")) return false;
  const hourEt = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(nowMs)));
  if (hourEt < 9) return false;
  const day = etDate(nowMs - DAY);
  // Checked locally first, so the 90-second paper cycle doesn't ask the database every run.
  if (readState<{ day: string }>("usage-report.json")?.day === day) return false;
  const mode = `usage-report-${day}`;
  const done = await db.select("bot_runs", `select=id&mode=eq.${mode}&limit=1`);
  if (done.length) {
    writeState("usage-report.json", { day });
    return false;
  }
  const monthStart = `${day.slice(0, 8)}01`;
  const [y, m] = await Promise.all([
    db.rpc<EgressSummary>("bot_egress_summary", { p_from: day, p_to: day }),
    db.rpc<EgressSummary>("bot_egress_summary", { p_from: monthStart, p_to: day }),
  ]);
  const ok = await postDiscord("usage", formatUsageReport(day, y, m, Number(day.slice(8))));
  if (ok) {
    await db.insert("bot_runs", { mode, host: RUN_HOST, finished_at: new Date(nowMs).toISOString(), summary: { day, bytes: y.bytes } });
    writeState("usage-report.json", { day });
  }
  return ok;
}
