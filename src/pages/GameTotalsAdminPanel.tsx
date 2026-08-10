import { useState, type CSSProperties } from "react";
import { parseSeasonCsv, mergeAdvancedCsv, mergedRowsToArray } from "../lib/csvImport";
import {
  useGameTotalsEngine,
  buildBetRows,
  COMPOSITE_KEYS,
  COMPOSITE_LABELS,
  type CompositeKey,
  type EnrichedGameRow,
} from "../lib/gameTotalsEngine";
import { DEFAULT_GAME_TOTALS_SETTINGS, type GameTotalsSettings } from "../lib/api/gameTotalsData";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const TABS = ["raw", "inputs", "composites", "bets", "filtered", "performance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  raw: "Raw Data",
  inputs: "System Inputs",
  composites: "Composites",
  bets: "Bets",
  filtered: "Filtered Bets",
  performance: "Performance",
};

function fmt(v: number | null | undefined, digits = 2): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(digits);
}

async function saveSettings(season: number, settings: GameTotalsSettings) {
  const password = window.prompt("Admin password:");
  if (!password) return;
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "saveGameTotalsSettings", season, settings }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed");
}

function SettingsBar({ settings, setSettings, season }: any) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await saveSettings(season, settings);
      setMsg("Saved.");
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
        alignItems: "center",
        padding: "0.9rem 1rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
        marginBottom: "1rem",
      }}
    >
      <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
        Composite 2 weights [S1, S2, S3, S4+S5]{" "}
        {settings.weights.map((w: number, i: number) => (
          <input
            key={i}
            type="number"
            step="0.5"
            value={w}
            onChange={(e) => {
              const next = [...settings.weights];
              next[i] = parseFloat(e.target.value) || 0;
              setSettings({ ...settings, weights: next });
            }}
            style={{ width: 50, marginLeft: 4 }}
          />
        ))}
      </label>
      <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
        Composite 3 regression %{" "}
        <input
          type="number"
          step="5"
          value={Math.round(settings.regressPct * 100)}
          onChange={(e) => setSettings({ ...settings, regressPct: (parseFloat(e.target.value) || 0) / 100 })}
          style={{ width: 60 }}
        />
      </label>
      <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
        Filter threshold (x std dev){" "}
        <input
          type="number"
          step="0.1"
          value={settings.filterThresholdMultiplier}
          onChange={(e) => setSettings({ ...settings, filterThresholdMultiplier: parseFloat(e.target.value) || 0 })}
          style={{ width: 60 }}
        />
      </label>
      <button className="menu-btn" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Settings"}
      </button>
      <button className="menu-btn" onClick={() => setSettings({ ...DEFAULT_GAME_TOTALS_SETTINGS })}>
        Reset Defaults
      </button>
      {msg && <span style={{ color: msg.startsWith("Error") ? "#c45c52" : "#8fd39a", fontSize: "0.8rem" }}>{msg}</span>}
    </div>
  );
}

