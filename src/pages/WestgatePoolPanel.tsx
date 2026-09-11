import { useEffect, useMemo, useRef, useState } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import TeamLink from "../components/TeamLink";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchWestgateWeek, fetchWestgateSeasonRows, gradeWestgatePick, westgatePoints, WESTGATE_PICK_LIMIT, type WestgateRow } from "../lib/api/westgatePool";
import {
  fetchWestgateStandings,
  fetchWestgatePoolSettings,
  saveWestgatePoolSettings,
  importWestgateStandings,
  computePayoutPctByRank,
  projectPayout,
  type WestgateStandingRow,
  type WestgatePoolSettings,
} from "../lib/api/westgateStandings";
import { WESTGATE_STANDINGS_CSV_TEMPLATE, parseWestgateStandingsCsv } from "../lib/api/westgateStandingsImport";
import { WESTGATE_LINES_CSV_TEMPLATE, parseWestgateLinesCsv, importWestgateLines, type WestgateLinesImportResult } from "../lib/api/westgateLinesImport";

const POOL_URL =
  "https://www.westgateresorts.com/hotels/nevada/las-vegas/westgate-las-vegas-resort-casino/casino/2026-supercontest-college-card/";
// The reference season whose final cash prizes seed the payout-%-by-rank
// table — last year's full field/payout structure, scaled onto this
// year's (typically smaller) entry count.
const REFERENCE_SEASON = 2025;

