import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import ExportPngButton from "../components/ExportPngButton";
import { winTotalBuckets } from "../lib/montecarlo/distribution";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import {
  runMonteCarloAsync,
  simulateSingleSeason,
  computeSrsStats,
  getSubFcsRatingInfo,
  winsAtLeastPct,
  undefeatedPct,
  type TeamSimResult,
  type ScheduleRow,
  type SrsTeamRow,
  type ResumeComparisonEntry,
} from "../lib/montecarlo/engine";
import {
  fetchSeasonGames,
  fetchMonteCarloRuns,
  fetchMonteCarloRun,
  fetchLatestMonteCarloRunPerWeek,
  fetchTeamRunHistory,
  saveMonteCarloRun,
  type MonteCarloRunSummary,
  type MonteCarloRun,
  type TeamRunHistoryEntry,
} from "../lib/api/monteCarlo";
import { saveRatingRows } from "../lib/api/ratingSystems";
import { computeCurrentWeek } from "../lib/api/survivorPoolPublic";
import { fairMoneylineFromWinPct } from "../lib/odds";
import ConferenceStandingsOddsTable from "../components/ConferenceStandingsOddsTable";

const NUM_TRIALS = 100000;

function fmtPct(v: number) {
  return `${v.toFixed(1)}%`;
}

function fmtSpread(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

// Converts a Monte Carlo percentage (0-100 scale, as stored on TeamSimResult)
// to a fair American moneyline via fairMoneylineFromWinPct, which expects a
// decimal probability (0-1).
function fmtML(pct: number | null | undefined) {
  if (pct == null || Number.isNaN(pct)) return "–";
  const ml = fairMoneylineFromWinPct(pct / 100);
  if (ml == null) return "–";
  return `${ml > 0 ? "+" : ""}${Math.round(ml)}`;
}

// ---------------------------------------------------------------------
// Distribution breakdown — shown when a team row is expanded.
// ---------------------------------------------------------------------
function DistributionDetail({ result, colSpan, showMore }: { result: TeamSimResult; colSpan: number; showMore: boolean }) {
  const buckets = winTotalBuckets(result);

  const seedBuckets = (result.seedPct ?? [])
    .map((pct, i) => ({ seed: i + 1, pct }))
    .filter((s) => s.pct > 0.05);

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "0.5rem 0.75rem", background: "rgba(255,255,255,0.03)", fontSize: "0.75rem" }}>
        <div>
          <strong>{result.team} win-total distribution:</strong>{" "}
          {buckets.map((b) => `${b.wins}-${b.losses}: ${b.pct.toFixed(1)}%`).join("  ·  ")}
        </div>
        {showMore && seedBuckets.length > 0 && (
          <div style={{ marginTop: "0.3rem" }}>
            <strong>Seed distribution:</strong>{" "}
            {seedBuckets.map((s) => `#${s.seed}: ${s.pct.toFixed(1)}%`).join("  ·  ")}
          </div>
        )}
      </td>
    </tr>
  );
}

