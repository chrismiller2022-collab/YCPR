import { useState, type CSSProperties } from "react";
import {
  useGameTotalsEngine,
  buildTeamSplitBetRows,
  COMPOSITE_KEYS,
  COMPOSITE_LABELS,
  type CompositeKey,
  type EnrichedGameRow,
} from "../lib/gameTotalsEngine";
import { resolveSplitSpread, splitTeamTotal } from "../lib/gameTotals";
import { DEFAULT_GAME_TOTALS_SETTINGS, type GameTotalsSettings } from "../lib/api/gameTotalsData";
import { RawDataTab, EfficiencyInputsTab, SeasonPicker, SyncControl, CsvImportControl, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const TABS = ["raw", "inputs", "composites", "bets", "filtered", "performance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  raw: "Raw Data",
  inputs: "Efficiency Inputs",
  composites: "Team Composites",
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
        Spread source for team split{" "}
        <select
          className="filter"
          value={settings.spreadSource}
          onChange={(e) => setSettings({ ...settings, spreadSource: e.target.value })}
          style={{ marginLeft: 4 }}
        >
          <option value="vegas">All Vegas (blank if unsynced)</option>
          <option value="mine">All Mine (never blank)</option>
          <option value="vegas-fill-mine">Vegas, fill blanks with mine</option>
        </select>
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
      <span style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
        Weights/regression % are shared with Game Totals — edit those on that page.
      </span>
    </div>
  );
}

function TeamCompositesTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={CP}>Wk</th>
            <th style={CP}>Team</th>
            <th style={CP}>Opp</th>
            {COMPOSITE_KEYS.map((k) => (
              <th key={k} style={{ ...CP, textAlign: "right" }}>
                {k.replace("composite", "C")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const spread = resolveSplitSpread(settings.spreadSource, r.game.homeSpread, r.myHomeSpread ?? 0);
            return (
              <>
                <tr key={r.game.id + "-h"}>
                  <td style={CP}>{r.game.week}</td>
                  <td style={CP}>{r.game.homeTeam} (H)</td>
                  <td style={CP}>{r.game.awayTeam}</td>
                  {COMPOSITE_KEYS.map((k) => {
                    const split = splitTeamTotal(r.projection?.composites[k] ?? null, spread);
                    return (
                      <td key={k} style={{ ...CP, textAlign: "right" }}>
                        {fmt(split.home)}
                      </td>
                    );
                  })}
                </tr>
                <tr key={r.game.id + "-a"}>
                  <td style={CP}>{r.game.week}</td>
                  <td style={CP}>{r.game.awayTeam} (A)</td>
                  <td style={CP}>{r.game.homeTeam}</td>
                  {COMPOSITE_KEYS.map((k) => {
                    const split = splitTeamTotal(r.projection?.composites[k] ?? null, spread);
                    return (
                      <td key={k} style={{ ...CP, textAlign: "right" }}>
                        {fmt(split.away)}
                      </td>
                    );
                  })}
                </tr>
              </>
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

function TeamBetsTab({ rows, settings, filteredOnly }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings; filteredOnly: boolean }) {
  const [composite, setComposite] = useState<CompositeKey>("composite1");
  const betRows = buildTeamSplitBetRows(rows, composite, settings.filterThresholdMultiplier, settings.spreadSource);
  const shown = filteredOnly ? betRows.filter((b) => b.isFiltered) : betRows;

  return (
    <div>
      <CompositePicker value={composite} onChange={setComposite} />
      <div className="table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={CP}>Wk</th>
              <th style={CP}>Team</th>
              <th style={CP}>Opp</th>
              <th style={{ ...CP, textAlign: "right" }}>{COMPOSITE_LABELS[composite]}</th>
              <th style={{ ...CP, textAlign: "right" }}>Vegas Team Total</th>
              <th style={{ ...CP, textAlign: "right" }}>Amount Off</th>
              <th style={CP}>Call</th>
              {filteredOnly && <th style={CP}>Filtered</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((b, i) => (
              <tr key={b.row.game.id + "-" + b.team + "-" + i}>
                <td style={CP}>{b.row.game.week}</td>
                <td style={CP}>
                  {b.team} ({b.isHome ? "H" : "A"})
                </td>
                <td style={CP}>{b.isHome ? b.row.game.awayTeam : b.row.game.homeTeam}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmt(b.splitValue)}</td>
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
                <td colSpan={filteredOnly ? 8 : 7} className="empty">
                  No teams.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "0.5rem" }}>
        Two rows per game — one per team — so this list runs roughly double the length of Game Totals' Bets tab.
      </p>
    </div>
  );
}

function TeamPerformanceTab({ rows, settings }: { rows: EnrichedGameRow[]; settings: GameTotalsSettings }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
      {COMPOSITE_KEYS.map((key) => {
        const betRows = buildTeamSplitBetRows(rows, key, settings.filterThresholdMultiplier, settings.spreadSource);
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
            <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>All graded team totals</div>
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

export default function TeamTotalsAdminPanel({ onBack }: { onBack: () => void }) {
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
      <h2 style={{ marginTop: 0 }}>Team Totals</h2>

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
      <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "-0.5rem", marginBottom: "1rem" }}>
        Games, lines, and team stats are shared with Game Totals — importing/syncing here or there updates the same data.
      </p>
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
          {tab === "inputs" && <EfficiencyInputsTab rows={rows} />}
          {tab === "composites" && <TeamCompositesTab rows={rows} settings={settings} />}
          {tab === "bets" && <TeamBetsTab rows={rows} settings={settings} filteredOnly={false} />}
          {tab === "filtered" && <TeamBetsTab rows={rows} settings={settings} filteredOnly />}
          {tab === "performance" && <TeamPerformanceTab rows={rows} settings={settings} />}
        </>
      )}
    </div>
  );
}
