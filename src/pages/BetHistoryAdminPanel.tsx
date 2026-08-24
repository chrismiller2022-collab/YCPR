import { useEffect, useMemo, useState, type ReactNode } from "react";
import { type BetHistoryRecord, BET_HISTORY } from "../data/betHistory.data";
import { availableConferences } from "../lib/survivor";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import {
  aggregatePlain,
  aggregateCustom,
  breakdownByConference,
  breakdownByTeam,
  filterRecords,
  winPct,
  computeErrorStatsFromBetHistory,
  computeSplitsPlain,
  computeSplitsCustom,
  computeAmountOffPoints,
  buildAmountOffMatrix,
  tallyAmountOffCustom,
  buildLiveBetHistoryRecords,
  DEFAULT_CUSTOM_PARAMS,
  type RecordTally,
  type BetHistoryFilters,
  type CustomParams,
  type BreakdownTriple,
  type CategorySplitTally,
  type SplitBucket,
  type AmountOffPoint,
  type HfaMode,
} from "../lib/betHistory";

const SEASONS = [2024, 2025, 2026];

// Any season in SEASONS with zero BET_HISTORY rows gets its data built
// live instead, from synced games/lines + live power ratings (see
// buildLiveBetHistoryRecords in lib/betHistory.ts). Computed once — both
// SEASONS and BET_HISTORY are static.
const LIVE_SEASONS = SEASONS.filter((s) => !BET_HISTORY.some((r) => r.season === s));

function fmtRecord(t: RecordTally) {
  return `${t.w}-${t.l}${t.push > 0 ? `-${t.push}` : ""}`;
}
function fmtPct(t: RecordTally) {
  return `${winPct(t).toFixed(1)}%`;
}

function ParamGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 10,
        padding: "1.1rem 1.2rem",
      }}
    >
      <div
        style={{
          fontSize: "0.8rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--gold)",
          marginBottom: "0.75rem",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function StatsBlock({
  title,
  overall,
  byWeek,
  compact,
}: {
  title: string;
  overall: RecordTally | undefined;
  byWeek: Map<number, RecordTally> | undefined;
  compact?: boolean;
}) {
  const safeOverall: RecordTally = overall ?? { w: 0, l: 0, push: 0 };
  const safeByWeek = byWeek ?? new Map<number, RecordTally>();
  const weeks = Array.from(safeByWeek.keys()).sort((a, b) => a - b);

  if (compact) {
    return (
      <div>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "baseline", marginBottom: "0.5rem" }}>
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1 }}>{fmtRecord(safeOverall)}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginTop: "0.15rem" }}>Record</div>
          </div>
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1 }}>{fmtPct(safeOverall)}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginTop: "0.15rem" }}>Win %</div>
          </div>
        </div>
        {weeks.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.76rem", color: "var(--chalk-dim)" }}>Weekly breakdown</summary>
            <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 6, marginTop: "0.4rem" }}>
              <table className="no-sticky-head" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.74rem" }}>
                <thead>
                  <tr>
                    <th className="th">Week</th>
                    <th className="th th-right">Record</th>
                    <th className="th th-right">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => {
                    const t = safeByWeek.get(w)!;
                    return (
                      <tr key={w}>
                        <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>Week {w}</td>
                        <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtRecord(t)}</td>
                        <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtPct(t)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div
        style={{
          padding: "1.1rem 1.3rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: "0.8rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--gold)",
            marginBottom: "0.6rem",
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", gap: "2.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{fmtRecord(safeOverall)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>Record</div>
          </div>
          <div>
            <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{fmtPct(safeOverall)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>Win %</div>
          </div>
        </div>
      </div>

      {weeks.length > 0 && (
        <details style={{ marginTop: "0.5rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--chalk-dim)", padding: "0.3rem 0.1rem" }}>
            Weekly breakdown
          </summary>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginTop: "0.5rem" }}>
            <table className="no-sticky-head" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th className="th">Week</th>
                  <th className="th th-right">Record</th>
                  <th className="th th-right">Win %</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const t = safeByWeek.get(w)!;
                  return (
                    <tr key={w}>
                      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week {w}</td>
                      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtRecord(t)}</td>
                      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtPct(t)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        </details>
      )}
    </div>
  );
}

