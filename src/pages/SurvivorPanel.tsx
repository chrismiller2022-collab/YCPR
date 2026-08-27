import { useEffect, useMemo, useRef, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import {
  SURVIVOR_WEEKS,
  availableConferences,
  DEFAULT_CONFERENCES,
  rowTeams,
  gameForTeamInWeek,
  opponentOf,
  teamSpread,
  teamWinPct,
  cellStatus,
  teamsUsedElsewhere,
  allUsedTeams,
  computeSpreadRanks,
} from "../lib/survivor";
import { fairMoneylineFromWinPct } from "../lib/odds";
import { fetchSavedPaths, saveSurvivorPath, deleteSurvivorPath, type SurvivorSavedPath } from "../lib/api/survivorPaths";
import { exportNodeAsPng } from "../lib/exportPng";

// Heat-map coloring for the grid — brighter gold = higher win probability
// (a "safer" week to burn that team), purple = the single best matchup of
// that week among all eligible cells (rank.weekRank === 1, already
// computed by computeSpreadRanks). Mirrors the style of the NFL survivor
// optimal-path graphics Chris referenced.
function heatBg(winPct: number | null, isOptimal: boolean): string {
  if (isOptimal) return "rgba(168, 85, 247, 0.45)";
  if (winPct == null) return "transparent";
  const t = Math.max(0, Math.min(1, (winPct - 0.5) / 0.45)); // 50% -> 0, 95%+ -> 1
  return `rgba(230, 185, 60, ${(0.08 + t * 0.5).toFixed(2)})`;
}

const STORAGE_KEY = "survivor_picks_v1";

function loadPicks(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// This is the same Survivor picks tool that used to live behind its own
// password gate at #survivor. It's now a panel inside Admin — access is
// controlled by Admin's single shared gate (see AdminPage.tsx), so this
// component no longer checks a password itself.
export default function SurvivorPanel({ onBack }: { onBack?: () => void }) {
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [selectedConfs, setSelectedConfs] = useState<Set<string>>(new Set(DEFAULT_CONFERENCES));
  const [hideUsed, setHideUsed] = useState(false);
  const [view, setView] = useState<"spread" | "moneyline">("spread");
  const [sortWeekKey, setSortWeekKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [savedPaths, setSavedPaths] = useState<SurvivorSavedPath[]>([]);
  const [savingPath, setSavingPath] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [showSavedPaths, setShowSavedPaths] = useState(false);
  const exportGridRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  function loadSavedPaths() {
    fetchSavedPaths()
      .then(setSavedPaths)
      .catch((err) => setPathError(err.message));
  }

  useEffect(() => {
    loadSavedPaths();
  }, []);

  async function handleSavePath() {
    const name = prompt("Name this path (e.g. \"Safe start\", \"Save Ohio State for champ week\"):");
    if (!name) return;
    setSavingPath(true);
    setPathError(null);
    try {
      await saveSurvivorPath(name, picks);
      loadSavedPaths();
    } catch (err: any) {
      setPathError(err.message);
    } finally {
      setSavingPath(false);
    }
  }

  async function handleDeletePath(id: number) {
    if (!confirm("Delete this saved path?")) return;
    try {
      await deleteSurvivorPath(id);
      loadSavedPaths();
    } catch (err: any) {
      setPathError(err.message);
    }
  }

  function handleLoadPath(path: SurvivorSavedPath) {
    if (!confirm(`Load "${path.name}"? This replaces your current working picks (not saved paths, just the picks you're actively editing).`)) return;
    setPicks(path.picks);
  }

  async function handleExportPng() {
    if (!exportGridRef.current) return;
    setExporting(true);
    try {
      await exportNodeAsPng(exportGridRef.current, "survivor-path");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setPicks(loadPicks());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  }, [picks]);

  const allConfs = useMemo(() => availableConferences(), []);
  const teams = useMemo(() => rowTeams(selectedConfs), [selectedConfs]);
  const usedTeams = useMemo(() => allUsedTeams(picks), [picks]);
  // Ranks computed over the full (unfiltered-by-hideUsed) team set for the
  // current conference selection — same spread values already shown in the
  // grid (no live ratings here, matching teamSpread() calls below), just
  // ranked two ways: biggest favorite that week, and biggest favorite this
  // team gets all season.
  const spreadRanks = useMemo(() => computeSpreadRanks(teams, selectedConfs), [teams, selectedConfs]);

  const visibleTeams = useMemo(
    () => teams.filter((team) => !hideUsed || !usedTeams.has(team.team)),
    [teams, hideUsed, usedTeams]
  );

  const sortedTeams = useMemo(() => {
    if (!sortWeekKey) return visibleTeams;
    return [...visibleTeams].sort((a, b) => {
      const sa = spreadForWeek(a, sortWeekKey);
      const sb = spreadForWeek(b, sortWeekKey);
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1; // no game this week — always sinks to the bottom
      if (sb == null) return -1;
      return sortDir === "asc" ? sa - sb : sb - sa;
    });
  }, [visibleTeams, sortWeekKey, sortDir]);

  function toggleConf(conf: string) {
    setSelectedConfs((prev) => {
      const next = new Set(prev);
      if (next.has(conf)) next.delete(conf);
      else next.add(conf);
      return next;
    });
  }

  function handleSortClick(weekKey: string) {
    if (sortWeekKey === weekKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortWeekKey(weekKey);
      setSortDir("asc");
    }
  }

  function spreadForWeek(team: any, weekKey: string): number | null {
    const week = SURVIVOR_WEEKS.find((w) => w.key === weekKey);
    if (!week) return null;
    const game = gameForTeamInWeek(team.team, week.dataWeek);
    if (!game) return null;
    const opp = opponentOf(game, team.team);
    if (!opp) return null;
    return teamSpread(team, opp, game);
  }

  function handleCellClick(teamName: string, weekKey: string, status: string) {
    if (status !== "open" && status !== "selected") return;
    setPicks((prev) => {
      const weekPicks = prev[weekKey] || [];
      if (weekPicks.includes(teamName)) {
        return { ...prev, [weekKey]: weekPicks.filter((t) => t !== teamName) };
      }
      const usedElsewhere = teamsUsedElsewhere(prev, weekKey);
      if (usedElsewhere.has(teamName)) return prev;
      if (weekPicks.length >= 2) return prev;
      return { ...prev, [weekKey]: [...weekPicks, teamName] };
    });
  }

  function resetAll() {
    if (confirm("Clear all picks? This can't be undone.")) {
      setPicks({});
    }
  }

  const lockedWeeks = SURVIVOR_WEEKS.filter((w) => (picks[w.key] || []).length === 2).length;

  return (
    <div style={{ padding: "1rem 0 3rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Survivor Pool</h2>
          <p style={{ margin: "0.25rem 0 0", color: "var(--chalk-dim)", fontSize: "0.9rem" }}>
            {lockedWeeks} of {SURVIVOR_WEEKS.length} weeks locked · {usedTeams.size} teams used
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className={`mode-btn ${view === "spread" ? "mode-btn-active" : ""}`}
            onClick={() => setView("spread")}
          >
            Spread
          </button>
          <button
            className={`mode-btn ${view === "moneyline" ? "mode-btn-active" : ""}`}
            onClick={() => setView("moneyline")}
          >
            Moneyline
          </button>
          <button
            className="menu-btn"
            onClick={() => setHideUsed((v) => !v)}
            style={{ opacity: hideUsed ? 1 : 0.7 }}
          >
            {hideUsed ? "Showing eligible only" : "Hide used teams"}
          </button>
          <button className="menu-btn" onClick={resetAll}>
            Reset all
          </button>
          <button className="menu-btn" onClick={handleSavePath} disabled={savingPath}>
            {savingPath ? "Saving…" : "Save path"}
          </button>
          <button className="menu-btn" onClick={() => setShowSavedPaths((v) => !v)}>
            {showSavedPaths ? "Hide" : "Show"} saved paths ({savedPaths.length})
          </button>
          <button className="menu-btn" onClick={handleExportPng} disabled={exporting}>
            {exporting ? "Exporting…" : "Export path as PNG"}
          </button>
          <a
            href="https://app.splashsports.com/contest/fd3afd3f-9fe8-4d70-a68f-085efb6c99b2/entries/overall"
            target="_blank"
            rel="noopener noreferrer"
            className="menu-btn"
            style={{ textDecoration: "none" }}
          >
            Open Survivor Pool ↗
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onBack?.();
            }}
            className="menu-btn"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            ← Pools
          </a>
        </div>
      </div>

      <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span
          style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "rgba(230, 185, 60, 0.55)" }}
        />
        Brighter = safer pick (higher win%)
        <span
          style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "rgba(168, 85, 247, 0.45)", marginLeft: "0.5rem" }}
        />
        Purple = biggest favorite of that week
      </div>

      {pathError && <p style={{ color: "crimson", fontSize: "0.82rem" }}>{pathError}</p>}

      {showSavedPaths && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem",
            background: "var(--turf-panel)",
            border: "1px solid var(--hash)",
            borderRadius: 8,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Saved paths</div>
          {savedPaths.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", margin: 0 }}>No paths saved yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {savedPaths.map((p) => {
                const weeksSet = Object.values(p.picks).filter((t) => t.length > 0).length;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <span>
                      <strong>{p.name}</strong>{" "}
                      <span style={{ color: "var(--chalk-dim)", fontSize: "0.8rem" }}>
                        · {weeksSet} weeks set · {new Date(p.created_at).toLocaleDateString()}
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: "0.4rem" }}>
                      <button className="menu-btn" onClick={() => handleLoadPath(p)}>
                        Load
                      </button>
                      <button className="menu-btn" onClick={() => handleDeletePath(p.id)}>
                        Delete
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginBottom: "1rem",
          padding: "0.75rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginRight: "0.5rem", alignSelf: "center" }}>
          Conferences:
        </span>
        {allConfs.map((conf) => {
          const active = selectedConfs.has(conf);
          return (
            <button
              key={conf}
              onClick={() => toggleConf(conf)}
              style={{
                fontSize: "0.78rem",
                padding: "0.3rem 0.6rem",
                borderRadius: 6,
                border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
                background: active ? "var(--gold-dim)" : "transparent",
                color: active ? "var(--chalk)" : "var(--chalk-dim)",
                cursor: "pointer",
              }}
            >
              {conf}
            </button>
          );
        })}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  background: "var(--turf-panel-2)",
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  minWidth: 150,
                  borderBottom: "1px solid var(--hash)",
                }}
              >
                Team
              </th>
              {SURVIVOR_WEEKS.map((w) => {
                const locked = (picks[w.key] || []).length === 2;
                const isSorted = sortWeekKey === w.key;
                return (
                  <th
                    key={w.key}
                    onClick={() => handleSortClick(w.key)}
                    style={{
                      padding: "0.4rem 0.5rem",
                      textAlign: "center",
                      minWidth: 92,
                      borderBottom: "1px solid var(--hash)",
                      background: locked ? "rgba(255,255,255,0.06)" : "var(--turf-panel-2)",
                      textDecoration: locked ? "line-through" : "none",
                      color: locked ? "var(--chalk-dim)" : "var(--chalk)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}>
                      {w.label}
                      <span style={{ fontSize: "0.6rem", opacity: isSorted ? 1 : 0.35 }}>
                        {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "—"}
                      </span>
                    </div>
                    <div style={{ fontWeight: 400, fontSize: "0.68rem", opacity: 0.7 }}>
                      {w.lockLabel}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team) => (
                <tr key={team.team}>
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      background: "var(--turf-panel)",
                      padding: "0.4rem 0.75rem",
                      borderBottom: "1px solid var(--hash)",
                      textDecoration: usedTeams.has(team.team) ? "line-through" : "none",
                      opacity: usedTeams.has(team.team) ? 0.5 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                      <TeamLogo team={team} />
                      {team.team}
                    </span>
                  </td>
                  {SURVIVOR_WEEKS.map((week) => {
                    const game = gameForTeamInWeek(team.team, week.dataWeek);
                    const opp = game ? opponentOf(game, team.team) : undefined;
                    const usedElsewhere = teamsUsedElsewhere(picks, week.key);
                    const status = cellStatus(
                      team.team,
                      week,
                      game,
                      opp,
                      selectedConfs,
                      picks,
                      usedElsewhere
                    );

                    if (!game) {
                      return (
                        <td
                          key={week.key}
                          style={{
                            textAlign: "center",
                            padding: "0.4rem",
                            borderBottom: "1px solid var(--hash)",
                            color: "var(--chalk-dim)",
                          }}
                        >
                          –
                        </td>
                      );
                    }

                    const isHome = game.home === team.team;
                    const spread = opp ? teamSpread(team, opp, game) : null;
                    const winPct = opp ? teamWinPct(team, opp, game) : null;
                    const clickable = status === "open" || status === "selected";
                    const rank = spreadRanks.get(`${team.team}::${week.key}`);
                    const isOptimal = rank != null && rank.weekRank === 1;

                    const bg =
                      status === "selected"
                        ? "var(--gold-dim)"
                        : status === "ineligible" || status === "team-used" || status === "week-locked"
                        ? "rgba(255,255,255,0.03)"
                        : heatBg(winPct, isOptimal);

                    const tip =
                      status === "ineligible"
                        ? "Opponent's conference isn't selected"
                        : status === "team-used"
                        ? "Team already used in another week"
                        : status === "week-locked"
                        ? "Both picks already made for this week"
                        : undefined;

                    return (
                      <td
                        key={week.key}
                        onClick={() => clickable && handleCellClick(team.team, week.key, status)}
                        className={tip ? "cell-tip" : undefined}
                        data-tip={tip}
                        style={{
                          textAlign: "center",
                          padding: "0.35rem 0.4rem",
                          borderBottom: "1px solid var(--hash)",
                          background: bg,
                          cursor: clickable ? "pointer" : "not-allowed",
                          opacity: status === "ineligible" || status === "team-used" || status === "week-locked" ? 0.4 : 1,
                          textDecoration:
                            status === "ineligible" || status === "team-used" ? "line-through" : "none",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {isHome ? "" : "@"}
                          {opp ? opp.team : "?"}
                        </div>
                        {view === "spread" && spread != null && (
                          <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                            {spread > 0 ? "+" : ""}
                            {spread.toFixed(1)}
                          </div>
                        )}
                        {view === "moneyline" && winPct != null && (
                          <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                            {(() => {
                              const ml = fairMoneylineFromWinPct(winPct);
                              if (ml == null) return "–";
                              return `${ml > 0 ? "+" : ""}${Math.round(ml)}`;
                            })()}
                          </div>
                        )}
                        {rank && (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                              gap: "0.3rem",
                              marginTop: "0.15rem",
                              fontSize: "0.6rem",
                              fontWeight: 700,
                            }}
                          >
                            <span
                              className="cell-tip"
                              data-tip={`${rank.weekRank} biggest favorite of ${rank.weekPoolSize} pickable games this week`}
                              style={{
                                padding: "0.05rem 0.3rem",
                                borderRadius: 999,
                                background: "rgba(255,255,255,0.08)",
                                color: "var(--chalk-dim)",
                              }}
                            >
                              Wk #{rank.weekRank}
                            </span>
                            <span
                              className="cell-tip"
                              data-tip={`${team.team}'s ${rank.seasonRank} biggest favorite spread of ${rank.seasonPoolSize} pickable games this season`}
                              style={{
                                padding: "0.05rem 0.3rem",
                                borderRadius: 999,
                                background: rank.seasonRank === 1 ? "var(--gold-dim)" : "rgba(255,255,255,0.08)",
                                color: rank.seasonRank === 1 ? "var(--chalk)" : "var(--chalk-dim)",
                              }}
                            >
                              Yr #{rank.seasonRank}
                            </span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Off-screen export grid — captured by html2canvas via exportGridRef,
          never actually visible in the interactive UI. Reading order:
          Week 1 Pick 1, Week 1 Pick 2, Week 2 Pick 1, Week 2 Pick 2, ...,
          wrapped into a fixed-column grid so the whole season reads left-
          to-right, top-to-bottom in one image (4 columns — tell Chris if
          a different width reads better). */}
      <div style={{ position: "absolute", top: -99999, left: -99999 }}>
        <div ref={exportGridRef} style={{ background: "#1a1b2e", padding: "1.5rem", width: 900 }}>
          <div style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 800, marginBottom: "1rem" }}>Survivor Path</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
            {SURVIVOR_WEEKS.flatMap((week) =>
              (picks[week.key] || []).map((teamName, i) => (
                <div
                  key={`${week.key}-${i}`}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: 6,
                    padding: "0.5rem",
                    color: "#fff",
                    fontSize: "0.8rem",
                  }}
                >
                  <div style={{ color: "#a3a8c3", fontSize: "0.68rem", marginBottom: "0.2rem" }}>
                    {week.label} · Pick {i + 1}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700 }}>
                    <TeamLogo team={teamName} size={18} />
                    {teamName}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
