import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import { CONFERENCES } from "../data/teams";
import { RATING_SYSTEMS, RATING_SYSTEMS_BY_KEY, CONSENSUS_INPUT_SYSTEMS, YC_INPUT_SYSTEMS } from "../lib/ratingSystems";
import type { WeeklyPowerRatingRow } from "../lib/api/ratingSystems";
import { matchTeamRows } from "../lib/teamNameMatch";
import { parseSheetCsv, parseMcilleceCsv, parseMasseyCsv, normalizeMasseyRows } from "../lib/ratingsCsv";
import { computeConglomeratedTable, conglomeratedRowsToSaveFormat, type ConglomeratedRow } from "../lib/ratingConglomerate";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines } from "../lib/api/gamesLines";
import { buildRatingsByTeam, computeMultiSystemRow, aggregateSystemPerformance, winPct } from "../lib/multiRatingMatchups";
import {
  fetchRatingPulls,
  fetchRatingWeights,
  saveRatingWeights,
  syncCfbdRatings,
  fetchPublishedSheetCsv,
  saveRatingRows,
  saveRatingWeek,
  fetchSavedRatingWeeks,
  fetchWeeklyPowerRatings,
  pushYcToLiveRatings,
  type RatingPullRow,
  type RatingSaveRow,
} from "../lib/api/ratingSystems";
import { fetchAvailableWeeks } from "../lib/api/weeklyStats";
import { WEEK_OPTIONS } from "../lib/weekOptions";

function fmtNum(v: number | null, digits = 2) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

