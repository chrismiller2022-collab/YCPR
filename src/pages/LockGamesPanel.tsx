import { useMemo, useRef, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow, classOf } from "../lib/matchupsCompute";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { fetchGameProjectionLocks, lockGameProjections, overrideGameProjectionLock, type LockCandidate } from "../lib/api/gameProjectionLocks";

type ExistingLock = { my_away_spread: number | null; my_total: number | null; my_away_win_pct: number | null };
type DivBucket = "fbsVfbs" | "fcsVfcs" | "cross";
const DIV_LABELS: Record<DivBucket, string> = { fbsVfbs: "FBS vs FBS", fcsVfcs: "FCS vs FCS", cross: "Cross-Division (FBS vs FCS)" };

function divBucketOf(g: GameWithLines): DivBucket | null {
  const h = classOf(g, "home");
  const a = classOf(g, "away");
  if (h === "fbs" && a === "fbs") return "fbsVfbs";
  if (h === "fcs" && a === "fcs") return "fcsVfcs";
  if ((h === "fbs" && a === "fcs") || (h === "fcs" && a === "fbs")) return "cross";
  return null; // unclassified team on either side — omitted from all three buckets rather than silently misfiled into one
}

function groupByDivision<T extends GameWithLines>(games: T[]): Record<DivBucket, T[]> {
  const out: Record<DivBucket, T[]> = { fbsVfbs: [], fcsVfcs: [], cross: [] };
  for (const g of games) {
    const b = divBucketOf(g);
    if (b) out[b].push(g);
  }
  return out;
}

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
  const [existingLocks, setExistingLocks] = useState<Record<string, ExistingLock>>({});
  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState<DivBucket | "all" | null>(null);
  const [result, setResult] = useState<{ locked: LockCandidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ spread: string; total: string; winPct: string }>({ spread: "", total: "", winPct: "" });
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState<string | null>(null);

  // CSV correction import
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvResult, setCsvResult] = useState<{ applied: number; skipped: { row: number; reason: string }[] } | null>(null);

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

  const lockedGames = useMemo(() => {
    if (!games) return [];
    return games.filter((g) => existingLocks[g.id]);
  }, [games, existingLocks]);

  const candidatesByDiv = useMemo(() => groupByDivision(candidateGames), [candidateGames]);
  const lockedByDiv = useMemo(() => groupByDivision(lockedGames), [lockedGames]);

  function buildCandidates(list: GameWithLines[]): LockCandidate[] {
    return list
      .map((g) => {
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
      })
      // Never write a lock with null spread/win% — see
      // useAutoLockProjections.ts for why that's worse than no lock
      // at all. Total can be null on its own (that pipeline isn't
      // fully wired to this yet), but spread/win% must be real.
      .filter((c) => c.my_away_spread != null && c.my_away_win_pct != null);
  }

  async function handleLock(bucket: DivBucket | "all") {
    setLocking(bucket);
    setError(null);
    try {
      const list = bucket === "all" ? candidateGames : candidatesByDiv[bucket];
      const candidates = buildCandidates(list);
      await lockGameProjections(candidates);
      setResult({ locked: candidates });
      await handleLoad(); // refresh so the list reflects what's now locked
    } catch (err: any) {
      setError(err.message ?? "Failed to lock games");
    } finally {
      setLocking(null);
    }
  }

  const dataReady = games != null && !ratingsLoading && !totalsLoading;

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

  // CSV format: week,away_team,home_team,spread,total,win_pct
  // win_pct as a plain percentage number (45.2, not 0.452). A blank
  // cell for spread/total/win_pct means "leave that field as whatever
  // it's currently locked to" — this is for CORRECTING specific fields
  // in bulk, not for blindly overwriting all three on every row. Only
  // touches games that already have a lock (matched by week + team
  // names against what's currently loaded); unmatched or not-yet-
  // locked rows are reported, never silently created as a new lock —
  // that's what the "Lock Games Now" flow above is for.
  function parseCsv(text: string): string[][] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(",").map((cell) => cell.trim()));
  }

  async function handleCsvFile(file: File) {
    setCsvBusy(true);
    setCsvResult(null);
    setError(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const header = rows[0]?.map((h) => h.toLowerCase()) ?? [];
      const dataRows = header[0] === "week" ? rows.slice(1) : rows; // tolerate a missing header row
      const idx = {
        week: header.indexOf("week"),
        away: header.indexOf("away_team"),
        home: header.indexOf("home_team"),
        spread: header.indexOf("spread"),
        total: header.indexOf("total"),
        winPct: header.indexOf("win_pct"),
      };
      const useNamedColumns = idx.week >= 0 && idx.away >= 0 && idx.home >= 0;

      const byKey = new Map<string, GameWithLines>();
      for (const g of games ?? []) byKey.set(`${g.week}|${g.away_team.toLowerCase()}|${g.home_team.toLowerCase()}`, g);

      const skipped: { row: number; reason: string }[] = [];
      let applied = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const cols = dataRows[i];
        const rowNum = i + 2; // +1 for 0-index, +1 for the header row
        const week = useNamedColumns ? cols[idx.week] : cols[0];
        const away = useNamedColumns ? cols[idx.away] : cols[1];
        const home = useNamedColumns ? cols[idx.home] : cols[2];
        const spreadRaw = useNamedColumns ? cols[idx.spread] : cols[3];
        const totalRaw = useNamedColumns ? cols[idx.total] : cols[4];
        const winPctRaw = useNamedColumns ? cols[idx.winPct] : cols[5];

        if (!week || !away || !home) {
          skipped.push({ row: rowNum, reason: "Missing week/away_team/home_team" });
          continue;
        }
        const key = `${parseInt(week, 10)}|${away.toLowerCase()}|${home.toLowerCase()}`;
        const game = byKey.get(key);
        if (!game) {
          skipped.push({ row: rowNum, reason: `No synced game matches week ${week}, ${away} @ ${home}` });
          continue;
        }
        const existing = existingLocks[game.id];
        if (!existing) {
          skipped.push({ row: rowNum, reason: `${away} @ ${home} isn't locked yet — use "Lock Games Now" first, not the CSV` });
          continue;
        }
        const spread = spreadRaw?.trim() ? parseFloat(spreadRaw) : existing.my_away_spread;
        const total = totalRaw?.trim() ? parseFloat(totalRaw) : existing.my_total;
        const winPct = winPctRaw?.trim() ? parseFloat(winPctRaw) / 100 : existing.my_away_win_pct;

        await overrideGameProjectionLock(game.id, { my_away_spread: spread, my_total: total, my_away_win_pct: winPct });
        setExistingLocks((prev) => ({ ...prev, [game.id]: { my_away_spread: spread, my_total: total, my_away_win_pct: winPct } }));
        applied++;
      }

      setCsvResult({ applied, skipped });
    } catch (err: any) {
      setError(err.message ?? "Failed to process CSV");
    } finally {
      setCsvBusy(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  }

  function CandidateTable({ bucket, list }: { bucket: DivBucket; list: GameWithLines[] }) {
    if (list.length === 0) return null;
    return (
      <div style={{ marginBottom: "1.5rem" }}>
        <div className="section-label">{DIV_LABELS[bucket]} — Would Lock ({list.length})</div>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          <thead>
            <tr>
              <th className="th">Kickoff</th>
              <th className="th">Game</th>
              <th className="th th-right">My Line (would lock)</th>
              <th className="th th-right">My Total (would lock)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => {
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
        <button onClick={() => handleLock(bucket)} disabled={locking != null}>
          {locking === bucket ? "Locking…" : `Lock ${list.length} ${DIV_LABELS[bucket]} Game${list.length === 1 ? "" : "s"} Now`}
        </button>
      </div>
    );
  }

  function LockedTable({ bucket, list }: { bucket: DivBucket; list: GameWithLines[] }) {
    if (list.length === 0) return null;
    return (
      <div style={{ marginBottom: "2rem" }}>
        <div className="section-label">{DIV_LABELS[bucket]} — Already Locked ({list.length})</div>
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
            {list.map((g) => {
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
    );
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
                above, not already locked). {lockedGames.length} game{lockedGames.length === 1 ? "" : "s"} already locked this season.
              </p>

              {candidateGames.length > 0 && (
                <>
                  <div className="section-label">Would Lock — grouped by division</div>
                  {(["fbsVfbs", "cross", "fcsVfcs"] as DivBucket[]).map((b) => (
                    <CandidateTable key={b} bucket={b} list={candidatesByDiv[b]} />
                  ))}
                  <button onClick={() => handleLock("all")} disabled={locking != null} style={{ marginBottom: "1.5rem" }}>
                    {locking === "all" ? "Locking…" : `Lock All ${candidateGames.length} Games Now (every division at once)`}
                  </button>
                </>
              )}

              {lockedGames.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                  <div className="section-label">Already Locked — grouped by division, correct any that captured the wrong number</div>
                  <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0, maxWidth: 640 }}>
                    If a lock was written after ratings had already drifted from what you actually
                    posted before kickoff, fix it here (one at a time) or via CSV below (in bulk) —
                    either way this overwrites the lock permanently with whatever you enter, it isn't
                    re-derived from ratings.
                  </p>
                  {correctionMsg && <p style={{ color: "#8fd39a" }}>{correctionMsg}</p>}
                  {(["fbsVfbs", "cross", "fcsVfcs"] as DivBucket[]).map((b) => (
                    <LockedTable key={b} bucket={b} list={lockedByDiv[b]} />
                  ))}

                  <div style={{ padding: "1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8, maxWidth: 640 }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>Bulk-correct via CSV</div>
                    <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
                      Columns: <code>week,away_team,home_team,spread,total,win_pct</code> (header row optional,
                      win_pct as a plain percentage like 45.2, not 0.452). Leave a cell blank to keep that
                      field's current locked value — only fills in the columns you actually provide. Only
                      touches games that are already locked above; it never creates a new lock.
                    </p>
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      disabled={csvBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCsvFile(file);
                      }}
                    />
                    {csvBusy && <p style={{ fontSize: "0.82rem" }}>Processing…</p>}
                    {csvResult && (
                      <div style={{ marginTop: "0.6rem", fontSize: "0.82rem" }}>
                        <p style={{ color: "#8fd39a", margin: 0 }}>Applied {csvResult.applied} correction(s).</p>
                        {csvResult.skipped.length > 0 && (
                          <>
                            <p style={{ color: "#a15c00", margin: "0.4rem 0 0.2rem" }}>Skipped {csvResult.skipped.length} row(s):</p>
                            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                              {csvResult.skipped.map((s, i) => (
                                <li key={i}>
                                  Row {s.row}: {s.reason}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </div>
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
