import { useEffect, useMemo, useState } from "react";
import { fetchSeasonAvailableWeeks } from "../lib/api/seasonWeeklyRatings";
import { fetchTeamSosAvailableWeeks } from "../lib/api/ratingSystems";
import { fetchResumeRatingsAvailableWeeks } from "../lib/api/resumeWeights";
import { fetchMonteCarloRuns } from "../lib/api/monteCarlo";
import { fetchGameLockCoverageByWeek } from "../lib/api/gameProjectionLocks";

// Status overview, not an action page — each item's actual save/publish
// action lives on its own admin page (Rating Systems, SOS, Resume
// Rating, Monte Carlo, Lock Games), since each has real computation
// logic behind it that shouldn't be duplicated here. This is a single
// place to see, at a glance, what's actually protected for a given
// week versus what still needs attention — click a column header to
// jump to where the save happens.
const CHECK = "✅";
const DASH = "–";

interface ColumnDef {
  key: string;
  label: string;
  navTarget: string;
  weeks: Set<number>;
}

export default function PublishPage({ onBack, onNavigate }: { onBack: () => void; onNavigate?: (view: string) => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratingsWeeks, setRatingsWeeks] = useState<number[]>([]);
  const [sosWeeks, setSosWeeks] = useState<number[]>([]);
  const [resumeWeeks, setResumeWeeks] = useState<number[]>([]);
  const [mcWeeks, setMcWeeks] = useState<number[]>([]);
  const [lockCoverage, setLockCoverage] = useState<Record<number, { kickedOff: number; locked: number }>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchSeasonAvailableWeeks(season),
      fetchTeamSosAvailableWeeks(season),
      fetchResumeRatingsAvailableWeeks(season),
      fetchMonteCarloRuns(season),
      fetchGameLockCoverageByWeek(season),
    ])
      .then(([ratings, sos, resume, mcRuns, coverage]) => {
        if (cancelled) return;
        setRatingsWeeks(ratings);
        setSosWeeks(sos);
        setResumeWeeks(resume);
        setMcWeeks(Array.from(new Set(mcRuns.map((r) => r.week))).sort((a, b) => a - b));
        setLockCoverage(coverage);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load publish status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: "ratings", label: "Power Ratings", navTarget: "ratingsystems", weeks: new Set(ratingsWeeks) },
      { key: "sos", label: "SOS", navTarget: "sos", weeks: new Set(sosWeeks) },
      { key: "resume", label: "Resume Ratings", navTarget: "resumerating", weeks: new Set(resumeWeeks) },
      { key: "wintotals", label: "Win Totals", navTarget: "montecarlo", weeks: new Set(mcWeeks) },
      { key: "bracket", label: "Bracket", navTarget: "montecarlo", weeks: new Set(mcWeeks) },
      { key: "matchups", label: "Matchups", navTarget: "lockgames", weeks: new Set(ratingsWeeks) },
    ],
    [ratingsWeeks, sosWeeks, resumeWeeks, mcWeeks]
  );

  // Rows: every week that shows up anywhere, plus a small buffer up to
  // the current week so upcoming weeks are visible as clearly not-yet-
  // published rather than just not existing in the table at all.
  const weekRows = useMemo(() => {
    const all = new Set<number>([...ratingsWeeks, ...sosWeeks, ...resumeWeeks, ...mcWeeks, ...Object.keys(lockCoverage).map(Number)]);
    const maxKnown = all.size > 0 ? Math.max(...all) : 0;
    const upper = Math.max(maxKnown + 1, 2);
    for (let w = 0; w <= upper; w++) all.add(w);
    return Array.from(all).sort((a, b) => a - b);
  }, [ratingsWeeks, sosWeeks, resumeWeeks, mcWeeks, lockCoverage]);

  const cellStyle: React.CSSProperties = { padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)", textAlign: "center" };

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Publish</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0, maxWidth: 700 }}>
        Status only — each column's actual save/publish action lives on its own admin page (click a
        header to jump there). A checkmark means that week's snapshot exists and is protected; it
        doesn't mean anyone's looked at it recently.
      </p>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", maxWidth: 700 }}>
        Win Totals and Bracket both read the same saved Monte Carlo run, so their columns will
        always match — saving one run covers both. Matchups' checkmark reflects whether that
        week's Power Ratings are saved (the baseline every matchup projection locks to); the small
        number underneath is how many of that week's already-kicked-off games have their own
        individual lock — see Lock Games if that's behind the game count.
      </p>

      <label style={{ display: "block", marginBottom: "1rem" }}>
        Season{" "}
        <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
      </label>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr>
              <th style={{ padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)", textAlign: "left" }}>Week</th>
              {columns.map((c) => (
                <th key={c.key} style={{ padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)", textAlign: "center" }}>
                  {onNavigate ? (
                    <button
                      onClick={() => onNavigate(c.navTarget)}
                      style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", textDecoration: "underline" }}
                    >
                      {c.label}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekRows.map((w) => {
              const coverage = lockCoverage[w];
              return (
                <tr key={w}>
                  <td style={{ padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)", fontWeight: 700 }}>
                    {w === 0 ? "Preseason" : `Week ${w}`}
                  </td>
                  {columns.map((c) => {
                    if (c.key === "matchups") {
                      const saved = c.weeks.has(w);
                      return (
                        <td key={c.key} style={cellStyle}>
                          {saved ? CHECK : DASH}
                          {coverage && coverage.kickedOff > 0 && (
                            <div style={{ fontSize: "0.7rem", color: coverage.locked < coverage.kickedOff ? "#c45c52" : "var(--chalk-dim)" }}>
                              {coverage.locked}/{coverage.kickedOff} locked
                            </div>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} style={cellStyle}>
                        {c.weeks.has(w) ? CHECK : DASH}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