async function westgateSave(season: number, week: number, rows: WestgateRow[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password,
      pool: "westgate",
      action: "saveWeek",
      season,
      week,
      rows: rows.map((r) => ({ game_id: r.game_id, westgate_line: r.westgate_line, picked_side: r.picked_side })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

function fmt(v: number | null, decimals = 1) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(decimals)}`;
}

function fmtAbs(v: number | null, decimals = 2) {
  if (v == null) return "–";
  return Math.abs(v).toFixed(decimals);
}

function fmtMoney(v: number) {
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------
// Lines CSV upload — converts the contest's own PDF card into a line per
// game, without touching whatever's already picked.
// ---------------------------------------------------------------------
function LinesCsvImport({ season, week, onImported }: { season: number; week: number; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<WestgateLinesImportResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob([WESTGATE_LINES_CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "westgate-lines-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCheck(csvText: string) {
    setText(csvText);
    setChecking(true);
    setMsg(null);
    try {
      setResult(await parseWestgateLinesCsv(season, week, csvText));
    } catch (err: any) {
      setMsg(err.message ?? "Failed to parse CSV");
    } finally {
      setChecking(false);
    }
  }

  async function handleFile(f: File) {
    const csvText = await f.text();
    await handleCheck(csvText);
  }

  async function handleImport() {
    if (!result || result.resolved.length === 0) return;
    setImporting(true);
    setMsg(null);
    try {
      const { imported } = await importWestgateLines(season, week, result.resolved);
      setMsg(`Imported ${imported} line${imported === 1 ? "" : "s"}.`);
      setResult(null);
      setText("");
      onImported();
    } catch (err: any) {
      setMsg(err.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  }

  if (!open) {
    return (
      <button className="menu-btn" onClick={() => setOpen(true)}>
        Upload Lines CSV
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.75rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <strong>Upload Westgate lines for week {week}</strong>
        <button className="menu-btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
        away_team, home_team, westgate_line (away-perspective — negative means away favored). Only
        the line is touched; any pick already saved for that game is left alone.{" "}
        <button className="menu-btn" style={{ padding: "0.1rem 0.4rem" }} onClick={downloadTemplate}>
          Download template
        </button>
      </p>
      <input ref={fileRef} type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", margin: "0.5rem 0 0.2rem" }}>...or paste CSV text:</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste CSV here…"
        rows={6}
        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.78rem" }}
      />
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
        <button onClick={() => handleCheck(text)} disabled={checking || text.trim() === ""}>
          {checking ? "Checking…" : "Check"}
        </button>
        {result && (
          <button onClick={handleImport} disabled={importing || result.resolved.length === 0}>
            {importing ? "Importing…" : `Import ${result.resolved.length} line${result.resolved.length === 1 ? "" : "s"}`}
          </button>
        )}
        {msg && <span style={{ color: msg.startsWith("Imported") ? "green" : "#e0a030" }}>{msg}</span>}
      </div>
      {result && result.errors.length > 0 && (
        <div style={{ marginTop: "0.5rem", color: "#e0a030", fontSize: "0.78rem" }}>
          {result.errors.length} row{result.errors.length === 1 ? "" : "s"} couldn't be resolved:
          <ul>
            {result.errors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Standings tab — uploaded contest leaderboard, merged with our own live
// record/points, payouts scaled off REFERENCE_SEASON's cash prizes.
// ---------------------------------------------------------------------
function StandingsTab({ season }: { season: number }) {
  const [standings, setStandings] = useState<WestgateStandingRow[]>([]);
  const [reference, setReference] = useState<WestgateStandingRow[]>([]);
  const [settings, setSettings] = useState<WestgatePoolSettings>({ season, entries: 774, entry_fee: 500 });
  const [entriesInput, setEntriesInput] = useState("774");
  const [feeInput, setFeeInput] = useState("500");
  const [savingSettings, setSavingSettings] = useState(false);
  const [myRows, setMyRows] = useState<WestgateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [text, setText] = useState("");
  const [checkResult, setCheckResult] = useState<ReturnType<typeof parseWestgateStandingsCsv> | null>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWestgateStandings(season),
      season === REFERENCE_SEASON ? Promise.resolve([]) : fetchWestgateStandings(REFERENCE_SEASON),
      fetchWestgatePoolSettings(season),
      fetchWestgateSeasonRows(season, liveByTeam),
    ])
      .then(([s, ref, set, mine]) => {
        setStandings(s);
        setReference(season === REFERENCE_SEASON ? s : ref);
        setSettings(set);
        setEntriesInput(String(set.entries));
        setFeeInput(String(set.entry_fee));
        setMyRows(mine);
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (ratingsLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, ratingsLoading]);

  const pctByRank = useMemo(() => computePayoutPctByRank(reference), [reference]);

  const myRecord = useMemo(() => {
    return myRows.reduce(
      (acc, r) => {
        const g = gradeWestgatePick(r);
        if (g === "win") acc.wins++;
        else if (g === "loss") acc.losses++;
        else if (g === "push") acc.pushes++;
        return acc;
      },
      { wins: 0, losses: 0, pushes: 0 }
    );
  }, [myRows]);
  const myPoints = westgatePoints(myRecord);

  // Insert "You" into the uploaded field by points, same tie-break
  // convention (share of a rank) the contest itself uses.
  const merged = useMemo(() => {
    const rows: (WestgateStandingRow & { isYou?: boolean })[] = standings.map((r) => ({ ...r }));
    const you: WestgateStandingRow & { isYou?: boolean } = {
      season,
      place_rank: 0,
      place_label: "",
      alias: "YOU (live)",
      record: `${myRecord.wins}-${myRecord.losses}${myRecord.pushes > 0 ? `-${myRecord.pushes}` : ""}`,
      points: myPoints,
      cash_prize: null,
      isYou: true,
    };
    const better = rows.filter((r) => (r.points ?? -Infinity) > myPoints).length;
    you.place_rank = better + 1;
    you.place_label = String(you.place_rank);
    rows.push(you);
    rows.sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
    // Re-derive place_rank/label for a clean 1..N ordering once "You" is
    // spliced in, rather than trusting the CSV's own (now-stale) ranks.
    let rank = 1;
    let prevPoints: number | null = null;
    let tieGroupStart = 1;
    return rows.map((r, i) => {
      if (prevPoints !== null && r.points === prevPoints) {
        // stays in the same tie group
      } else {
        rank = i + 1;
        tieGroupStart = rank;
      }
      prevPoints = r.points ?? null;
      const tiedCount = rows.filter((x) => x.points === r.points).length;
      const label = tiedCount > 1 ? `${tieGroupStart}T` : String(tieGroupStart);
      return { ...r, place_rank: tieGroupStart, place_label: label };
    });
  }, [standings, myRecord, myPoints, season]);

  async function handleSaveSettings() {
    const entries = parseInt(entriesInput, 10);
    const fee = parseFloat(feeInput);
    if (!entries || !fee) return;
    setSavingSettings(true);
    try {
      await saveWestgatePoolSettings(season, entries, fee);
      setSettings({ season, entries, entry_fee: fee });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([WESTGATE_STANDINGS_CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "westgate-standings-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCheck(csvText: string) {
    setText(csvText);
    setMsg(null);
    setCheckResult(parseWestgateStandingsCsv(csvText));
  }

  async function handleFile(f: File) {
    const csvText = await f.text();
    handleCheck(csvText);
  }

  async function handleImport() {
    if (!checkResult || checkResult.resolved.length === 0) return;
    setImporting(true);
    setMsg(null);
    try {
      const { imported } = await importWestgateStandings(season, checkResult.resolved);
      setMsg(`Imported ${imported} row${imported === 1 ? "" : "s"}.`);
      setCheckResult(null);
      setText("");
      load();
    } catch (err: any) {
      setMsg(err.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Field size (entries){" "}
          <input type="number" value={entriesInput} onChange={(e) => setEntriesInput(e.target.value)} style={{ width: 80 }} />
        </label>
        <label>
          Entry fee ($){" "}
          <input type="number" value={feeInput} onChange={(e) => setFeeInput(e.target.value)} style={{ width: 70 }} />
        </label>
        <button className="menu-btn" onClick={handleSaveSettings} disabled={savingSettings}>
          {savingSettings ? "Saving…" : "Save"}
        </button>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          Total pool: {fmtMoney(settings.entries * settings.entry_fee)} — payouts scaled off {REFERENCE_SEASON}'s percentages.
        </span>
      </div>

      <button className="menu-btn" onClick={() => setUploadOpen((o) => !o)} style={{ marginBottom: "1rem" }}>
        {uploadOpen ? "Close" : "Upload Standings CSV"}
      </button>
      {uploadOpen && (
        <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.75rem", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            place, alias, record, points, cash_prize (cash_prize optional — only needed for a completed
            season, to seed the payout-% table). Replaces this season's whole standings snapshot each time.{" "}
            <button className="menu-btn" style={{ padding: "0.1rem 0.4rem" }} onClick={downloadTemplate}>
              Download template
            </button>
          </p>
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", margin: "0.5rem 0 0.2rem" }}>...or paste CSV text:</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste CSV here…"
            rows={6}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.78rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
            <button onClick={() => handleCheck(text)} disabled={text.trim() === ""}>
              Check
            </button>
            {checkResult && (
              <button onClick={handleImport} disabled={importing || checkResult.resolved.length === 0}>
                {importing ? "Importing…" : `Import ${checkResult.resolved.length} row${checkResult.resolved.length === 1 ? "" : "s"}`}
              </button>
            )}
            {msg && <span style={{ color: msg.startsWith("Imported") ? "green" : "#e0a030" }}>{msg}</span>}
          </div>
          {checkResult && checkResult.errors.length > 0 && (
            <div style={{ marginTop: "0.5rem", color: "#e0a030", fontSize: "0.78rem" }}>
              {checkResult.errors.map((e, i) => (
                <div key={i}>
                  Line {e.line}: {e.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {(loading || ratingsLoading) && <p>Loading…</p>}

      {!loading && standings.length === 0 && (
        <p style={{ color: "var(--chalk-dim)" }}>
          No standings uploaded for {season} yet — "You" will still show below based on your own picked
          games' live record.
        </p>
      )}

      {!loading && (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th className="th">Place</th>
                <th className="th">Alias</th>
                <th className="th">Record</th>
                <th className="th" style={{ textAlign: "right" }}>
                  Points
                </th>
                <th className="th" style={{ textAlign: "right" }}>
                  Proj. Payout
                </th>
              </tr>
            </thead>
            <tbody>
              {merged.map((r, i) => (
                <tr
                  key={`${r.alias}-${i}`}
                  style={{ background: r.isYou ? "var(--gold-dim)" : undefined, fontWeight: r.isYou ? 700 : undefined }}
                >
                  <td style={{ padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)" }}>{r.place_label}</td>
                  <td style={{ padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)" }}>{r.alias}</td>
                  <td style={{ padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)" }}>{r.record ?? "–"}</td>
                  <td style={{ padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.points != null ? r.points.toFixed(2) : "–"}
                  </td>
                  <td style={{ padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {fmtMoney(projectPayout(r.place_rank, settings, pctByRank))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        "You" is inserted using your own live record/points from every game you've picked this season
        (1 pt per win, 0.5 per push) — not part of the uploaded CSV. Proj. Payout applies{" "}
        {REFERENCE_SEASON}'s per-rank share of the pool to this season's field size × entry fee.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Weekly picks tab
// ---------------------------------------------------------------------
function PicksTab({ season, week, onWeekChange }: { season: number; week: number; onWeekChange: (w: number) => void }) {
  const [rows, setRows] = useState<WestgateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("[]");
  const [showPickedOnly, setShowPickedOnly] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [sortKey, setSortKey] = useState("start_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [gameSearch, setGameSearch] = useState("");
  const [sortMode, setSortMode] = useState<"time" | "bestBet">("time");

  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");

  function snapshotOf(list: WestgateRow[]): string {
    return JSON.stringify(list.map((r) => ({ g: r.game_id, l: r.westgate_line, p: r.picked_side })));
  }

  function load() {
    setLoading(true);
    setError(null);
    fetchWestgateWeek(season, week, liveByTeam)
      .then((data) => {
        setRows(data);
        setSavedSnapshot(snapshotOf(data));
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (ratingsLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, ratingsLoading]);

  const pickedCount = rows.filter((r) => r.picked_side != null).length;
  const isDirty = snapshotOf(rows) !== savedSnapshot;

  function updateRow(gameId: string, patch: Partial<WestgateRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.game_id !== gameId) return r;
        if (patch.picked_side != null && r.picked_side == null && pickedCount >= WESTGATE_PICK_LIMIT) {
          setSaveMsg(`You've already picked ${WESTGATE_PICK_LIMIT} games — the max for this pool. Unpick one first.`);
          return r;
        }
        return { ...r, ...patch };
      })
    );
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await westgateSave(season, week, rows);
      setSaveMsg("Saved.");
      setSavedSnapshot(snapshotOf(rows));
      setSortMode("bestBet");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSort(key: string) {
    setSortMode("time");
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function myVsVegas(r: WestgateRow): number | null {
    return r.myProjAwaySpread != null && r.vegasAwaySpread != null ? r.myProjAwaySpread - r.vegasAwaySpread : null;
  }
  function westgateVsMineLive(r: WestgateRow): number | null {
    return r.westgate_line != null && r.myProjAwaySpread != null ? r.westgate_line - r.myProjAwaySpread : null;
  }
  function westgateVsVegasLive(r: WestgateRow): number | null {
    return r.westgate_line != null && r.vegasAwaySpread != null ? r.westgate_line - r.vegasAwaySpread : null;
  }

  const accessor = (r: WestgateRow, key: string): any => {
    switch (key) {
      case "away_team":
        return r.game.away_team;
      case "home_team":
        return r.game.home_team;
      case "start_date":
        return r.game.start_date ?? "";
      case "myProjAwaySpread":
        return r.myProjAwaySpread;
      case "vegasAwaySpread":
        return r.vegasAwaySpread;
      case "openingAwaySpread":
        return r.openingAwaySpread;
      case "westgate_line":
        return r.westgate_line;
      case "myVsVegas": {
        const v = myVsVegas(r);
        return v != null ? Math.abs(v) : null;
      }
      case "westgateVsMine": {
        const v = westgateVsMineLive(r);
        return v != null ? Math.abs(v) : null;
      }
      case "westgateVsVegas":
        return westgateVsVegasLive(r);
      case "wfb":
        return r.wfbTeam ? 1 : 0;
      default:
        return null;
    }
  };

  const visibleRows = useMemo(() => {
    let list = showPickedOnly ? rows.filter((r) => r.picked_side != null) : rows;
    if (hideCompleted) list = list.filter((r) => !r.game.completed);
    if (gameSearch.trim() !== "") {
      const q = gameSearch.trim().toLowerCase();
      list = list.filter((r) => r.game.away_team.toLowerCase().includes(q) || r.game.home_team.toLowerCase().includes(q));
    }
    if (sortMode === "bestBet") {
      list = [...list].sort((a, b) => {
        const av = westgateVsMineLive(a);
        const bv = westgateVsMineLive(b);
        const aAbs = av == null ? -Infinity : Math.abs(av);
        const bAbs = bv == null ? -Infinity : Math.abs(bv);
        return bAbs - aAbs;
      });
    } else {
      list = [...list].sort((a, b) => {
        const av = accessor(a, sortKey);
        const bv = accessor(b, sortKey);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string") {
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }
    return list;
  }, [rows, showPickedOnly, hideCompleted, sortKey, sortDir, gameSearch, sortMode]);

  const record = rows.reduce(
    (acc, r) => {
      const g = gradeWestgatePick(r);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      else if (g === "push") acc.pushes++;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0 }
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Week{" "}
          <input
            type="number"
            min={1}
            max={16}
            value={week}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10) || week;
              if (isDirty && !confirm("You have unsaved picks/lines for this week — switch weeks anyway and lose them?")) return;
              onWeekChange(next);
            }}
            style={{ width: 70 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input type="checkbox" checked={showPickedOnly} onChange={(e) => setShowPickedOnly(e.target.checked)} />
          Show picked games only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed games
        </label>
        <span style={{ fontSize: "0.82rem", color: pickedCount === WESTGATE_PICK_LIMIT ? "green" : "#a15c00" }}>
          Picked: {pickedCount}/{WESTGATE_PICK_LIMIT} · Record: {record.wins}-{record.losses}
          {record.pushes > 0 ? `-${record.pushes}` : ""} · Points: {westgatePoints(record).toFixed(1)}
        </span>
        <input
          type="text"
          placeholder="Search teams…"
          value={gameSearch}
          onChange={(e) => setGameSearch(e.target.value)}
          style={{ width: 150 }}
        />
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort:</span>
        <button className={`mode-btn ${sortMode === "bestBet" ? "mode-btn-active" : ""}`} onClick={() => setSortMode("bestBet")}>
          Best Bets
        </button>
        <button
          className={`mode-btn ${sortMode === "time" ? "mode-btn-active" : ""}`}
          onClick={() => {
            setSortMode("time");
            setSortKey("start_date");
            setSortDir("asc");
          }}
        >
          Time
        </button>
      </div>

      <LinesCsvImport season={season} week={week} onImported={load} />

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {ratingsLoading && <p>Loading live ratings…</p>}
      {loading && <p>Loading…</p>}

      {!loading && rows.length === 0 && (
        <p style={{ color: "var(--chalk-dim)" }}>
          No FBS-vs-FBS games saved for {season} week {week} yet — sync this week from Games & Lines first.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginTop: "1rem" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <SortHeader label="Away" sortKey="away_team" active={sortKey === "away_team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Home" sortKey="home_team" active={sortKey === "home_team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader
                    label="My Projection"
                    sortKey="myProjAwaySpread"
                    active={sortKey === "myProjAwaySpread"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Vegas Line"
                    sortKey="vegasAwaySpread"
                    active={sortKey === "vegasAwaySpread"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Opening Line"
                    sortKey="openingAwaySpread"
                    active={sortKey === "openingAwaySpread"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Westgate Line"
                    sortKey="westgate_line"
                    active={sortKey === "westgate_line"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="My vs Vegas"
                    sortKey="myVsVegas"
                    active={sortKey === "myVsVegas"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Westgate vs Mine"
                    sortKey="westgateVsMine"
                    active={sortKey === "westgateVsMine"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Westgate vs Vegas"
                    sortKey="westgateVsVegas"
                    active={sortKey === "westgateVsVegas"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <th className="th">Proj Cover</th>
                  <th className="th">Actual Cover</th>
                  <SortHeader label="WFB" sortKey="wfb" active={sortKey === "wfb"} dir={sortDir} onClick={handleSort} />
                  <th className="th">Pick</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const grade = gradeWestgatePick(r);
                  const cellStyle = { padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)" };
                  return (
                    <tr key={r.game_id}>
                      <td style={cellStyle}>
                        <TeamLink team={r.game.away_team} />
                      </td>
                      <td style={cellStyle}>
                        <TeamLink team={r.game.home_team} />
                      </td>
                      <td
                        style={{
                          ...cellStyle,
                          textAlign: "right",
                          color: r.myProjAwaySpread != null ? spreadColor(r.myProjAwaySpread) : undefined,
                        }}
                      >
                        {fmt(r.myProjAwaySpread)}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(r.vegasAwaySpread)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(r.openingAwaySpread)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.5"
                          value={r.westgate_line ?? ""}
                          onChange={(e) =>
                            updateRow(r.game_id, { westgate_line: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 55, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmtAbs(myVsVegas(r))}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmtAbs(westgateVsMineLive(r))}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(westgateVsVegasLive(r), 2)}</td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        {r.projCoverTeam === "away" ? (
                          <TeamLogo team={r.game.away_team} size={16} />
                        ) : r.projCoverTeam === "home" ? (
                          <TeamLogo team={r.game.home_team} size={16} />
                        ) : (
                          <span style={{ color: "var(--chalk-dim)" }}>–</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        {r.actualCoverTeam === "away" ? (
                          <TeamLogo team={r.game.away_team} size={16} />
                        ) : r.actualCoverTeam === "home" ? (
                          <TeamLogo team={r.game.home_team} size={16} />
                        ) : r.actualCoverTeam === "push" ? (
                          "Push"
                        ) : (
                          <span style={{ color: "var(--chalk-dim)" }}>–</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}>
                          {r.wfbTeam === "away" ? (
                            <TeamLogo team={r.game.away_team} size={16} />
                          ) : r.wfbTeam === "home" ? (
                            <TeamLogo team={r.game.home_team} size={16} />
                          ) : (
                            <span style={{ color: "var(--chalk-dim)" }}>–</span>
                          )}
                          {r.wfbTeam != null && <span style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{fmtAbs(r.wfbAmountOff)}</span>}
                        </div>
                      </td>
                      <td style={cellStyle}>
                        <div style={{ display: "flex", gap: "0.2rem" }}>
                          <button
                            className="menu-btn"
                            style={{ opacity: r.picked_side === "away" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                            onClick={() => updateRow(r.game_id, { picked_side: r.picked_side === "away" ? null : "away" })}
                            title={r.game.away_team}
                          >
                            <TeamLogo team={r.game.away_team} size={16} /> {fmt(r.westgate_line)}
                          </button>
                          <button
                            className="menu-btn"
                            style={{ opacity: r.picked_side === "home" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                            onClick={() => updateRow(r.game_id, { picked_side: r.picked_side === "home" ? null : "home" })}
                            title={r.game.home_team}
                          >
                            <TeamLogo team={r.game.home_team} size={16} /> {fmt(r.westgate_line != null ? -r.westgate_line : null)}
                          </button>
                        </div>
                      </td>
                      <td style={cellStyle}>
                        {grade === "pending" ? "–" : grade === "win" ? "✅ Win" : grade === "push" ? "Push" : "❌ Loss"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {isDirty && (
            <p style={{ color: "#e0a030", fontWeight: 700, marginTop: "1rem", marginBottom: 0 }}>
              ⚠ You have unsaved picks and/or lines — click Save below before leaving this page, or they'll be lost.
            </p>
          )}
          <button onClick={handleSave} disabled={saving} style={{ marginTop: "0.5rem" }}>
            {saving ? "Saving…" : "Save Westgate Lines & Picks"}
          </button>
          {saveMsg && <span style={{ color: saveMsg === "Saved." ? "green" : "#e0a030", marginLeft: "0.75rem" }}>{saveMsg}</span>}
        </>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        My vs Vegas / Westgate vs Mine show the size of the disagreement only (no sign). Westgate vs
        Vegas keeps its sign: positive means Westgate's line is more home-favoring than Vegas. Pushes
        count as half a win toward Points, same as the real contest. Results grade automatically once
        CFBD marks a game complete with a final score.
      </div>
    </div>
  );
}

export default function WestgatePoolPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [tab, setTab] = useState<"picks" | "standings">("picks");

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Westgate Supercontest</h2>
        <a href={POOL_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
          Open Westgate Supercontest ↗
        </a>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Every FBS-vs-FBS game this week, automatically. Enter Westgate's line for each game (same
        convention as the rest of the site: negative = away favored) and pick exactly {WESTGATE_PICK_LIMIT} games.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className={`mode-btn ${tab === "picks" ? "mode-btn-active" : ""}`} onClick={() => setTab("picks")}>
            This Week
          </button>
          <button className={`mode-btn ${tab === "standings" ? "mode-btn-active" : ""}`} onClick={() => setTab("standings")}>
            Standings & Payouts
          </button>
        </div>
      </div>

      {tab === "picks" && <PicksTab season={season} week={week} onWeekChange={setWeek} />}
      {tab === "standings" && <StandingsTab season={season} />}
    </div>
  );
}