export function RawDataTab({ rows }: { rows: EnrichedGameRow[] }) {
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={CP}>Wk</th>
            <th style={CP}>Away</th>
            <th style={CP}>Home</th>
            <th style={{ ...CP, textAlign: "right" }}>Away Pts</th>
            <th style={{ ...CP, textAlign: "right" }}>Away PA</th>
            <th style={{ ...CP, textAlign: "right" }}>Away Plays</th>
            <th style={{ ...CP, textAlign: "right" }}>Away Drives</th>
            <th style={{ ...CP, textAlign: "right" }}>Away Yds</th>
            <th style={{ ...CP, textAlign: "right" }}>Home Pts</th>
            <th style={{ ...CP, textAlign: "right" }}>Home PA</th>
            <th style={{ ...CP, textAlign: "right" }}>Home Plays</th>
            <th style={{ ...CP, textAlign: "right" }}>Home Drives</th>
            <th style={{ ...CP, textAlign: "right" }}>Home Yds</th>
            <th style={{ ...CP, textAlign: "right" }}>Vegas O/U</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.game.id}>
              <td style={CP}>{r.game.week}</td>
              <td style={CP}>{r.game.awayTeam}</td>
              <td style={CP}>{r.game.homeTeam}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away?.pointsFor, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away?.pointsAgainst, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away?.offensePlays, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away?.offenseDrives, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away?.totalYards, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home?.pointsFor, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home?.pointsAgainst, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home?.offensePlays, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home?.offenseDrives, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home?.totalYards, 0)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.odds.vegasTotal, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SystemInputsTab({ rows }: { rows: EnrichedGameRow[] }) {
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={CP}>Wk</th>
            <th style={CP}>Team</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Pts/Drive</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Drives/Gm</th>
            <th style={{ ...CP, textAlign: "right" }}>Def Pts/Drive Allow</th>
            <th style={{ ...CP, textAlign: "right" }}>Def Drives/Gm Faced</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Pts/Play</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Plays/Gm</th>
            <th style={{ ...CP, textAlign: "right" }}>Def Pts/Play Allow</th>
            <th style={{ ...CP, textAlign: "right" }}>Def Plays/Gm Faced</th>
            <th style={{ ...CP, textAlign: "right" }}>Off YPP</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Yds/Pt</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Pass YPA</th>
            <th style={{ ...CP, textAlign: "right" }}>Off Rush YPA</th>
            <th style={{ ...CP, textAlign: "right" }}>Vegas O/U</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <>
              {r.homeSystemInputs && (
                <tr key={r.game.id + "-h"}>
                  <td style={CP}>{r.game.week}</td>
                  <td style={CP}>{r.game.homeTeam} (H)</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offPtsPerDrive)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offDrivesPerGame)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.defPtsPerDriveAllowed)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.defDrivesPerGameFaced)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offPtsPerPlay)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offPlaysPerGame)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.defPtsPerPlayAllowed)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.defPlaysPerGameFaced)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offYpp)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offYardsPerPoint)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offPassYpa)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeSystemInputs.offRushYpa)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.odds.vegasTotal, 1)}</td>
                </tr>
              )}
              {r.awaySystemInputs && (
                <tr key={r.game.id + "-a"}>
                  <td style={CP}>{r.game.week}</td>
                  <td style={CP}>{r.game.awayTeam} (A)</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offPtsPerDrive)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offDrivesPerGame)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.defPtsPerDriveAllowed)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.defDrivesPerGameFaced)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offPtsPerPlay)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offPlaysPerGame)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.defPtsPerPlayAllowed)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.defPlaysPerGameFaced)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offYpp)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offYardsPerPoint)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offPassYpa)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awaySystemInputs.offRushYpa)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.odds.vegasTotal, 1)}</td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompositesTab({ rows }: { rows: EnrichedGameRow[] }) {
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={CP}>Wk</th>
            <th style={CP}>Matchup</th>
            <th style={{ ...CP, textAlign: "right" }}>S1</th>
            <th style={{ ...CP, textAlign: "right" }}>S2</th>
            <th style={{ ...CP, textAlign: "right" }}>S3</th>
            <th style={{ ...CP, textAlign: "right" }}>S4+S5</th>
            <th style={{ ...CP, textAlign: "right" }}>Comp 1</th>
            <th style={{ ...CP, textAlign: "right" }}>Comp 2</th>
            <th style={{ ...CP, textAlign: "right" }}>Comp 3</th>
            <th style={{ ...CP, textAlign: "right" }}>Comp 4</th>
            <th style={{ ...CP, textAlign: "right" }}>Comp 5</th>
            <th style={{ ...CP, textAlign: "right" }}>Comp 6</th>
            <th style={{ ...CP, textAlign: "right" }}>Open</th>
            <th style={{ ...CP, textAlign: "right" }}>Close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const h = r.projection?.homeResults;
            const a = r.projection?.awayResults;
            const c = r.projection?.composites;
            return (
              <tr key={r.game.id}>
                <td style={CP}>{r.game.week}</td>
                <td style={CP}>
                  {r.game.awayTeam} @ {r.game.homeTeam}
                </td>
                <td style={{ ...CP, textAlign: "right" }}>{h && a ? fmt(h.s1 + a.s1) : "–"}</td>
                <td style={{ ...CP, textAlign: "right" }}>{h && a ? fmt(h.s2 + a.s2) : "–"}</td>
                <td style={{ ...CP, textAlign: "right" }}>{h && a ? fmt(h.s3 + a.s3) : "–"}</td>
                <td style={{ ...CP, textAlign: "right" }}>{h && a ? fmt(h.s45 + a.s45) : "–"}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(c?.composite1)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(c?.composite2)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(c?.composite3)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(c?.composite4)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(c?.composite5)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(c?.composite6)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.odds.openingTotal, 1)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.odds.closingTotal, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompositePicker({ value, onChange }: { value: CompositeKey; onChange: (k: CompositeKey) => void }) {
  return (
    <select className="filter" value={value} onChange={(e) => onChange(e.target.value as CompositeKey)} style={{ marginBottom: "0.75rem" }}>
      {COMPOSITE_KEYS.map((k) => (
        <option key={k} value={k}>
          {COMPOSITE_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

function BetsTab({ rows, settings, filteredOnly }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings; filteredOnly: boolean }) {
  const [composite, setComposite] = useState<CompositeKey>("composite1");
  const betRows = buildBetRows(rows, composite, settings.filterThresholdMultiplier);
  const shown = filteredOnly ? betRows.filter((b) => b.isFiltered) : betRows;

  return (
    <div>
      <CompositePicker value={composite} onChange={setComposite} />
      <div className="table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={CP}>Wk</th>
              <th style={CP}>Matchup</th>
              <th style={{ ...CP, textAlign: "right" }}>{COMPOSITE_LABELS[composite]}</th>
              <th style={{ ...CP, textAlign: "right" }}>Vegas O/U</th>
              <th style={{ ...CP, textAlign: "right" }}>Amount Off</th>
              <th style={CP}>Call</th>
              {filteredOnly && <th style={CP}>Filtered</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.row.game.id}>
                <td style={CP}>{b.row.game.week}</td>
                <td style={CP}>
                  {b.row.game.awayTeam} @ {b.row.game.homeTeam}
                </td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(b.compositeValue)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(b.vegasTotal, 1)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(b.amountOff)}</td>
                <td style={{ ...CP, color: b.call === "Over" ? "#8fd39a" : b.call === "Under" ? "#e07a7a" : undefined, fontWeight: 700 }}>
                  {b.call ?? "–"}
                </td>
                {filteredOnly && <td style={CP}>{b.isFiltered ? "✓" : "–"}</td>}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={filteredOnly ? 7 : 6} className="empty">
                  No games.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerformanceTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
      {COMPOSITE_KEYS.map((key) => {
        const betRows = buildBetRows(rows, key, settings.filterThresholdMultiplier);
        const graded = betRows.filter((b) => b.grade != null);
        const wins = graded.filter((b) => b.grade === "win").length;
        const losses = graded.filter((b) => b.grade === "loss").length;
        const pushes = graded.filter((b) => b.grade === "push").length;

        const filteredGraded = betRows.filter((b) => b.isFiltered && b.grade != null);
        const fWins = filteredGraded.filter((b) => b.grade === "win").length;
        const fLosses = filteredGraded.filter((b) => b.grade === "loss").length;

        return (
          <div key={key} style={{ padding: "1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <div style={{ fontWeight: 700, color: "var(--gold)", marginBottom: "0.5rem" }}>{COMPOSITE_LABELS[key]}</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>
              {wins}-{losses}
              {pushes > 0 ? `-${pushes}` : ""}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>All graded games</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.5rem" }}>
              {fWins}-{fLosses}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>Filtered only</div>
          </div>
        );
      })}
    </div>
  );
}

export function SyncControl({ season }: { season: number }) {
  const [syncing, setSyncing] = useState(false);
  const [includeStats, setIncludeStats] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSync() {
    const password = window.prompt("Admin password:");
    if (!password) return;
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cfbd-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, year: season, syncStats: includeStats }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setMsg(
        `Synced: ${data.gamesUpserted} games, ${data.linesUpserted} lines` +
          (includeStats ? `, ${data.statsTeamsUpserted} teams' stats.` : ".")
      );
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
      <button className="menu-btn" onClick={handleSync} disabled={syncing}>
        {syncing ? "Syncing…" : `Sync ${season} games & lines from CFBD`}
      </button>
      <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
        <input type="checkbox" checked={includeStats} onChange={(e) => setIncludeStats(e.target.checked)} /> Also pull team
        stats (heavier — skip if you're importing those via CSV instead)
      </label>
      {msg && <span style={{ fontSize: "0.8rem", color: msg.startsWith("Error") ? "#c45c52" : "#8fd39a" }}>{msg}</span>}
    </div>
  );
}

export function CsvImportControl({ season }: { season: number }) {
  const [seasonFile, setSeasonFile] = useState<File | null>(null);
  const [advancedFile, setAdvancedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function readFile(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(f);
    });
  }

  async function handleImport() {
    if (!seasonFile || !advancedFile) {
      setMsg("Error: select both season.csv and advanced.csv first.");
      return;
    }
    const password = window.prompt("Admin password:");
    if (!password) return;
    setImporting(true);
    setMsg(null);
    try {
      const [seasonText, advancedText] = await Promise.all([readFile(seasonFile), readFile(advancedFile)]);
      const byTeam = parseSeasonCsv(seasonText);
      mergeAdvancedCsv(byTeam, advancedText);
      const rows = mergedRowsToArray(byTeam);

      const res = await fetch("/api/admin-bets-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action: "importTeamStatsCsv", rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setMsg(`Imported ${data.imported} teams' stats from CSV. Games/lines still need syncing separately — this only covers team_season_stats.`);
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
        marginBottom: "1rem",
        flexWrap: "wrap",
        padding: "0.75rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Import from CSV (no API calls, no timeout risk):</span>
      <label style={{ fontSize: "0.78rem" }}>
        season.csv <input type="file" accept=".csv" onChange={(e) => setSeasonFile(e.target.files?.[0] ?? null)} />
      </label>
      <label style={{ fontSize: "0.78rem" }}>
        advanced.csv <input type="file" accept=".csv" onChange={(e) => setAdvancedFile(e.target.files?.[0] ?? null)} />
      </label>
      <button className="menu-btn" onClick={handleImport} disabled={importing}>
        {importing ? "Importing…" : "Import Stats CSV"}
      </button>
      {msg && <span style={{ fontSize: "0.78rem", color: msg.startsWith("Error") ? "#c45c52" : "#8fd39a" }}>{msg}</span>}
    </div>
  );
}

const SEASON_OPTIONS = [2024, 2025, 2026];

export function SeasonPicker({ season, setSeason }: { season: number; setSeason: (s: number) => void }) {
  return (
    <select className="filter" value={season} onChange={(e) => setSeason(Number(e.target.value))} style={{ marginBottom: "1rem" }}>
      {SEASON_OPTIONS.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}

export function DivisionPicker({ division, setDivision }: { division: string; setDivision: (d: string) => void }) {
  return (
    <select className="filter" value={division} onChange={(e) => setDivision(e.target.value)} style={{ marginBottom: "1rem" }}>
      <option value="All">All divisions</option>
      <option value="FBS">FBS only (both teams)</option>
      <option value="FCS">FCS only (both teams)</option>
    </select>
  );
}

export function filterRowsByDivision(rows: EnrichedGameRow[], division: string): EnrichedGameRow[] {
  if (division === "All") return rows;
  return rows.filter((r) => r.game.homeClassification === division.toLowerCase() && r.game.awayClassification === division.toLowerCase());
}

export default function GameTotalsAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, settings, setSettings, loading, error } = useGameTotalsEngine(season);
  const rows = filterRowsByDivision(allRows, division);
  const [tab, setTab] = useState<Tab>("composites");

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Game Totals</h2>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>
      <CsvImportControl season={season} />
      <details style={{ marginBottom: "1rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Or sync games/lines live from CFBD (needed either way — CSV import only covers team stats)
        </summary>
        <div style={{ marginTop: "0.5rem" }}>
          <SyncControl season={season} />
        </div>
      </details>
      <SettingsBar settings={settings} setSettings={setSettings} season={season} />

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} className={`mode-btn ${tab === t ? "mode-btn-active" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          {tab === "raw" && <RawDataTab rows={rows} />}
          {tab === "inputs" && <SystemInputsTab rows={rows} />}
          {tab === "composites" && <CompositesTab rows={rows} />}
          {tab === "bets" && <BetsTab rows={rows} settings={settings} filteredOnly={false} />}
          {tab === "filtered" && <BetsTab rows={rows} settings={settings} filteredOnly />}
          {tab === "performance" && <PerformanceTab rows={rows} settings={settings} />}
        </>
      )}
    </div>
  );
}
