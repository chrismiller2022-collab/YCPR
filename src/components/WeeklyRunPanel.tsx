import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAdminWeek } from "../lib/adminWeek";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { toggleChecklistItem } from "../lib/api/adminChecklist";
import { RUN_STEPS, dueAt, fetchAutoStatuses, fetchRunCheckoffs, runChecklistWeek, runSunday, type AutoStatus, type RunStep } from "../lib/weeklyRun";
import WeeklyDataPanel from "./WeeklyDataPanel";

// Admin home: the week's run in order. Each row shows done/overdue state, when it was done, when it's due and a link
// to the page that does it. Rows the database can confirm turn green on their own; the rest have a check-off.

function fmtWhen(d: Date | string | null): string {
  if (!d) return "–";
  return new Date(d).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const cell: CSSProperties = { padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", verticalAlign: "middle" };

export default function WeeklyRunPanel({ onNavigate }: { onNavigate: (view: string) => void }) {
  const season = new Date().getFullYear();
  const { week } = useAdminWeek();
  const [games, setGames] = useState<GameWithLines[] | null>(null);
  const [auto, setAuto] = useState<Partial<Record<string, AutoStatus>>>({});
  const [checks, setChecks] = useState<Record<string, { checked: boolean; at: string | null }>>({});
  const [error, setError] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const [tick, setTick] = useState(0);
  const { locks } = useGameProjectionLocks(season, [week]);

  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season, week)
      .then((g) => !cancelled && setGames(g.filter((x) => x.home_classification === "fbs" || x.away_classification === "fbs")))
      .catch(() => !cancelled && setGames([]));
    return () => {
      cancelled = true;
    };
  }, [season, week, tick]);

  const firstKickoff = useMemo(() => {
    const ks = (games ?? []).map((g) => g.start_date).filter((x): x is string => !!x).sort();
    return ks[0] ?? null;
  }, [games]);
  const sunday = useMemo(() => runSunday(firstKickoff), [firstKickoff]);

  useEffect(() => {
    if (!games) return;
    let cancelled = false;
    Promise.all([fetchAutoStatuses(season, week, sunday), fetchRunCheckoffs(season, week)])
      .then(([a, c]) => {
        if (cancelled) return;
        setAuto(a);
        setChecks(c);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load status"));
    return () => {
      cancelled = true;
    };
  }, [games, season, week, sunday, tick]);

  // Lock Week: games not yet frozen, earliest game day first. Only the next game day's games are listed; once those
  // are locked the next day's show up.
  const unlocked = useMemo(
    () => (games ?? []).filter((g) => !g.completed && !locks[g.id]).sort((a, b) => (a.start_date ?? "9").localeCompare(b.start_date ?? "9")),
    [games, locks]
  );
  const nextLockDay = unlocked[0]?.start_date ? new Date(unlocked[0].start_date).toDateString() : null;
  const nextLockGames = unlocked.filter((g) => (g.start_date ? new Date(g.start_date).toDateString() : null) === nextLockDay);

  function statusOf(step: RunStep): { done: boolean; at: string | null; note?: string; manual: boolean } {
    if (step.auto === "locks") {
      const total = (games ?? []).length;
      return { done: total > 0 && unlocked.length === 0, at: null, note: total ? `${total - unlocked.length}/${total} locked` : undefined, manual: false };
    }
    if (step.auto) {
      const a = auto[step.auto];
      if (a?.done) return { ...a, manual: false };
      // An auto step can still be checked off by hand (e.g. done outside the site).
      const c = checks[step.key];
      return { done: !!c?.checked, at: c?.checked ? c.at : null, note: a?.note, manual: false };
    }
    const c = checks[step.key];
    return { done: !!c?.checked, at: c?.checked ? c.at : null, manual: true };
  }

  async function toggle(step: RunStep, next: boolean) {
    setChecks((prev) => ({ ...prev, [step.key]: { checked: next, at: next ? new Date().toISOString() : null } }));
    try {
      await toggleChecklistItem(runChecklistWeek(season, week), step.key, next);
    } catch (e: any) {
      setError(e.message ?? "Couldn't save");
    }
  }

  const now = Date.now();
  const rows = RUN_STEPS.map((step) => ({ step, status: statusOf(step), due: dueAt(step, sunday, firstKickoff) }));
  const doneCount = rows.filter((r) => r.status.done).length;

  return (
    <section className="admin-panel" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div className="admin-panel-head">
        <h3>
          Week {week} run · {doneCount}/{rows.length} done
        </h3>
        <button className="admin-link admin-panel-link" onClick={() => setTick((n) => n + 1)}>
          Refresh status
        </button>
      </div>
      <div className="admin-progress" title={`${doneCount} of ${rows.length} done`}>
        <span style={{ width: `${(doneCount / rows.length) * 100}%` }} />
      </div>
      {error && <p style={{ color: "var(--c-err)", fontSize: "0.82rem", margin: 0 }}>{error}</p>}
      <div className="table-scroll" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.84rem" }}>
          <thead>
            <tr>
              {["", "Step", "Done", "Due"].map((h, i) => (
                <th key={i} style={{ ...cell, textAlign: "left", color: "var(--chalk-dim)", fontWeight: 600, fontSize: "0.74rem" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ step, status, due }, i) => {
              const overdue = !status.done && due != null && due.getTime() < now;
              const bg = status.done ? "color-mix(in srgb, var(--c-ok) 10%, transparent)" : overdue ? "color-mix(in srgb, var(--c-err) 12%, transparent)" : undefined;
              return (
                <tr key={step.key} style={{ background: bg }}>
                  <td style={{ ...cell, width: 28 }}>
                    <input
                      type="checkbox"
                      checked={status.done}
                      disabled={step.auto === "locks" || (!!step.auto && !!auto[step.auto]?.done)}
                      onChange={(e) => toggle(step, e.target.checked)}
                      title={step.auto && step.auto !== "locks" ? "Turns green on its own when the site sees it done; check to mark it done by hand" : undefined}
                      aria-label={`Mark ${step.label} done`}
                    />
                  </td>
                  <td style={cell}>
                    <span style={{ color: "var(--chalk-dim)", marginRight: "0.4rem" }}>{i + 1}.</span>
                    <button className="admin-link" onClick={() => (step.key === "sync" ? setShowData((s) => !s) : onNavigate(step.view))} style={{ fontWeight: 600 }}>
                      {step.label}
                    </button>
                    {step.auto && <span style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginLeft: "0.4rem" }}>auto</span>}
                    {status.note && !status.done && <span style={{ fontSize: "0.74rem", color: "var(--chalk-dim)", marginLeft: "0.4rem" }}>{status.note}</span>}
                    {step.key === "sync" && <span style={{ fontSize: "0.74rem", color: "var(--chalk-dim)", marginLeft: "0.4rem" }}>{showData ? "▾ hide" : "▸ open sync"}</span>}
                    {step.key === "sync" && showData && (
                      <div style={{ marginTop: "0.6rem" }}>
                        <WeeklyDataPanel />
                      </div>
                    )}
                    {step.auto === "locks" && nextLockGames.length > 0 && (
                      <div style={{ marginTop: "0.4rem", fontSize: "0.78rem" }}>
                        Lock by {fmtWhen(nextLockGames[0].start_date)}:{" "}
                        {nextLockGames.map((g, j) => (
                          <span key={g.id}>
                            {j > 0 ? ", " : ""}
                            {g.away_team} @ {g.home_team}
                          </span>
                        ))}
                        {unlocked.length > nextLockGames.length && (
                          <span style={{ color: "var(--chalk-dim)" }}> · {unlocked.length - nextLockGames.length} more later in the week</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap", color: status.done ? "var(--c-ok)" : "var(--chalk-dim)" }}>
                    {status.done ? (status.at ? fmtWhen(status.at) : "Done") : "–"}
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap", color: overdue ? "var(--c-err)" : undefined, fontWeight: overdue ? 700 : 400 }}>
                    {step.due === "firstKickoff" ? (due ? `${fmtWhen(due)} (first kickoff)` : "first kickoff") : fmtWhen(due)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
