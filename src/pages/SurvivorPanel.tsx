import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import {
  SURVIVOR_WEEKS,
  availableConferences,
  DEFAULT_CONFERENCES,
  rowTeams,
  gameForTeamInWeek,
  opponentOf,
  teamSpread,
  cellStatus,
  teamsUsedElsewhere,
  allUsedTeams,
  computeSpreadRanks,
} from "../lib/survivor";

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
  const [sortWeekKey, setSortWeekKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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
            className="menu-btn"
            onClick={() => setHideUsed((v) => !v)}
            style={{ opacity: hideUsed ? 1 : 0.7 }}
          >
            {hideUsed ? "Showing eligible only" : "Hide used teams"}
          </button>
          <button className="menu-btn" onClick={resetAll}>
            Reset all
          </button>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onBack?.();
            }}
            className="menu-btn"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            ← Admin
          </a>
        </div>
      </div>

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
                    const clickable = status === "open" || status === "selected";
                    const rank = spreadRanks.get(`${team.team}::${week.key}`);

                    const bg =
                      status === "selected"
                        ? "var(--gold-dim)"
                        : status === "ineligible" || status === "team-used" || status === "week-locked"
                        ? "rgba(255,255,255,0.03)"
                        : "transparent";

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
                        {spread != null && (
                          <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                            {spread > 0 ? "+" : ""}
                            {spread.toFixed(1)}
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
    </div>
  );
}