function ResultsTable({ results, numTrials }: { results: TeamSimResult[]; numTrials: number }) {
  const [sortKey, setSortKey] = useState("nattyPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const colSpan = showMore ? 15 : 10;

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const enriched = useMemo(() => {
    return results.map((r) => ({
      ...r,
      bowlPct: winsAtLeastPct(r, numTrials, 6),
      undefeatedPct: undefeatedPct(r, numTrials),
    }));
  }, [results, numTrials]);

  const sorted = useMemo(() => {
    return [...enriched].sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [enriched, sortKey, sortDir]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.4rem" }}>
        <button className="menu-btn" style={{ padding: "0.15rem 0.5rem", fontSize: "0.75rem" }} onClick={() => setShowMore((s) => !s)}>
          {showMore ? "Show fewer stats" : "Show more stats"}
        </button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
        <thead>
          <tr>
            <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
            <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
            <th className="th th-right">Reg. Season Record</th>
            <th className="th th-right">95% CI</th>
            <SortHeader
              label="Make Champ %"
              sortKey="madeConfChampPct"
              active={sortKey === "madeConfChampPct"}
              dir={sortDir}
              onClick={handleSort}
              align="right"
            />
            <SortHeader
              label="Win Champ %"
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
            {showMore && (
              <>
                <SortHeader
                  label="Bowl (6+) %"
                  sortKey="bowlPct"
                  active={sortKey === "bowlPct"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
                <SortHeader
                  label="Undefeated %"
                  sortKey="undefeatedPct"
                  active={sortKey === "undefeatedPct"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
                <SortHeader
                  label="Quarterfinal %"
                  sortKey="quarterfinalPct"
                  active={sortKey === "quarterfinalPct"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
                <SortHeader
                  label="Semifinal %"
                  sortKey="semifinalPct"
                  active={sortKey === "semifinalPct"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
                <SortHeader
                  label="NCG %"
                  sortKey="nattyGamePct"
                  active={sortKey === "nattyGamePct"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
              </>
            )}
            <th className="th"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const projWins = Math.round(r.meanWins);
            const projLosses = r.totalGames - projWins;
            const isOpen = expanded === r.team;
            return (
              <Fragment key={r.team}>
                <tr>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <TeamLogo team={r.team} /> {r.team}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conf}</td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {projWins}-{projLosses}{" "}
                    <span style={{ color: "var(--chalk-dim)", fontSize: "0.72rem" }}>({r.meanWins.toFixed(1)})</span>
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.ci95Low}–{r.ci95High} wins
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtPct(r.madeConfChampPct)}
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
                  {showMore && (
                    <>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {fmtPct(r.bowlPct)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {fmtPct(r.undefeatedPct)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {r.quarterfinalPct != null ? fmtPct(r.quarterfinalPct) : "–"}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {r.semifinalPct != null ? fmtPct(r.semifinalPct) : "–"}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                        {r.nattyGamePct != null ? fmtPct(r.nattyGamePct) : "–"}
                      </td>
                    </>
                  )}
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <button className="menu-btn" style={{ padding: "0.15rem 0.4rem" }} onClick={() => setExpanded(isOpen ? null : r.team)}>
                      {isOpen ? "Hide" : "Distribution"}
                    </button>
                  </td>
                </tr>
                {isOpen && <DistributionDetail result={r} colSpan={colSpan} showMore={showMore} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function HistoryTab({ season }: { season: number }) {
  const [runs, setRuns] = useState<MonteCarloRunSummary[]>([]);
  const [loadedRunId, setLoadedRunId] = useState<number | null>(null);
  const [loadedResults, setLoadedResults] = useState<TeamSimResult[] | null>(null);
  const [loadedNumTrials, setLoadedNumTrials] = useState<number>(5000);
  const [loadedResumeComparison, setLoadedResumeComparison] = useState<ResumeComparisonEntry[] | null>(null);
  const [loadedResumeComparisonTrials, setLoadedResumeComparisonTrials] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamHistory, setTeamHistory] = useState<TeamRunHistoryEntry[] | null>(null);

  useMemo(() => {
    setLoading(true);
    setShowAllRuns(false);
    fetchMonteCarloRuns(season)
      .then((r) => {
        setRuns(r);
        if (r.length > 0) void viewRun(r[0].id);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  async function viewRun(id: number) {
    const run = await fetchMonteCarloRun(id);
    if (run) {
      setLoadedRunId(id);
      setLoadedResults(run.results);
      setLoadedNumTrials(run.num_trials);
      setLoadedResumeComparison(run.resume_comparison ?? null);
      setLoadedResumeComparisonTrials(run.resume_comparison_trials ?? 0);
    }
  }

  async function loadTeamHistory() {
    if (!teamQuery.trim()) return;
    const history = await fetchTeamRunHistory(season, teamQuery.trim());
    setTeamHistory(history);
  }

  if (loading) return <p>Loading run history…</p>;

  // Only the most recent saved run shows by default — "Show more" reveals
  // the rest. This is the one place on the site that shows full run
  // history; Playoff Seeds/Betting/Conference Standings intentionally
  // don't (they use a week dropdown pointed at each week's latest run).
  const visibleRuns = showAllRuns ? runs : runs.slice(0, 1);

  return (
    <div>
      <div className="section-label">Saved runs — {season}</div>
      {runs.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No runs saved yet for this season.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "1.5rem" }}>
          {visibleRuns.map((r) => (
            <button
              key={r.id}
              className="menu-btn"
              style={{ justifyContent: "flex-start", textAlign: "left", opacity: loadedRunId === r.id ? 1 : 0.7 }}
              onClick={() => viewRun(r.id)}
            >
              Week {r.week} · {r.num_trials.toLocaleString()} trials · {new Date(r.run_at).toLocaleString()}
            </button>
          ))}
          {!showAllRuns && runs.length > 1 && (
            <button
              className="menu-btn"
              style={{ justifyContent: "flex-start", textAlign: "left", opacity: 0.6, fontSize: "0.8rem" }}
              onClick={() => setShowAllRuns(true)}
            >
              Show more ({runs.length - 1} older run{runs.length - 1 === 1 ? "" : "s"})
            </button>
          )}
        </div>
      )}

      {loadedResults && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div className="section-label">Run results</div>
          <ResultsTable results={loadedResults} numTrials={loadedNumTrials} />
          {loadedResumeComparison && (
            <ResumeComparisonTable entries={loadedResumeComparison} sampleTrials={loadedResumeComparisonTrials} />
          )}
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
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Win Champ %</th>
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

// ---------------------------------------------------------------------
// Current model (win% + rating tiebreak) vs. resume-informed model (win% +
// VSRS tiebreak), computed on the exact same 1-in-10 sampled trials so the
// two columns are apples-to-apples. SRS/VSRS themselves are also a 10k-
// trial average now instead of a single realization — see SRS_SAMPLE_EVERY
// in engine.ts.
// ---------------------------------------------------------------------
function ResumeComparisonTable({ entries, sampleTrials }: { entries: ResumeComparisonEntry[]; sampleTrials: number }) {
  const [sortKey, setSortKey] = useState<keyof ResumeComparisonEntry>("resumePlayoffPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: string) {
    const k = key as keyof ResumeComparisonEntry;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const ranked = useMemo(() => {
    return entries
      .filter((r) => r.currentPlayoffPct > 0.05 || r.resumePlayoffPct > 0.05)
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });
  }, [entries, sortKey, sortDir]);

  if (sampleTrials === 0) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h4 style={{ marginBottom: "0.3rem" }}>Default (resume-informed) vs. legacy (rating-based) model</h4>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
        The playoff field/seed everywhere else on this site now uses win% + VSRS as the tiebreaker
        (resume quality — who you beat/lost to — instead of a static preseason rating), computed on
        every {sampleTrials > 0 ? `10th` : ""} sampled trial ({sampleTrials.toLocaleString()} of them). The "Legacy" columns show
        what the old win% + fixed-rating method would have produced on those same trials, kept here
        purely so the switch is auditable. SRS/VSRS are averaged across the same sampled trials.
      </p>
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader
                label="Default CFP%"
                sortKey="resumePlayoffPct"
                active={sortKey === "resumePlayoffPct"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader
                label="Default Avg Seed"
                sortKey="resumeAvgSeed"
                active={sortKey === "resumeAvgSeed"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader
                label="Legacy CFP%"
                sortKey="currentPlayoffPct"
                active={sortKey === "currentPlayoffPct"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader
                label="Legacy Avg Seed"
                sortKey="currentAvgSeed"
                active={sortKey === "currentAvgSeed"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader label="Avg SRS" sortKey="avgSrs" active={sortKey === "avgSrs"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Avg VSRS" sortKey="avgVsrs" active={sortKey === "avgVsrs"} dir={sortDir} onClick={handleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => {
              const pctDelta = r.resumePlayoffPct - r.currentPlayoffPct;
              return (
                <tr key={r.team}>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>
                    <TeamLogo team={r.team} /> {r.team}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtPct(r.resumePlayoffPct)}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.resumeAvgSeed != null ? r.resumeAvgSeed.toFixed(1) : "–"}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtPct(r.currentPlayoffPct)}{" "}
                    <span style={{ fontSize: "0.7rem", color: pctDelta > 0.5 ? "#2e8b40" : pctDelta < -0.5 ? "#c0392b" : "var(--chalk-dim)" }}>
                      ({-pctDelta >= 0 ? "+" : ""}
                      {(-pctDelta).toFixed(1)})
                    </span>
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.currentAvgSeed != null ? r.currentAvgSeed.toFixed(1) : "–"}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.avgSrs != null ? r.avgSrs.toFixed(1) : "–"}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.avgVsrs != null ? r.avgVsrs.toFixed(1) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonteCarloResultsSection() {
  const [tab, setTab] = useState<"run" | "history">("run");
  const [season, setSeason] = useState(new Date().getFullYear());
  const numTrials = NUM_TRIALS;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [resumeComparison, setResumeComparison] = useState<ResumeComparisonEntry[] | null>(null);
  const [resumeComparisonTrials, setResumeComparisonTrials] = useState(0);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  // Editable — defaults to the auto-detected currentWeek after a run, but
  // Chris can overwrite it to save into any week (e.g. re-saving over
  // week 1 after a correction), rather than being locked to whatever
  // week was auto-detected as "current."
  const [saveWeek, setSaveWeek] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  // Large trial counts (100k) take tens of seconds even batched — a live
  // elapsed timer while the progress bar creeps up is what actually
  // reassures someone the tab isn't just hung.
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setElapsedMs(0);
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 200);
    return () => clearInterval(interval);
  }, [running]);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setSaveMsg(null);
    setProgress(null);
    try {
      const games = await fetchSeasonGames(season);
      if (games.length === 0) {
        setError(`No games saved for ${season} yet — sync the season from Games & Lines first.`);
        setRunning(false);
        return;
      }
      // computeCurrentWeek requires an ENTIRE week's games to be complete
      // before advancing — the old inline version here advanced on just
      // ANY completed game in a week, which broke the same way the
      // Survivor Pool bug did: CFBD's week numbering can span almost two
      // calendar weeks (e.g. week 1 covering both an Aug 27-29
      // season-opener slate and the real Sept 5 main slate), so a single
      // early game being marked complete jumped this straight to "week
      // 2" while most of week 1 hadn't been played yet.
      const week = computeCurrentWeek(games);
      setCurrentWeek(week);
      setSaveWeek(week);

      await new Promise((r) => setTimeout(r, 30));
      // Runs in yielding batches (see runMonteCarloAsync) so the tab stays
      // responsive and this progress bar actually animates instead of the
      // page freezing for however long 100k trials takes.
      const { teamResults, unmatchedTeams, resumeComparison: cmp, resumeComparisonTrials: cmpTrials } =
        await runMonteCarloAsync(games, liveByTeam, numTrials, (completed, total) => setProgress({ completed, total }));
      setResults(teamResults);
      setUnmatched(unmatchedTeams);
      setResumeComparison(cmp ?? null);
      setResumeComparisonTrials(cmpTrials ?? 0);
    } catch (err: any) {
      setError(err.message ?? "Simulation failed");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function handleSave() {
    if (!results || saveWeek == null) return;
    setSaving(true);
    setError(null);
    try {
      await saveMonteCarloRun({
        season,
        week: saveWeek,
        numTrials,
        results,
        unmatchedTeams: unmatched,
        resumeComparison: resumeComparison ?? undefined,
        resumeComparisonTrials,
      });
      setSaveMsg("Saved.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
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
            <button onClick={handleRun} disabled={running}>
              {running ? "Running…" : "Run simulation"}
            </button>
            {results && (
              <>
                <label>
                  Save to week{" "}
                  <input
                    type="number"
                    min={1}
                    value={saveWeek ?? ""}
                    onChange={(e) => setSaveWeek(parseInt(e.target.value, 10) || null)}
                    style={{ width: 70 }}
                  />
                </label>
                <button onClick={handleSave} disabled={saving || saveWeek == null}>
                  {saving ? "Saving…" : "Save this run"}
                </button>
              </>
            )}
          </div>

          {running && (
            <div style={{ marginBottom: "1rem", maxWidth: 420 }}>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: "var(--turf-panel-2)",
                  border: "1px solid var(--hash)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: progress ? `${Math.round((progress.completed / progress.total) * 100)}%` : "4%",
                    background: "var(--gold, #d9a441)",
                    transition: "width 0.15s linear",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.3rem" }}>
                {progress
                  ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} trials`
                  : "Loading games…"}
                {" · "}
                {(elapsedMs / 1000).toFixed(1)}s elapsed
              </div>
            </div>
          )}

          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {saveMsg && <p style={{ color: "green" }}>{saveMsg}</p>}
          {unmatched.length > 0 && (
            <p style={{ color: "#a15c00", fontSize: "0.8rem" }}>
              No power rating found for: {unmatched.slice(0, 15).join(", ")}
              {unmatched.length > 15 ? `, +${unmatched.length - 15} more` : ""}. These are
              treated as sub-FCS buy-game opponents — estimated at the median FCS rating +28
              (worse) rather than a 50/50 coin flip, so they don't drag down projected win
              totals for the teams that play them.
            </p>
          )}

          {results && (
            <div style={{ marginTop: "1rem" }}>
              <ResultsTable results={results} numTrials={numTrials} />
              {resumeComparison && <ResumeComparisonTable entries={resumeComparison} sampleTrials={resumeComparisonTrials} />}
            </div>
          )}
        </>
      )}

      {tab === "history" && <HistoryTab season={season} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// SRS stats table — Power Ratings & SRS output, one row per team.
// ---------------------------------------------------------------------
function SrsStatsTable({ stats }: { stats: SrsTeamRow[] }) {
  const [sortKey, setSortKey] = useState("vsrs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [divFilter, setDivFilter] = useState<"all" | "FBS" | "FCS">("FBS");

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = divFilter === "all" ? stats : stats.filter((r) => r.div === divFilter);
  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  const num = (v: number) => (v > 0 ? "+" : "") + v.toFixed(2);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {(["FBS", "FCS", "all"] as const).map((d) => (
          <button
            key={d}
            className={`mode-btn ${divFilter === d ? "mode-btn-active" : ""}`}
            onClick={() => setDivFilter(d)}
          >
            {d === "all" ? "All" : d}
          </button>
        ))}
      </div>
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 650, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="W-L" sortKey="wins" active={sortKey === "wins"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Total MOV" sortKey="totalMOV" active={sortKey === "totalMOV"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="SOS" sortKey="sos" active={sortKey === "sos"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="SOS Rank" sortKey="sosRank" active={sortKey === "sosRank"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="SRS" sortKey="srs" active={sortKey === "srs"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="SRS Rank" sortKey="srsRank" active={sortKey === "srsRank"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Win Bonus" sortKey="winBonus" active={sortKey === "winBonus"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Loss Penalty" sortKey="lossPenalty" active={sortKey === "lossPenalty"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Total Win Bonus" sortKey="totalWinBonus" active={sortKey === "totalWinBonus"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Total Loss Penalty" sortKey="totalLossPenalty" active={sortKey === "totalLossPenalty"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Victory Pts" sortKey="victoryPoints" active={sortKey === "victoryPoints"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="VSRS" sortKey="vsrs" active={sortKey === "vsrs"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="VSRS Rank" sortKey="vsrsRank" active={sortKey === "vsrsRank"} dir={sortDir} onClick={handleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team}>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  <TeamLogo team={r.team} /> {r.team}
                </td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conf}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.rating)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {r.wins}-{r.losses}
                </td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.totalMOV)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.sos)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{r.sosRank}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 600 }}>{num(r.srs)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{r.srsRank}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.winBonus)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.lossPenalty)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.totalWinBonus)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.totalLossPenalty)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{num(r.victoryPoints)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 600 }}>{num(r.vsrs)}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{r.vsrsRank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// SRS games/results table — one simulated realization of the full season
// schedule.
// ---------------------------------------------------------------------
function SrsGamesTable({ rows }: { rows: ScheduleRow[] }) {
  const [weekFilter, setWeekFilter] = useState<"all" | number>("all");
  const weeks = useMemo(() => Array.from(new Set(rows.map((r) => r.week))).sort((a, b) => a - b), [rows]);
  const visibleRows = weekFilter === "all" ? rows : rows.filter((r) => r.week === weekFilter);

  return (
    <div>
      {weeks.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
            <option value="all">All weeks</option>
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 600, overflowY: "auto" }}>
        {/* thead th here already has explicit inline position:sticky; unaffected by the table-scroll flip */}
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Week</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Away</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Home</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>My Spread</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Random</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Final Result</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Winner</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Loser</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Margin</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.week}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.awayTeam}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.homeTeam}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtSpread(r.mySpread)}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {r.randomValue != null ? fmtSpread(r.randomValue) : "–"}
                </td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtSpread(r.finalResult)}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 600 }}>{r.winner ?? "–"}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.loser ?? "–"}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {r.margin != null ? r.margin.toFixed(1) : "–"}
                </td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", color: r.status === "actual" ? "var(--gold)" : "var(--chalk-dim)" }}>
                  {r.status === "actual" ? "Actual" : "Simulated"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// SRS tab — one sim button runs a single simulated realization of the
// full season, then feeds the SAME realization into both the SRS stats
// pipeline and the games/results table below, in two sub-tabs.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Monte Carlo average SRS/VSRS — sortable, FBS only (resumeComparison
// never carries FCS teams; see indexByName in engine.ts). Ranks computed
// client-side since the saved run only stores the raw averages.
// ---------------------------------------------------------------------
function McAvgSrsTable({ entries, sampleTrials }: { entries: ResumeComparisonEntry[]; sampleTrials: number }) {
  const [sortKey, setSortKey] = useState<"team" | "conf" | "avgSrs" | "avgVsrs">("avgVsrs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: string) {
    const k = key as typeof sortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const ranked = useMemo(() => {
    const withRanks = entries
      .filter((e) => e.avgSrs != null)
      .map((e) => ({ ...e }));
    const srsRankOf = new Map(
      [...withRanks].sort((a, b) => (b.avgSrs ?? 0) - (a.avgSrs ?? 0)).map((e, i) => [e.team, i + 1])
    );
    const vsrsRankOf = new Map(
      [...withRanks].sort((a, b) => (b.avgVsrs ?? 0) - (a.avgVsrs ?? 0)).map((e, i) => [e.team, i + 1])
    );
    return withRanks
      .map((e) => ({ ...e, srsRank: srsRankOf.get(e.team)!, vsrsRank: vsrsRankOf.get(e.team)! }))
      .sort((a: any, b: any) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === "asc" ? av - bv : bv - av;
      });
  }, [entries, sortKey, sortDir]);

  if (sampleTrials === 0) {
    return <p style={{ color: "var(--chalk-dim)" }}>This saved run predates SRS/VSRS averaging — re-run and save to populate this.</p>;
  }

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
        SRS/VSRS averaged across {sampleTrials.toLocaleString()} sampled trials from the loaded Monte
        Carlo run (1 in 10 of the total), instead of a single realization — much more stable.
      </p>
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Avg SRS" sortKey="avgSrs" active={sortKey === "avgSrs"} dir={sortDir} onClick={handleSort} align="right" />
              <th className="th th-right">SRS Rank</th>
              <SortHeader label="Avg VSRS" sortKey="avgVsrs" active={sortKey === "avgVsrs"} dir={sortDir} onClick={handleSort} align="right" />
              <th className="th th-right">VSRS Rank</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.team}>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  <TeamLogo team={r.team} /> {r.team}
                </td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conf}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 600 }}>
                  {r.avgSrs?.toFixed(1)}
                </td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{r.srsRank}</td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 600 }}>
                  {r.avgVsrs?.toFixed(1)}
                </td>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{r.vsrsRank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SrsTab() {
  const [mode, setMode] = useState<"montecarlo" | "single">("montecarlo");
  const [season, setSeason] = useState(new Date().getFullYear());

  // Monte Carlo average mode - reads the same saved-run/week-picker pattern
  // as Betting/Playoff Seeds/Conference Standings.
  const { weekOptions, selectedWeek, setSelectedWeek, loadedRun, loading: mcLoading } = useLatestRunByWeek(season);
  const [mcSending, setMcSending] = useState(false);
  const [mcSendMsg, setMcSendMsg] = useState<string | null>(null);

  async function sendMcToRatingSystems() {
    if (!loadedRun?.resume_comparison) return;
    setMcSending(true);
    setMcSendMsg(null);
    try {
      // Same sign-flip and destination as the single-sim path below - this
      // is just a more stable (10k-trial-averaged) source for the same
      // "YC SRS" rating_pulls snapshot.
      const rows = loadedRun.resume_comparison
        .filter((r) => r.avgSrs != null && r.avgVsrs != null)
        .map((r) => ({
          team: r.team,
          conference: r.conf,
          division: "FBS",
          values: { yc_srs: -(r.avgSrs as number), yc_vsrs: -(r.avgVsrs as number) },
        }));
      const result = await saveRatingRows(rows);
      setMcSendMsg(`Sent ${rows.length} teams to Rating Systems as "YC SRS" (SRS + VSRS, saved ${result.saved}).`);
    } catch (err: any) {
      setMcSendMsg(err.message ?? "Failed to send to Rating Systems");
    } finally {
      setMcSending(false);
    }
  }

  // Single-realization mode - unchanged from before, kept around because it
  // covers FCS too (the Monte Carlo average only ever covers FBS) and
  // doesn't require a saved run to exist yet.
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [srsStats, setSrsStats] = useState<SrsTeamRow[]>([]);
  const [subTab, setSubTab] = useState<"stats" | "games">("stats");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  async function sendToRatingSystems() {
    setSending(true);
    setSendMsg(null);
    try {
      // Sign-flip: this engine's srs/vsrs have higher = better, this
      // site's rating_pulls convention (matching every other tracked
      // system) is negative = better. yc_vsrs isn't a system on the
      // Rating Systems conglomerate page (it's not in RATING_SYSTEMS) —
      // it rides along in rating_pulls purely so Admin Resume Rating's
      // SRS/VSRS metrics can read a stable, admin-refreshed snapshot
      // instead of re-simulating live on every page load.
      const rows = srsStats.map((r) => ({
        team: r.team,
        conference: r.conf,
        division: r.div,
        values: { yc_srs: -r.srs, yc_vsrs: -r.vsrs },
      }));
      const result = await saveRatingRows(rows);
      setSendMsg(`Sent ${rows.length} teams to Rating Systems as "YC SRS" (SRS + VSRS, saved ${result.saved}).`);
    } catch (err: any) {
      setSendMsg(err.message ?? "Failed to send to Rating Systems");
    } finally {
      setSending(false);
    }
  }

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const games = await fetchSeasonGames(season);
      if (games.length === 0) {
        setError(`No games saved for ${season} yet — sync the season from Games & Lines first.`);
        setLoading(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
      const simRows = simulateSingleSeason(games, liveByTeam);
      setRows(simRows);
      setSrsStats(computeSrsStats(simRows, liveByTeam));
    } catch (err: any) {
      setError(err.message ?? "Failed to generate schedule");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button className={`mode-btn ${mode === "montecarlo" ? "mode-btn-active" : ""}`} onClick={() => setMode("montecarlo")}>
          Monte Carlo Average
        </button>
        <button className={`mode-btn ${mode === "single" ? "mode-btn-active" : ""}`} onClick={() => setMode("single")}>
          Single Sim (incl. FCS)
        </button>
      </div>

      {mode === "montecarlo" ? (
        <div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
            <label>
              Season{" "}
              <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
            </label>
            {weekOptions.length > 0 && <WeekPicker weekOptions={weekOptions} selectedWeek={selectedWeek} onChange={setSelectedWeek} />}
            {loadedRun?.resume_comparison && (
              <button onClick={sendMcToRatingSystems} disabled={mcSending} style={{ marginLeft: "auto" }}>
                {mcSending ? "Sending…" : "Send to Rating Systems (YC SRS)"}
              </button>
            )}
          </div>
          {mcSendMsg && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>{mcSendMsg}</p>}

          {mcLoading ? (
            <p>Loading saved runs…</p>
          ) : weekOptions.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No saved runs for this season yet — save a run from Monte Carlo Results first.</p>
          ) : (
            loadedRun && <McAvgSrsTable entries={loadedRun.resume_comparison ?? []} sampleTrials={loadedRun.resume_comparison_trials ?? 0} />
          )}
        </div>
      ) : (
        <div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
            One simulated realization of the full season — every remaining game gets a single
            fresh random draw (Normal, mean 0, stddev 15.7, clipped ±25) added to your projected
            spread. Already-completed games show the actual result. Power Ratings & SRS Stats and
            Games & Results below reflect this exact same realization — hit Re-roll to draw a new one.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
            <label>
              Season{" "}
              <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
            </label>
            <button onClick={generate} disabled={loading}>
              {loading ? "Simulating…" : rows.length > 0 ? "Re-roll" : "Run sim"}
            </button>
          </div>

          {error && <p style={{ color: "crimson" }}>{error}</p>}

          {rows.length > 0 && (
            <>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button className={`mode-btn ${subTab === "stats" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("stats")}>
                  Power Ratings &amp; SRS Stats
                </button>
                <button className={`mode-btn ${subTab === "games" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("games")}>
                  Games &amp; Results
                </button>
                {subTab === "stats" && (
                  <button onClick={sendToRatingSystems} disabled={sending} style={{ marginLeft: "auto" }}>
                    {sending ? "Sending…" : "Send to Rating Systems (YC SRS)"}
                  </button>
                )}
              </div>
              {sendMsg && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: "-0.5rem" }}>{sendMsg}</p>}

              {subTab === "stats" && <SrsStatsTable stats={srsStats} />}
              {subTab === "games" && <SrsGamesTable rows={rows} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Betting tab — same saved-run data as Results, but every % converted to
// a fair American moneyline via fairMoneylineFromWinPct. The Monte Carlo
// itself stays percentage-based; this is purely a display conversion.
// ---------------------------------------------------------------------
function BettingResultsTable({ results, numTrials }: { results: TeamSimResult[]; numTrials: number }) {
  const [sortKey, setSortKey] = useState("nattyPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showMore, setShowMore] = useState(false);

  const enriched = useMemo(() => {
    return results.map((r) => ({
      ...r,
      bowlPct: winsAtLeastPct(r, numTrials, 6),
      undefeatedPct: undefeatedPct(r, numTrials),
    }));
  }, [results, numTrials]);

  const sorted = useMemo(() => {
    return [...enriched].sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [enriched, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.4rem" }}>
        <button className="menu-btn" style={{ padding: "0.15rem 0.5rem", fontSize: "0.75rem" }} onClick={() => setShowMore((s) => !s)}>
          {showMore ? "Show fewer stats" : "Show more stats"}
        </button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
              <SortHeader
                label="Make Champ"
                sortKey="madeConfChampPct"
                active={sortKey === "madeConfChampPct"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader
                label="Win Champ"
                sortKey="confTitlePct"
                active={sortKey === "confTitlePct"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader
                label="Playoff"
                sortKey="playoffPct"
                active={sortKey === "playoffPct"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              <SortHeader label="Natty" sortKey="nattyPct" active={sortKey === "nattyPct"} dir={sortDir} onClick={handleSort} align="right" />
              {showMore && (
                <>
                  <SortHeader label="Bowl (6+)" sortKey="bowlPct" active={sortKey === "bowlPct"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader
                    label="Undefeated"
                    sortKey="undefeatedPct"
                    active={sortKey === "undefeatedPct"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Quarterfinal"
                    sortKey="quarterfinalPct"
                    active={sortKey === "quarterfinalPct"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Semifinal"
                    sortKey="semifinalPct"
                    active={sortKey === "semifinalPct"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader label="NCG" sortKey="nattyGamePct" active={sortKey === "nattyGamePct"} dir={sortDir} onClick={handleSort} align="right" />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team}>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  <TeamLogo team={r.team} /> {r.team}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conf}</td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.madeConfChampPct)}</td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.confTitlePct)}</td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.playoffPct)}</td>
                <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.nattyPct)}</td>
                {showMore && (
                  <>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.bowlPct)}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.undefeatedPct)}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.quarterfinalPct)}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.semifinalPct)}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.nattyGamePct)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Shared "pick a week, see that week's latest saved run" pattern used by
// Betting, Playoff Seeds, and Conference Standings — these three
// deliberately do NOT show full run-by-run history (that's what Results &
// History is for). Defaults to the most recent week with a saved run.
// ---------------------------------------------------------------------
function useLatestRunByWeek(season: number) {
  const [weekOptions, setWeekOptions] = useState<MonteCarloRunSummary[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [loadedRun, setLoadedRun] = useState<MonteCarloRun | null>(null);
  const [loading, setLoading] = useState(true);

  useMemo(() => {
    setLoading(true);
    setLoadedRun(null);
    fetchLatestMonteCarloRunPerWeek(season)
      .then((weeks) => {
        setWeekOptions(weeks);
        setSelectedWeek(weeks.length > 0 ? weeks[0].week : null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    if (selectedWeek == null) {
      setLoadedRun(null);
      return;
    }
    const match = weekOptions.find((w) => w.week === selectedWeek);
    if (!match) return;
    let cancelled = false;
    fetchMonteCarloRun(match.id).then((run) => {
      if (!cancelled) setLoadedRun(run);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedWeek, weekOptions]);

  return { weekOptions, selectedWeek, setSelectedWeek, loadedRun, loading };
}

function WeekPicker({
  weekOptions,
  selectedWeek,
  onChange,
}: {
  weekOptions: MonteCarloRunSummary[];
  selectedWeek: number | null;
  onChange: (week: number) => void;
}) {
  return (
    <label>
      Week{" "}
      <select value={selectedWeek ?? ""} onChange={(e) => onChange(parseInt(e.target.value, 10))}>
        {weekOptions.map((w) => (
          <option key={w.week} value={w.week}>
            Week {w.week} · {w.num_trials.toLocaleString()} trials · {new Date(w.run_at).toLocaleDateString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function BettingTab() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const { weekOptions, selectedWeek, setSelectedWeek, loadedRun, loading } = useLatestRunByWeek(season);

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
        Same saved Monte Carlo runs as Results, converted to fair American moneylines
        (P/(1-P)×-100 for favorites, (1-P)/P×100 for underdogs).
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        {weekOptions.length > 0 && <WeekPicker weekOptions={weekOptions} selectedWeek={selectedWeek} onChange={setSelectedWeek} />}
      </div>

      {loading ? (
        <p>Loading saved runs…</p>
      ) : weekOptions.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No saved runs for this season yet — save a run from Monte Carlo Results first.</p>
      ) : (
        loadedRun && <BettingResultsTable results={loadedRun.results} numTrials={loadedRun.num_trials} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Playoff Seed Odds — one row per team with any playoff chance at all,
// ranked by CFP% (playoffPct), with a moneyline derived from that same
// number, and all 12 seedPct columns laid out side by side instead of
// buried in the Results tab's per-row "Show More" text blob. Picks from
// the same saved runs as Betting, above — this is a viewer, not something
// that recomputes anything itself.
// ---------------------------------------------------------------------
function seedHeatBg(pct: number): string | undefined {
  if (pct < 3) return undefined;
  const alpha = Math.min(0.55, (pct / 30) * 0.55);
  return `rgba(96, 165, 250, ${alpha.toFixed(2)})`;
}

function PlayoffSeedOddsTable({ results }: { results: TeamSimResult[] }) {
  const ranked = results
    .filter((r) => r.playoffPct > 0.05 && r.seedPct)
    .sort((a, b) => b.playoffPct - a.playoffPct);

  if (ranked.length === 0) {
    return <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>No team had a playoff chance in this run.</p>;
  }

  return (
    <div className="table-scroll" style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 700 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.74rem" }}>
        <thead>
          <tr>
            <th className="th">Team</th>
            <th className="th">Conf</th>
            <th className="th th-right">CFP#</th>
            <th className="th th-right">CFP%</th>
            <th className="th th-right">ML</th>
            {Array.from({ length: 12 }, (_, i) => (
              <th key={i} className="th th-right">
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, idx) => (
            <tr key={r.team}>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>
                <TeamLogo team={r.team} /> {r.team}
              </td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>{r.conf}</td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>#{idx + 1}</td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtPct(r.playoffPct)}</td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtML(r.playoffPct)}</td>
              {(r.seedPct ?? []).map((pct, i) => (
                <td
                  key={i}
                  style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right", background: seedHeatBg(pct) }}
                >
                  {pct < 0.5 ? "–" : `${Math.round(pct)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayoffSeedOddsTab() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const { weekOptions, selectedWeek, setSelectedWeek, loadedRun, loading } = useLatestRunByWeek(season);

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
        Every team with a playoff chance in the saved run, ranked by CFP% (playoffPct), with the
        moneyline that number implies and the full chance of landing each of the 12 seeds.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        {weekOptions.length > 0 && <WeekPicker weekOptions={weekOptions} selectedWeek={selectedWeek} onChange={setSelectedWeek} />}
      </div>

      {loading ? (
        <p>Loading saved runs…</p>
      ) : weekOptions.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No saved runs for this season yet — save a run from Monte Carlo Results first.</p>
      ) : (
        loadedRun && <PlayoffSeedOddsTable results={loadedRun.results} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Conference Standings Odds — same saved-run picker pattern as the other
// tabs, plus a conference dropdown built from whichever conferences
// actually show up in the loaded run's teams. Rendering itself lives in
// ConferenceStandingsOddsTable, shared with the public Conference Preview
// pages so both places stay in sync automatically.
// ---------------------------------------------------------------------
function ConferenceStandingsTab() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const { weekOptions, selectedWeek, setSelectedWeek, loadedRun, loading } = useLatestRunByWeek(season);
  const [conference, setConference] = useState<string>("");

  const conferences = loadedRun
    ? Array.from(new Set(loadedRun.results.map((r) => r.conf))).filter((c) => c !== "FBS Independents").sort()
    : [];

  useEffect(() => {
    if (conferences.length === 0) return;
    setConference((prev) => (prev && conferences.includes(prev) ? prev : conferences[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedRun]);

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
        Chance each team in the picked conference finishes with at least N conference wins, from
        the saved run's full conference-win distribution. Same table shown on that conference's
        public preview page, always reading the most recently saved run.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        {weekOptions.length > 0 && <WeekPicker weekOptions={weekOptions} selectedWeek={selectedWeek} onChange={setSelectedWeek} />}
        {conferences.length > 0 && (
          <label>
            Conference{" "}
            <select value={conference} onChange={(e) => setConference(e.target.value)}>
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <p>Loading saved runs…</p>
      ) : weekOptions.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No saved runs for this season yet — save a run from Monte Carlo Results first.</p>
      ) : (
        loadedRun &&
        conference && (
          <ConferenceStandingsOddsTable results={loadedRun.results} numTrials={loadedRun.num_trials} conference={conference} />
        )
      )}
    </div>
  );
}

export default function MonteCarloPanel({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<"results" | "betting" | "srs" | "seeds" | "confstandings">("results");
  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const { medianFcsRating, syntheticRating } = getSubFcsRatingInfo(liveByTeam);
  const exportRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <button className="menu-btn" data-export-exclude="true" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Monte Carlo</h2>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", alignItems: "center", flexWrap: "wrap" }} data-export-exclude="true">
        <button className={`mode-btn ${section === "results" ? "mode-btn-active" : ""}`} onClick={() => setSection("results")}>
          Monte Carlo Results
        </button>
        <button className={`mode-btn ${section === "betting" ? "mode-btn-active" : ""}`} onClick={() => setSection("betting")}>
          Betting
        </button>
        <button className={`mode-btn ${section === "srs" ? "mode-btn-active" : ""}`} onClick={() => setSection("srs")}>
          SRS
        </button>
        <button className={`mode-btn ${section === "seeds" ? "mode-btn-active" : ""}`} onClick={() => setSection("seeds")}>
          Playoff Seeds
        </button>
        <button
          className={`mode-btn ${section === "confstandings" ? "mode-btn-active" : ""}`}
          onClick={() => setSection("confstandings")}
        >
          Conference Standings
        </button>
        <span style={{ marginLeft: "auto" }}>
          <ExportPngButton targetRef={exportRef} filename={() => `monte-carlo-${section}`} showTweet={false} />
        </span>
      </div>

      <div ref={exportRef}>
        {section === "results" && <MonteCarloResultsSection />}
        {section === "betting" && <BettingTab />}
        {section === "srs" && <SrsTab />}
        {section === "seeds" && <PlayoffSeedOddsTab />}
        {section === "confstandings" && <ConferenceStandingsTab />}
      </div>

      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: "2rem", borderTop: "1px solid var(--hash)", paddingTop: "1rem" }} data-export-exclude="true">
        Simulates the rest of the season using your projected spread for every remaining
        game plus a random margin drawn from a Normal distribution (mean 0, stddev 15.7,
        clipped ±25) — your same spreadsheet method. Reg. Season Record / 95% CI cover only
        the regular season — the conference championship game is an extra 13th game that not
        every team plays, so it's deliberately excluded from the win total and tracked on its
        own via Make Champ % / Win Champ % instead. Conference tiebreakers use a simple win%
        ranking, and the conference championship game itself is simulated between the top 2
        teams. The 12-team playoff field mirrors the real CFP format: the 5 highest-rated
        conference champions get automatic bids (the top 4 of those get a first-round bye),
        and the next 7 highest-rated teams overall fill the remaining at-large spots, seeded
        by rating. Opponents with no power rating at all (sub-FCS buy-game teams) are
        estimated at the current median FCS rating ({medianFcsRating.toFixed(2)}) + 28, i.e.{" "}
        {syntheticRating.toFixed(2)}, rather than a coin flip.
      </p>
    </div>
  );
}
