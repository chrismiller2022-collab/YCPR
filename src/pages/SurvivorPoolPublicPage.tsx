import { useEffect, useMemo, useState } from "react";
import {
  fetchEntrantBySlug,
  fetchPoolSeasonGames,
  fetchSpreadsForGames,
  fetchEntrantPicks,
  computeWeekDeadline,
  computeGameLockTime,
  submitPick,
  type SurvivorPoolEntrantPublic,
  type PoolGameRow,
  type SpreadWithSource,
  type EntrantPickRow,
} from "../lib/api/survivorPoolPublic";
import { fetchSurvivorPoolSettings } from "../lib/api/survivorPoolAdmin";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function fmtSpread(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmtDeadline(d: Date | null) {
  if (!d) return "–";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

interface GridCell {
  gameId: string;
  opponent: string;
  isHome: boolean;
  opponentConf: string | null;
  eligible: boolean;
  spread: SpreadWithSource;
  startDate: string | null;
}

export default function SurvivorPoolPublicPage({ slug, onHome }: { slug: string; onHome?: () => void }) {
  const [entrant, setEntrant] = useState<SurvivorPoolEntrantPublic | null | "loading">("loading");
  const [conferences, setConferences] = useState<string[]>([]);
  const [selectedConfs, setSelectedConfs] = useState<Set<string>>(new Set());
  const [poolGames, setPoolGames] = useState<PoolGameRow[]>([]);
  const [spreads, setSpreads] = useState<Map<string, SpreadWithSource>>(new Map());
  const [picks, setPicks] = useState<EntrantPickRow[]>([]);
  const [hideUsed, setHideUsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selection, setSelection] = useState<{ team: string; gameId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const e = await fetchEntrantBySlug(slug);
      if (!e) {
        setEntrant(null);
        setLoading(false);
        return;
      }
      setEntrant(e);

      const settings = await fetchSurvivorPoolSettings(e.season);
      const confs = settings?.conferences ?? [];
      setConferences(confs);
      setSelectedConfs(new Set(confs));

      const games = await fetchPoolSeasonGames(e.season, confs);
      setPoolGames(games);

      const gameIds = games.map((g) => g.gameId);
      const spreadMap = await fetchSpreadsForGames(e.season, gameIds, liveByTeam);
      setSpreads(spreadMap);

      const entrantPicks = await fetchEntrantPicks(e.id);
      setPicks(entrantPicks);
    } catch (err: any) {
      setError(err.message ?? "Failed to load pool");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const usedTeams = useMemo(() => new Set(picks.map((p) => p.team)), [picks]);

  const weeks = useMemo(() => Array.from(new Set(poolGames.map((g) => g.week))).sort((a, b) => a - b), [poolGames]);

  const currentWeek = useMemo(() => {
    const completedWeeks = poolGames.filter((g) => g.completed).map((g) => g.week);
    return completedWeeks.length > 0 ? Math.max(...completedWeeks) + 1 : weeks[0] ?? 1;
  }, [poolGames, weeks]);

  const weekDeadline = useMemo(() => {
    const currentWeekGames = poolGames.filter((g) => g.week === currentWeek);
    return computeWeekDeadline(currentWeekGames.map((g) => g.startDate));
  }, [poolGames, currentWeek]);

  const currentPick = picks.find((p) => p.week === currentWeek) ?? null;

  const rowTeams = useMemo(() => {
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
    const spread = spreads.get(game.gameId) ?? { awaySpread: null, source: "unavailable" as const };
    return { gameId: game.gameId, opponent, isHome, opponentConf, eligible, spread, startDate: game.startDate };
  }

  function toggleConf(conf: string) {
    setSelectedConfs((prev) => {
      const next = new Set(prev);
      if (next.has(conf)) next.delete(conf);
      else next.add(conf);
      return next;
    });
  }

  function handleCellClick(team: string, week: number, cell: GridCell) {
    if (week !== currentWeek) return;
    if (!cell.eligible) return;
    const lockTime = computeGameLockTime(cell.startDate, weekDeadline);
    if (lockTime && new Date() >= lockTime) return;
    const usedElsewhere = picks.some((p) => p.team === team && p.week !== currentWeek);
    if (usedElsewhere) return;

    setSubmitError(null);
    setSubmitMsg(null);
    setSelection({ team, gameId: cell.gameId });
  }

  async function confirmSubmit() {
    if (!selection || typeof entrant !== "object" || entrant === null) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitMsg(null);
    try {
      await submitPick(slug, currentWeek, selection.gameId, selection.team);
      setSubmitMsg(`Picked ${selection.team} for Week ${currentWeek}.`);
      setSelection(null);
      await loadAll();
    } catch (err: any) {
      setSubmitError(err.message ?? "Failed to save pick");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
        <p>Loading…</p>
      </div>
    );
  }

  if (entrant === null) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
        <h2>Link not found</h2>
        <p style={{ color: "var(--chalk-dim)" }}>
          This survivor pool link doesn't match anyone in the pool — double check the link, or
          ask whoever sent it to you to confirm it.
        </p>
        {onHome && (
          <p>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onHome();
              }}
            >
              ← Back to site
            </a>
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
        <p style={{ color: "crimson" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem 1.25rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <div className="eyebrow">Survivor Pool</div>
        <h1 className="title" style={{ fontSize: "1.8rem" }}>
          {entrant.name}'s Picks
        </h1>
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.9rem" }}>
          Week {currentWeek} is open for picks — overall deadline{" "}
          <strong style={{ color: "var(--chalk)" }}>{fmtDeadline(weekDeadline)}</strong>. Games
          earlier in the week lock at their own kickoff instead. Other weeks are shown so you
          can plan ahead, but can't be picked yet.
        </p>
        {currentPick && (
          <p style={{ fontSize: "0.85rem" }}>
            Current pick for Week {currentWeek}: <strong>{currentPick.team}</strong> (submitted{" "}
            {new Date(currentPick.submitted_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            ) — you can still change this until it locks.
          </p>
        )}
        {typeof entrant === "object" && entrant !== null && (
          <p style={{ fontSize: "0.85rem" }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = `survivorpool-standings-${entrant.season}`;
              }}
            >
              View full pool standings →
            </a>
          </p>
        )}
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
        {conferences.map((conf) => {
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
        <button
          className="menu-btn"
          onClick={() => setHideUsed((v) => !v)}
          style={{ marginLeft: "auto", opacity: hideUsed ? 1 : 0.7 }}
        >
          {hideUsed ? "Showing eligible only" : "Hide used teams"}
        </button>
      </div>

      {rowTeams.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>
          No games available yet — the admin hasn't synced this season's schedule, or hasn't
          set the pool's conferences yet.
        </p>
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
                {weeks.map((w) => (
                  <th
                    key={w}
                    style={{
                      padding: "0.4rem 0.5rem",
                      textAlign: "center",
                      minWidth: 100,
                      borderBottom: "1px solid var(--hash)",
                      background: w === currentWeek ? "var(--gold-dim)" : "var(--turf-panel-2)",
                    }}
                  >
                    Week {w}
                    {w === currentWeek && <div style={{ fontSize: "0.62rem", fontWeight: 400 }}>Pickable</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowTeams
                .filter((team) => !hideUsed || !usedTeams.has(team))
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
                        textDecoration: usedTeams.has(team) ? "line-through" : "none",
                        opacity: usedTeams.has(team) ? 0.5 : 1,
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

                      const isCurrentWeek = week === currentWeek;
                      const lockTime = isCurrentWeek ? computeGameLockTime(cell.startDate, weekDeadline) : null;
                      const locked = !!lockTime && new Date() >= lockTime;
                      const usedElsewhere = picks.some((p) => p.team === team && p.week !== currentWeek);
                      const isSelectedPick = currentPick?.team === team && isCurrentWeek;
                      const isPendingSelection = selection?.team === team && isCurrentWeek;
                      const clickable = isCurrentWeek && cell.eligible && !locked && !usedElsewhere;
                      const dimmed = !cell.eligible || (usedTeams.has(team) && !isSelectedPick);

                      return (
                        <td
                          key={week}
                          onClick={() => clickable && handleCellClick(team, week, cell)}
                          style={{
                            textAlign: "center",
                            padding: "0.35rem 0.4rem",
                            borderBottom: "1px solid var(--hash)",
                            background: isSelectedPick
                              ? "var(--gold-dim)"
                              : isPendingSelection
                              ? "rgba(255,200,87,0.15)"
                              : isCurrentWeek
                              ? "rgba(255,200,87,0.06)"
                              : "transparent",
                            opacity: dimmed ? 0.4 : 1,
                            cursor: clickable ? "pointer" : "default",
                          }}
                          title={
                            !cell.eligible
                              ? "Opponent's conference isn't in the pool"
                              : locked
                              ? "This game has already locked"
                              : usedElsewhere
                              ? "Already used in another week"
                              : undefined
                          }
                        >
                          <div style={{ fontWeight: 600 }}>
                            {cell.isHome ? "" : "@"}
                            {cell.opponent}
                          </div>
                          <div style={{ fontSize: "0.68rem", opacity: 0.8 }}>
                            {fmtSpread(cell.spread.awaySpread)}
                            {cell.spread.source !== "unavailable" && (
                              <span
                                style={{
                                  marginLeft: "0.3rem",
                                  fontSize: "0.62rem",
                                  padding: "0.05rem 0.3rem",
                                  borderRadius: 999,
                                  background: cell.spread.source === "vegas" ? "rgba(90,168,105,0.25)" : "rgba(111,177,224,0.25)",
                                  color: cell.spread.source === "vegas" ? "#8fd39a" : "#9cc7e8",
                                }}
                              >
                                {cell.spread.source === "vegas" ? "Vegas" : "FPI"}
                              </span>
                            )}
                          </div>
                          {isCurrentWeek && locked && <div style={{ fontSize: "0.62rem", color: "#a15c00" }}>Locked</div>}
                          {isSelectedPick && <div style={{ fontSize: "0.62rem", color: "var(--gold)" }}>Your pick</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {selection && (
        <div
          style={{
            position: "sticky",
            bottom: "1rem",
            marginTop: "1rem",
            padding: "0.9rem 1.1rem",
            background: "var(--turf-panel-2)",
            border: "1px solid var(--gold)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <span>
            Confirm pick: <strong>{selection.team}</strong> — Week {currentWeek}
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={confirmSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit pick"}
            </button>
            <button className="menu-btn" onClick={() => setSelection(null)} disabled={submitting}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {submitMsg && <p style={{ color: "green", marginTop: "0.75rem" }}>{submitMsg}</p>}
      {submitError && <p style={{ color: "crimson", marginTop: "0.75rem" }}>{submitError}</p>}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        Spreads use the Vegas line when available, otherwise a projection from ESPN's FPI —
        the small badge on each cell shows which. Only Week {currentWeek} can be picked right
        now; other weeks are shown for planning. A pick can be changed any time before it
        locks — either at its own kickoff (for early-week games) or the week's overall
        deadline, whichever comes first.
      </div>
    </div>
  );
}