function BreakdownTable({ title, breakdown, maxHeight }: { title: string; breakdown: BreakdownTriple; maxHeight?: number }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"group" | "everyBet" | "filteredBet" | "weightedFilteredBet">("group");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const groups = Array.from(
    new Set([...breakdown.everyBet.keys(), ...breakdown.filteredBet.keys(), ...breakdown.weightedFilteredBet.keys()])
  );

  const empty = { w: 0, l: 0, push: 0 };

  function handleSort(key: string) {
    const k = key as typeof sortKey;
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "group" ? "asc" : "desc"); // win% sorts best-first by default; name sorts A-first
    }
  }

  const mapFor = (key: "everyBet" | "filteredBet" | "weightedFilteredBet") =>
    key === "everyBet" ? breakdown.everyBet : key === "filteredBet" ? breakdown.filteredBet : breakdown.weightedFilteredBet;

  const filteredGroups = groups
    .filter((g) => !search.trim() || g.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "group") return sortDir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
      const av = winPct(mapFor(sortKey).get(a) ?? empty);
      const bv = winPct(mapFor(sortKey).get(b) ?? empty);
      return sortDir === "asc" ? av - bv : bv - av;
    });

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <div className="section-label" style={{ margin: 0 }}>
          {title}
        </div>
        <input
          placeholder="Filter rows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: "0.78rem", maxWidth: 180 }}
        />
      </div>
      {groups.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem" }}>No data for this breakdown yet.</p>
      ) : (
        <div className="table-scroll" style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: maxHeight ?? undefined }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <SortHeader
                  label={title.includes("Conference") ? "Conference" : "Team"}
                  sortKey="group"
                  active={sortKey === "group"}
                  dir={sortDir}
                  onClick={handleSort}
                />
                <SortHeader
                  label="Every Bet (Win %)"
                  sortKey="everyBet"
                  active={sortKey === "everyBet"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
                <SortHeader
                  label="Filtered Bet (Win %)"
                  sortKey="filteredBet"
                  active={sortKey === "filteredBet"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
                <SortHeader
                  label="Weighted Filtered (Win %)"
                  sortKey="weightedFilteredBet"
                  active={sortKey === "weightedFilteredBet"}
                  dir={sortDir}
                  onClick={handleSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g) => {
                const eb = breakdown.everyBet.get(g) ?? empty;
                const fb = breakdown.filteredBet.get(g) ?? empty;
                const wfb = breakdown.weightedFilteredBet.get(g) ?? empty;
                return (
                  <tr key={g}>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                      <TeamLogo team={g} /> {g}
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRecord(eb)} <span style={{ color: "var(--chalk-dim)" }}>({fmtPct(eb)})</span>
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fb.w + fb.l + fb.push > 0 ? (
                        <>
                          {fmtRecord(fb)} <span style={{ color: "var(--chalk-dim)" }}>({fmtPct(fb)})</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--chalk-dim)" }}>–</span>
                      )}
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {wfb.w + wfb.l + wfb.push > 0 ? (
                        <>
                          {fmtRecord(wfb)} <span style={{ color: "var(--chalk-dim)" }}>({fmtPct(wfb)})</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--chalk-dim)" }}>–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function ErrorStatsBlock({ errorStats }: { errorStats: ReturnType<typeof computeErrorStatsFromBetHistory> }) {
  const fmtNum = (v: number | null, digits = 2) => (v == null ? "–" : v.toFixed(digits));
  const fmtDelta = (v: number | null, digits = 2) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="section-label">ATS Stats</div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table className="no-sticky-head" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
          <thead>
            <tr>
              <th className="th"></th>
              <th className="th th-right">YC</th>
              <th className="th th-right">Vegas</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Abs Error</td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.yc.absError)}
              </td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.vegas.absError)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Median Abs Error</td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.yc.medianAbsError)}
              </td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.vegas.medianAbsError)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Mean Squared Error</td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.yc.mse)}
              </td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.vegas.mse)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Abs Error over Vegas</td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  borderBottom: "1px solid var(--hash)",
                  textAlign: "right",
                  color: errorStats.absErrorOverVegasYc != null && errorStats.absErrorOverVegasYc < 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.absErrorOverVegasYc)}
              </td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  borderBottom: "1px solid var(--hash)",
                  textAlign: "right",
                  color: errorStats.absErrorOverVegasYc != null && errorStats.absErrorOverVegasYc > 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.absErrorOverVegasYc != null ? -errorStats.absErrorOverVegasYc : null)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem" }}>MSE over Vegas</td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  textAlign: "right",
                  color: errorStats.mseOverVegasYc != null && errorStats.mseOverVegasYc < 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.mseOverVegasYc)}
              </td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  textAlign: "right",
                  color: errorStats.mseOverVegasYc != null && errorStats.mseOverVegasYc > 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.mseOverVegasYc != null ? -errorStats.mseOverVegasYc : null)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "0.5rem" }}>
        Same for both tabs — error metrics only depend on the raw spread/prediction/scores,
        not on the Custom tab's four adjustable parameters. Recomputes live from whatever
        filters are selected above.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Home / Away / Favorite / Underdog splits — one row per bet category
