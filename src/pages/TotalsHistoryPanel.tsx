import { useMemo, useState } from "react";
import {
  DivisionPicker,
  filterRowsByDivision,
  GamePerformanceTab,
  TeamPerformanceTab,
  TotalsTab,
  TeamTotalsTab,
} from "./GameTotalsAdminPanel";
import { useMultiSeasonGameTotalsEngine } from "../lib/gameTotalsEngine";
import { WeekSeasonToggle, filterByViewMode, type ViewMode } from "./PerformanceView";

// Extracted from the Totals admin page's Performance/TT Performance
// tabs — Totals itself now shows just Totals/Team Totals (the live,
// per-game working view), while this page is specifically "how has the
// model performed historically." Reuses GamePerformanceTab/
// TeamPerformanceTab (now exported from GameTotalsAdminPanel.tsx)
// rather than duplicating them, and the same useMultiSeasonGameTotalsEngine/
// filterRowsByDivision/DivisionPicker every other Totals-related page
// already uses.
const TABS = ["performance", "teamperformance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { performance: "Performance", teamperformance: "TT Performance" };

const SEASON_OPTIONS = [2026, 2025, 2024, 2023, 2022, 2021];

// Per Chris: game-level data only makes sense (and is only shown) for a
// single selected season — across multiple seasons the season selector
// intentionally degrades to just cross-season performance rollups, not a
// "week 5 of every season at once" table.
function MultiSeasonPicker({ seasons, setSeasons }: { seasons: number[]; setSeasons: (s: number[]) => void }) {
  function toggle(year: number) {
    if (seasons.includes(year)) {
      if (seasons.length === 1) return; // always at least one season selected
      setSeasons(seasons.filter((y) => y !== year));
    } else {
      setSeasons([...seasons, year].sort((a, b) => b - a));
    }
  }
  return (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
      {SEASON_OPTIONS.map((y) => (
        <label key={y} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem" }}>
          <input type="checkbox" checked={seasons.includes(y)} onChange={() => toggle(y)} />
          {y}
        </label>
      ))}
    </div>
  );
}

export default function TotalsHistoryPanel({ onBack }: { onBack: () => void }) {
  const [seasons, setSeasons] = useState<number[]>([new Date().getFullYear()]);
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, settings, loading, error } = useMultiSeasonGameTotalsEngine(seasons);
  const rows = filterRowsByDivision(allRows, division);
  const [tab, setTab] = useState<Tab>("performance");
  const singleSeason = seasons.length === 1;

  const [viewMode, setViewMode] = useState<ViewMode>("season");
  const [viewWeek, setViewWeek] = useState(1);
  const availableWeeks = useMemo(() => Array.from(new Set(rows.map((r) => r.game.week))).sort((a, b) => a - b), [rows]);
  // Forced to the whole-season view once more than one season is
  // selected — "week 5" spans different games in different seasons, so
  // a single week filter across seasons isn't a meaningful slice.
  const effectiveViewMode: ViewMode = singleSeason ? viewMode : "season";
  const viewRows = useMemo(() => filterByViewMode(rows, effectiveViewMode, viewWeek), [rows, effectiveViewMode, viewWeek]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Totals History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        How the Totals model has actually performed — for the live per-game working view, see
        Totals or Matchups instead. Pick one season to also see that season's game-by-game data below;
        multiple seasons shows performance across all of them, without the game-level breakdown.
      </p>

      <MultiSeasonPicker seasons={seasons} setSeasons={setSeasons} />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>

      {singleSeason && (
        <WeekSeasonToggle mode={viewMode} setMode={setViewMode} week={viewWeek} setWeek={setViewWeek} availableWeeks={availableWeeks} />
      )}

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

          {singleSeason && (
            <div style={{ marginTop: "2rem" }}>
              <h3>Game-by-game — {seasons[0]}</h3>
              {tab === "performance" && <TotalsTab rows={viewRows} settings={settings} />}
              {tab === "teamperformance" && <TeamTotalsTab rows={viewRows} settings={settings} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
