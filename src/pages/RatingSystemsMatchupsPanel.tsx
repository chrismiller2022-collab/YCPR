import { useEffect, useMemo, useState } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLink from "../components/TeamLink";
import { TEAMS_BY_NAME, CONFERENCES } from "../data/teams";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchWeeklyPowerRatings, type WeeklyPowerRatingRow } from "../lib/api/ratingSystems";
import { RATING_SYSTEMS } from "../lib/ratingSystems";
import {
  buildRatingsByTeam,
  computeMultiSystemRow,
  aggregateSystemPerformance,
  winPct,
  type MultiSystemGameRow,
} from "../lib/multiRatingMatchups";
import { ATS_BREAKEVEN_PCT } from "../lib/matchupsCompute";

const CP: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  fontSize: "0.76rem",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  whiteSpace: "nowrap",
};

// Date/Time, Away, Home and Vegas Spread stay pinned while the per-system
// columns scroll horizontally. Fixed widths make each column's left
// offset (the sum of the ones before it) predictable.
const STICKY_COLS = [
  { width: 118, left: 0 },
  { width: 160, left: 118 },
  { width: 160, left: 278 },
  { width: 84, left: 438 },
];
function stickyStyle(i: number, isHeader: boolean): React.CSSProperties {
  const { width, left } = STICKY_COLS[i];
  return {
    position: "sticky",
    left,
    width,
    minWidth: width,
    maxWidth: width,
    overflow: "hidden",
    textOverflow: "ellipsis",
    zIndex: isHeader ? 21 : 5,
    background: isHeader ? "var(--turf)" : "var(--turf-panel)",
    ...(i === STICKY_COLS.length - 1 ? { borderRight: "1px solid var(--hash)" } : {}),
  };
}

// How far a system's projected spread is from the Vegas line, in
// points (absolute — direction is what the Cover Team tab is for).
function amountOff(row: MultiSystemGameRow, systemKey: string): number | null {
  const proj = row.systems[systemKey]?.projAwaySpread;
  if (proj == null || row.vegasAwaySpread == null) return null;
  return Math.abs(proj - row.vegasAwaySpread);
}
// One cell per system: who that system is on (its projected cover
// team), the spread it projects for that team, and how far that is from
// Vegas — "Kansas -3.2 · off 2.3". Sorting the tab by a system column
// orders games by that last number.
function betCell(row: MultiSystemGameRow, systemKey: string): string {
  const sys = row.systems[systemKey];
  const off = amountOff(row, systemKey);
  if (!sys || sys.projAwaySpread == null || sys.projCoverTeam == null || off == null) return "–";
  const team = sys.projCoverTeam === "away" ? row.game.away_team : row.game.home_team;
  const teamSpread = sys.projCoverTeam === "away" ? sys.projAwaySpread : -sys.projAwaySpread;
  return `${team} ${fmtSpread(teamSpread)} · off ${off.toFixed(1)}`;
}

function fmtSpread(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function teamName(game: GameWithLines, side: "away" | "home" | "push" | null) {
  if (side === "away") return game.away_team;
  if (side === "home") return game.home_team;
  return side === "push" ? "Push" : "–";
}

// ---------------------------------------------------------------------
// Shared filter bar.
// ---------------------------------------------------------------------
function FilterBar({
  season,
  setSeason,
  week,
  setWeek,
  weeks,
  divFilter,
  setDivFilter,
  confFilter,
  setConfFilter,
}: any) {
  return (
    <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
      <label>
        Season{" "}
        <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 80 }} />
      </label>
      <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
        <option value="all">All weeks</option>
        {weeks.map((w: number) => (
          <option key={w} value={w}>
            Week {w}
          </option>
        ))}
      </select>
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
  );
}

