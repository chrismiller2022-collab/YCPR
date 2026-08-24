import { useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fairMoneylineFromWinPct } from "../lib/odds";
import { undefeatedPct, type TeamSimResult } from "../lib/montecarlo/engine";
import { fetchMonteCarloRuns, fetchMonteCarloRun, type MonteCarloRunSummary } from "../lib/api/monteCarlo";

// ---------------------------------------------------------------------
// Prediction-markets pricing helpers.
//
// Yes/No pricing: "simple complement" (per confirmed decision) — Yes =
// Chance in cents/%, No = 100 - Chance. No artificial vig/spread for now.
// ---------------------------------------------------------------------
type PriceMode = "cents" | "american";

function yesNoPct(pct: number | null | undefined): { yes: number; no: number } | null {
  if (pct == null || Number.isNaN(pct)) return null;
  const yes = Math.min(100, Math.max(0, pct));
  return { yes, no: 100 - yes };
}

function fmtCents(pct: number) {
  return `${Math.round(pct)}¢`;
}

function fmtAmerican(pct: number) {
  const ml = fairMoneylineFromWinPct(pct / 100);
  if (ml == null) return "–";
  return `${ml > 0 ? "+" : ""}${Math.round(ml)}`;
}

/** Renders a Yes/No pair of cells for a given percentage, in the active price mode. */
function YesNoCells({ pct, mode }: { pct: number | null | undefined; mode: PriceMode }) {
  const yn = yesNoPct(pct);
  if (!yn) {
    return (
      <>
        <td style={tdRight}>–</td>
        <td style={tdRight}>–</td>
      </>
    );
  }
  return (
    <>
      <td style={tdRight}>{mode === "cents" ? fmtCents(yn.yes) : fmtAmerican(yn.yes)}</td>
      <td style={tdRight}>{mode === "cents" ? fmtCents(yn.no) : fmtAmerican(yn.no)}</td>
    </>
  );
}

