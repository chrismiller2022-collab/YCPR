import { Fragment, useMemo, useState } from "react";
import {
  DivisionPicker,
  filterRowsByDivision,
  GamePerformanceTab,
  TeamPerformanceTab,
  TotalsTab,
  TeamTotalsTab,
} from "./GameTotalsAdminPanel";
import {
  useMultiSeasonGameTotalsEngine,
  computeTotalsKeyNumberStudy,
  TOTALS_KEY_NUMBER_TIERS,
  type TotalsKeyNumberTally,
} from "../lib/gameTotalsEngine";
import { WeekSeasonToggle, filterByViewMode, type ViewMode } from "./PerformanceView";

const KEY_NUMBER_MIN_SEASON = 2026;

function fmtTallyRecord(t: TotalsKeyNumberTally): string {
  return `${t.w}-${t.l}${t.push > 0 ? `-${t.push}` : ""}`;
}
function tallyGames(t: TotalsKeyNumberTally): number {
  return t.w + t.l + t.push;
}
function fmtTallyPct(t: TotalsKeyNumberTally): string {
  const decided = t.w + t.l;
  return decided === 0 ? "–" : `${((t.w / decided) * 100).toFixed(1)}%`;
}

function KeyNumberTallyCells({ tally }: { tally: TotalsKeyNumberTally }) {
  return (
    <>
      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{tallyGames(tally)}</td>
      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtTallyRecord(tally)}</td>
      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 700 }}>
        {fmtTallyPct(tally)}
      </td>
    </>
  );
}

function TotalsKeyNumbersSection({ rows, hasEligibleSeason }: { rows: ReturnType<typeof useMultiSeasonGameTotalsEngine>["rows"]; hasEligibleSeason: boolean }) {
  const study = useMemo(() => computeTotalsKeyNumberStudy(rows), [rows]);

  if (!hasEligibleSeason) {
    return (
      <p style={{ color: "var(--chalk-dim)" }}>
        Check {KEY_NUMBER_MIN_SEASON} or a later season above to see this study — it's live-only, {KEY_NUMBER_MIN_SEASON}+, with no
        historical backfill for earlier seasons.
      </p>
    );
  }

  const headerRow = (
    <tr>
      <th style={{ textAlign: "left", padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }} rowSpan={2}>
        Key Number
      </th>
      <th style={{ textAlign: "center", padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }} colSpan={3}>
        Under
      </th>
      <th style={{ textAlign: "center", padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }} colSpan={3}>
        Over
      </th>
    </tr>
  );
  const subHeaderRow = (
    <tr>
      <th style={{ textAlign: "right", padding: "0.2rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 400, fontSize: "0.72rem" }}>
        Games
      </th>
      <th style={{ textAlign: "right", padding: "0.2rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 400, fontSize: "0.72rem" }}>
        Record
      </th>
      <th style={{ textAlign: "right", padding: "0.2rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 400, fontSize: "0.72rem" }}>
        Win %
      </th>
      <th style={{ textAlign: "right", padding: "0.2rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 400, fontSize: "0.72rem" }}>
        Games
      </th>
      <th style={{ textAlign: "right", padding: "0.2rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 400, fontSize: "0.72rem" }}>
        Record
      </th>
      <th style={{ textAlign: "right", padding: "0.2rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 400, fontSize: "0.72rem" }}>
        Win %
      </th>
    </tr>
  );

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0, marginBottom: "1.25rem" }}>
        How the Totals model performs when my projected total and Vegas's total straddle a real scoring key number.
        Under rows are games where my total is at or below that key number and Vegas's is above it (I project the
        Under to cover); Over rows are the mirror image. Live-only, {KEY_NUMBER_MIN_SEASON}+ — no historical
        backfill. "Pooled" counts a game once if it clears at least one key number in that group, not once per key
        number it happens to clear.
      </p>

      <div className="section-label" style={{ marginBottom: "0.5rem" }}>
        Pooled — All Key Numbers
      </div>
      <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            {headerRow}
            {subHeaderRow}
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", fontWeight: 700 }}>{study.pooledAll.label}</td>
              <KeyNumberTallyCells tally={study.pooledAll.under} />
              <KeyNumberTallyCells tally={study.pooledAll.over} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-label" style={{ marginBottom: "0.5rem" }}>
        Pooled by Tier
      </div>
      <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            {headerRow}
            {subHeaderRow}
          </thead>
          <tbody>
            {study.byTier.map((t) => (
              <tr key={t.label}>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{t.label}</td>
                <KeyNumberTallyCells tally={t.under} />
                <KeyNumberTallyCells tally={t.over} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-label" style={{ marginBottom: "0.5rem" }}>
        Pooled — Cumulative Tiers
      </div>
      <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            {headerRow}
            {subHeaderRow}
          </thead>
          <tbody>
            {study.cumulativeTiers.map((t) => (
              <tr key={t.label}>
                <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{t.label}</td>
                <KeyNumberTallyCells tally={t.under} />
                <KeyNumberTallyCells tally={t.over} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-label" style={{ marginBottom: "0.5rem" }}>
        Individual Key Numbers
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            {headerRow}
            {subHeaderRow}
          </thead>
          <tbody>
            {study.byKey.map((r, i) => {
              const isNewTier = i === 0 || study.byKey[i - 1].tier !== r.tier;
              return (
                <Fragment key={r.key}>
                  {isNewTier && (
                    <tr>
                      <td colSpan={7} style={{ padding: "0.5rem 0.6rem 0.2rem", fontSize: "0.75rem", color: "var(--gold)", fontWeight: 700 }}>
                        {TOTALS_KEY_NUMBER_TIERS[r.tier - 1].label}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.key}</td>
                    <KeyNumberTallyCells tally={r.under} />
                    <KeyNumberTallyCells tally={r.over} />
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Extracted from the Totals admin page's Performance/TT Performance
// tabs — Totals itself now shows just Totals/Team Totals (the live,
// per-game working view), while this page is specifically "how has the
// model performed historically." Reuses GamePerformanceTab/
// TeamPerformanceTab (now exported from GameTotalsAdminPanel.tsx)
// rather than duplicating them, and the same useMultiSeasonGameTotalsEngine/
// filterRowsByDivision/DivisionPicker every other Totals-related page
// already uses.
const TABS = ["performance", "teamperformance", "keynumbers"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { performance: "Performance", teamperformance: "TT Performance", keynumbers: "Key Numbers" };

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

  // Key Numbers is always restricted to KEY_NUMBER_MIN_SEASON+, regardless
  // of what's checked above for the other tabs — a separate, independently
  // fetched row set rather than trying to filter the merged multi-season
  // rows after the fact (EnrichedGameRow doesn't carry a season field to
  // filter on once seasons are merged).
  const keyNumberSeasons = useMemo(() => seasons.filter((s) => s >= KEY_NUMBER_MIN_SEASON), [seasons]);
  const { rows: keyNumberAllRows, loading: keyNumberLoading } = useMultiSeasonGameTotalsEngine(keyNumberSeasons);
  const keyNumberRows = useMemo(() => filterRowsByDivision(keyNumberAllRows, division), [keyNumberAllRows, division]);

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

      {singleSeason && tab !== "keynumbers" && (
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

      {tab === "keynumbers" ? (
        keyNumberLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <TotalsKeyNumbersSection rows={keyNumberRows} hasEligibleSeason={keyNumberSeasons.length > 0} />
        )
      ) : loading ? (
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
