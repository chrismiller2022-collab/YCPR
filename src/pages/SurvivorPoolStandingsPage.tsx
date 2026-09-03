import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchPoolSeasonGames,
  fetchAllSeasonPicks,
  computeWeekDeadline,
  gradePickResult,
  type PoolGameRow,
  type PickResult,
} from "../lib/api/survivorPoolPublic";
import { fetchSurvivorPoolSettings, fetchSurvivorPoolEntrants, type SurvivorPoolEntrant } from "../lib/api/survivorPoolAdmin";

export default function SurvivorPoolStandingsPage({
  season,
  viewerSlug,
  onHome,
}: {
  season: number;
  viewerSlug?: string | null;
  onHome?: () => void;
}) {
  const navigate = useNavigate();
  const [entrants, setEntrants] = useState<SurvivorPoolEntrant[]>([]);
  const [picks, setPicks] = useState<(any & { entrant_id: number })[]>([]);
  const [poolGames, setPoolGames] = useState<PoolGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const settings = await fetchSurvivorPoolSettings(season);
        const confs = settings?.conferences ?? [];
        const [e, p, g] = await Promise.all([
          fetchSurvivorPoolEntrants(season),
          fetchAllSeasonPicks(season),
          fetchPoolSeasonGames(season, confs),
        ]);
        setEntrants(e);
        setPicks(p);
        setPoolGames(g);
      } catch (err: any) {
        setError(err.message ?? "Failed to load standings");
      } finally {
        setLoading(false);
      }
    })();
  }, [season]);

  const gamesById = useMemo(() => new Map(poolGames.map((g) => [g.gameId, g])), [poolGames]);
  const weeks = useMemo(() => Array.from(new Set(poolGames.map((g) => g.week))).sort((a, b) => a - b), [poolGames]);

  // Each week's own reveal deadline — same Saturday-11am-ET (or earlier
  // kickoff) logic used for picking, just used here to gate visibility
  // instead of submission.
  const weekDeadlines = useMemo(() => {
    const map = new Map<number, Date | null>();
    for (const w of weeks) {
      const gamesInWeek = poolGames.filter((g) => g.week === w);
      map.set(w, computeWeekDeadline(gamesInWeek.map((g) => g.startDate)));
    }
    return map;
  }, [weeks, poolGames]);

  function isWeekRevealed(week: number): boolean {
    const deadline = weekDeadlines.get(week);
    return !deadline || new Date() >= deadline;
  }

  const viewerEntrantId = useMemo(() => {
    if (!viewerSlug) return null;
    return entrants.find((e) => e.slug === viewerSlug)?.id ?? null;
  }, [entrants, viewerSlug]);

  function isWeekRevealedFor(week: number, entrantId: number): boolean {
    if (viewerEntrantId != null && entrantId === viewerEntrantId) return true;
    return isWeekRevealed(week);
  }

  const picksByEntrant = useMemo(() => {
    const map = new Map<number, Map<number, any[]>>();
    for (const p of picks) {
      const inner = map.get(p.entrant_id) ?? new Map<number, any[]>();
      const list = inner.get(p.week) ?? [];
      list.push(p);
      inner.set(p.week, list);
      map.set(p.entrant_id, inner);
    }
    return map;
  }, [picks]);

  const PICKS_PER_WEEK = 2;

  // Alive/eliminated: eliminated the first revealed week where the
  // entrant doesn't have both required picks submitted, or where either
  // submitted pick lost.
  function entrantStatus(entrantId: number): { alive: boolean; eliminatedWeek: number | null } {
    const inner = picksByEntrant.get(entrantId) ?? new Map();
    for (const w of weeks) {
      // Deliberately the plain, non-viewer-aware check here — whether a
      // week actually counts toward elimination depends on its real
      // deadline having passed, the same for everyone. Using the
      // viewer-aware early-reveal here was the bug: it made every future,
      // not-yet-open week look "concluded" for the viewer's own row,
      // wrongly flagging missing picks for weeks that haven't even
      // opened yet as an elimination.
      if (!isWeekRevealed(w)) break;
      const weekPicks = inner.get(w) ?? [];
      if (weekPicks.length < PICKS_PER_WEEK) {
        return { alive: false, eliminatedWeek: w };
      }
      const anyLoss = weekPicks.some((p: any) => gradePickResult(p, gamesById) === "loss");
      if (anyLoss) {
        return { alive: false, eliminatedWeek: w };
      }
    }
    return { alive: true, eliminatedWeek: null };
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
        <p>Loading…</p>
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
    <div style={{ padding: "1.5rem 1.25rem 3rem", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <div className="eyebrow">Survivor Pool</div>
        <h1 className="title" style={{ fontSize: "1.8rem" }}>
          Standings — {season}
        </h1>
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.9rem" }}>
          A week's picks stay hidden for everyone until that week's own deadline passes — at
          that point nothing can be changed anyway, so revealing them can't give anyone an
          edge.
          {viewerEntrantId != null && " Your own picks are shown early here, before the deadline — only yours."}
        </p>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {viewerSlug && (
            <button
              className="menu-btn"
              onClick={() => {
                navigate(`/survivor-pool/${viewerSlug}`);
              }}
              style={{ fontSize: "0.82rem" }}
            >
              ← Back to my picks
            </button>
          )}
          {onHome && (
            <button className="menu-btn" onClick={onHome} style={{ fontSize: "0.82rem" }}>
              ← Back to main site
            </button>
          )}
        </div>
      </div>

      {entrants.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No entrants in this pool yet.</p>
      ) : (
        <div className="table-scroll">
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
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
                    minWidth: 140,
                    borderBottom: "1px solid var(--hash)",
                  }}
                >
                  Entrant
                </th>
                <th style={{ padding: "0.5rem 0.6rem", textAlign: "center", borderBottom: "1px solid var(--hash)" }}>Status</th>
                {weeks.map((w) => (
                  <th
                    key={w}
                    style={{
                      padding: "0.4rem 0.5rem",
                      textAlign: "center",
                      minWidth: 90,
                      borderBottom: "1px solid var(--hash)",
                    }}
                  >
                    Wk {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entrants.map((entrant) => {
                const status = entrantStatus(entrant.id);
                const inner = picksByEntrant.get(entrant.id) ?? new Map();
                return (
                  <tr key={entrant.id} style={{ background: entrant.id === viewerEntrantId ? "rgba(255,200,87,0.06)" : undefined }}>
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        background: "var(--turf-panel)",
                        padding: "0.4rem 0.75rem",
                        borderBottom: "1px solid var(--hash)",
                        whiteSpace: "nowrap",
                        opacity: status.alive ? 1 : 0.55,
                        textDecoration: status.alive ? "none" : "line-through",
                      }}
                    >
                      {entrant.name}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "center" }}>
                      {status.alive ? (
                        <span style={{ color: "#8fd39a" }}>Alive</span>
                      ) : (
                        <span style={{ color: "#c45c52" }}>Out (Wk {status.eliminatedWeek})</span>
                      )}
                    </td>
                    {weeks.map((w) => {
                      const revealed = isWeekRevealedFor(w, entrant.id);
                      const weekPicks: any[] = inner.get(w) ?? [];

                      if (!revealed) {
                        return (
                          <td
                            key={w}
                            style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "center", color: "var(--chalk-dim)" }}
                          >
                            –
                          </td>
                        );
                      }
                      if (weekPicks.length === 0) {
                        return (
                          <td
                            key={w}
                            style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "center", color: "var(--chalk-dim)" }}
                          >
                            No picks
                          </td>
                        );
                      }
                      return (
                        <td key={w} style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "center" }}>
                          {weekPicks.map((pick, i) => {
                            const result: PickResult = gradePickResult(pick, gamesById);
                            return (
                              <div
                                key={i}
                                style={{
                                  color: result === "loss" ? "#c45c52" : result === "win" ? "#8fd39a" : undefined,
                                  marginBottom: i < weekPicks.length - 1 ? "0.2rem" : 0,
                                }}
                              >
                                {pick.team}
                                {result !== "pending" && (
                                  <span style={{ fontSize: "0.68rem", marginLeft: "0.2rem" }}>{result === "win" ? "✅" : "❌"}</span>
                                )}
                              </div>
                            );
                          })}
                          {weekPicks.length < 2 && <div style={{ fontSize: "0.68rem", color: "#a15c00" }}>(missing 1)</div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        An entrant is eliminated the first week their pick loses, or the first past-deadline
        week with no pick submitted at all.
      </div>
    </div>
  );
}