// ---------------------------------------------------------------------
// Spreads / Cover Team tabs share a base layout — only the per-system
// cell differs (projected spread vs projected cover team name).
// ---------------------------------------------------------------------
function GamesTable({
  rows: rawRows,
  cell,
  sortValue,
}: {
  rows: MultiSystemGameRow[];
  cell: (row: MultiSystemGameRow, systemKey: string) => string;
  // When provided, system column headers become clickable sorts on this
  // numeric value (click again to flip direction).
  sortValue?: (row: MultiSystemGameRow, systemKey: string) => number | null;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const rows = useMemo(() => {
    if (!sortKey || !sortValue) return rawRows;
    return [...rawRows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rawRows, sortKey, sortDir, sortValue]);
  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th className="th" style={{ ...CP, ...stickyStyle(0, true) }}>Date/Time</th>
            <th className="th" style={{ ...CP, ...stickyStyle(1, true) }}>Away</th>
            <th className="th" style={{ ...CP, ...stickyStyle(2, true) }}>Home</th>
            <th className="th th-right" style={{ ...CP, ...stickyStyle(3, true) }}>Vegas Spread</th>
            <th className="th th-right" style={CP}>Away Score</th>
            <th className="th th-right" style={CP}>Home Score</th>
            <th className="th th-right" style={CP}>Final Diff</th>
            {RATING_SYSTEMS.map((s) => (
              <th
                key={s.key}
                className="th th-right"
                style={{ ...CP, cursor: sortValue ? "pointer" : undefined }}
                onClick={sortValue ? () => toggleSort(s.key) : undefined}
              >
                {s.label}
                {sortValue && sortKey === s.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const finalDiff =
              r.game.completed && r.game.away_points != null && r.game.home_points != null
                ? r.game.away_points - r.game.home_points
                : null;
            return (
              <tr key={r.game.id}>
                <td style={{ ...CP, ...stickyStyle(0, false) }}>{fmtDateTime(r.game.start_date)}</td>
                <td style={{ ...CP, ...stickyStyle(1, false) }}>
                  <TeamLink team={r.game.away_team} />
                </td>
                <td style={{ ...CP, ...stickyStyle(2, false) }}>
                  <TeamLink team={r.game.home_team} />
                </td>
                <td style={{ ...CP, ...stickyStyle(3, false), textAlign: "right" }}>{fmtSpread(r.vegasAwaySpread)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{r.game.away_points ?? "–"}</td>
                <td style={{ ...CP, textAlign: "right" }}>{r.game.home_points ?? "–"}</td>
                <td style={{ ...CP, textAlign: "right" }}>{finalDiff != null ? finalDiff : "–"}</td>
                {RATING_SYSTEMS.map((s) => (
                  <td key={s.key} style={{ ...CP, textAlign: "right" }}>
                    {cell(r, s.key)}
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td style={CP} colSpan={7 + RATING_SYSTEMS.length}>
                No games match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Spread Chart tab — dot plot of every system's projected away-oriented
// spread (negative = away favored, so "away wins by 7" plots at -7, same
// convention as projAwaySpread everywhere else in this file), alongside a
// black tick for the Vegas line and a green tick for the actual result once
// the game's final. YC gets a star-in-circle marker instead of a plain dot
// so it stands out among ~20 systems. Every row in the current filtered
// view shares one x-axis domain/scale so spreads are visually comparable
// game to game — one tick header, stacked rows underneath, left identity
// column pinned while the chart scrolls.
// ---------------------------------------------------------------------
const CHART_WIDTH = 900;
const CHART_ROW_HEIGHT = 40;
const TICK_STEP = 7;

function actualAwaySpread(game: GameWithLines): number | null {
  if (!game.completed || game.away_points == null || game.home_points == null) return null;
  return game.home_points - game.away_points; // away wins by X -> -X, same convention as projAwaySpread
}

interface ChartDomain {
  min: number;
  max: number;
  ticks: number[];
}

function computeDomain(rows: MultiSystemGameRow[]): ChartDomain {
  const values: number[] = [];
  for (const r of rows) {
    if (r.vegasAwaySpread != null) values.push(r.vegasAwaySpread);
    const act = actualAwaySpread(r.game);
    if (act != null) values.push(act);
    for (const s of RATING_SYSTEMS) {
      const v = r.systems[s.key]?.projAwaySpread;
      if (v != null) values.push(v);
    }
  }
  if (values.length === 0) return { min: -7, max: 7, ticks: [7, 0, -7] };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = Math.floor((rawMin - TICK_STEP) / TICK_STEP) * TICK_STEP;
  const max = Math.ceil((rawMax + TICK_STEP) / TICK_STEP) * TICK_STEP;
  const ticks: number[] = [];
  for (let t = max; t >= min; t -= TICK_STEP) ticks.push(t);
  return { min, max, ticks };
}

// Left = domain.max (positive / away underdog), right = domain.min
// (negative / away favorite) — matches the reference chart's orientation.
function xPct(value: number, domain: ChartDomain): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 50;
  return ((domain.max - value) / span) * 100;
}

function SpreadChartHeader({ domain }: { domain: ChartDomain }) {
  return (
    <div style={{ position: "relative", height: 24, minWidth: CHART_WIDTH, borderBottom: "1px solid var(--hash)" }}>
      {domain.ticks.map((t) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: `${xPct(t, domain)}%`,
            transform: "translateX(-50%)",
            fontSize: "0.68rem",
            color: "var(--chalk-dim)",
            whiteSpace: "nowrap",
          }}
        >
          {t.toFixed(1)}
        </div>
      ))}
    </div>
  );
}

function SpreadChartRow({ row, domain }: { row: MultiSystemGameRow; domain: ChartDomain }) {
  const act = actualAwaySpread(row.game);

  return (
    <div
      style={{
        position: "relative",
        height: CHART_ROW_HEIGHT,
        minWidth: CHART_WIDTH,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {domain.ticks.map((t) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: `${xPct(t, domain)}%`,
            top: 0,
            bottom: 0,
            borderLeft: t === 0 ? "1px dashed rgba(255,255,255,0.25)" : "1px dashed rgba(255,255,255,0.08)",
          }}
        />
      ))}

      {row.vegasAwaySpread != null && (
        <div
          className="cell-tip cell-tip-above"
          data-tip={`Vegas: ${fmtSpread(row.vegasAwaySpread)}`}
          style={{
            position: "absolute",
            left: `${xPct(row.vegasAwaySpread, domain)}%`,
            top: 4,
            bottom: 4,
            width: 2,
            background: "#f4f2ea",
            transform: "translateX(-50%)",
          }}
        />
      )}

      {act != null && (
        <div
          className="cell-tip cell-tip-above"
          data-tip={`Result: ${fmtSpread(act)}`}
          style={{
            position: "absolute",
            left: `${xPct(act, domain)}%`,
            top: 4,
            bottom: 4,
            width: 2,
            background: "#3ecf5e",
            transform: "translateX(-50%)",
          }}
        />
      )}

      {RATING_SYSTEMS.map((s, i) => {
        const v = row.systems[s.key]?.projAwaySpread;
        if (v == null) return null;
        const isYc = s.key === "yc";
        const jitter = ((i % 5) - 2) * 4;
        return (
          <div
            key={s.key}
            className="cell-tip cell-tip-above"
            data-tip={`${s.label}: ${fmtSpread(v)}`}
            style={{
              position: "absolute",
              left: `${xPct(v, domain)}%`,
              top: `calc(50% + ${jitter}px)`,
              transform: "translate(-50%, -50%)",
              zIndex: isYc ? 5 : 1,
            }}
          >
            {isYc ? (
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--gold)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #14152b",
                  fontSize: "0.65rem",
                  lineHeight: 1,
                  color: "#14152b",
                }}
              >
                ★
              </div>
            ) : (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(0,0,0,0.4)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SpreadChartTab({ rows: allRows }: { rows: MultiSystemGameRow[] }) {
  const [linesOnly, setLinesOnly] = useState(false);
  const rows = useMemo(
    () => (linesOnly ? allRows.filter((r) => r.vegasAwaySpread != null) : allRows),
    [allRows, linesOnly]
  );
  const domain = useMemo(() => computeDomain(rows), [rows]);

  return (
    <div>
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
          <input type="checkbox" checked={linesOnly} onChange={(e) => setLinesOnly(e.target.checked)} />
          Vegas lines only (hide games with no line)
        </label>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <div style={{ display: "flex", minWidth: 340 + CHART_WIDTH }}>
          <div style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--turf-panel)", minWidth: 340 }}>
            <div style={{ height: 24, borderBottom: "1px solid var(--hash)" }} />
            {rows.map((r) => (
              <div
                key={r.game.id}
                style={{
                  height: CHART_ROW_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0 0.5rem",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  fontSize: "0.76rem",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: "var(--chalk-dim)" }}>Wk {r.game.week}</span>
                <span style={{ color: "var(--chalk-dim)" }}>{fmtDateTime(r.game.start_date)}</span>
                <span><TeamLink team={r.game.away_team} /></span>
                <span style={{ color: "var(--chalk-dim)" }}>@</span>
                <span><TeamLink team={r.game.home_team} /></span>
                <span style={{ color: "var(--chalk-dim)" }}>Vegas {fmtSpread(r.vegasAwaySpread)}</span>
              </div>
            ))}
            {rows.length === 0 && <div style={{ padding: "0.5rem", fontSize: "0.8rem" }}>No games match these filters.</div>}
          </div>
          <div>
            <SpreadChartHeader domain={domain} />
            {rows.map((r) => (
              <SpreadChartRow key={r.game.id} row={r} domain={domain} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Results tab — per-system Every Bet / Filtered Bet / NWFB records, week
// and season, with live win % prominent.
// ---------------------------------------------------------------------
function ResultsTable({ weekRows, seasonRows }: { weekRows: MultiSystemGameRow[]; seasonRows: MultiSystemGameRow[] }) {
  const weekPerf = useMemo(() => aggregateSystemPerformance(weekRows), [weekRows]);
  const seasonPerf = useMemo(() => aggregateSystemPerformance(seasonRows), [seasonRows]);

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th className="th" style={CP}>System</th>
            <th className="th th-right" style={CP}>Week Every Bet</th>
            <th className="th th-right" style={CP}>Week Filtered</th>
            <th className="th th-right" style={CP}>Week NWFB</th>
            <th className="th th-right" style={CP}>Season Every Bet</th>
            <th className="th th-right" style={CP}>Season Filtered</th>
            <th className="th th-right" style={CP}>Season NWFB</th>
          </tr>
        </thead>
        <tbody>
          {RATING_SYSTEMS.map((s) => {
            const wk = weekPerf[s.key];
            const sn = seasonPerf[s.key];
            const fmt = (r: { w: number; l: number; push: number }) =>
              `${r.w}-${r.l}${r.push ? `-${r.push}` : ""} (${winPct(r).toFixed(1)}%)`;
            // Green/red against the same ATS breakeven baseline used
            // site-wide (52.38%, the fixed -110 vig threshold) — not a
            // plain 50/50 split, and not colored at all with zero
            // decided bets (a system with no record yet isn't "bad").
            const perfColor = (r: { w: number; l: number; push: number }) => {
              const decided = r.w + r.l;
              if (decided === 0) return undefined;
              return winPct(r) >= ATS_BREAKEVEN_PCT * 100 ? "#8fd39a" : "#e07a7a";
            };
            return (
              <tr key={s.key}>
                <td style={{ ...CP, fontWeight: 700 }}>{s.label}</td>
                <td style={{ ...CP, textAlign: "right", color: perfColor(wk.everyBet) }}>{fmt(wk.everyBet)}</td>
                <td style={{ ...CP, textAlign: "right", color: perfColor(wk.filteredBet) }}>{fmt(wk.filteredBet)}</td>
                <td style={{ ...CP, textAlign: "right", color: perfColor(wk.nwfb) }}>{fmt(wk.nwfb)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700, color: perfColor(sn.everyBet) ?? "var(--gold)" }}>{fmt(sn.everyBet)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700, color: perfColor(sn.filteredBet) ?? "var(--gold)" }}>{fmt(sn.filteredBet)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700, color: perfColor(sn.nwfb) ?? "var(--gold)" }}>{fmt(sn.nwfb)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Top-level panel.
// ---------------------------------------------------------------------
export default function RatingSystemsMatchupsPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState<"all" | number>("all");
  useDefaultToAdminWeek(setWeek);
  const [tab, setTab] = useState<"spreads" | "spreadchart" | "amountoff" | "cover" | "filtered" | "nwfb" | "results">("spreads");
  const [divFilter, setDivFilter] = useState<"all" | "FBS" | "FCS">("FBS");
  const [confFilter, setConfFilter] = useState("");
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [weekly, setWeekly] = useState<WeeklyPowerRatingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchGamesWithLines(season), fetchWeeklyPowerRatings(season)])
      .then(([g, w]) => {
        setGames(g);
        setWeekly(w);
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [season]);

  const savedWeeks = useMemo(() => Array.from(new Set(weekly.map((r) => r.week))).sort((a, b) => a - b), [weekly]);

  // Group ratings by week so each game is graded against ITS OWN week's
  // saved snapshot — ratings move week to week, so a season-wide grade
  // has to use whichever week's numbers were actually live for that game.
  const ratingsByWeek = useMemo(() => {
    const byWeek = new Map<number, WeeklyPowerRatingRow[]>();
    for (const r of weekly) {
      const list = byWeek.get(r.week) ?? [];
      list.push(r);
      byWeek.set(r.week, list);
    }
    const out = new Map<number, Record<string, Record<string, number>>>();
    for (const [wk, rows] of byWeek) out.set(wk, buildRatingsByTeam(rows));
    return out;
  }, [weekly]);

  const passesFilters = (g: GameWithLines) => {
    const home = TEAMS_BY_NAME[g.home_team];
    if (!home) return false;
    if (divFilter !== "all" && home.div !== divFilter) return false;
    if (confFilter && home.conf !== confFilter) return false;
    return true;
  };

  // Only games in a week that actually has a saved ratings snapshot can be
  // graded at all — this is expected: performance tracking builds up from
  // the first saved week forward, it doesn't retroactively backfill weeks
  // that were never saved.
  const allGradedRows = useMemo(() => {
    const out: MultiSystemGameRow[] = [];
    for (const g of games) {
      if (!passesFilters(g)) continue;
      const ratingsByTeam = ratingsByWeek.get(g.week);
      if (!ratingsByTeam) continue;
      out.push(computeMultiSystemRow(g, ratingsByTeam, liveByTeam));
    }
    return out;
  }, [games, ratingsByWeek, divFilter, confFilter, liveByTeam]);

  // A week with lines synced but no saved ratings snapshot yet (the
  // usual state early in a week) used to vanish from every tab entirely
  // — no Vegas line, no proj cover, no bets — because a game was only
  // shown if its own week had a snapshot. Preview those weeks against
  // the most recent saved snapshot instead. Deliberately kept out of
  // the Results tab (allGradedRows), which must only ever grade a game
  // against the snapshot that was actually live for it.
  const latestSavedWeek = savedWeeks.length > 0 ? savedWeeks[savedWeeks.length - 1] : null;
  const previewRows = useMemo(() => {
    if (latestSavedWeek == null) return [];
    const ratingsByTeam = ratingsByWeek.get(latestSavedWeek);
    if (!ratingsByTeam) return [];
    const out: MultiSystemGameRow[] = [];
    for (const g of games) {
      if (g.week <= latestSavedWeek || !passesFilters(g)) continue;
      out.push(computeMultiSystemRow(g, ratingsByTeam, liveByTeam));
    }
    return out;
  }, [games, ratingsByWeek, latestSavedWeek, divFilter, confFilter, liveByTeam]);
  const previewWeeks = useMemo(
    () =>
      Array.from(new Set(previewRows.filter((r) => r.vegasAwaySpread != null).map((r) => r.game.week))).sort((a, b) => a - b),
    [previewRows]
  );
  const displayRows = useMemo(() => [...allGradedRows, ...previewRows], [allGradedRows, previewRows]);

  const weekRows = useMemo(
    () => (week === "all" ? displayRows : displayRows.filter((r) => r.game.week === week)),
    [displayRows, week]
  );
  const resultsWeekRows = useMemo(
    () => (week === "all" ? allGradedRows : allGradedRows.filter((r) => r.game.week === week)),
    [allGradedRows, week]
  );

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Rating Systems Matchups</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Only weeks with a saved Rating Systems snapshot (Save As Week) show up here — grading uses each game's own
        week's saved ratings, not the current live pulls.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <button className={`mode-btn ${tab === "spreads" ? "mode-btn-active" : ""}`} onClick={() => setTab("spreads")}>
          Proj Spreads
        </button>
        <button className={`mode-btn ${tab === "spreadchart" ? "mode-btn-active" : ""}`} onClick={() => setTab("spreadchart")}>
          Spread Chart
        </button>
        <button className={`mode-btn ${tab === "amountoff" ? "mode-btn-active" : ""}`} onClick={() => setTab("amountoff")}>
          Bets + Amount Off
        </button>
        <button className={`mode-btn ${tab === "cover" ? "mode-btn-active" : ""}`} onClick={() => setTab("cover")}>
          Proj Cover Team
        </button>
        <button className={`mode-btn ${tab === "filtered" ? "mode-btn-active" : ""}`} onClick={() => setTab("filtered")}>
          Filtered Bets
        </button>
        <button className={`mode-btn ${tab === "nwfb" ? "mode-btn-active" : ""}`} onClick={() => setTab("nwfb")}>
          NWFB
        </button>
        <button className={`mode-btn ${tab === "results" ? "mode-btn-active" : ""}`} onClick={() => setTab("results")}>
          Results
        </button>
      </div>

      <FilterBar
        season={season}
        setSeason={setSeason}
        week={week}
        setWeek={setWeek}
        weeks={[...savedWeeks, ...previewWeeks]}
        divFilter={divFilter}
        setDivFilter={setDivFilter}
        confFilter={confFilter}
        setConfFilter={setConfFilter}
      />

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {tab === "spreads" && <GamesTable rows={weekRows} cell={(r, key) => fmtSpread(r.systems[key]?.projAwaySpread ?? null)} sortValue={(r, key) => r.systems[key]?.projAwaySpread ?? null} />}
          {tab === "spreadchart" && <SpreadChartTab rows={weekRows} />}
          {tab === "amountoff" && (
            <GamesTable
              rows={weekRows}
              cell={(r, key) => betCell(r, key)}
              sortValue={amountOff}
            />
          )}
          {tab === "cover" && (
            <GamesTable rows={weekRows} cell={(r, key) => teamName(r.game, r.systems[key]?.projCoverTeam ?? null)} />
          )}
          {tab === "filtered" && (
            <GamesTable rows={weekRows} cell={(r, key) => teamName(r.game, r.systems[key]?.filteredBetTeam ?? null)} />
          )}
          {tab === "nwfb" && (
            <GamesTable rows={weekRows} cell={(r, key) => teamName(r.game, r.systems[key]?.nwfbTeam ?? null)} />
          )}
          {tab === "results" && <ResultsTable weekRows={resultsWeekRows} seasonRows={allGradedRows} />}
        </>
      )}
    </div>
  );
}
