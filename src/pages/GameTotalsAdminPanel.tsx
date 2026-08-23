import { useMemo, useState, type CSSProperties } from "react";
import { parseSeasonCsv, mergeAdvancedCsv, mergedRowsToArray } from "../lib/csvImport";
import SortHeader from "../components/SortHeader";
import {
  useGameTotalsEngine,
  buildBetRows,
  buildTeamSplitBetRows,
  computeGamePerformanceBreakdown,
  computeTeamPerformanceBreakdown,
  computeAmountOffDistribution,
  type EnrichedGameRow,
  type BetRow,
  type TeamSplitBetRow,
} from "../lib/gameTotalsEngine";
import { SYSTEM_KEYS, SYSTEM_LABELS, type SystemKey } from "../lib/gameTotals";
import { DEFAULT_GAME_TOTALS_SETTINGS, type GameTotalsSettings } from "../lib/api/gameTotalsData";
import { WeekSeasonToggle, filterByViewMode, PerformanceTable, AmountOffChart, type ViewMode } from "./PerformanceView";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const TABS = ["totals", "teamtotals", "performance", "teamperformance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  totals: "Totals",
  teamtotals: "Team Totals",
  performance: "Performance",
  teamperformance: "TT Performance",
};

const LEGACY_TABS = ["raw", "inputs", "composites"] as const;
type LegacyTab = (typeof LEGACY_TABS)[number];
const LEGACY_TAB_LABELS: Record<LegacyTab, string> = { raw: "Raw Data", inputs: "Efficiency Inputs", composites: "Legacy Composites" };

function fmt(v: number | null | undefined, digits = 2): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(digits);
}

function dateLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

function kickoffLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
      <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
        Model: Ridge regression, trained on 2021-2025 CFBD data — one projected total per game.
      </span>
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

export function EfficiencyInputsTab({ rows }: { rows: EnrichedGameRow[] }) {
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={CP}>Wk</th>
            <th style={CP}>Team</th>
            <th style={{ ...CP, textAlign: "right" }}>Blended Plays</th>
            <th style={{ ...CP, textAlign: "right" }}>Blended Drives</th>
            <th style={{ ...CP, textAlign: "right" }}>Blended Rush Att</th>
            <th style={{ ...CP, textAlign: "right" }}>Blended Pass Att</th>
            <th style={{ ...CP, textAlign: "right" }}>PPA Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Success Rate Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Explosiveness Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Pts/Opp Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Rush PPA Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Rush SR Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Pass PPA Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Pass SR Factor</th>
            <th style={{ ...CP, textAlign: "right" }}>Vegas O/U</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <>
              {r.homeEfficiencyInputs && (
                <tr key={r.game.id + "-h"}>
                  <td style={CP}>{r.game.week}</td>
                  <td style={CP}>{r.game.homeTeam} (H)</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.blendedPlays)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.blendedDrives)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.blendedRushAttempts)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.blendedPassAttempts)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.ppaFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.successRateFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.explosivenessFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.pointsPerOppFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.rushPpaFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.rushSuccessRateFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.passPpaFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeEfficiencyInputs.passSuccessRateFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.odds.vegasTotal, 1)}</td>
                </tr>
              )}
              {r.awayEfficiencyInputs && (
                <tr key={r.game.id + "-a"}>
                  <td style={CP}>{r.game.week}</td>
                  <td style={CP}>{r.game.awayTeam} (A)</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.blendedPlays)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.blendedDrives)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.blendedRushAttempts)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.blendedPassAttempts)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.ppaFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.successRateFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.explosivenessFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.pointsPerOppFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.rushPpaFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.rushSuccessRateFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.passPpaFactor)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{fmt(r.awayEfficiencyInputs.passSuccessRateFactor)}</td>
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

