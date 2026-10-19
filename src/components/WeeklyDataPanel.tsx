import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAdminWeek } from "../lib/adminWeek";
import {
  WEEKLY_STEPS,
  fetchCfbdPullRuns,
  fetchWeeklyCoverage,
  gapsFrom,
  runWeeklyStep,
  type CfbdPullRun,
  type WeeklyCoverage,
  type WeeklyStep,
} from "../lib/api/weeklyData";
import { fetchMarketLinesUpdatedAt, refreshMarketLines } from "../lib/api/marketLines";

// One place for the week's data: Sync week pulls everything CFBD has for the selected week (games, lines, game
// stats, plays, season stats); Fill gaps re-runs only what the coverage table shows missing; Refresh Vegas lines
// saves the median across sportsbooks that every page uses as "Vegas".

const cell: CSSProperties = { padding: "0.25rem 0.55rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap", textAlign: "right" };
const STEP_LABEL: Record<WeeklyStep, string> = Object.fromEntries(WEEKLY_STEPS.map((s) => [s.key, s.label])) as Record<WeeklyStep, string>;

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Frac({ n, of }: { n: number; of: number }) {
  if (of === 0) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  const full = n >= of;
  return <span style={{ color: full ? "var(--c-ok)" : n === 0 ? "var(--c-err)" : "var(--c-warn)", fontWeight: full ? 400 : 700 }}>{`${n}/${of}`}</span>;
}

