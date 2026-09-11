import { useMemo, useRef, useState } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLink from "../components/TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow, classOf } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import {
  fetchGameProjectionLocks,
  lockGameProjections,
  overrideGameProjectionLock,
  type LockCandidate,
  type LockProjectionsResult,
} from "../lib/api/gameProjectionLocks";

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

// Freezes an ENTIRE week's projections (spread, win%, total) in one
// deliberate, explicit action — the replacement for the old
// useAutoLockProjections (removed entirely; it locked whatever a page
// happened to compute at whatever moment it next rendered after
// kickoff, which is how Week 1 got frozen with numbers that already
// disagreed with the pregame report before anything else ever touched
// them). This tool uses WEEK-ACCURATE ratings (useWeekAccurateRatings,
// scoped to exactly the week being frozen) rather than "latest" — the
// same fix already applied to Admin/Public Matchups — so freezing Week 1
// always uses Week 1's own ratings snapshot, never whatever's live at
// the moment you click the button.
//
// Team totals and moneylines are NOT stored separately: they're pure
// functions of (my_total, my_away_spread) and (my_away_win_pct)
// respectively (see splitTeamTotal / fairMoneylineFromWinPct), so
// locking these three fields is sufficient — every consumer re-derives
// team totals/moneylines from the locked values instead of drifting
// independently.
export default function LockGamesPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [games, setGames] = useState<GameWithLines[] | null>(null);
  const [existingLocks, setExistingLocks] = useState<Record<string, ExistingLock>>({});
  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState<DivBucket | "all" | null>(null);
  const [result, setResult] = useState<(LockProjectionsResult & { missing: { game: GameWithLines; reason: string }[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ spread: string; total: string; winPct: string }>({ spread: "", total: "", winPct: "" });
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState<string | null>(null);

  // CSV correction import
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvResult, setCsvResult] = useState<{ applied: number; skipped: { row: number; reason: string }[] } | null>(null);

  const currentSeason = new Date().getFullYear();
  const { byWeek: ratingsByWeek, loading: ratingsLoading } = useWeekAccurateRatings(season, [week], currentSeason);
  const ratings = ratingsByWeek[week] ?? {};
  const { rows: totalsEngineRows, loading: totalsLoading } = useGameTotalsEngine(season);

  const projTotalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.game.week === week && r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsEngineRows, week]);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const [allGames, locks] = await Promise.all([fetchGamesWithLines(season, week), fetchGameProjectionLocks(season, [week])]);
      setGames(allGames);
      setExistingLocks(locks);
    } catch (err: any) {
      setError(err.message ?? "Failed to load games");
    } finally {
      setLoading(false);
    }
  }

  const weekGames = useMemo(() => (games ?? []).filter((g) => g.week === week), [games, week]);

  const candidateGames = useMemo(() => weekGames.filter((g) => !existingLocks[g.id]), [weekGames, existingLocks]);
  const lockedGames = useMemo(() => weekGames.filter((g) => existingLocks[g.id]), [weekGames, existingLocks]);

  const candidatesByDiv = useMemo(() => groupByDivision(candidateGames), [candidateGames]);
  const lockedByDiv = useMemo(() => groupByDivision(lockedGames), [lockedGames]);

  function buildCandidates(list: GameWithLines[]): { ready: LockCandidate[]; missing: { game: GameWithLines; reason: string }[] } {
    const ready: LockCandidate[] = [];
    const missing: { game: GameWithLines; reason: string }[] = [];
    for (const g of list) {
      const computed = computeRow(g, ratings);
      const myTotal = projTotalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null;
      // Never write a lock with null spread/win% — that's strictly worse
      // than no lock at all: it provides zero protection (computeRow
      // falls through to live computation when a lock field is null) AND
      // blocks any future freeze attempt (the write is append-only, so a
      // broken row sits there permanently until someone notices and
      // manually deletes it).
      if (computed.projAwaySpread == null || computed.projWinPct == null) {
        missing.push({ game: g, reason: !ratings[g.away_team] || !ratings[g.home_team] ? "no rating for one or both teams this week" : "couldn't compute" });
        continue;
      }
      ready.push({
        game_id: g.id,
        season: g.season,
        week: g.week,
        home_team: g.home_team,
        away_team: g.away_team,
        my_away_spread: computed.projAwaySpread,
        my_total: myTotal,
        my_away_win_pct: computed.projWinPct,
      });
    }
    return { ready, missing };
  }

  async function handleLock(bucket: DivBucket | "all") {
    setLocking(bucket);
    setError(null);
    try {
      const list = bucket === "all" ? candidateGames : candidatesByDiv[bucket];
      const { ready, missing } = buildCandidates(list);
      const lockResult = await lockGameProjections(ready);
      setResult({ ...lockResult, missing });
      await handleLoad(); // refresh so the list reflects what's now locked
    } catch (err: any) {
      setError(err.message ?? "Failed to freeze week");
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

  const [fillingTotals, setFillingTotals] = useState(false);
  const [fillTotalsMsg, setFillTotalsMsg] = useState<string | null>(null);

  // Backfills a null "Frozen Total" (the old auto-lock's known gap — it
  // never reliably captured this field) with whatever the totals engine
  // currently computes, WITHOUT touching an already-frozen spread/win%.
  // Only meaningful as a stand-in for the true pregame value if the
  // model's inputs haven't drifted since — e.g. right after temporarily
  // clearing team_season_stats for the season being backfilled, per the
  // "does this look like the true pregame total" discussion in chat.
  async function fillTotalFromCurrent(gameId: string) {
    const lock = existingLocks[gameId];
    const game = (games ?? []).find((g) => g.id === gameId);
    if (!lock || !game) return;
    const liveTotal = projTotalByGame.get(`${game.week}|${game.home_team}|${game.away_team}`) ?? null;
    if (liveTotal == null) return;
    await overrideGameProjectionLock(gameId, { my_away_spread: lock.my_away_spread, my_total: liveTotal, my_away_win_pct: lock.my_away_win_pct });
    setExistingLocks((prev) => ({ ...prev, [gameId]: { ...prev[gameId], my_total: liveTotal } }));
  }

  async function fillAllMissingTotals() {
    setFillingTotals(true);
    setFillTotalsMsg(null);
    try {
      const targets = lockedGames.filter((g) => existingLocks[g.id]?.my_total == null);
      let filled = 0;
      let stillMissing = 0;
      for (const g of targets) {
        const liveTotal = projTotalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null;
        if (liveTotal == null) {
          stillMissing++;
          continue;
        }
        const lock = existingLocks[g.id];
        await overrideGameProjectionLock(g.id, { my_away_spread: lock.my_away_spread, my_total: liveTotal, my_away_win_pct: lock.my_away_win_pct });
        setExistingLocks((prev) => ({ ...prev, [g.id]: { ...prev[g.id], my_total: liveTotal } }));
        filled++;
      }
      setFillTotalsMsg(`Filled ${filled} missing total${filled === 1 ? "" : "s"}.${stillMissing > 0 ? ` ${stillMissing} still have no current total to pull from.` : ""}`);
    } catch (err: any) {
      setFillTotalsMsg(err.message ?? "Failed to fill totals");
    } finally {
      setFillingTotals(false);
    }
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
  // that's what "Freeze Week Now" above is for.
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
        const rowWeek = useNamedColumns ? cols[idx.week] : cols[0];
        const away = useNamedColumns ? cols[idx.away] : cols[1];
        const home = useNamedColumns ? cols[idx.home] : cols[2];
        const spreadRaw = useNamedColumns ? cols[idx.spread] : cols[3];
        const totalRaw = useNamedColumns ? cols[idx.total] : cols[4];
        const winPctRaw = useNamedColumns ? cols[idx.winPct] : cols[5];

        if (!rowWeek || !away || !home) {
          skipped.push({ row: rowNum, reason: "Missing week/away_team/home_team" });
          continue;
        }
        const key = `${parseInt(rowWeek, 10)}|${away.toLowerCase()}|${home.toLowerCase()}`;
        const game = byKey.get(key);
        if (!game) {
          skipped.push({ row: rowNum, reason: `No synced game matches week ${rowWeek}, ${away} @ ${home} (make sure you've loaded that week above)` });
          continue;
        }
        const existing = existingLocks[game.id];
        if (!existing) {
          skipped.push({ row: rowNum, reason: `${away} @ ${home} isn't locked yet — use "Freeze Week Now" first, not the CSV` });
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
        <div className="section-label">{DIV_LABELS[bucket]} — Would Freeze ({list.length})</div>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          <thead>
            <tr>
              <th className="th">Kickoff</th>
              <th className="th">Game</th>
              <th className="th th-right">My Line (would freeze)</th>
              <th className="th th-right">My Total (would freeze)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => {
              const computed = computeRow(g, ratings);
              const myTotal = projTotalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null;
              return (
                <tr key={g.id}>
                  <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                    {g.start_date ? new Date(g.start_date).toLocaleString() : "–"}
                  </td>
                  <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>
                    <TeamLink team={g.away_team} size={16} /> @ <TeamLink team={g.home_team} size={16} />
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
          {locking === bucket ? "Freezing…" : `Freeze ${list.length} ${DIV_LABELS[bucket]} Game${list.length === 1 ? "" : "s"} Now`}
        </button>
      </div>
    );
  }

  function LockedTable({ bucket, list }: { bucket: DivBucket; list: GameWithLines[] }) {
    if (list.length === 0) return null;
    return (
      <div style={{ marginBottom: "2rem" }}>
        <div className="section-label">{DIV_LABELS[bucket]} — Already Frozen ({list.length})</div>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr>
              <th className="th">Kickoff</th>
              <th className="th">Game</th>
              <th className="th th-right">Frozen Line</th>
              <th className="th th-right">Frozen Total</th>
              <th className="th th-right">Frozen Win%</th>
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
                    <TeamLink team={g.away_team} size={16} /> @ <TeamLink team={g.home_team} size={16} />
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
                        {lock?.my_total == null && projTotalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) != null && (
                          <button onClick={() => fillTotalFromCurrent(g.id)} style={{ marginLeft: "0.4rem" }} title="Fill from the current total model">
                            Fill Total
                          </button>
                        )}
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
      <h2 style={{ marginTop: 0 }}>Freeze Week</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0, maxWidth: 640 }}>
        Freezes "my" spread, total, and win% for every game in the selected week that doesn't already
        have one — using THAT WEEK'S OWN ratings snapshot, never "latest." Team totals and moneylines
        aren't stored separately; every page derives them from these three frozen numbers, so nothing
        can drift independently. Do this once, before you finalize picks/reports for the week — not
        after games have already started. Vegas/closing lines are never touched by this and keep
        updating normally.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Season
          <br />
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <label>
          Week
          <br />
          <input type="number" min={1} max={20} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)} style={{ width: 70 }} />
        </label>
        <button onClick={handleLoad} disabled={loading}>
          {loading ? "Loading…" : "Load Week"}
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
                <strong>{candidateGames.length}</strong> game{candidateGames.length === 1 ? "" : "s"} in Week {week} would be frozen.{" "}
                {lockedGames.length} game{lockedGames.length === 1 ? "" : "s"} already frozen.
              </p>

              {candidateGames.length > 0 && (
                <>
                  <div className="section-label">Would Freeze — grouped by division</div>
                  {(["fbsVfbs", "cross", "fcsVfcs"] as DivBucket[]).map((b) => (
                    <CandidateTable key={b} bucket={b} list={candidatesByDiv[b]} />
                  ))}
                  <button onClick={() => handleLock("all")} disabled={locking != null} style={{ marginBottom: "1.5rem" }}>
                    {locking === "all" ? "Freezing…" : `Freeze All ${candidateGames.length} Week ${week} Games Now`}
                  </button>
                </>
              )}

              {lockedGames.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                  <div className="section-label">Already Frozen — grouped by division, correct any that captured the wrong number</div>
                  <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0, maxWidth: 640 }}>
                    Fix a wrong freeze here (one at a time) or via CSV below (in bulk) — either way this
                    overwrites the frozen value permanently with whatever you enter, it isn't re-derived
                    from ratings.
                  </p>
                  {correctionMsg && <p style={{ color: "#8fd39a" }}>{correctionMsg}</p>}
                  {lockedGames.some((g) => existingLocks[g.id]?.my_total == null) && (
                    <div style={{ marginBottom: "1rem" }}>
                      <button onClick={fillAllMissingTotals} disabled={fillingTotals}>
                        {fillingTotals ? "Filling…" : "Fill All Missing Totals From Current Model"}
                      </button>
                      {fillTotalsMsg && <span style={{ marginLeft: "0.6rem", color: "#8fd39a" }}>{fillTotalsMsg}</span>}
                    </div>
                  )}
                  {(["fbsVfbs", "cross", "fcsVfcs"] as DivBucket[]).map((b) => (
                    <LockedTable key={b} bucket={b} list={lockedByDiv[b]} />
                  ))}

                  <div style={{ padding: "1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8, maxWidth: 640 }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>Bulk-correct via CSV</div>
                    <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
                      Columns: <code>week,away_team,home_team,spread,total,win_pct</code> (header row optional,
                      win_pct as a plain percentage like 45.2, not 0.452). Leave a cell blank to keep that
                      field's current frozen value — only fills in the columns you actually provide. Only
                      touches games that are already frozen above; it never creates a new freeze.
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
        <div style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid var(--hash)", borderRadius: 8, maxWidth: 700 }}>
          <p style={{ color: "#8fd39a", fontWeight: 700, margin: 0 }}>
            Froze {result.locked} new game{result.locked === 1 ? "" : "s"} for Week {week}.
          </p>
          {result.alreadyLocked.length > 0 && (
            <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem" }}>
              {result.alreadyLocked.length} of the submitted game{result.alreadyLocked.length === 1 ? "" : "s"} were already frozen
              and left untouched.
            </p>
          )}
          {result.missing.length > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <p style={{ color: "#e0a030", fontWeight: 700, margin: 0, fontSize: "0.85rem" }}>
                {result.missing.length} game{result.missing.length === 1 ? "" : "s"} could NOT be frozen —
                not silently skipped, flagging so you know these still need attention:
              </p>
              <ul style={{ fontSize: "0.82rem", margin: "0.3rem 0 0" }}>
                {result.missing.map((m) => (
                  <li key={m.game.id}>
                    {m.game.away_team} @ {m.game.home_team} — {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