const tdBase: React.CSSProperties = { padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" };
const tdRight: React.CSSProperties = { ...tdBase, textAlign: "right" };

function PriceModeToggle({ mode, onChange }: { mode: PriceMode; onChange: (m: PriceMode) => void }) {
  return (
    <div style={{ display: "flex", gap: "0.4rem" }}>
      <button className={`mode-btn ${mode === "cents" ? "mode-btn-active" : ""}`} onClick={() => onChange("cents")}>
        Kalshi (¢)
      </button>
      <button className={`mode-btn ${mode === "american" ? "mode-btn-active" : ""}`} onClick={() => onChange("american")}>
        American odds
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Run picker — shared by every sub-tab.
// ---------------------------------------------------------------------
function useLoadedRun() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [runs, setRuns] = useState<MonteCarloRunSummary[]>([]);
  const [loadedRunId, setLoadedRunId] = useState<number | null>(null);
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [numTrials, setNumTrials] = useState(5000);
  const [week, setWeek] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useMemo(() => {
    setLoading(true);
    setLoadedRunId(null);
    setResults(null);
    fetchMonteCarloRuns(season)
      .then(async (r) => {
        setRuns(r);
        if (r.length > 0) {
          const run = await fetchMonteCarloRun(r[0].id);
          if (run) {
            setLoadedRunId(run.id);
            setResults(run.results);
            setNumTrials(run.num_trials);
            setWeek(run.week);
          }
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  async function viewRun(id: number) {
    const run = await fetchMonteCarloRun(id);
    if (run) {
      setLoadedRunId(run.id);
      setResults(run.results);
      setNumTrials(run.num_trials);
      setWeek(run.week);
    }
  }

  return { season, setSeason, runs, loadedRunId, viewRun, results, numTrials, week, loading };
}

function RunPicker(props: ReturnType<typeof useLoadedRun>) {
  const { season, setSeason, runs, loadedRunId, viewRun, loading } = props;
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.6rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
      </div>
      {loading ? (
        <p>Loading saved runs…</p>
      ) : runs.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No saved Monte Carlo runs for this season yet.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {runs.map((r) => (
            <button
              key={r.id}
              className="menu-btn"
              style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", opacity: loadedRunId === r.id ? 1 : 0.7 }}
              onClick={() => viewRun(r.id)}
            >
              Week {r.week} · {r.num_trials.toLocaleString()} trials
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Simple per-team qualification markets: Natty, Playoff qual, Undefeated
// reg season, Natty game qual, Semis qual, Quarters qual, To win conf.
// ---------------------------------------------------------------------
const SIMPLE_MARKETS: { key: string; label: string }[] = [
  { key: "nattyPct", label: "Natty (win it all)" },
  { key: "playoffPct", label: "Playoff qualification" },
  { key: "undefeatedPct", label: "Undefeated regular season" },
  { key: "nattyGamePct", label: "Natty game qualification" },
  { key: "semifinalPct", label: "Semifinal qualification" },
  { key: "quarterfinalPct", label: "Quarterfinal qualification" },
  { key: "confTitlePct", label: "To win conference" },
];

function marketValue(r: TeamSimResult, numTrials: number, key: string): number | null {
  if (key === "undefeatedPct") return undefeatedPct(r, numTrials);
  const v = (r as any)[key];
  return v == null ? null : v;
}

function MarketsTab({ run, mode }: { run: ReturnType<typeof useLoadedRun>; mode: PriceMode }) {
  const [marketKey, setMarketKey] = useState(SIMPLE_MARKETS[0].key);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    if (!run.results) return [];
    return [...run.results]
      .map((r) => ({ r, val: marketValue(r, run.numTrials, marketKey) }))
      .sort((a, b) => (sortDir === "asc" ? (a.val ?? -1) - (b.val ?? -1) : (b.val ?? -1) - (a.val ?? -1)));
  }, [run.results, run.numTrials, marketKey, sortDir]);

  return (
    <div>
      <RunPicker {...run} />
      {run.results && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <select value={marketKey} onChange={(e) => setMarketKey(e.target.value)}>
              {SIMPLE_MARKETS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th">Conf</th>
                  <SortHeader
                    label="Chance %"
                    sortKey="val"
                    active
                    dir={sortDir}
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    align="right"
                  />
                  <th className="th th-right">Yes</th>
                  <th className="th th-right">No</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, val }) => (
                  <tr key={r.team}>
                    <td style={tdBase}>
                      <TeamLogo team={r.team} /> {r.team}
                    </td>
                    <td style={tdBase}>{r.conf}</td>
                    <td style={tdRight}>{val != null ? `${val.toFixed(1)}%` : "–"}</td>
                    <YesNoCells pct={val} mode={mode} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Playoff seeds market (12-way per team) — added to the Monte Carlo
// engine itself (seedPct), shown here per-seed.
// ---------------------------------------------------------------------
function SeedsTab({ run, mode }: { run: ReturnType<typeof useLoadedRun>; mode: PriceMode }) {
  const [seed, setSeed] = useState(1);

  const rows = useMemo(() => {
    if (!run.results) return [];
    return [...run.results]
      .map((r) => ({ r, val: r.seedPct?.[seed - 1] ?? null }))
      .filter((row) => row.val != null && row.val > 0.01)
      .sort((a, b) => (b.val ?? 0) - (a.val ?? 0));
  }, [run.results, seed]);

  return (
    <div>
      <RunPicker {...run} />
      {run.results && (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              Seed{" "}
              <select value={seed} onChange={(e) => setSeed(parseInt(e.target.value, 10))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((s) => (
                  <option key={s} value={s}>
                    #{s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {rows.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>
              No seed data for this run — it was saved before playoff-seed tracking was added.
            </p>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th className="th">Team</th>
                    <th className="th">Conf</th>
                    <th className="th th-right">Chance %</th>
                    <th className="th th-right">Yes</th>
                    <th className="th th-right">No</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ r, val }) => (
                    <tr key={r.team}>
                      <td style={tdBase}>
                        <TeamLogo team={r.team} /> {r.team}
                      </td>
                      <td style={tdBase}>{r.conf}</td>
                      <td style={tdRight}>{val!.toFixed(1)}%</td>
                      <YesNoCells pct={val} mode={mode} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Which conference wins the Natty — a derived/aggregate market, summing
// nattyPct across each team by conference. Deliberately NOT a tracked
// field on the Monte Carlo engine itself, per instruction.
// ---------------------------------------------------------------------
function ConferenceNattyTab({ run, mode }: { run: ReturnType<typeof useLoadedRun>; mode: PriceMode }) {
  const rows = useMemo(() => {
    if (!run.results) return [];
    const byConf = new Map<string, number>();
    for (const r of run.results) {
      byConf.set(r.conf, (byConf.get(r.conf) ?? 0) + (r.nattyPct ?? 0));
    }
    return [...byConf.entries()].map(([conf, pct]) => ({ conf, pct })).sort((a, b) => b.pct - a.pct);
  }, [run.results]);

  return (
    <div>
      <RunPicker {...run} />
      {run.results && (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th className="th">Conference</th>
                <th className="th th-right">Chance %</th>
                <th className="th th-right">Yes</th>
                <th className="th th-right">No</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ conf, pct }) => (
                <tr key={conf}>
                  <td style={tdBase}>{conf}</td>
                  <td style={tdRight}>{pct.toFixed(1)}%</td>
                  <YesNoCells pct={pct} mode={mode} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Win totals — two distinct markets:
//  1. Vegas O/U: model % chance of going over the saved Vegas win line
//     for each team (from the weekly upload, same field LiveWinTotalsPage
//     reads as "Vegas Win Total").
//  2. Wins ladder: Kalshi-style "N+ wins" threshold table for one team at
//     a time, matching the Chance/Yes/No shape from the example.
// ---------------------------------------------------------------------
function overPct(result: TeamSimResult, numTrials: number, line: number): number {
  if (numTrials <= 0) return 0;
  let count = 0;
  for (let w = 0; w < result.winDistribution.length; w++) {
    if (w > line) count += result.winDistribution[w] ?? 0;
  }
  return (count / numTrials) * 100;
}

function WinTotalsTab({ run, mode }: { run: ReturnType<typeof useLoadedRun>; mode: PriceMode }) {
  const [subTab, setSubTab] = useState<"vegas" | "ladder">("vegas");
  const [ladderTeam, setLadderTeam] = useState<string | null>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const vegasRows = useMemo(() => {
    if (!run.results) return [];
    return run.results
      .map((r) => {
        const line = liveByTeam[r.team]?.season_win_line ?? null;
        const over = line != null ? overPct(r, run.numTrials, line) : null;
        return { r, line, over };
      })
      .filter((row) => row.line != null)
      .sort((a, b) => (b.over ?? 0) - (a.over ?? 0));
  }, [run.results, run.numTrials, liveByTeam]);

  const ladderTeamResult = useMemo(() => {
    if (!run.results || !ladderTeam) return null;
    return run.results.find((r) => r.team === ladderTeam) ?? null;
  }, [run.results, ladderTeam]);

  const ladderRows = useMemo(() => {
    if (!ladderTeamResult) return [];
    const maxWins = ladderTeamResult.totalGames;
    const out: { threshold: number; chance: number }[] = [];
    for (let n = 5; n <= maxWins; n++) {
      out.push({ threshold: n, chance: 0 });
    }
    // fill via winsAtLeastPct-equivalent (>= n)
    for (const row of out) {
      let count = 0;
      for (let w = row.threshold; w < ladderTeamResult.winDistribution.length; w++) {
        count += ladderTeamResult.winDistribution[w] ?? 0;
      }
      row.chance = (count / run.numTrials) * 100;
    }
    return out;
  }, [ladderTeamResult, run.numTrials]);

  return (
    <div>
      <RunPicker {...run} />
      {run.results && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button className={`mode-btn ${subTab === "vegas" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("vegas")}>
              Vegas O/U
            </button>
            <button className={`mode-btn ${subTab === "ladder" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("ladder")}>
              Wins ladder
            </button>
          </div>

          {subTab === "vegas" && (
            <>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>
                Model chance of finishing OVER each team's saved Vegas win total (from the latest
                weekly upload), using the Monte Carlo win distribution.
              </p>
              {vegasRows.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>No teams have a Vegas win total saved yet.</p>
              ) : (
                <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
                    <thead>
                      <tr>
                        <th className="th">Team</th>
                        <th className="th th-right">Vegas Line</th>
                        <th className="th th-right">Over %</th>
                        <th className="th th-right">Over Yes</th>
                        <th className="th th-right">Over No</th>
                        <th className="th th-right">Under Yes</th>
                        <th className="th th-right">Under No</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vegasRows.map(({ r, line, over }) => (
                        <tr key={r.team}>
                          <td style={tdBase}>
                            <TeamLogo team={r.team} /> {r.team}
                          </td>
                          <td style={tdRight}>{line!.toFixed(1)}</td>
                          <td style={tdRight}>{over!.toFixed(1)}%</td>
                          <YesNoCells pct={over} mode={mode} />
                          <YesNoCells pct={100 - (over ?? 0)} mode={mode} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {subTab === "ladder" && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <label>
                  Team{" "}
                  <select value={ladderTeam ?? ""} onChange={(e) => setLadderTeam(e.target.value || null)}>
                    <option value="">Select a team…</option>
                    {[...run.results].sort((a, b) => a.team.localeCompare(b.team)).map((r) => (
                      <option key={r.team} value={r.team}>
                        {r.team}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {ladderTeamResult ? (
                <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
                    <thead>
                      <tr>
                        <th className="th">Wins</th>
                        <th className="th th-right">Chance</th>
                        <th className="th th-right">Yes</th>
                        <th className="th th-right">No</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ladderRows.map((row) => (
                        <tr key={row.threshold}>
                          <td style={tdBase}>{row.threshold}+</td>
                          <td style={tdRight}>{row.chance.toFixed(1)}%</td>
                          <YesNoCells pct={row.chance} mode={mode} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: "var(--chalk-dim)" }}>Pick a team to see its wins ladder.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Head-to-head win comparison — model each team's win total as
// Normal(meanWins, stddev derived from its saved 95% CI), assume
// independence between the two teams, compute P(TeamA wins > TeamB wins).
// ---------------------------------------------------------------------
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

// 95% CI half-width = 1.959964 stddevs.
function stddevFromCi(ci95Low: number, ci95High: number): number {
  return Math.max((ci95High - ci95Low) / (2 * 1.959964), 0.01);
}

function impliedProbFromAmerican(odds: number | null): number | null {
  if (odds == null || Number.isNaN(odds)) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

function HeadToHeadTab({ run, mode }: { run: ReturnType<typeof useLoadedRun>; mode: PriceMode }) {
  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [customA, setCustomA] = useState("");
  const [customB, setCustomB] = useState("");

  const resultA = useMemo(() => run.results?.find((r) => r.team === teamA) ?? null, [run.results, teamA]);
  const resultB = useMemo(() => run.results?.find((r) => r.team === teamB) ?? null, [run.results, teamB]);

  const model = useMemo(() => {
    if (!resultA || !resultB) return null;
    const sdA = stddevFromCi(resultA.ci95Low, resultA.ci95High);
    const sdB = stddevFromCi(resultB.ci95Low, resultB.ci95High);
    const diffMean = resultA.meanWins - resultB.meanWins;
    const diffSd = Math.sqrt(sdA * sdA + sdB * sdB);
    const pAOverB = normalCdf(diffMean / diffSd) * 100;
    return { pAOverB, pBOverA: 100 - pAOverB, sdA, sdB };
  }, [resultA, resultB]);

  const customAOdds = customA.trim() === "" ? null : parseFloat(customA);
  const customBOdds = customB.trim() === "" ? null : parseFloat(customB);
  const impliedA = impliedProbFromAmerican(customAOdds != null && !Number.isNaN(customAOdds) ? customAOdds : null);
  const impliedB = impliedProbFromAmerican(customBOdds != null && !Number.isNaN(customBOdds) ? customBOdds : null);

  return (
    <div>
      <RunPicker {...run} />
      {run.results && (
        <>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>
            "Team A finishes with more wins than Team B" — each team's win total modeled as
            Normal(mean, stddev from its saved 95% CI), assuming independence between the two
            teams.
          </p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <label>
              Team A{" "}
              <select value={teamA ?? ""} onChange={(e) => setTeamA(e.target.value || null)}>
                <option value="">Select…</option>
                {[...run.results].sort((a, b) => a.team.localeCompare(b.team)).map((r) => (
                  <option key={r.team} value={r.team}>
                    {r.team}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Team B{" "}
              <select value={teamB ?? ""} onChange={(e) => setTeamB(e.target.value || null)}>
                <option value="">Select…</option>
                {[...run.results].sort((a, b) => a.team.localeCompare(b.team)).map((r) => (
                  <option key={r.team} value={r.team}>
                    {r.team}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {model && resultA && resultB && (
            <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginBottom: "1.25rem" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th className="th">Team</th>
                    <th className="th th-right">Mean Wins</th>
                    <th className="th th-right">95% CI</th>
                    <th className="th th-right">Model P(more wins)</th>
                    <th className="th th-right">Price</th>
                    <th className="th th-right">Custom American</th>
                    <th className="th th-right">Implied %</th>
                    <th className="th th-right">Edge (model − implied)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdBase}>
                      <TeamLogo team={resultA.team} /> {resultA.team}
                    </td>
                    <td style={tdRight}>{resultA.meanWins.toFixed(1)}</td>
                    <td style={tdRight}>
                      {resultA.ci95Low}–{resultA.ci95High}
                    </td>
                    <td style={tdRight}>{model.pAOverB.toFixed(1)}%</td>
                    <td style={tdRight}>{mode === "cents" ? fmtCents(model.pAOverB) : fmtAmerican(model.pAOverB)}</td>
                    <td style={tdRight}>
                      <input
                        type="number"
                        value={customA}
                        onChange={(e) => setCustomA(e.target.value)}
                        placeholder="e.g. -150"
                        style={{ width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={tdRight}>{impliedA != null ? `${(impliedA * 100).toFixed(1)}%` : "–"}</td>
                    <td
                      style={{
                        ...tdRight,
                        color: impliedA != null ? (model.pAOverB / 100 - impliedA > 0 ? "#8fd39a" : "#c45c52") : undefined,
                      }}
                    >
                      {impliedA != null ? `${((model.pAOverB / 100 - impliedA) * 100).toFixed(1)} pts` : "–"}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdBase}>
                      <TeamLogo team={resultB.team} /> {resultB.team}
                    </td>
                    <td style={tdRight}>{resultB.meanWins.toFixed(1)}</td>
                    <td style={tdRight}>
                      {resultB.ci95Low}–{resultB.ci95High}
                    </td>
                    <td style={tdRight}>{model.pBOverA.toFixed(1)}%</td>
                    <td style={tdRight}>{mode === "cents" ? fmtCents(model.pBOverA) : fmtAmerican(model.pBOverA)}</td>
                    <td style={tdRight}>
                      <input
                        type="number"
                        value={customB}
                        onChange={(e) => setCustomB(e.target.value)}
                        placeholder="e.g. +130"
                        style={{ width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={tdRight}>{impliedB != null ? `${(impliedB * 100).toFixed(1)}%` : "–"}</td>
                    <td
                      style={{
                        ...tdRight,
                        color: impliedB != null ? (model.pBOverA / 100 - impliedB > 0 ? "#8fd39a" : "#c45c52") : undefined,
                      }}
                    >
                      {impliedB != null ? `${((model.pBOverA / 100 - impliedB) * 100).toFixed(1)} pts` : "–"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Top-level PM admin panel.
// ---------------------------------------------------------------------
export default function PmAdminPanel({ onBack }: { onBack: () => void }) {
  const [subTab, setSubTab] = useState<"markets" | "seeds" | "confnatty" | "wintotals" | "h2h">("markets");
  const [mode, setMode] = useState<PriceMode>("cents");
  const run = useLoadedRun();

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Prediction Markets</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: "-0.5rem" }}>
        Fair prices modeled from saved Monte Carlo runs. Yes = Chance, No = 100 − Chance (no vig
        applied).
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className={`mode-btn ${subTab === "markets" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("markets")}>
            Markets
          </button>
          <button className={`mode-btn ${subTab === "seeds" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("seeds")}>
            Playoff Seeds
          </button>
          <button className={`mode-btn ${subTab === "confnatty" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("confnatty")}>
            Conference to Win Natty
          </button>
          <button className={`mode-btn ${subTab === "wintotals" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("wintotals")}>
            Win Totals
          </button>
          <button className={`mode-btn ${subTab === "h2h" ? "mode-btn-active" : ""}`} onClick={() => setSubTab("h2h")}>
            Head to Head
          </button>
        </div>
        <PriceModeToggle mode={mode} onChange={setMode} />
      </div>

      {subTab === "markets" && <MarketsTab run={run} mode={mode} />}
      {subTab === "seeds" && <SeedsTab run={run} mode={mode} />}
      {subTab === "confnatty" && <ConferenceNattyTab run={run} mode={mode} />}
      {subTab === "wintotals" && <WinTotalsTab run={run} mode={mode} />}
      {subTab === "h2h" && <HeadToHeadTab run={run} mode={mode} />}
    </div>
  );
}