// ---------------------------------------------------------------------
// Weight editor.
// ---------------------------------------------------------------------
function WeightsEditor({
  weights,
  onSave,
}: {
  weights: Record<string, number>;
  onSave: (w: Record<string, number>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>(weights);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => setDraft(weights), [weights]);

  const editableKeys = [...YC_INPUT_SYSTEMS]; // includes "consensus"

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await onSave(draft);
      setMsg("Weights saved.");
    } catch (err: any) {
      setMsg(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        YC weights (weighted average across every system below, including Consensus)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
        {editableKeys.map((key) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", fontSize: "0.75rem", gap: "0.2rem" }}>
            {RATING_SYSTEMS_BY_KEY[key]?.label ?? key}
            <input
              type="number"
              step="0.05"
              value={draft[key] ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: parseFloat(e.target.value) || 0 }))}
              style={{ width: 70 }}
            />
          </label>
        ))}
      </div>
      <button onClick={handleSave} disabled={saving} style={{ marginTop: "0.75rem" }}>
        {saving ? "Saving…" : "Save weights"}
      </button>
      {msg && <span style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>{msg}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Sync / upload controls.
// ---------------------------------------------------------------------
function SyncControls({ onDataChanged }: { onDataChanged: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<{ source: string; names: string[] } | null>(null);

  async function handleCfbdSync() {
    setBusy("cfbd");
    setLog(null);
    try {
      const data = await syncCfbdRatings(year);
      const parts = Object.entries(data.results).map(
        ([key, r]: [string, any]) => `${key}: ${r.error ? `error (${r.error})` : `${r.saved}/${r.fetched}`}`
      );
      setLog(`CFBD sync — ${parts.join(", ")}`);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "CFBD sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSheetSync() {
    setBusy("sheet");
    setLog(null);
    try {
      const csv = await fetchPublishedSheetCsv();
      const parsed = parseSheetCsv(csv);
      if (parsed.length === 0) {
        setLog("Parsed 0 rows from the sheet — check that it still has Team/Division columns with the expected headers.");
        return;
      }
      const { matched, unmatched: um } = matchTeamRows(parsed, (r) => r.team);
      const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: m.row.values }));
      const result = await saveRatingRows(rows);
      setLog(`Sheet pull — parsed ${parsed.length}, matched ${matched.length}, saved ${result.saved} values.`);
      if (um.length > 0) setUnmatched({ source: "Google Sheet", names: um.map((r) => r.team) });
      else setUnmatched(null);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "Sheet sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleMcilleceUpload(file: File) {
    setBusy("mcillece");
    setLog(null);
    try {
      const text = await file.text();
      const parsed = parseMcilleceCsv(text);
      if (parsed.length === 0) {
        setLog("Parsed 0 rows from this file — check that it still has \"Team\" and \"Power\" columns with those exact headers.");
        return;
      }
      const { matched, unmatched: um } = matchTeamRows(parsed, (r) => r.team);
      const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: { mcillece: m.row.value } }));
      const result = await saveRatingRows(rows);
      setLog(`McIllece upload — parsed ${parsed.length}, matched ${matched.length}, saved ${result.saved} teams.`);
      if (um.length > 0) setUnmatched({ source: "McIllece CSV", names: um.map((r) => r.team) });
      else setUnmatched(null);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "McIllece upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleMasseyUpload(file: File) {
    setBusy("massey");
    setLog(null);
    try {
      const text = await file.text();
      const raw = parseMasseyCsv(text);
      if (raw.length === 0) {
        setLog("Parsed 0 rows from this file — check that it still has \"Team\" and \"Pwr\" columns with those exact headers.");
        return;
      }
      const normalized = normalizeMasseyRows(raw);
      const { matched, unmatched: um } = matchTeamRows(normalized, (r) => r.team);
      const rows: RatingSaveRow[] = matched.map((m) => ({ team: m.team, values: { massey: m.row.value } }));
      const result = await saveRatingRows(rows);
      setLog(
        `Massey upload — parsed ${raw.length}, matched ${matched.length}, saved ${result.saved} teams (min-max normalized to [-55, +30], sign-flipped).`
      );
      if (um.length > 0) setUnmatched({ source: "Massey CSV", names: um.map((r) => r.team) });
      else setUnmatched(null);
      onDataChanged();
    } catch (err: any) {
      setLog(err.message ?? "Massey upload failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Pull / upload ratings
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <label>
          Year{" "}
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)} style={{ width: 80 }} />
        </label>
        <button onClick={handleCfbdSync} disabled={busy != null}>
          {busy === "cfbd" ? "Syncing…" : "Sync CFBD (FPI/SP+/SRS/Core/Elo)"}
        </button>
        <button onClick={handleSheetSync} disabled={busy != null}>
          {busy === "sheet" ? "Pulling…" : "Pull Google Sheet"}
        </button>
        <label className="menu-btn" style={{ cursor: "pointer" }}>
          {busy === "mcillece" ? "Uploading…" : "Upload McIllece CSV"}
          <input
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            disabled={busy != null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleMcilleceUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        <label className="menu-btn" style={{ cursor: "pointer" }}>
          {busy === "massey" ? "Uploading…" : "Upload Massey CSV"}
          <input
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            disabled={busy != null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleMasseyUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {log && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginBottom: 0 }}>{log}</p>}
      {unmatched && (
        <p style={{ fontSize: "0.78rem", color: "#a15c00", marginTop: "0.5rem" }}>
          {unmatched.source}: {unmatched.names.length} team name(s) couldn't be matched and were skipped —{" "}
          {unmatched.names.join(", ")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Per-system win % — same grading engine as the Rating Systems Matchups
// page's Results tab (Every Bet / Filtered Bet / NWFB), season-to-date.
// Shown here too, right next to the weight editor, since seeing each
// system's live win % is exactly what's useful for deciding weights —
// legitimately 0-0 (0%) until a week gets saved and games complete.
// ---------------------------------------------------------------------
function SystemPerformanceSummary({ season }: { season: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState<Record<string, ReturnType<typeof aggregateSystemPerformance>[string]> | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchGamesWithLines(season), fetchWeeklyPowerRatings(season)])
      .then(([games, weekly]) => {
        if (cancelled) return;
        const byWeek = new Map<number, typeof weekly>();
        for (const r of weekly) {
          const list = byWeek.get(r.week) ?? [];
          list.push(r);
          byWeek.set(r.week, list);
        }
        const ratingsByWeek = new Map<number, Record<string, Record<string, number>>>();
        for (const [wk, rowsForWeek] of byWeek) ratingsByWeek.set(wk, buildRatingsByTeam(rowsForWeek));

        const graded = [];
        for (const g of games) {
          const ratingsByTeam = ratingsByWeek.get(g.week);
          if (!ratingsByTeam) continue; // no saved snapshot for this game's week yet
          graded.push(computeMultiSystemRow(g, ratingsByTeam, liveByTeam));
        }
        setPerf(aggregateSystemPerformance(graded));
      })
      .catch((err) => !cancelled && setError(err.message ?? "Failed to load performance"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, liveByTeam]);

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Win % by system ({season} season-to-date)
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <th className="th">System</th>
                <th className="th th-right">Every Bet</th>
                <th className="th th-right">Filtered</th>
                <th className="th th-right">NWFB</th>
              </tr>
            </thead>
            <tbody>
              {RATING_SYSTEMS.map((s) => {
                const p = perf?.[s.key];
                const fmtRec = (r?: { w: number; l: number; push: number }) =>
                  r ? `${r.w}-${r.l}${r.push ? `-${r.push}` : ""} (${winPct(r).toFixed(1)}%)` : "0-0 (0.0%)";
                return (
                  <tr key={s.key}>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{s.label}</td>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRec(p?.everyBet)}
                    </td>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRec(p?.filteredBet)}
                    </td>
                    <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRec(p?.nwfb)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.5rem", marginBottom: 0 }}>
        Only weeks with a saved snapshot (Save As Week, below) count toward these records — everything reads 0-0
        until at least one week is saved and its games complete.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Save As Week.
// ---------------------------------------------------------------------
function SaveAsWeekControl({ rows, season }: { rows: ConglomeratedRow[]; season: number }) {
  const [week, setWeek] = useState(1);
  const [savedWeeks, setSavedWeeks] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchSavedRatingWeeks(season)
      .then(setSavedWeeks)
      .catch(() => {});
  }, [season, msg]);

  const willOverwrite = savedWeeks.includes(week);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const saveRows = conglomeratedRowsToSaveFormat(rows);
      const result = await saveRatingWeek(season, week, saveRows);
      setMsg(`Saved ${result.saved} values for ${season} week ${week}.`);
    } catch (err: any) {
      setMsg(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Save as week
      </div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Week{" "}
          <input type="number" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 70 }} />
        </label>
        <button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : willOverwrite ? `Overwrite week ${week}` : `Save as week ${week}`}
        </button>
        {savedWeeks.length > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
            Weeks already saved for {season}: {savedWeeks.join(", ")}
          </span>
        )}
      </div>
      {willOverwrite && !saving && (
        <p style={{ fontSize: "0.78rem", color: "#a15c00", marginTop: "0.4rem" }}>
          Week {week} already has a saved snapshot — saving again will overwrite it.
        </p>
      )}
      {msg && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Push YC to Live Ratings — writes YC into weekly_team_stats.rating (the
// same table/column Data Upload writes, and what every other page's
// "live rating" reads), for a chosen week. Only touches the rating (and
// recomputed rank) column on each row — every other field Data Upload
// populates (resume metrics, win totals, etc.) is left exactly as-is.
// Teams YC has no value for (mostly small FCS schools the CFBD systems
// don't cover) keep whatever rating they already had.
// ---------------------------------------------------------------------
function PushYcControl({ rows }: { rows: ConglomeratedRow[] }) {
  const [week, setWeek] = useState<string>("preseason");
  const [pushing, setPushing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchAvailableWeeks()
      .then((weeks) => {
        if (weeks.length > 0) setWeek(weeks[0]); // most recent by week_number
      })
      .catch(() => {});
  }, []);

  const ycCount = rows.filter((r) => r.yc != null).length;

  async function handlePush() {
    setPushing(true);
    setMsg(null);
    try {
      const teamRatings = rows.filter((r) => r.yc != null).map((r) => ({ team: r.team, rating: r.yc as number }));
      const result = await pushYcToLiveRatings(week, teamRatings);
      setMsg(`Pushed YC for ${result.matched} teams into "${week}" live ratings (${result.saved} rows saved).`);
    } catch (err: any) {
      setMsg(err.message ?? "Push failed");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.6rem" }}>
        Push YC to live ratings
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: 0, marginBottom: "0.6rem" }}>
        Writes YC's current values into the same "rating" field Data Upload writes, for every site page that shows a
        live power rating (Team Pages, Matchups, Survivor, Monte Carlo, etc.) — nothing else about that week's saved
        stats changes. {ycCount} of {rows.length} teams currently have a YC value.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <select value={week} onChange={(e) => setWeek(e.target.value)}>
          {WEEK_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <button onClick={handlePush} disabled={pushing || ycCount === 0}>
          {pushing ? "Pushing…" : `Push YC → ${week}`}
        </button>
      </div>
      {msg && <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: "0.4rem" }}>{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Conglomerated table.
// ---------------------------------------------------------------------
function ConglomeratedTable({ rows }: { rows: ConglomeratedRow[] }) {
  const [sortKey, setSortKey] = useState("yc");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc"); // negative-is-better -> ascending shows best first
  const [divFilter, setDivFilter] = useState<"all" | "FBS" | "FCS">("FBS");
  const [confFilter, setConfFilter] = useState("");

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = rows.filter((r) => {
    if (divFilter !== "all" && r.div !== divFilter) return false;
    if (confFilter && r.conf !== confFilter) return false;
    return true;
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a: any, b: any) => {
      const av = sortKey === "yc" || sortKey === "consensus" ? a[sortKey] : a.values[sortKey];
      const bv = sortKey === "yc" || sortKey === "consensus" ? b[sortKey] : b.values[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortDir]);

  const systemCols = RATING_SYSTEMS.filter((s) => s.key !== "yc" && s.key !== "consensus");

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {(["FBS", "FCS", "all"] as const).map((d) => (
          <button key={d} className={`mode-btn ${divFilter === d ? "mode-btn-active" : ""}`} onClick={() => setDivFilter(d)}>
            {d === "all" ? "All" : d}
          </button>
        ))}
        <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)}>
          <option value="">All conferences</option>
          {CONFERENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 650, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <SortHeader label="Div" sortKey="div" active={sortKey === "div"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="YC" sortKey="yc" active={sortKey === "yc"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader
                label="Consensus"
                sortKey="consensus"
                active={sortKey === "consensus"}
                dir={sortDir}
                onClick={handleSort}
                align="right"
              />
              {systemCols.map((s) => (
                <SortHeader key={s.key} label={s.label} sortKey={s.key} active={sortKey === s.key} dir={sortDir} onClick={handleSort} align="right" />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team}>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.div}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conf}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.team}</td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 700 }}>
                  {fmtNum(r.yc)}
                </td>
                <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                  {fmtNum(r.consensus)}
                </td>
                {systemCols.map((s) => (
                  <td key={s.key} style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtNum(r.values[s.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Power Ratings History — a verification view, not an editor. Lets you
// confirm the weekly "Save as week" snapshots (SaveAsWeekControl, above)
// are actually landing correctly: pick a season, pick one of its saved
// weeks, and see every rating system's value for every team that week,
// straight from weekly_power_ratings. Starts empty for any season with no
// saved weeks yet (2026 is the first season this was ever wired up).
// ---------------------------------------------------------------------
interface HistoryRow {
  team: string;
  conference: string | null;
  division: string | null;
  values: Record<string, number>;
}

function pivotHistoryRows(rows: WeeklyPowerRatingRow[]): { rows: HistoryRow[]; systemKeys: string[] } {
  const byTeam = new Map<string, HistoryRow>();
  const systemKeys = new Set<string>();
  for (const r of rows) {
    let row = byTeam.get(r.team);
    if (!row) {
      row = { team: r.team, conference: r.conference, division: r.division, values: {} };
      byTeam.set(r.team, row);
    }
    row.values[r.system_key] = r.value;
    systemKeys.add(r.system_key);
  }
  // Order columns by the canonical RATING_SYSTEMS registry order (falling
  // back to alphabetical for any key that isn't in the registry, e.g. an
  // old/retired system that still has historical rows).
  const known = RATING_SYSTEMS.map((s) => s.key).filter((k) => systemKeys.has(k));
  const unknown = Array.from(systemKeys).filter((k) => !RATING_SYSTEMS_BY_KEY[k]).sort();
  return { rows: Array.from(byTeam.values()), systemKeys: [...known, ...unknown] };
}

function PowerRatingsHistorySection() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [savedWeeks, setSavedWeeks] = useState<number[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [raw, setRaw] = useState<WeeklyPowerRatingRow[]>([]);
  const [loadingWeeks, setLoadingWeeks] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("team");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setLoadingWeeks(true);
    setError(null);
    setWeek(null);
    setRaw([]);
    fetchSavedRatingWeeks(season)
      .then((weeks) => {
        setSavedWeeks(weeks);
        if (weeks.length > 0) setWeek(weeks[weeks.length - 1]); // default to the most recent saved week
      })
      .catch((err) => setError(err.message ?? "Failed to load saved weeks"))
      .finally(() => setLoadingWeeks(false));
  }, [season]);

  useEffect(() => {
    if (week == null) return;
    setLoadingWeek(true);
    setError(null);
    fetchWeeklyPowerRatings(season, week)
      .then(setRaw)
      .catch((err) => setError(err.message ?? "Failed to load week"))
      .finally(() => setLoadingWeek(false));
  }, [season, week]);

  const { rows, systemKeys } = useMemo(() => pivotHistoryRows(raw), [raw]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a: any, b: any) => {
      const av = sortKey === "team" || sortKey === "conference" ? a[sortKey] : a.values[sortKey];
      const bv = sortKey === "team" || sortKey === "conference" ? b[sortKey] : b.values[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDir]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Power Ratings History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Read-only — a way to confirm each week's "Save as week" snapshot actually landed. Pick a
        season and one of its saved weeks to see every rating system's value for every team that
        week, straight from what's stored.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
          Season{" "}
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)}
            style={{ width: 90 }}
          />
        </label>
        <label style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
          Week{" "}
          <select
            value={week ?? ""}
            onChange={(e) => setWeek(e.target.value === "" ? null : parseInt(e.target.value, 10))}
            disabled={savedWeeks.length === 0}
          >
            {savedWeeks.length === 0 && <option value="">No saved weeks</option>}
            {savedWeeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        {loadingWeeks && <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Loading weeks…</span>}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loadingWeeks && savedWeeks.length === 0 && (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
          No saved snapshots for {season} yet — use "Save as week" on the Manage tab once ratings
          look right for a given week.
        </p>
      )}

      {week != null && (
        <>
          {loadingWeek ? (
            <p>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>No rows saved for week {week}.</p>
          ) : (
            <div className="table-scroll" style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 650 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
                <thead>
                  <tr>
                    <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                    <SortHeader
                      label="Conf"
                      sortKey="conference"
                      active={sortKey === "conference"}
                      dir={sortDir}
                      onClick={handleSort}
                    />
                    {systemKeys.map((key) => (
                      <SortHeader
                        key={key}
                        label={RATING_SYSTEMS_BY_KEY[key]?.label ?? key}
                        sortKey={key}
                        active={sortKey === key}
                        dir={sortDir}
                        onClick={handleSort}
                        align="right"
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.team}>
                      <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.team}</td>
                      <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conference ?? "–"}</td>
                      {systemKeys.map((key) => (
                        <td key={key} style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                          {fmtNum(r.values[key] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Top-level panel.
// ---------------------------------------------------------------------
export default function RatingSystemsPanel({ onBack }: { onBack: () => void }) {
  const [panelTab, setPanelTab] = useState<"manage" | "history">("manage");
  const [pulls, setPulls] = useState<RatingPullRow[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    setError(null);
    Promise.all([fetchRatingPulls(), fetchRatingWeights()])
      .then(([p, w]) => {
        setPulls(p);
        setWeights(w);
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  const conglomerated = useMemo(() => computeConglomeratedTable(pulls, weights), [pulls, weights]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button className={`mode-btn ${panelTab === "manage" ? "mode-btn-active" : ""}`} onClick={() => setPanelTab("manage")}>
          Manage
        </button>
        <button className={`mode-btn ${panelTab === "history" ? "mode-btn-active" : ""}`} onClick={() => setPanelTab("history")}>
          Power Ratings History
        </button>
      </div>

      {panelTab === "history" ? (
        <PowerRatingsHistorySection />
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>Rating Systems</h2>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
            Pull FPI/SP+/SRS/Core/Elo from CFBD, pull the published sheet, and upload McIllece/Massey weekly. YC is a
            customizable weighted average across every system (including Consensus, itself a simple average of the
            source systems). Save the current table to a specific week once you're happy with it.
          </p>

          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {loading ? (
            <p>Loading…</p>
          ) : (
            <>
              <SyncControls onDataChanged={loadAll} />
              <SystemPerformanceSummary season={new Date().getFullYear()} />
              <WeightsEditor weights={weights} onSave={async (w) => { await saveRatingWeights(w); loadAll(); }} />
              <SaveAsWeekControl rows={conglomerated} season={new Date().getFullYear()} />
              <PushYcControl rows={conglomerated} />
              <ConglomeratedTable rows={conglomerated} />
            </>
          )}
        </>
      )}
    </div>
  );
}
