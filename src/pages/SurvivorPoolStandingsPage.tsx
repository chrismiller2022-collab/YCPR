import { useEffect, useMemo, useState } from "react";
import {
  fetchPoolSeasonGames,
  fetchAllSeasonPicks,
  computeWeekDeadline,
  gradePickResult,
  type PoolGameRow,
  type PickResult,
} from "../lib/api/survivorPoolPublic";
import { fetchSurvivorPoolSettings, fetchSurvivorPoolEntrants, type SurvivorPoolEntrant } from "../lib/api/survivorPoolAdmin";

export default function SurvivorPoolStandingsPage({ season, onHome }: { season: number; onHome?: () => void }) {
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

  const picksByEntrant = useMemo(() => {
    const map = new Map<number, Map<number, any>>();
    for (const p of picks) {
      const inner = map.get(p.entrant_id) ?? new Map<number, any>();
      inner.set(p.week, p);
      map.set(p.entrant_id, inner);
    }
    return map;
  }, [picks]);

  // Alive/eliminated: eliminated the first week a submitted pick lost, or
  // the first past-deadline week with no pick submitted at all.
  function entrantStatus(entrantId: number): { alive: boolean; eliminatedWeek: number | null } {
    const inner = picksByEntrant.get(entrantId) ?? new Map();
    for (const w of weeks) {
      if (!isWeekRevealed(w)) break; // future/undecided weeks don't count yet
      const pick = inner.get(w);
      if (!pick) {
        return { alive: false, eliminatedWeek: w };
      }
      const result = gradePickResult(pick, gamesById);
      if (result === "loss") {
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

      {entrants.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No entrants in this pool yet.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
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
                  <tr key={entrant.id}>
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
                      const revealed = isWeekRevealed(w);
                      const pick = inner.get(w);

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
                      if (!pick) {
                        return (
                          <td
                            key={w}
                            style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "center", color: "var(--chalk-dim)" }}
                          >
                            No pick
                          </td>
                        );
                      }
                      const result: PickResult = gradePickResult(pick, gamesById);
                      return (
                        <td
                          key={w}
                          style={{
                            padding: "0.4rem 0.5rem",
                            borderBottom: "1px solid var(--hash)",
                            textAlign: "center",
                            color: result === "loss" ? "#c45c52" : result === "win" ? "#8fd39a" : undefined,
                          }}
                        >
                          {pick.team}
                          {result !== "pending" && <div style={{ fontSize: "0.68rem" }}>{result === "win" ? "✅" : "❌"}</div>}
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
