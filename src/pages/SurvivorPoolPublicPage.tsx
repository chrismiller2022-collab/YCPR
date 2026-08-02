import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
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
  type GameSpreads,
  type EntrantPickRow,
} from "../lib/api/survivorPoolPublic";
import { fetchSurvivorPoolSettings } from "../lib/api/survivorPoolAdmin";

const PICKS_PER_WEEK = 2;

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

type OddsMode = "vegas" | "fpi";

interface GridCell {
  gameId: string;
  opponent: string;
  isHome: boolean;
  opponentConf: string | null;
  eligible: boolean;
  displaySpread: number | null;
  startDate: string | null;
}

export default function SurvivorPoolPublicPage({ slug, onHome }: { slug: string; onHome?: () => void }) {
  const [entrant, setEntrant] = useState<SurvivorPoolEntrantPublic | null | "loading">("loading");
  const [conferences, setConferences] = useState<string[]>([]);
  const [poolGames, setPoolGames] = useState<PoolGameRow[]>([]);
  const [spreads, setSpreads] = useState<Map<string, GameSpreads>>(new Map());
  const [picks, setPicks] = useState<EntrantPickRow[]>([]);
  const [hideUsed, setHideUsed] = useState(false);
  const [oddsMode, setOddsMode] = useState<OddsMode>("vegas");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [localPlan, setLocalPlan] = useState<Record<number, string[]>>({});

  const [pendingActions, setPendingActions] = useState<{ team: string; gameId: string; mode: "add" | "remove" }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ week: number; teams: string[] } | null>(null);

  const [sortWeek, setSortWeek] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const selectedConfs = useMemo(() => new Set(conferences), [conferences]);

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

      const games = await fetchPoolSeasonGames(e.season, confs);
      setPoolGames(games);

      const gameIds = games.map((g) => g.gameId);
      const spreadMap = await fetchSpreadsForGames(e.season, gameIds);
      setSpreads(spreadMap);

      const entrantPicks = await fetchEntrantPicks(e.id);
      setPicks(entrantPicks);
      const plan: Record<number, string[]> = {};
      for (const p of entrantPicks) {
        (plan[p.week] = plan[p.week] ?? []).push(p.team);
      }
      setLocalPlan(plan);
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

  const weeks = useMemo(() => Array.from(new Set(poolGames.map((g) => g.week))).sort((a, b) => a - b), [poolGames]);

  const currentWeek = useMemo(() => {
    const completedWeeks = poolGames.filter((g) => g.completed).map((g) => g.week);
    return completedWeeks.length > 0 ? Math.max(...completedWeeks) + 1 : weeks[0] ?? 1;
  }, [poolGames, weeks]);

  const weekDeadline = useMemo(() => {
    const currentWeekGames = poolGames.filter((g) => g.week === currentWeek);
    return computeWeekDeadline(currentWeekGames.map((g) => g.startDate));
  }, [poolGames, currentWeek]);

  const currentWeekPicks = picks.filter((p) => p.week === currentWeek);

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

    return { gameId: game.gameId, opponent, isHome, opponentConf, eligible, displaySpread, startDate: game.startDate };
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

  function handleCellClick(team: string, week: number, cell: GridCell) {
    if (!cell.eligible) return;
    const weekTeams = localPlan[week] ?? [];
    const alreadyPicked = weekTeams.includes(team);

    if (!alreadyPicked) {
      if (isTeamUsedElsewhere(team, week)) return;
      if (weekTeams.length >= PICKS_PER_WEEK) return;
    }

    const isCurrentWeek = week === currentWeek;

    if (isCurrentWeek) {
      const lockTime = computeGameLockTime(cell.startDate, weekDeadline);
      if (lockTime && new Date() >= lockTime) return;
      setSubmitError(null);
      setConfirmation(null);
      // A second click on the same team always cancels its queued action
      // net-to-nothing — remove it from the queue entirely, whatever mode
      // it was queued as. Without this, clicking a team then unclicking it
      // left BOTH the add and the remove sitting in the queue, showing an
      // inflated "Submit 4 picks" for what was really just 2 net changes.
      setPendingActions((prev) => {
        const mode = alreadyPicked ? "remove" : "add";
        const existingIdx = prev.findIndex((a) => a.team === team);
        if (existingIdx !== -1) {
          return prev.filter((_, i) => i !== existingIdx);
        }
        return [...prev, { team, gameId: cell.gameId, mode }];
      });
      setLocalPlan((prev) => {
        const next = { ...prev };
        const list = next[week] ?? [];
        next[week] = alreadyPicked ? list.filter((t) => t !== team) : [...list, team];
        return next;
      });
    } else {
      setLocalPlan((prev) => {
        const next = { ...prev };
        const list = next[week] ?? [];
        next[week] = alreadyPicked ? list.filter((t) => t !== team) : [...list, team];
        return next;
      });
    }
  }

  async function confirmPendingActions() {
    if (pendingActions.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setConfirmation(null);
    try {
      for (const action of pendingActions) {
        await submitPick(slug, currentWeek, action.gameId, action.team, action.mode === "remove");
      }
      // localPlan already reflects the final state from the optimistic
      // toggles as each cell was clicked, so it's the source of truth for
      // exactly what's now picked for this week.
      const finalTeams = localPlan[currentWeek] ?? [];
      setConfirmation({ week: currentWeek, teams: finalTeams });
      setPendingActions([]);
      await loadAll();
    } catch (err: any) {
      setSubmitError(err.message ?? "Failed to save picks");
      setPendingActions([]);
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  }

  function cancelPendingActions() {
    // Revert every queued optimistic local toggle.
    setLocalPlan((prev) => {
      const next = { ...prev };
      let list = next[currentWeek] ?? [];
      for (const action of pendingActions) {
        list = action.mode === "add" ? list.filter((t) => t !== action.team) : [...list, action.team];
      }
      next[currentWeek] = list;
      return next;
    });
    setPendingActions([]);
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

  const currentWeekTeams = localPlan[currentWeek] ?? [];

  return (
    <div style={{ padding: `1.5rem 1.25rem ${pendingActions.length > 0 ? "6rem" : "3rem"}`, maxWidth: 1150, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div className="eyebrow">Survivor Pool</div>
            <h1 className="title" style={{ fontSize: "1.8rem", margin: 0 }}>
              {entrant.name}'s Picks
            </h1>
          </div>
          <button
            onClick={() => {
              window.location.hash = `survivorpool-standings-${entrant.season}-viewer-${slug}`;
            }}
            style={{
              padding: "0.7rem 1.3rem",
              fontSize: "0.95rem",
              fontWeight: 700,
              borderRadius: 8,
              border: "1px solid var(--gold)",
              background: "var(--gold-dim)",
              color: "var(--chalk)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            View Full Pool Standings
          </button>
        </div>
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.9rem" }}>
          Week {currentWeek} is open for picks — overall deadline{" "}
          <strong style={{ color: "var(--chalk)" }}>{fmtDeadline(weekDeadline)}</strong>. Games
          earlier in the week lock at their own kickoff instead. You need{" "}
          <strong style={{ color: "var(--chalk)" }}>two</strong> picks for Week {currentWeek} —
          you have {currentWeekTeams.length} of {PICKS_PER_WEEK} so far. You can click ahead
          into future weeks too, just to plan — those clicks aren't submitted until that week
          becomes current.
        </p>
        {currentWeekPicks.length > 0 && (
          <p style={{ fontSize: "0.85rem" }}>
            Submitted for Week {currentWeek}:{" "}
            {currentWeekPicks.map((p, i) => (
              <span key={p.id}>
                <strong>{p.team}</strong>
                {i < currentWeekPicks.length - 1 ? ", " : ""}
              </span>
            ))}{" "}
            — you can still change these until they lock.
          </p>
        )}
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
        <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--chalk)" }}>Rules & conferences in this pool</summary>
        <div style={{ marginTop: "0.6rem", color: "var(--chalk-dim)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong style={{ color: "var(--chalk)" }}>Conferences in this pool: </strong>
            {conferences.length > 0 ? conferences.join(", ") : "none set yet"}
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>Two teams must be picked each week, from the conferences selected by the commissioner.</li>
            <li>Only games between two teams from those selected conferences are eligible picks.</li>
            <li>Conference Championship week is in play, same as any other week.</li>
            <li>You cannot use the same team twice across the season.</li>
            <li>If you have fewer than two eligible teams left to pick during Conference Championship week, you'll be eliminated.</li>
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
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Odds:</span>
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
          {hideUsed ? "Showing eligible only" : "Hide used teams"}
        </button>
      </div>

      {rowTeams.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>
          No games available yet — the admin hasn't synced this season's schedule, or hasn't set
          the pool's conferences yet.
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
                  <SortHeader
                    key={w}
                    label={`Week ${w}${w === currentWeek ? " (Pickable)" : ""}`}
                    sortKey={String(w)}
                    active={sortWeek === w}
                    dir={sortDir}
                    onClick={() => handleWeekHeaderClick(w)}
                    align="center"
                  />
                ))}
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

                      const isCurrentWeek = week === currentWeek;
                      const lockTime = isCurrentWeek ? computeGameLockTime(cell.startDate, weekDeadline) : null;
                      const locked = !!lockTime && new Date() >= lockTime;
                      const weekTeams = localPlan[week] ?? [];
                      const isPlanned = weekTeams.includes(team);
                      const weekFull = weekTeams.length >= PICKS_PER_WEEK && !isPlanned;
                      const usedElsewhere = !isPlanned && isTeamUsedElsewhere(team, week);
                      const clickable = cell.eligible && !usedElsewhere && !weekFull && !(isCurrentWeek && locked && !isPlanned);
                      const dimmed = !cell.eligible || (plannedTeams.has(team) && !isPlanned);

                      return (
                        <td
                          key={week}
                          onClick={() => clickable && handleCellClick(team, week, cell)}
                          style={{
                            textAlign: "center",
                            padding: "0.35rem 0.4rem",
                            borderBottom: "1px solid var(--hash)",
                            background: isPlanned ? "var(--gold-dim)" : isCurrentWeek ? "rgba(255,200,87,0.06)" : "transparent",
                            opacity: dimmed ? 0.4 : 1,
                            cursor: clickable ? "pointer" : "default",
                          }}
                          title={
                            !cell.eligible
                              ? "Opponent's conference isn't in the pool"
                              : locked && !isPlanned
                              ? "This game has already locked"
                              : usedElsewhere
                              ? "Already used/planned in another week"
                              : weekFull
                              ? "Both picks already made for this week"
                              : undefined
                          }
                        >
                          <div style={{ fontWeight: 600 }}>
                            {cell.isHome ? "" : "@"}
                            {cell.opponent}
                          </div>
                          <div style={{ fontSize: "0.68rem", opacity: 0.8 }}>{fmtSpread(cell.displaySpread)}</div>
                          {isCurrentWeek && locked && !isPlanned && <div style={{ fontSize: "0.62rem", color: "#a15c00" }}>Locked</div>}
                          {isPlanned && <div style={{ fontSize: "0.62rem", color: "var(--gold)" }}>{isCurrentWeek ? "Your pick" : "Planned"}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingActions.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: "1rem",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(560px, calc(100% - 2rem))",
            zIndex: 1000,
            padding: "0.9rem 1.1rem",
            background: "var(--turf-panel-2)",
            border: "1px solid var(--gold)",
            borderRadius: 8,
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <span>
            Week {currentWeek}:{" "}
            {pendingActions.map((a, i) => (
              <span key={i}>
                {a.mode === "add" ? "Pick " : "Remove "}
                <strong>{a.team}</strong>
                {i < pendingActions.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={confirmPendingActions} disabled={submitting}>
              {submitting ? "Saving…" : `Submit ${pendingActions.length} pick${pendingActions.length > 1 ? "s" : ""}`}
            </button>
            <button className="menu-btn" onClick={cancelPendingActions} disabled={submitting}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmation && (
        <div
          style={{
            marginTop: "1rem",
            padding: "1rem 1.1rem",
            background: "var(--gold-dim)",
            border: "1px solid var(--gold)",
            borderRadius: 8,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>✅ Picks confirmed for Week {confirmation.week}</div>
          <div style={{ marginBottom: "0.75rem" }}>
            {confirmation.teams.length > 0 ? (
              <>
                You've picked <strong>{confirmation.teams.join(" and ")}</strong> for Week {confirmation.week}.
              </>
            ) : (
              "No picks currently made for this week."
            )}
          </div>
          <button
            onClick={() => {
              window.location.hash = `survivorpool-standings-${entrant.season}-viewer-${slug}`;
            }}
          >
            View Standings (your picks visible)
          </button>
        </div>
      )}
      {submitError && <p style={{ color: "crimson", marginTop: "0.75rem" }}>{submitError}</p>}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        Click any week's header to sort teams by that week's spread (biggest favorite first).
        Each week needs two picks. Only Week {currentWeek} can actually be submitted — clicking
        ahead into other weeks just plans locally so you can see how your choices play out, and
        resets if you reload the page.
      </div>
    </div>
  );
}
