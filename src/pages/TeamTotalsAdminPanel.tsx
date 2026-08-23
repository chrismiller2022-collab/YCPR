import { useMemo, useState, type CSSProperties } from "react";
import SortHeader from "../components/SortHeader";
import {
  useGameTotalsEngine,
  buildTeamSplitBetRows,
  computeTeamPerformanceBreakdown,
  computeAmountOffDistribution,
  type EnrichedGameRow,
  type TeamSplitBetRow,
} from "../lib/gameTotalsEngine";
import { DEFAULT_GAME_TOTALS_SETTINGS, type GameTotalsSettings } from "../lib/api/gameTotalsData";
import { SeasonPicker, SyncControl, CsvImportControl, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";
import { WeekSeasonToggle, filterByViewMode, PerformanceTable, AmountOffChart, type ViewMode } from "./PerformanceView";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const TABS = ["totals", "performance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { totals: "Team Totals", performance: "Performance" };

function fmt(v: number | null | undefined, digits = 1): string {
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
        My TT = my total split by my spread. Vegas TT = Vegas's total split by Vegas's spread (derived — no real
        market team-total line synced). EB = every bet's call. FB = call shown only if it also clears the filter.
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

// ---------------------------------------------------------------------
// One row per GAME (not per team) — pairs up the home/away
// TeamSplitBetRow entries buildTeamSplitBetRows produces for the same
// game, per Chris: "Each row should be the game, not the team vs opponent."
// ---------------------------------------------------------------------
interface CombinedRow {
  game: EnrichedGameRow;
  away: TeamSplitBetRow;
  home: TeamSplitBetRow;
}

function combineByGame(betRows: TeamSplitBetRow[]): CombinedRow[] {
  const byGame = new Map<string, { away?: TeamSplitBetRow; home?: TeamSplitBetRow; game: EnrichedGameRow }>();
  for (const b of betRows) {
    const id = b.row.game.id;
    const entry = byGame.get(id) ?? { game: b.row };
    if (b.isHome) entry.home = b;
    else entry.away = b;
    byGame.set(id, entry);
  }
  const out: CombinedRow[] = [];
  for (const { game, home, away } of byGame.values()) {
    if (home && away) out.push({ game, home, away });
  }
  return out;
}

type SortKey =
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

function sortValue(r: CombinedRow, key: SortKey): number | string {
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
    return [...combined].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [combined, sortKey, sortDir]);

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
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away.vegasTeamTotal)}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(r.away.myTeamTotal)}</td>
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
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away.amountOff)}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.away.stdDevOff, 2)}</td>
              <td style={CP}>{r.game.game.homeTeam}</td>
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home.vegasTeamTotal)}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(r.home.myTeamTotal)}</td>
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
              <td style={{ ...CP, textAlign: "right" }}>{fmt(r.home.amountOff)}</td>
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

export default function TeamTotalsAdminPanel({ onBack }: { onBack: () => void }) {
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
      <h2 style={{ marginTop: 0 }}>Team Totals</h2>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>

      <SyncControl season={season} />
      <details style={{ marginBottom: "1rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Or import team stats from CSV instead (no API calls, no timeout risk — games/lines above are always
          pulled live from CFBD either way)
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
          {tab === "totals" && <TeamTotalsTab rows={viewRows} settings={settings} />}
          {tab === "performance" && <TeamPerformanceTab rows={viewRows} settings={settings} />}
        </>
      )}
    </div>
  );
}
