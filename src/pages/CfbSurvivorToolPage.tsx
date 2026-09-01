import { useEffect, useMemo, useRef, useState } from "react";
import ExportPngButton from "../components/ExportPngButton";
import { availableConferences, DEFAULT_CONFERENCES } from "../lib/survivor";
import {
  fetchPoolSeasonGames,
  fetchSpreadsForGames,
  fetchEntrantByCode,
  computeCurrentWeek,
  type PoolGameRow,
  type GameSpreads,
} from "../lib/api/survivorPoolPublic";

const PICKS_PER_WEEK = 2;

function fmtSpread(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

type OddsMode = "vegas" | "fpi";

interface GridCell {
  gameId: string;
  opponent: string;
  isHome: boolean;
  opponentConf: string | null;
  eligible: boolean;
  displaySpread: number | null;
}

export default function CfbSurvivorToolPage({ onHome }: { onHome?: () => void }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const allConfs = useMemo(() => availableConferences(), []);
  const [season, setSeason] = useState(new Date().getFullYear());
  const [selectedConfs, setSelectedConfs] = useState<Set<string>>(new Set(DEFAULT_CONFERENCES));
  const [poolGames, setPoolGames] = useState<PoolGameRow[]>([]);
  const [spreads, setSpreads] = useState<Map<string, GameSpreads>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideUsed, setHideUsed] = useState(false);
  const [oddsMode, setOddsMode] = useState<OddsMode>("vegas");

  const [localPlan, setLocalPlan] = useState<Record<number, string[]>>({});
  const [sortWeek, setSortWeek] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setLocalPlan({});
    (async () => {
      try {
        const games = await fetchPoolSeasonGames(season, allConfs);
        setPoolGames(games);
        const gameIds = games.map((g) => g.gameId);
        const spreadMap = await fetchSpreadsForGames(season, gameIds);
        setSpreads(spreadMap);
      } catch (err: any) {
        setError(err.message ?? "Failed to load schedule");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  const weeks = useMemo(() => Array.from(new Set(poolGames.map((g) => g.week))).sort((a, b) => a - b), [poolGames]);

  const currentWeek = useMemo(() => computeCurrentWeek(poolGames), [poolGames]);

  const plannedTeams = useMemo(() => {
    const set = new Set<string>();
    for (const teams of Object.values(localPlan)) for (const t of teams) set.add(t);
    return set;
  }, [localPlan]);

  const baseRowTeams = useMemo(() => {
    const set = new Set<string>();
    for (const g of poolGames) {
      if (g.homeConference && selectedConfs.has(g.homeConference)) set.add(g.homeTeam);
      if (g.awayConference && selectedConfs.has(g.awayConference)) set.add(g.awayTeam);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [poolGames, selectedConfs]);

  function cellFor(team: string, week: number): GridCell | null {
    const game = poolGames.find((g) => g.week === week && (g.homeTeam === team || g.awayTeam === team));
    if (!game) return null;
    const isHome = game.homeTeam === team;
    const opponent = isHome ? game.awayTeam : game.homeTeam;
    const opponentConf = isHome ? game.awayConference : game.homeConference;
    const eligible = !!opponentConf && selectedConfs.has(opponentConf);

    const entry = spreads.get(game.gameId);
    const raw = oddsMode === "vegas" ? entry?.vegasAwaySpread : entry?.fpiAwaySpread;
    const displaySpread = raw == null ? null : isHome ? -raw : raw;

    return { gameId: game.gameId, opponent, isHome, opponentConf, eligible, displaySpread };
  }

  const rowTeams = useMemo(() => {
    if (sortWeek == null) return baseRowTeams;
    const withValues = baseRowTeams.map((team) => ({ team, value: cellFor(team, sortWeek)?.displaySpread ?? null }));
    withValues.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return sortDir === "asc" ? a.value - b.value : b.value - a.value;
    });
    return withValues.map((w) => w.team);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRowTeams, sortWeek, sortDir, spreads, oddsMode]);

  function toggleConf(conf: string) {
    setSelectedConfs((prev) => {
      const next = new Set(prev);
      if (next.has(conf)) next.delete(conf);
      else next.add(conf);
      return next;
    });
  }

  function handleWeekHeaderClick(week: number) {
    if (sortWeek === week) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortWeek(week);
      setSortDir("asc");
    }
  }

  function isTeamUsedElsewhere(team: string, excludeWeek: number): boolean {
    return Object.entries(localPlan).some(([w, teams]) => Number(w) !== excludeWeek && teams.includes(team));
  }

  // Purely local — every week is clickable, nothing is ever submitted or
  // saved. This is a browsing/planning tool only.
  function handleCellClick(team: string, week: number, cell: GridCell) {
    if (!cell.eligible) return;
    const weekTeams = localPlan[week] ?? [];
    const alreadyPicked = weekTeams.includes(team);

    if (!alreadyPicked) {
      if (isTeamUsedElsewhere(team, week)) return;
      if (weekTeams.length >= PICKS_PER_WEEK) return;
    }

    setLocalPlan((prev) => {
      const next = { ...prev };
      const list = next[week] ?? [];
      next[week] = alreadyPicked ? list.filter((t) => t !== team) : [...list, team];
      return next;
    });
  }

  async function handleCodeSubmit() {
    setCodeError(null);
    if (!code.trim()) {
      setCodeError("No user found.");
      return;
    }
    setCheckingCode(true);
    try {
      const entrant = await fetchEntrantByCode(code);
      if (!entrant) {
        setCodeError("No user found.");
        return;
      }
      window.location.hash = `survivorpool-${entrant.slug}`;
    } catch {
      setCodeError("No user found.");
    } finally {
      setCheckingCode(false);
    }
  }

  return (
    <div style={{ padding: "1.5rem 1.25rem 3rem", maxWidth: "none", margin: "0 auto" }} ref={exportRef}>
      <div className="team-hero">
        {onHome && (
          <button className="back-link" data-export-exclude="true" onClick={onHome}>
            ‹ All rankings
          </button>
        )}
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">CFB SURVIVOR</h1>
        <p className="subtitle team-subtitle">
          Browse and plan out survivor picks across the whole season — pick any team in any
          week to try out a strategy. Nothing here is saved; it's purely a planning tool.
        </p>
        <div style={{ marginTop: "0.75rem" }} data-export-exclude="true">
          <ExportPngButton targetRef={exportRef} filename="cfb-survivor-plan" showTweet={false} />
        </div>
      </div>

      <div
        data-export-exclude="true"
        style={{
          marginBottom: "1.25rem",
          padding: "1rem 1.1rem",
          background: "var(--gold-dim)",
          border: "1px solid var(--gold)",
          borderRadius: 8,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>
          Member of our season-long CFB Survivor contest? Enter your user code here:
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            placeholder="e.g. es7ikk"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCodeSubmit()}
            style={{ flex: 1, minWidth: 160, maxWidth: 260 }}
          />
          <button onClick={handleCodeSubmit} disabled={checkingCode}>
            {checkingCode ? "Checking…" : "Enter"}
          </button>
        </div>
        {codeError && <p style={{ color: "crimson", marginTop: "0.5rem", marginBottom: 0 }}>{codeError}</p>}
      </div>

      <details
        style={{
          marginBottom: "1rem",
          padding: "0.75rem 0.9rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
          fontSize: "0.82rem",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--chalk)" }}>How this planning tool works</summary>
        <div style={{ marginTop: "0.6rem", color: "var(--chalk-dim)", lineHeight: 1.7 }}>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>Pick any two teams in any week to see how a strategy plays out — nothing here is saved or submitted anywhere.</li>
            <li>Only games between two teams from your selected conferences are eligible.</li>
            <li>You can't plan the same team twice across the season, same as the real contest's rule.</li>
            <li>
              If you're an actual entrant in our real pool, use the code box above instead — that takes you to your real
              page where picks actually count.
            </li>
          </ul>
        </div>
      </details>

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
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          Season{" "}
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)}
            style={{ width: 80 }}
          />
        </label>

        <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Conferences:</span>
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

        <span style={{ marginLeft: "1rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Odds:</span>
        <div style={{ display: "flex", border: "1px solid var(--hash)", borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setOddsMode("vegas")}
            style={{
              padding: "0.3rem 0.7rem",
              fontSize: "0.78rem",
              border: "none",
              background: oddsMode === "vegas" ? "var(--gold-dim)" : "transparent",
              color: oddsMode === "vegas" ? "var(--chalk)" : "var(--chalk-dim)",
              cursor: "pointer",
            }}
          >
            Vegas
          </button>
          <button
            onClick={() => setOddsMode("fpi")}
            style={{
              padding: "0.3rem 0.7rem",
              fontSize: "0.78rem",
              border: "none",
              background: oddsMode === "fpi" ? "var(--gold-dim)" : "transparent",
              color: oddsMode === "fpi" ? "var(--chalk)" : "var(--chalk-dim)",
              cursor: "pointer",
            }}
          >
            FPI
          </button>
        </div>

        <button className="menu-btn" onClick={() => setHideUsed((v) => !v)} style={{ marginLeft: "auto", opacity: hideUsed ? 1 : 0.7 }}>
          {hideUsed ? "Showing eligible only" : "Hide planned teams"}
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : rowTeams.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No games synced for {season} yet.</p>
      ) : (
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
                {weeks.map((w) => {
                  const isSorted = sortWeek === w;
                  return (
                    <th
                      key={w}
                      onClick={() => handleWeekHeaderClick(w)}
                      style={{
                        padding: "0.5rem 0.5rem",
                        textAlign: "center",
                        minWidth: 92,
                        borderBottom: "1px solid var(--hash)",
                        background: "var(--turf-panel-2)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                        {`Week ${w}${w === currentWeek ? " (Current)" : ""}`}
                        <span style={{ fontSize: "0.6rem", opacity: isSorted ? 1 : 0.35 }}>
                          {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "—"}
                        </span>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowTeams
                .filter((team) => !hideUsed || !plannedTeams.has(team))
                .map((team) => (
                  <tr key={team}>
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        background: "var(--turf-panel)",
                        padding: "0.4rem 0.75rem",
                        borderBottom: "1px solid var(--hash)",
                        textDecoration: plannedTeams.has(team) ? "line-through" : "none",
                        opacity: plannedTeams.has(team) ? 0.5 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {team}
                    </td>
                    {weeks.map((week) => {
                      const cell = cellFor(team, week);
                      if (!cell) {
                        return (
                          <td
                            key={week}
                            style={{ textAlign: "center", padding: "0.4rem", borderBottom: "1px solid var(--hash)", color: "var(--chalk-dim)" }}
                          >
                            –
                          </td>
                        );
                      }

                      const weekTeams = localPlan[week] ?? [];
                      const isPlanned = weekTeams.includes(team);
                      const weekFull = weekTeams.length >= PICKS_PER_WEEK && !isPlanned;
                      const usedElsewhere = !isPlanned && isTeamUsedElsewhere(team, week);
                      const clickable = cell.eligible && !usedElsewhere && !weekFull;
                      const dimmed = !cell.eligible || (plannedTeams.has(team) && !isPlanned);
                      const isCurrentWeek = week === currentWeek;
                      const tip = !cell.eligible
                        ? "Opponent's conference isn't selected"
                        : usedElsewhere
                        ? "Already planned in another week"
                        : weekFull
                        ? "Both picks already planned for this week"
                        : undefined;

                      return (
                        <td
                          key={week}
                          onClick={() => clickable && handleCellClick(team, week, cell)}
                          className={tip ? "cell-tip" : undefined}
                          data-tip={tip}
                          style={{
                            textAlign: "center",
                            padding: "0.35rem 0.4rem",
                            borderBottom: "1px solid var(--hash)",
                            background: isPlanned ? "var(--gold-dim)" : isCurrentWeek ? "rgba(255,200,87,0.06)" : "transparent",
                            opacity: dimmed ? 0.4 : 1,
                            cursor: clickable ? "pointer" : "default",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>
                            {cell.isHome ? "" : "@"}
                            {cell.opponent}
                          </div>
                          <div style={{ fontSize: "0.68rem", opacity: 0.8 }}>{fmtSpread(cell.displaySpread)}</div>
                          {isPlanned && <div style={{ fontSize: "0.62rem", color: "var(--gold)" }}>Planned</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        Click any week's header to sort teams by that week's spread (biggest favorite first).
        This page is a free-form planning tool — nothing typed or clicked here is saved
        anywhere. If you're in our real contest, use the code box above to get to your actual
        picks page.
      </div>
    </div>
  );
}