function LegacyCompositesTab({ rows }: { rows: EnrichedGameRow[] }) {
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={CP}>Wk</th>
            <th style={CP}>Matchup</th>
            {SYSTEM_KEYS.map((k) => (
              <th key={k} style={{ ...CP, textAlign: "right" }}>
                {SYSTEM_LABELS[k]}
              </th>
            ))}
            <th style={{ ...CP, textAlign: "right" }}>My Total</th>
            <th style={{ ...CP, textAlign: "right" }}>Open</th>
            <th style={{ ...CP, textAlign: "right" }}>Close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const h = r.projection?.homeResults;
            const a = r.projection?.awayResults;
            return (
              <tr key={r.game.id}>
                <td style={CP}>{r.game.week}</td>
                <td style={CP}>
                  {r.game.awayTeam} @ {r.game.homeTeam}
                </td>
                {SYSTEM_KEYS.map((k: SystemKey) => (
                  <td key={k} style={{ ...CP, textAlign: "right" }}>
                    {h && a ? fmt(h[k] + a[k]) : "–"}
                  </td>
                ))}
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(r.projection?.projectedTotal)}</td>
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

function ShowMore({ rows }: { rows: EnrichedGameRow[] }) {
  const [open, setOpen] = useState(false);
  const [legacyTab, setLegacyTab] = useState<LegacyTab>("raw");

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} style={{ marginBottom: "1rem" }}>
      <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
        Show more (raw data, efficiency inputs, legacy composites)
      </summary>
      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {LEGACY_TABS.map((t) => (
              <button key={t} className={`mode-btn ${legacyTab === t ? "mode-btn-active" : ""}`} onClick={() => setLegacyTab(t)}>
                {LEGACY_TAB_LABELS[t]}
              </button>
            ))}
          </div>
          {legacyTab === "raw" && <RawDataTab rows={rows} />}
          {legacyTab === "inputs" && <EfficiencyInputsTab rows={rows} />}
          {legacyTab === "composites" && <LegacyCompositesTab rows={rows} />}
        </div>
      )}
    </details>
  );
}

type SortKey = "week" | "date" | "awayTeam" | "homeTeam" | "vegasTotal" | "myTotal" | "amountOff" | "stdDevOff";

function sortValue(b: BetRow, key: SortKey): number | string {
  switch (key) {
    case "week":
      return b.row.game.week;
    case "date":
      return b.row.game.startDate ?? "";
    case "awayTeam":
      return b.row.game.awayTeam;
    case "homeTeam":
      return b.row.game.homeTeam;
    case "vegasTotal":
      return b.vegasTotal ?? -Infinity;
    case "myTotal":
      return b.projectedTotal ?? -Infinity;
    case "amountOff":
      return b.amountOff ?? -Infinity;
    case "stdDevOff":
      return b.stdDevOff ?? -Infinity;
  }
}

function TotalsTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  const betRows = useMemo(() => buildBetRows(rows, settings.filterThresholdMultiplier), [rows, settings.filterThresholdMultiplier]);

  const [sortKey, setSortKey] = useState<SortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: string) {
    const k = key as SortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...betRows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [betRows, sortKey, sortDir]);

  const sh = (label: string, key: SortKey, align?: "right") => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align={align} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("Wk", "week")}
            {sh("Date", "date")}
            <th style={CP}>Kickoff</th>
            {sh("Away", "awayTeam")}
            {sh("Home", "homeTeam")}
            {sh("Vegas Total", "vegasTotal", "right")}
            {sh("My Total", "myTotal", "right")}
            <th style={{ ...CP, textAlign: "right" }}>EB</th>
            <th style={{ ...CP, textAlign: "right" }}>FB</th>
            {sh("Amt Off", "amountOff", "right")}
            {sh("Std Dev Off", "stdDevOff", "right")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => (
            <tr key={b.row.game.id}>
              <td style={CP}>{b.row.game.week}</td>
              <td style={CP}>{dateLabel(b.row.game.startDate)}</td>
              <td style={CP}>{kickoffLabel(b.row.game.startDate)}</td>
              <td style={CP}>{b.row.game.awayTeam}</td>
              <td style={CP}>{b.row.game.homeTeam}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(b.vegasTotal, 1)}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(b.projectedTotal)}</td>
              <td style={{ ...CP, textAlign: "right", color: b.call === "Over" ? "#8fd39a" : b.call === "Under" ? "#e07a7a" : undefined }}>
                {b.call ?? "–"}
              </td>
              <td
                style={{
                  ...CP,
                  textAlign: "right",
                  color: b.isFiltered ? (b.call === "Over" ? "#8fd39a" : "#e07a7a") : undefined,
                  fontWeight: b.isFiltered ? 700 : undefined,
                }}
              >
                {b.isFiltered ? b.call : "–"}
              </td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(b.amountOff)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(b.stdDevOff, 2)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={11} className="empty">
                No games.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GamePerformanceTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  const betRows = useMemo(() => buildBetRows(rows, settings.filterThresholdMultiplier), [rows, settings.filterThresholdMultiplier]);
  const segments = useMemo(() => computeGamePerformanceBreakdown(betRows), [betRows]);
  const buckets = useMemo(() => computeAmountOffDistribution(betRows), [betRows]);

  return (
    <div>
      <PerformanceTable segments={segments} />
      <h3 style={{ marginTop: "1.5rem", fontSize: "0.95rem" }}>Win% by Amount Off (every bet)</h3>
      <AmountOffChart buckets={buckets} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Team Totals — nested here as a tab per Chris, not a separate admin
// page. One row per GAME (not per team): pairs up the home/away
// TeamSplitBetRow entries buildTeamSplitBetRows produces for the same
// game.
// ---------------------------------------------------------------------
interface CombinedTeamRow {
  game: EnrichedGameRow;
  away: TeamSplitBetRow;
  home: TeamSplitBetRow;
}

function combineByGame(betRows: TeamSplitBetRow[]): CombinedTeamRow[] {
  const byGame = new Map<string, { away?: TeamSplitBetRow; home?: TeamSplitBetRow; game: EnrichedGameRow }>();
  for (const b of betRows) {
    const id = b.row.game.id;
    const entry = byGame.get(id) ?? { game: b.row };
    if (b.isHome) entry.home = b;
    else entry.away = b;
    byGame.set(id, entry);
  }
  const out: CombinedTeamRow[] = [];
  for (const { game, home, away } of byGame.values()) {
    if (home && away) out.push({ game, home, away });
  }
  return out;
}

type TeamSortKey =
  | "week"
  | "date"
  | "awayTeam"
  | "awayVegasTT"
  | "awayMyTT"
  | "awayAmountOff"
  | "awayStdDevOff"
  | "homeTeam"
  | "homeVegasTT"
  | "homeMyTT"
  | "homeAmountOff"
  | "homeStdDevOff";

function teamSortValue(r: CombinedTeamRow, key: TeamSortKey): number | string {
  switch (key) {
    case "week":
      return r.game.game.week;
    case "date":
      return r.game.game.startDate ?? "";
    case "awayTeam":
      return r.game.game.awayTeam;
    case "awayVegasTT":
      return r.away.vegasTeamTotal ?? -Infinity;
    case "awayMyTT":
      return r.away.myTeamTotal ?? -Infinity;
    case "awayAmountOff":
      return r.away.amountOff ?? -Infinity;
    case "awayStdDevOff":
      return r.away.stdDevOff ?? -Infinity;
    case "homeTeam":
      return r.game.game.homeTeam;
    case "homeVegasTT":
      return r.home.vegasTeamTotal ?? -Infinity;
    case "homeMyTT":
      return r.home.myTeamTotal ?? -Infinity;
    case "homeAmountOff":
      return r.home.amountOff ?? -Infinity;
    case "homeStdDevOff":
      return r.home.stdDevOff ?? -Infinity;
  }
}

function TeamTotalsTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  const betRows = useMemo(() => buildTeamSplitBetRows(rows, settings.filterThresholdMultiplier), [rows, settings.filterThresholdMultiplier]);
  const combined = useMemo(() => combineByGame(betRows), [betRows]);

  const [sortKey, setSortKey] = useState<TeamSortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: string) {
    const k = key as TeamSortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...combined].sort((a, b) => {
      const av = teamSortValue(a, sortKey);
      const bv = teamSortValue(b, sortKey);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [combined, sortKey, sortDir]);

  const sh = (label: string, key: TeamSortKey, align?: "right") => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align={align} />
  );

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        My TT = my total split by my spread. Vegas TT = Vegas's total split by Vegas's spread (derived — no real
        market team-total line synced). EB = every bet's call. FB = call shown only if it also clears the filter.
      </p>
      <div className="table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {sh("Wk", "week")}
              {sh("Date", "date")}
              <th style={CP}>Kickoff</th>
              {sh("Away", "awayTeam")}
              {sh("Away Vegas TT", "awayVegasTT", "right")}
              {sh("My Away TT", "awayMyTT", "right")}
              <th style={{ ...CP, textAlign: "right" }}>EB</th>
              <th style={{ ...CP, textAlign: "right" }}>FB</th>
              {sh("Amt Off", "awayAmountOff", "right")}
              {sh("Std Dev Off", "awayStdDevOff", "right")}
              {sh("Home", "homeTeam")}
              {sh("Home Vegas TT", "homeVegasTT", "right")}
              {sh("My Home TT", "homeMyTT", "right")}
              <th style={{ ...CP, textAlign: "right" }}>EB</th>
              <th style={{ ...CP, textAlign: "right" }}>FB</th>
              {sh("Amt Off", "homeAmountOff", "right")}
              {sh("Std Dev Off", "homeStdDevOff", "right")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.game.game.id}>
                <td style={CP}>{r.game.game.week}</td>
                <td style={CP}>{dateLabel(r.game.game.startDate)}</td>
                <td style={CP}>{kickoffLabel(r.game.game.startDate)}</td>
                <td style={CP}>{r.game.game.awayTeam}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away.vegasTeamTotal, 1)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(r.away.myTeamTotal, 1)}</td>
                <td style={{ ...CP, textAlign: "right", color: r.away.call === "Over" ? "#8fd39a" : r.away.call === "Under" ? "#e07a7a" : undefined }}>
                  {r.away.call ?? "–"}
                </td>
                <td
                  style={{
                    ...CP,
                    textAlign: "right",
                    color: r.away.isFiltered ? (r.away.call === "Over" ? "#8fd39a" : "#e07a7a") : undefined,
                    fontWeight: r.away.isFiltered ? 700 : undefined,
                  }}
                >
                  {r.away.isFiltered ? r.away.call : "–"}
                </td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away.amountOff, 1)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away.stdDevOff, 2)}</td>
                <td style={CP}>{r.game.game.homeTeam}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home.vegasTeamTotal, 1)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(r.home.myTeamTotal, 1)}</td>
                <td style={{ ...CP, textAlign: "right", color: r.home.call === "Over" ? "#8fd39a" : r.home.call === "Under" ? "#e07a7a" : undefined }}>
                  {r.home.call ?? "–"}
                </td>
                <td
                  style={{
                    ...CP,
                    textAlign: "right",
                    color: r.home.isFiltered ? (r.home.call === "Over" ? "#8fd39a" : "#e07a7a") : undefined,
                    fontWeight: r.home.isFiltered ? 700 : undefined,
                  }}
                >
                  {r.home.isFiltered ? r.home.call : "–"}
                </td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home.amountOff, 1)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home.stdDevOff, 2)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={17} className="empty">
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

function TeamPerformanceTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  const betRows = useMemo(() => buildTeamSplitBetRows(rows, settings.filterThresholdMultiplier), [rows, settings.filterThresholdMultiplier]);
  const segments = useMemo(() => computeTeamPerformanceBreakdown(betRows), [betRows]);
  const buckets = useMemo(() => computeAmountOffDistribution(betRows), [betRows]);

  return (
    <div>
      <PerformanceTable segments={segments} />
      <h3 style={{ marginTop: "1.5rem", fontSize: "0.95rem" }}>Win% by Amount Off (every bet)</h3>
      <AmountOffChart buckets={buckets} />
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

const SEASON_OPTIONS = [2026, 2025, 2024, 2023, 2022, 2021];

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
  const [tab, setTab] = useState<Tab>("totals");

  const [viewMode, setViewMode] = useState<ViewMode>("season");
  const [viewWeek, setViewWeek] = useState(1);
  const availableWeeks = useMemo(() => Array.from(new Set(rows.map((r) => r.game.week))).sort((a, b) => a - b), [rows]);
  const viewRows = useMemo(() => filterByViewMode(rows, viewMode, viewWeek), [rows, viewMode, viewWeek]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Totals</h2>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>
      <SyncControl season={season} />
      <details style={{ marginBottom: "1rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Or import team stats from CSV instead (no API calls, no timeout risk — games/lines above are
          always pulled live from CFBD either way)
        </summary>
        <div style={{ marginTop: "0.5rem" }}>
          <CsvImportControl season={season} />
        </div>
      </details>
      <SettingsBar settings={settings} setSettings={setSettings} season={season} />

      <WeekSeasonToggle mode={viewMode} setMode={setViewMode} week={viewWeek} setWeek={setViewWeek} availableWeeks={availableWeeks} />

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
          {tab === "totals" && (
            <>
              <TotalsTab rows={viewRows} settings={settings} />
              <ShowMore rows={viewRows} />
            </>
          )}
          {tab === "teamtotals" && <TeamTotalsTab rows={viewRows} settings={settings} />}
          {tab === "performance" && <GamePerformanceTab rows={viewRows} settings={settings} />}
          {tab === "teamperformance" && <TeamPerformanceTab rows={viewRows} settings={settings} />}
        </>
      )}
    </div>
  );
}