// (Every Game / Filtered / WFB / NWFB), one column per split. Combo cuts
// (e.g. "home favorite") are deliberately left out — too small a sample
// to be meaningful yet.
// ---------------------------------------------------------------------
function SplitCell({ t }: { t: RecordTally }) {
  return (
    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
      <div>{fmtRecord(t)}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{fmtPct(t)}</div>
    </td>
  );
}

const SPLIT_ROWS: { key: keyof CategorySplitTally; label: string }[] = [
  { key: "everyBet", label: "Every Game" },
  { key: "filteredBet", label: "Filtered Bet" },
  { key: "weightedFilteredBet", label: "WFB" },
  { key: "nwfb", label: "NWFB" },
];

function SplitsSection({ splits, hideNwfb }: { splits: CategorySplitTally; hideNwfb?: boolean }) {
  const rows = hideNwfb ? SPLIT_ROWS.filter((r) => r.key !== "nwfb") : SPLIT_ROWS;
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div className="section-label">Home / Away / Favorite / Underdog</div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
        Same four bet categories above, sliced by which side was picked. Favorite/underdog comes
        from the Vegas closing spread (true pick'ems excluded from that split). The second table
        below breaks out the four combos (home favorite, home underdog, away favorite, away
        underdog) — smaller samples than the plain splits, so treat with proportionally more
        caution.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table className="no-sticky-head" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th className="th">Bet Type</th>
              <th className="th th-right">Home</th>
              <th className="th th-right">Away</th>
              <th className="th th-right">Favorite</th>
              <th className="th th-right">Underdog</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const b: SplitBucket = splits[key];
              return (
                <tr key={key}>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{label}</td>
                  <SplitCell t={b.home} />
                  <SplitCell t={b.away} />
                  <SplitCell t={b.favorite} />
                  <SplitCell t={b.underdog} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "0.9rem", overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table className="no-sticky-head" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th className="th">Bet Type</th>
              <th className="th th-right">Home Favorite</th>
              <th className="th th-right">Home Underdog</th>
              <th className="th th-right">Away Favorite</th>
              <th className="th th-right">Away Underdog</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const b: SplitBucket = splits[key];
              return (
                <tr key={key}>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{label}</td>
                  <SplitCell t={b.homeFavorite} />
                  <SplitCell t={b.homeUnderdog} />
                  <SplitCell t={b.awayFavorite} />
                  <SplitCell t={b.awayUnderdog} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Amount-Off Matrix — every game bucketed by betting line (rows, signed
// from the picked team's own perspective unless "Abs values only" folds
// it) x "amount off >=" threshold (columns). A manual threshold-hunting
// tool, not a graded bet category. The custom row above the grid is an
// independent ad hoc calculator, always signed regardless of the grid's
// abs toggle — min=0/max=positive isolates underdog bets, min=negative/
// max=0 isolates favorite bets, purely as a byproduct of the plain range
// filter (no separate sign-detection logic needed).
// ---------------------------------------------------------------------
type MatrixStatMode = "total" | "win" | "loss" | "pct";
const MATRIX_STAT_TABS: { key: MatrixStatMode; label: string }[] = [
  { key: "total", label: "Total Games" },
  { key: "win", label: "Wins" },
  { key: "loss", label: "Losses" },
  { key: "pct", label: "Win %" },
];

function matrixCellText(t: RecordTally, mode: MatrixStatMode): string {
  if (mode === "total") return t.w + t.l + t.push > 0 ? String(t.w + t.l + t.push) : "–";
  if (mode === "win") return t.w > 0 ? String(t.w) : "–";
  if (mode === "loss") return t.l > 0 ? String(t.l) : "–";
  const decided = t.w + t.l;
  return decided === 0 ? "–" : `${winPct(t).toFixed(0)}%`;
}

/** Green above 50%, red below, fading to neutral near 50% — same idea as odds.ts's spreadColor but centered on win% instead of a spread. Cells with fewer than 5 decided games stay neutral (too small a sample to color meaningfully). */
function matrixCellBg(t: RecordTally, mode: MatrixStatMode): string | undefined {
  if (mode !== "pct") return undefined;
  const decided = t.w + t.l;
  if (decided < 5) return undefined;
  const pct = winPct(t);
  const clamp = Math.max(-25, Math.min(25, pct - 50));
  const favorite = [90, 168, 105];
  const neutral = [39, 45, 58];
  const underdog = [196, 92, 82];
  const k = Math.abs(clamp) / 25;
  const target = clamp >= 0 ? favorite : underdog;
  const [r, g, b] = neutral.map((n, i) => Math.round(n + (target[i] - n) * k));
  return `rgb(${r}, ${g}, ${b})`;
}

function fmtLineBucketLabel(min: number, max: number): string {
  return `${min} to ${max}`;
}

function AmountOffMatrixSection({ points }: { points: AmountOffPoint[] }) {
  const [absValues, setAbsValues] = useState(false);
  const [statMode, setStatMode] = useState<MatrixStatMode>("pct");
  const [customMin, setCustomMin] = useState(0);
  const [customMax, setCustomMax] = useState(10);
  const [customThreshold, setCustomThreshold] = useState(6);

  const matrix = useMemo(() => buildAmountOffMatrix(points, absValues), [points, absValues]);
  const customTally = useMemo(
    () => tallyAmountOffCustom(points, customMin, customMax, customThreshold),
    [points, customMin, customMax, customThreshold]
  );

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div className="section-label">Amount-Off Matrix</div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
        Every game (there's always a pick), rows = betting line, columns = the model's
        prediction was at least this many points off that line. "Abs values only" folds
        favorite/underdog into one 0-and-up axis instead of a signed -N to +N list.
      </p>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
          padding: "0.75rem 0.9rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
        }}
      >
        <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Custom min line{" "}
          <input type="number" step="0.5" value={customMin} onChange={(e) => setCustomMin(parseFloat(e.target.value) || 0)} style={{ width: 70 }} />
        </label>
        <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Custom max line{" "}
          <input type="number" step="0.5" value={customMax} onChange={(e) => setCustomMax(parseFloat(e.target.value) || 0)} style={{ width: 70 }} />
        </label>
        <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Amount off &gt;={" "}
          <input
            type="number"
            step="0.5"
            value={customThreshold}
            onChange={(e) => setCustomThreshold(parseFloat(e.target.value) || 0)}
            style={{ width: 70 }}
          />
        </label>
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, lineHeight: 1 }}>{fmtRecord(customTally)}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--chalk-dim)" }}>Record</div>
          </div>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, lineHeight: 1 }}>{fmtPct(customTally)}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--chalk-dim)" }}>Win %</div>
          </div>
        </div>
        <span style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
          Min 0 / max positive = underdog bets only. Min negative / max 0 = favorite bets only. Not color coded.
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {MATRIX_STAT_TABS.map((t) => (
          <button key={t.key} className={`mode-btn ${statMode === t.key ? "mode-btn-active" : ""}`} onClick={() => setStatMode(t.key)}>
            {t.label}
          </button>
        ))}
        <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginLeft: "0.5rem" }}>
          <input type="checkbox" checked={absValues} onChange={(e) => setAbsValues(e.target.checked)} /> Abs values only
        </label>
      </div>

      {matrix.lineBuckets.length === 0 || matrix.thresholds.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>No games match those filters.</p>
      ) : (
        <div className="table-scroll" style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 650 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.72rem" }}>
            <thead>
              <tr>
                <th
                  className="th"
                  style={{ position: "sticky", left: 0, zIndex: 21, background: "var(--turf)" }}
                >
                  Line
                </th>
                {matrix.thresholds.map((th) => (
                  <th key={th} className="th th-right">
                    &gt;= {th}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.lineBuckets.map((b, rowIdx) => (
                <tr key={`${b.min}-${b.max}`}>
                  <td
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderBottom: "1px solid var(--hash)",
                      position: "sticky",
                      left: 0,
                      background: "var(--turf-panel)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtLineBucketLabel(b.min, b.max)}
                  </td>
                  {matrix.thresholds.map((th, colIdx) => {
                    const t = matrix.cells[rowIdx][colIdx];
                    return (
                      <td
                        key={th}
                        style={{
                          padding: "0.25rem 0.5rem",
                          borderBottom: "1px solid var(--hash)",
                          textAlign: "right",
                          background: matrixCellBg(t, statMode),
                        }}
                      >
                        {matrixCellText(t, statMode)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterBar({ years, toggleYear, week, setWeek, confFilters, toggleConf, teamQuery, setTeamQuery, weeksAvailable, allConfs }: any) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        marginBottom: "1.5rem",
        padding: "0.9rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Seasons:</span>
      {SEASONS.map((y) => {
        const active = years.has(y);
        return (
          <button
            key={y}
            onClick={() => toggleYear(y)}
            style={{
              fontSize: "0.78rem",
              padding: "0.3rem 0.6rem",
              borderRadius: 6,
              border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
              background: active ? "var(--gold-dim)" : "transparent",
              color: active ? "var(--chalk)" : "var(--chalk-dim)",
              cursor: "pointer",
            }}
          >
            {y}
          </button>
        );
      })}

      <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
        Week{" "}
        <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
          <option value="all">All weeks</option>
          {weeksAvailable.map((w: number) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </label>

      <input placeholder="Search team…" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} style={{ minWidth: 150 }} />

      <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginLeft: "0.5rem" }}>Conferences (multi-select):</span>
      {["P4", "G6", ...allConfs].map((c: string) => {
        const active = confFilters.has(c);
        return (
          <button
            key={c}
            onClick={() => toggleConf(c)}
            style={{
              fontSize: "0.76rem",
              padding: "0.28rem 0.55rem",
              borderRadius: 6,
              border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
              background: active ? "var(--gold-dim)" : "transparent",
              color: active ? "var(--chalk)" : "var(--chalk-dim)",
              cursor: "pointer",
            }}
          >
            {c === "P4" ? "Power 4 (+ND)" : c === "G6" ? "Group of 6 (+UConn)" : c}
          </button>
        );
      })}
    </div>
  );
}

export default function BetHistoryAdminPanel({ onBack }: { onBack: () => void }) {
  const allConfs = useMemo(() => availableConferences(), []);
  const [tab, setTab] = useState<"plain" | "custom">("custom");

  const [years, setYears] = useState<Set<number>>(new Set(SEASONS));
  const [week, setWeek] = useState<number | "all">("all");
  const [confFilters, setConfFilters] = useState<Set<string>>(new Set());
  const [teamQuery, setTeamQuery] = useState("");

  const [params, setParams] = useState<CustomParams>({ ...DEFAULT_CUSTOM_PARAMS });

  // Live seasons (2026+, no BET_HISTORY upload) — fetched once on mount
  // and recomputed into BetHistoryRecord-shaped rows via
  // buildLiveBetHistoryRecords whenever ratings or the HFA toggle change,
  // then concatenated with the static upload before any filter is applied.
  const [hfaMode, setHfaMode] = useState<HfaMode>("team");
  const [liveGamesBySeason, setLiveGamesBySeason] = useState<Record<number, GameWithLines[]>>({});
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    if (LIVE_SEASONS.length === 0) return;
    Promise.all(LIVE_SEASONS.map((s) => fetchGamesWithLines(s).then((games) => [s, games] as const)))
      .then((pairs) => setLiveGamesBySeason(Object.fromEntries(pairs)))
      .catch(() => setLiveGamesBySeason({}));
  }, []);

  const liveRecords = useMemo(() => {
    const all: BetHistoryRecord[] = [];
    for (const s of LIVE_SEASONS) {
      all.push(...buildLiveBetHistoryRecords(liveGamesBySeason[s] ?? [], liveByTeam, hfaMode));
    }
    return all;
  }, [liveGamesBySeason, liveByTeam, hfaMode]);

  const allRecords = useMemo(() => [...BET_HISTORY, ...liveRecords], [liveRecords]);

  function toggleYear(y: number) {
    setYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  }

  function toggleConf(c: string) {
    setConfFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function setParam(key: keyof CustomParams, value: number) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  const filters: BetHistoryFilters = {
    years: Array.from(years),
    week: week === "all" ? null : week,
    confFilters: Array.from(confFilters),
    teamQuery,
  };

  const filtered = useMemo(
    () => filterRecords(allRecords, filters),
    [allRecords, filters.years.join(","), filters.week, filters.confFilters.join(","), filters.teamQuery]
  );

  const plainAgg = useMemo(() => aggregatePlain(filtered), [filtered]);
  const customAgg = useMemo(() => aggregateCustom(filtered, params), [filtered, params]);
  const errorStats = useMemo(() => computeErrorStatsFromBetHistory(filtered), [filtered]);
  const plainSplits = useMemo(() => computeSplitsPlain(filtered), [filtered]);
  const customSplits = useMemo(() => computeSplitsCustom(filtered, params), [filtered, params]);
  const amountOffPoints = useMemo(() => computeAmountOffPoints(filtered, params), [filtered, params]);

  const plainByConf = useMemo(() => breakdownByConference(filtered, "plain"), [filtered]);
  const plainByTeam = useMemo(() => breakdownByTeam(filtered, "plain"), [filtered]);
  const customByConf = useMemo(() => breakdownByConference(filtered, "custom", params), [filtered, params]);
  const customByTeam = useMemo(() => breakdownByTeam(filtered, "custom", params), [filtered, params]);

  const weeksAvailable = Array.from(new Set(filtered.map((r) => r.week))).sort((a, b) => a - b);

  function toWeekMap(
    agg: typeof plainAgg,
    which: "everyBet" | "filteredBet" | "weightedFilteredBet" | "nwfb" | "anyBet" | "matchAll3" | "filteredAndWfb" | "wfbAndNwfb" | "filteredAndNwfb"
  ) {
    const m = new Map<number, RecordTally>();
    for (const [w, v] of agg.byWeek) m.set(w, v[which] ?? { w: 0, l: 0, push: 0 });
    return m;
  }

  const isDefault =
    params.filterThreshold === DEFAULT_CUSTOM_PARAMS.filterThreshold &&
    params.minAbsLine === DEFAULT_CUSTOM_PARAMS.minAbsLine &&
    params.posThreshold === DEFAULT_CUSTOM_PARAMS.posThreshold &&
    params.negThreshold === DEFAULT_CUSTOM_PARAMS.negThreshold;

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Bet History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        <strong>Plain History</strong> shows the data exactly as uploaded — the actual
        historical record, unchanged. <strong>Custom</strong> ignores those precomputed
        columns and recomputes Every Bet / Filtered Bet / Weighted Filtered Bet fresh from the
        raw spread and prediction, live, as you adjust the four parameters below. Conferences
        are multi-select — pick more than one at once. Breakdown tables below slice all three
        categories by conference and by team.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button className={`mode-btn ${tab === "plain" ? "mode-btn-active" : ""}`} onClick={() => setTab("plain")}>
          Plain History
        </button>
        <button className={`mode-btn ${tab === "custom" ? "mode-btn-active" : ""}`} onClick={() => setTab("custom")}>
          Custom
        </button>
      </div>

      <FilterBar
        years={years}
        toggleYear={toggleYear}
        week={week}
        setWeek={setWeek}
        confFilters={confFilters}
        toggleConf={toggleConf}
        teamQuery={teamQuery}
        setTeamQuery={setTeamQuery}
        weeksAvailable={weeksAvailable}
        allConfs={allConfs}
      />

      {LIVE_SEASONS.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>HFA:</span>
          <select value={hfaMode} onChange={(e) => setHfaMode(e.target.value as HfaMode)}>
            <option value="team">Team-specific</option>
            <option value="flat">Flat 2.4</option>
          </select>
          <span style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
            Live seasons only ({LIVE_SEASONS.join(", ")}) — {SEASONS.filter((s) => !LIVE_SEASONS.includes(s)).join("/")} keeps using
            the uploaded historical prediction, no HFA recompute possible there.
          </span>
        </div>
      )}

      {tab === "custom" && (
        <div style={{ marginBottom: "0.75rem", display: "flex", justifyContent: "flex-end" }}>
          <button className="menu-btn" onClick={() => setParams({ ...DEFAULT_CUSTOM_PARAMS })} disabled={isDefault}>
            Reset all to defaults
          </button>
        </div>
      )}

      {allRecords.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No bet history data uploaded yet.</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No games match those filters.</p>
      ) : tab === "plain" ? (
        <>
          <StatsBlock title="Every Game Bet" overall={plainAgg.overall.everyBet} byWeek={toWeekMap(plainAgg, "everyBet")} />
          <StatsBlock title="Filtered Bet" overall={plainAgg.overall.filteredBet} byWeek={toWeekMap(plainAgg, "filteredBet")} />
          <StatsBlock
            title="Weighted Filtered Bet"
            overall={plainAgg.overall.weightedFilteredBet}
            byWeek={toWeekMap(plainAgg, "weightedFilteredBet")}
          />
          <SplitsSection splits={plainSplits.overall} hideNwfb />
          <ErrorStatsBlock errorStats={errorStats} />
          <AmountOffMatrixSection points={amountOffPoints} />
          <BreakdownTable title="Breakdown by Conference" breakdown={plainByConf} />
          <BreakdownTable title="Breakdown by Team" breakdown={plainByTeam} maxHeight={500} />
        </>
      ) : (
        <>
          <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
            "Any Bet" and the match/combo tiles below don't have their own thresholds — they're
            derived from the same six inputs used by Filtered / WFB / NWFB.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem", marginBottom: "1.25rem" }}>
            <ParamGroup title="Every Game Bet">
              <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.75rem" }}>No threshold — every game gets a lean.</p>
              <StatsBlock title="" overall={customAgg.overall.everyBet} byWeek={toWeekMap(customAgg, "everyBet")} compact />
            </ParamGroup>

            <ParamGroup title="Any Bet">
              <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.75rem" }}>
                Filtered OR WFB OR NWFB signals — counted once per game, not once per matching category.
              </p>
              <StatsBlock title="" overall={customAgg.overall.anyBet} byWeek={toWeekMap(customAgg, "anyBet")} compact />
            </ParamGroup>

            <ParamGroup title="Match Bet (All 3)">
              <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.75rem" }}>
                Filtered AND WFB AND NWFB all signal simultaneously — the strongest agreement.
              </p>
              <StatsBlock title="" overall={customAgg.overall.matchAll3} byWeek={toWeekMap(customAgg, "matchAll3")} compact />
            </ParamGroup>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem", marginBottom: "1.25rem" }}>
            <ParamGroup title="Filtered Bet">
              <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", display: "block", marginBottom: "0.75rem" }}>
                Abs amount off &gt;{" "}
                <input
                  type="number"
                  step="0.5"
                  value={params.filterThreshold}
                  onChange={(e) => setParam("filterThreshold", parseFloat(e.target.value) || 0)}
                  style={{ width: 70 }}
                />
              </label>
              <StatsBlock title="" overall={customAgg.overall.filteredBet} byWeek={toWeekMap(customAgg, "filteredBet")} compact />
            </ParamGroup>

            <ParamGroup title="WFB (Weighted Filtered Bet)">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                  Min abs betting line &gt; (no pick'ems){" "}
                  <input
                    type="number"
                    step="0.5"
                    value={params.minAbsLine}
                    onChange={(e) => setParam("minAbsLine", parseFloat(e.target.value) || 0)}
                    style={{ width: 70 }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                  Relative-off positive threshold &gt;{" "}
                  <input
                    type="number"
                    step="0.1"
                    value={params.posThreshold}
                    onChange={(e) => setParam("posThreshold", parseFloat(e.target.value) || 0)}
                    style={{ width: 70 }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                  Relative-off negative threshold &lt;{" "}
                  <input
                    type="number"
                    step="0.1"
                    value={params.negThreshold}
                    onChange={(e) => setParam("negThreshold", parseFloat(e.target.value) || 0)}
                    style={{ width: 70 }}
                  />
                </label>
              </div>
              <StatsBlock title="" overall={customAgg.overall.weightedFilteredBet} byWeek={toWeekMap(customAgg, "weightedFilteredBet")} compact />
            </ParamGroup>

            <ParamGroup title="NWFB">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                  Sigma divisor (abs amount off ÷ this){" "}
                  <input
                    type="number"
                    step="0.1"
                    value={params.sigmaDivisor ?? 15.7}
                    onChange={(e) => setParam("sigmaDivisor", parseFloat(e.target.value) || 0)}
                    style={{ width: 70 }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
                  Sigma Off must exceed{" "}
                  <input
                    type="number"
                    step="0.1"
                    value={params.sigmaThreshold ?? 0.4}
                    onChange={(e) => setParam("sigmaThreshold", parseFloat(e.target.value) || 0)}
                    style={{ width: 70 }}
                  />
                </label>
              </div>
              <StatsBlock title="" overall={customAgg.overall.nwfb ?? { w: 0, l: 0, push: 0 }} byWeek={toWeekMap(customAgg, "nwfb")} compact />
            </ParamGroup>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem", marginBottom: "1.5rem" }}>
            <ParamGroup title="Filtered + WFB Match">
              <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.75rem" }}>Both Filtered and WFB signal on this game.</p>
              <StatsBlock title="" overall={customAgg.overall.filteredAndWfb} byWeek={toWeekMap(customAgg, "filteredAndWfb")} compact />
            </ParamGroup>

            <ParamGroup title="WFB + NWFB Match">
              <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.75rem" }}>Both WFB and NWFB signal on this game.</p>
              <StatsBlock title="" overall={customAgg.overall.wfbAndNwfb} byWeek={toWeekMap(customAgg, "wfbAndNwfb")} compact />
            </ParamGroup>

            <ParamGroup title="Filtered + NWFB Match">
              <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.75rem" }}>Both Filtered and NWFB signal on this game.</p>
              <StatsBlock title="" overall={customAgg.overall.filteredAndNwfb} byWeek={toWeekMap(customAgg, "filteredAndNwfb")} compact />
            </ParamGroup>
          </div>

          <SplitsSection splits={customSplits.overall} />
          <ErrorStatsBlock errorStats={errorStats} />
          <AmountOffMatrixSection points={amountOffPoints} />
          <BreakdownTable title="Breakdown by Conference" breakdown={customByConf} />
          <BreakdownTable title="Breakdown by Team" breakdown={customByTeam} maxHeight={500} />
        </>
      )}
    </div>
  );
}