export default function WeeklyDataPanel() {
  const season = new Date().getFullYear();
  const { week: adminWeek } = useAdminWeek();
  const [week, setWeek] = useState(adminWeek);
  useEffect(() => setWeek(adminWeek), [adminWeek]);
  const [coverage, setCoverage] = useState<WeeklyCoverage | null>(null);
  const [runs, setRuns] = useState<CfbdPullRun[]>([]);
  const [linesAt, setLinesAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    Promise.all([fetchWeeklyCoverage(season), fetchCfbdPullRuns(), fetchMarketLinesUpdatedAt(season)])
      .then(([c, r, l]) => {
        setCoverage(c);
        setRuns(r);
        setLinesAt(l);
      })
      .catch((e) => setError(e.message ?? "Failed to load coverage"));
  }
  useEffect(reload, [season]);

  const gaps = useMemo(() => (coverage ? gapsFrom(coverage, week) : []), [coverage, week]);

  async function runSteps(steps: { week: number; step: WeeklyStep }[], label: string) {
    if (steps.length === 0) {
      setLog(["Nothing missing through Week " + week + "."]);
      return;
    }
    setBusy(label);
    setError(null);
    const lines: string[] = [];
    for (const s of steps) {
      setLog([...lines, `Week ${s.week} · ${STEP_LABEL[s.step]}…`]);
      try {
        const r = await runWeeklyStep(season, s.week, s.step);
        lines.push(`Week ${s.week} · ${STEP_LABEL[s.step]}: saved ${r.saved ?? 0}`);
      } catch (e: any) {
        lines.push(`Week ${s.week} · ${STEP_LABEL[s.step]}: FAILED — ${e.message ?? "error"}`);
      }
      setLog([...lines]);
    }
    setBusy(null);
    reload();
  }

  async function handleRefreshLines() {
    setBusy("lines");
    setError(null);
    try {
      const r = await refreshMarketLines(season);
      setLog([
        `Vegas lines: ${r.oddsGames} games from the odds feed, ${r.matched} matched and saved as the median across books.` +
          (r.unmatched.length ? ` Not matched (${r.unmatched.length}): ${r.unmatched.slice(0, 8).join(", ")}${r.unmatched.length > 8 ? "…" : ""}` : ""),
      ]);
    } catch (e: any) {
      setError(e.message ?? "Refreshing lines failed");
    } finally {
      setBusy(null);
      reload();
    }
  }

  const syncWeekSteps: { week: number; step: WeeklyStep }[] = WEEKLY_STEPS.map((s) => ({ week, step: s.key }));
  const requests = WEEKLY_STEPS.reduce((n, s) => n + s.requests, 0);
  const shownWeeks = (coverage?.weeks ?? []).filter((w) => w.week <= week).slice(-6);

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <div className="section-label" style={{ margin: 0 }}>
        Weekly data
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem", alignItems: "center" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Week <input type="number" min={1} max={20} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)} style={{ width: 56 }} />
        </label>
        <button
          className="primary"
          onClick={() => runSteps(syncWeekSteps, "sync")}
          disabled={busy != null}
          style={{ fontSize: "0.95rem", fontWeight: 700, padding: "0.55rem 1.2rem" }}
          title={`${WEEKLY_STEPS.map((s) => `${s.label}: ${s.what}`).join("\n")}\n\n${requests} CFBD requests`}
        >
          {busy === "sync" ? "Syncing…" : `Sync Week ${week}`}
        </button>
        <button onClick={() => runSteps(gaps, "gaps")} disabled={busy != null || !coverage} style={{ fontWeight: 600 }} title={gaps.map((g) => `Week ${g.week} · ${STEP_LABEL[g.step]}`).join("\n") || "Nothing missing"}>
          {busy === "gaps" ? "Filling…" : `Fill gaps (${gaps.length})`}
        </button>
        <button onClick={handleRefreshLines} disabled={busy != null} style={{ fontWeight: 600 }} title="Median spread, total and moneyline across sportsbooks (The Odds API, 1 request). Opening lines are kept.">
          {busy === "lines" ? "Refreshing…" : "Refresh Vegas lines"}
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Vegas lines updated {fmtWhen(linesAt)}</span>
      </div>
      <p style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", margin: 0 }}>
        Sync week runs {WEEKLY_STEPS.map((s) => s.label.toLowerCase()).join(", ")} ({requests} CFBD requests). DROGBA, Totals and Matchups → Review read
        these, so they don't need their own pulls. Final games grade against CFBD's closing line; upcoming games use the Vegas median.
      </p>
      {error && <p style={{ color: "var(--c-err)", fontSize: "0.82rem", margin: 0 }}>{error}</p>}
      {log.length > 0 && <pre style={{ fontSize: "0.76rem", margin: 0, whiteSpace: "pre-wrap", color: "var(--chalk-dim)" }}>{log.join("\n")}</pre>}
      <div className="table-scroll" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              {["Week", "Games", "Final", "PGWE", "Lines", "Game stats", "Plays"].map((h) => (
                <th key={h} style={{ ...cell, color: "var(--chalk-dim)", fontWeight: 600 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownWeeks.map((w) => (
              <tr key={w.week}>
                <td style={{ ...cell, fontWeight: 700 }}>{w.week}</td>
                <td style={cell}>{w.games}</td>
                <td style={cell}>
                  <Frac n={w.completed} of={w.started} />
                </td>
                <td style={cell}>
                  <Frac n={w.withPgwe} of={w.completed} />
                </td>
                <td style={cell}>
                  <Frac n={w.withLine} of={w.games} />
                </td>
                <td style={cell}>
                  <Frac n={w.withGameStats} of={w.completed} />
                </td>
                <td style={cell}>
                  <Frac n={w.withPlays} of={w.completed} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: "0.74rem", color: "var(--chalk-dim)" }}>
        Season stats updated {fmtWhen(coverage?.seasonStatsUpdatedAt ?? null)}
        {runs.length > 0 && (
          <>
            {" · "}Last pulls:{" "}
            {runs.slice(0, 5).map((r, i) => (
              <span key={i} style={{ color: r.ok ? undefined : "var(--c-err)" }} title={r.error ?? undefined}>
                {i > 0 ? ", " : ""}
                {r.label} {STEP_LABEL[r.source.replace("cfbd:", "") as WeeklyStep] ?? r.source} {r.ok ? fmtWhen(r.ran_at) : "failed"}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
