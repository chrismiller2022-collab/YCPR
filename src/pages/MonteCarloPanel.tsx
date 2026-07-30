import { useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { runMonteCarlo, type TeamSimResult } from "../lib/montecarlo/engine";
import {
  fetchSeasonGames,
  fetchMonteCarloRuns,
  fetchMonteCarloRun,
  fetchTeamRunHistory,
  saveMonteCarloRun,
  type MonteCarloRunSummary,
  type TeamRunHistoryEntry,
} from "../lib/api/monteCarlo";

const TRIAL_OPTIONS = [1000, 5000, 10000, 20000];

function fmtPct(v: number) {
  return `${v.toFixed(1)}%`;
}

function ResultsTable({ results }: { results: TeamSimResult[] }) {
  const [sortKey, setSortKey] = useState("nattyPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...results].sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [results, sortKey, sortDir]);

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
        <thead>
          <tr>
            <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
            <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
            <th className="th th-right">Record</th>
            <SortHeader label="Proj Wins" sortKey="meanWins" active={sortKey === "meanWins"} dir={sortDir} onClick={handleSort} align="right" />
            <SortHeader
              label="Conf Title %"
              sortKey="confTitlePct"
              active={sortKey === "confTitlePct"}
              dir={sortDir}
              onClick={handleSort}
              align="right"
            />
            <SortHeader
              label="Playoff %"
              sortKey="playoffPct"
              active={sortKey === "playoffPct"}
              dir={sortDir}
              onClick={handleSort}
              align="right"
            />
            <SortHeader label="Avg Seed" sortKey="avgSeed" active={sortKey === "avgSeed"} dir={sortDir} onClick={handleSort} align="right" />
            <SortHeader label="Natty %" sortKey="nattyPct" active={sortKey === "nattyPct"} dir={sortDir} onClick={handleSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.team}>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.team}</td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conf}</td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {r.currentWins}-{r.currentLosses}
              </td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {r.meanWins.toFixed(1)}
              </td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtPct(r.confTitlePct)}
              </td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtPct(r.playoffPct)}
              </td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {r.avgSeed != null ? r.avgSeed.toFixed(1) : "–"}
              </td>
              <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtPct(r.nattyPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab({ season }: { season: number }) {
  const [runs, setRuns] = useState<MonteCarloRunSummary[]>([]);
  const [loadedRunId, setLoadedRunId] = useState<number | null>(null);
  const [loadedResults, setLoadedResults] = useState<TeamSimResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamHistory, setTeamHistory] = useState<TeamRunHistoryEntry[] | null>(null);

  useMemo(() => {
    setLoading(true);
    fetchMonteCarloRuns(season)
      .then(setRuns)
      .finally(() => setLoading(false));
  }, [season]);

  async function viewRun(id: number) {
    const run = await fetchMonteCarloRun(id);
    if (run) {
      setLoadedRunId(id);
      setLoadedResults(run.results);
    }
  }

  async function loadTeamHistory() {
    if (!teamQuery.trim()) return;
    const history = await fetchTeamRunHistory(season, teamQuery.trim());
    setTeamHistory(history);
  }

  if (loading) return <p>Loading run history…</p>;

  return (
    <div>
      <div className="section-label">Saved runs — {season}</div>
      {runs.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No runs saved yet for this season.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "1.5rem" }}>
          {runs.map((r) => (
            <button
              key={r.id}
              className="menu-btn"
              style={{ justifyContent: "flex-start", textAlign: "left", opacity: loadedRunId === r.id ? 1 : 0.7 }}
              onClick={() => viewRun(r.id)}
            >
              Week {r.week} · {r.num_trials.toLocaleString()} trials · {new Date(r.run_at).toLocaleString()}
            </button>
          ))}
        </div>
      )}

      {loadedResults && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div className="section-label">Run results</div>
          <ResultsTable results={loadedResults} />
        </div>
      )}

      <div>
        <div className="section-label">Team trend across saved runs</div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input
            placeholder="Exact team name (e.g. Ohio State)"
            value={teamQuery}
            onChange={(e) => setTeamQuery(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button onClick={loadTeamHistory}>Load</button>
        </div>
        {teamHistory && (
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Date</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Proj Wins</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Conf Title %</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Playoff %</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Natty %</th>
                </tr>
              </thead>
              <tbody>
                {teamHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "0.75rem", textAlign: "center", color: "var(--chalk-dim)" }}>
                      No saved runs include that exact team name.
                    </td>
                  </tr>
                ) : (
                  teamHistory.map((h) => (
                    <tr key={h.runId}>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{h.week}</td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                        {new Date(h.runAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {h.result.meanWins.toFixed(1)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {fmtPct(h.result.confTitlePct)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {fmtPct(h.result.playoffPct)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {fmtPct(h.result.nattyPct)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MonteCarloPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"run" | "history">("run");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [numTrials, setNumTrials] = useState(5000);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  async function handleRun() {
    setRunning(true);
    setError(null);
    setSaveMsg(null);
    try {
      const games = await fetchSeasonGames(season);
      if (games.length === 0) {
        setError(`No games saved for ${season} yet — sync the season from Games & Lines first.`);
        setRunning(false);
        return;
      }
      const completedWeeks = games.filter((g) => g.completed).map((g) => g.week);
      const week = completedWeeks.length > 0 ? Math.max(...completedWeeks) + 1 : 1;
      setCurrentWeek(week);

      // Give the "Running…" state a chance to paint before the sim
      // blocks the main thread.
      await new Promise((r) => setTimeout(r, 30));
      const { teamResults, unmatchedTeams } = runMonteCarlo(games, liveByTeam, numTrials);
      setResults(teamResults);
      setUnmatched(unmatchedTeams);
    } catch (err: any) {
      setError(err.message ?? "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleSave() {
    if (!results || currentWeek == null) return;
    setSaving(true);
    setError(null);
    try {
      await saveMonteCarloRun({ season, week: currentWeek, numTrials, results, unmatchedTeams: unmatched });
      setSaveMsg("Saved.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Monte Carlo</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Simulates the rest of the season thousands of times from current power ratings —
        projected win totals, conference title odds, playoff odds/seed, and national
        championship odds. Conference tiebreakers use a simple win% + random tiebreak, and
        playoff seeding uses each team's current rating as a stand-in for a committee
        ranking (see code comments for the full list of v1 simplifications).
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button className={`mode-btn ${tab === "run" ? "mode-btn-active" : ""}`} onClick={() => setTab("run")}>
          Run
        </button>
        <button className={`mode-btn ${tab === "history" ? "mode-btn-active" : ""}`} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "run" && (
        <>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
            <label>
              Season{" "}
              <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
            </label>
            <label>
              Trials{" "}
              <select value={numTrials} onChange={(e) => setNumTrials(parseInt(e.target.value, 10))}>
                {TRIAL_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t.toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={handleRun} disabled={running}>
              {running ? "Running…" : "Run simulation"}
            </button>
            {results && (
              <button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : `Save this run (week ${currentWeek})`}
              </button>
            )}
          </div>

          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {saveMsg && <p style={{ color: "green" }}>{saveMsg}</p>}
          {unmatched.length > 0 && (
            <p style={{ color: "#a15c00", fontSize: "0.8rem" }}>
              No power rating found for: {unmatched.slice(0, 15).join(", ")}
              {unmatched.length > 15 ? `, +${unmatched.length - 15} more` : ""}. Games involving
              these were simulated as a 50/50 coin flip.
            </p>
          )}

          {results && (
            <div style={{ marginTop: "1rem" }}>
              <ResultsTable results={results} />
            </div>
          )}
        </>
      )}

      {tab === "history" && <HistoryTab season={season} />}
    </div>
  );
}
