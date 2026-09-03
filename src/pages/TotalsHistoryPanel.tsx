import { useMemo, useState } from "react";
import {
  SeasonPicker,
  DivisionPicker,
  filterRowsByDivision,
  GamePerformanceTab,
  TeamPerformanceTab,
} from "./GameTotalsAdminPanel";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { WeekSeasonToggle, filterByViewMode, type ViewMode } from "./PerformanceView";

// Extracted from the Totals admin page's Performance/TT Performance
// tabs — Totals itself now shows just Totals/Team Totals (the live,
// per-game working view), while this page is specifically "how has the
// model performed historically." Reuses GamePerformanceTab/
// TeamPerformanceTab (now exported from GameTotalsAdminPanel.tsx)
// rather than duplicating them, and the same useGameTotalsEngine/
// filterRowsByDivision/SeasonPicker/DivisionPicker every other Totals-
// related page already uses.
const TABS = ["performance", "teamperformance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { performance: "Performance", teamperformance: "TT Performance" };

export default function TotalsHistoryPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, settings, loading, error } = useGameTotalsEngine(season);
  const rows = filterRowsByDivision(allRows, division);
  const [tab, setTab] = useState<Tab>("performance");

  const [viewMode, setViewMode] = useState<ViewMode>("season");
  const [viewWeek, setViewWeek] = useState(1);
  const availableWeeks = useMemo(() => Array.from(new Set(rows.map((r) => r.game.week))).sort((a, b) => a - b), [rows]);
  const viewRows = useMemo(() => filterByViewMode(rows, viewMode, viewWeek), [rows, viewMode, viewWeek]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Totals History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        How the Totals model has actually performed — for the live per-game working view, see
        Totals or Matchups instead.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>

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
          {tab === "performance" && <GamePerformanceTab rows={viewRows} settings={settings} />}
          {tab === "teamperformance" && <TeamPerformanceTab rows={viewRows} settings={settings} />}
        </>
      )}
    </div>
  );
}
