import { useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { fetchGameProjectionLocks, lockGameProjections, overrideGameProjectionLock, type LockCandidate } from "../lib/api/gameProjectionLocks";

// Deliberate, explicit, on-demand alternative to relying on a page
// visit to trigger useAutoLockProjections — Chris asked for this
// specifically instead of "just load Admin Matchups," since that
// depends on that page's own filtering/state (season, week, hide-
// completed, etc.) all lining up correctly, which is exactly the kind
// of fragility you don't want for something this consequential. This
// tool does its own independent, unfiltered fetch of every game in the
// season, computes with "latest" ratings (the best available stand-in
// for "at kickoff" for games whose true kickoff-moment ratings are
// already gone), and shows exactly what it locked before/after so
// there's no ambiguity about whether it worked.
export default function LockGamesPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [cutoff, setCutoff] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [games, setGames] = useState<GameWithLines[] | null>(null);
  const [existingLocks, setExistingLocks] = useState<Record<string, { my_away_spread: number | null; my_total: number | null; my_away_win_pct: number | null }>>({});
  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState(false);
  const [result, setResult] = useState<{ locked: LockCandidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ spread: string; total: string; winPct: string }>({ spread: "", total: "", winPct: "" });
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState<string | null>(null);

  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");
  const { rows: totalsEngineRows, loading: totalsLoading } = useGameTotalsEngine(season);

  const projTotalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsEngineRows]);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const [allGames, locks] = await Promise.all([fetchGamesWithLines(season), fetchGameProjectionLocks(season, Array.from({ length: 20 }, (_, i) => i))]);
      setGames(allGames);
      setExistingLocks(locks);
    } catch (err: any) {
      setError(err.message ?? "Failed to load games");
    } finally {
      setLoading(false);
    }
  }

  const cutoffMs = new Date(cutoff).getTime();
  const candidateGames = useMemo(() => {
    if (!games) return [];
    return games.filter((g) => {
      if (!g.start_date) return false;
      const kickoff = new Date(g.start_date).getTime();
      if (kickoff > cutoffMs) return false; // hasn't reached the cutoff — leave it live
      return !existingLocks[g.id]; // already locked — nothing to do
    });
  }, [games, cutoffMs, existingLocks]);

  async function handleLock() {
    setLocking(true);
    setError(null);
    try {
      const candidates: LockCandidate[] = candidateGames.map((g) => {
        const computed = computeRow(g, liveByTeam);
        const myTotal = projTotalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null;
        return {
          game_id: g.id,
          season: g.season,
          week: g.week,
          home_team: g.home_team,
          away_team: g.away_team,
          my_away_spread: computed.projAwaySpread,
          my_total: myTotal,
          my_away_win_pct: computed.projWinPct,
        };
      });
      await lockGameProjections(candidates);
      setResult({ locked: candidates });
      await handleLoad(); // refresh so the list reflects what's now locked
    } catch (err: any) {
      setError(err.message ?? "Failed to lock games");
    } finally {
      setLocking(false);
    }
  }

  const dataReady = games != null && !ratingsLoading && !totalsLoading;

  const lockedGames = useMemo(() => {
    if (!games) return [];
    return games.filter((g) => existingLocks[g.id]);
  }, [games, existingLocks]);

  function startEditing(gameId: string) {
    const lock = existingLocks[gameId];
    setEditingGameId(gameId);
    setCorrectionMsg(null);
    setEditValues({
      spread: lock?.my_away_spread != null ? String(lock.my_away_spread) : "",
      total: lock?.my_total != null ? String(lock.my_total) : "",
      winPct: lock?.my_away_win_pct != null ? String((lock.my_away_win_pct * 100).toFixed(1)) : "",
    });
  }

  async function saveCorrection(gameId: string) {
    setSavingCorrection(true);
    setError(null);
    try {
      const spread = editValues.spread.trim() === "" ? null : parseFloat(editValues.spread);
      const total = editValues.total.trim() === "" ? null : parseFloat(editValues.total);
      const winPct = editValues.winPct.trim() === "" ? null : parseFloat(editValues.winPct) / 100;
      await overrideGameProjectionLock(gameId, { my_away_spread: spread, my_total: total, my_away_win_pct: winPct });
      setExistingLocks((prev) => ({ ...prev, [gameId]: { my_away_spread: spread, my_total: total, my_away_win_pct: winPct } }));
      setEditingGameId(null);
      setCorrectionMsg("Correction saved.");
    } catch (err: any) {
      setError(err.message ?? "Failed to save correction");
    } finally {
      setSavingCorrection(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Lock Games</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0, maxWidth: 640 }}>
        Explicitly locks "my" spread, total, and win% for every game with a kickoff at or before the
        date/time below that doesn't already have a lock — using whatever "latest" ratings/totals say
        right now. Once locked, a game's projection can never change again on this site, no matter how
        many more times ratings get pushed afterward. Run this before pushing a rating update if
        you want to be certain nothing already underway can drift.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Season
          <br />
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <label>
          Lock everything with kickoff at or before
          <br />
          <input type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
        </label>
        <button onClick={handleLoad} disabled={loading}>
          {loading ? "Loading…" : "Load Games"}
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {games != null && (
        <>
          {!dataReady ? (
            <p>Loading ratings/totals…</p>
          ) : (
            <>
              <p style={{ fontSize: "0.9rem" }}>
                <strong>{candidateGames.length}</strong> game{candidateGames.length === 1 ? "" : "s"} would be locked (kicked off by the cutoff
                above, not already locked). {Object.keys(existingLocks).length} game{Object.keys(existingLocks).length === 1 ? "" : "s"} already
                locked this season.
              </p>

              {candidateGames.length > 0 && (
                <>
                  <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "1rem" }}>
                    <thead>
                      <tr>
                        <th className="th">Kickoff</th>
                        <th className="th">Game</th>
                        <th className="th th-right">My Line (would lock)</th>
                        <th className="th th-right">My Total (would lock)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidateGames.map((g) => {
                        const computed = computeRow(g, liveByTeam);
                        const myTotal = projTotalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null;
                        return (
                          <tr key={g.id}>
                            <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                              {g.start_date ? new Date(g.start_date).toLocaleString() : "–"}
                            </td>
                            <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                              <TeamLogo team={g.away_team} size={16} /> {g.away_team} @ <TeamLogo team={g.home_team} size={16} /> {g.home_team}
                            </td>
                            <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                              {computed.projAwaySpread != null ? computed.projAwaySpread.toFixed(1) : "–"}
                            </td>
                            <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                              {myTotal != null ? myTotal.toFixed(1) : "–"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button onClick={handleLock} disabled={locking}>
                    {locking ? "Locking…" : `Lock ${candidateGames.length} Game${candidateGames.length === 1 ? "" : "s"} Now`}
                  </button>
                </>
              )}

              {lockedGames.length > 0 && (
                <div style={{ marginTop: "2rem" }}>
                  <div className="section-label">
                    Already Locked ({lockedGames.length}) — correct any that captured the wrong number
                  </div>
                  <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0, maxWidth: 640 }}>
                    If a lock was written after ratings had already drifted from what you actually
                    posted before kickoff, fix it here — this overwrites the lock permanently with
                    whatever you enter, it isn't re-derived from ratings.
                  </p>
                  {correctionMsg && <p style={{ color: "#8fd39a" }}>{correctionMsg}</p>}
                  <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr>
                        <th className="th">Kickoff</th>
                        <th className="th">Game</th>
                        <th className="th th-right">Locked Line</th>
                        <th className="th th-right">Locked Total</th>
                        <th className="th th-right">Locked Win%</th>
                        <th className="th"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lockedGames.map((g) => {
                        const lock = existingLocks[g.id];
                        const isEditing = editingGameId === g.id;
                        return (
                          <tr key={g.id}>
                            <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                              {g.start_date ? new Date(g.start_date).toLocaleString() : "–"}
                            </td>
                            <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                              <TeamLogo team={g.away_team} size={16} /> {g.away_team} @ <TeamLogo team={g.home_team} size={16} /> {g.home_team}
                            </td>
                            {isEditing ? (
                              <>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={editValues.spread}
                                    onChange={(e) => setEditValues((v) => ({ ...v, spread: e.target.value }))}
                                    style={{ width: 70 }}
                                  />
                                </td>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={editValues.total}
                                    onChange={(e) => setEditValues((v) => ({ ...v, total: e.target.value }))}
                                    style={{ width: 70 }}
                                  />
                                </td>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={editValues.winPct}
                                    onChange={(e) => setEditValues((v) => ({ ...v, winPct: e.target.value }))}
                                    style={{ width: 60 }}
                                  />
                                  %
                                </td>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                                  <button onClick={() => saveCorrection(g.id)} disabled={savingCorrection} style={{ marginRight: "0.4rem" }}>
                                    {savingCorrection ? "Saving…" : "Save"}
                                  </button>
                                  <button onClick={() => setEditingGameId(null)} disabled={savingCorrection}>
                                    Cancel
                                  </button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                                  {lock?.my_away_spread != null ? lock.my_away_spread.toFixed(1) : "–"}
                                </td>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                                  {lock?.my_total != null ? lock.my_total.toFixed(1) : "–"}
                                </td>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                                  {lock?.my_away_win_pct != null ? `${(lock.my_away_win_pct * 100).toFixed(1)}%` : "–"}
                                </td>
                                <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                                  <button onClick={() => startEditing(g.id)}>Edit</button>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <div style={{ marginTop: "1.5rem" }}>
          <p style={{ color: "#8fd39a", fontWeight: 700 }}>Locked {result.locked.length} game(s):</p>
          <ul style={{ fontSize: "0.85rem" }}>
            {result.locked.map((c) => (
              <li key={c.game_id}>
                {c.away_team} @ {c.home_team} — line {c.my_away_spread?.toFixed(1) ?? "–"}, total {c.my_total?.toFixed(1) ?? "–"}, win%{" "}
                {c.my_away_win_pct != null ? `${(c.my_away_win_pct * 100).toFixed(1)}%` : "–"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
