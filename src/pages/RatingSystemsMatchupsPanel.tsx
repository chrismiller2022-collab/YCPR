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
import { ATS_BREAKEVEN_PCT, computeRow, type MatchupComputed } from "../lib/matchupsCompute";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";
import { CHART_WIDTH, CHART_ROW_HEIGHT, computeDomain, SpreadChartHeader, SpreadChartRow } from "../components/SystemSpreadChart";
import { MatchupsRow, MatchupsHeaderRow, BettingStatsBlock, sortValue as matchupSortValue, compareValues } from "./AdminMatchupsPanel";

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
// Single System tab — one rating system treated as if it were my own: its
// saved ratings for each game's week feed the same computeRow (projected
// spread, cover team, Filtered/WFB/NWFB/WTF, bet size, win %, EV) and the
// same row/column layout as the regular admin Matchups page. Games whose
// week has no saved snapshot are skipped (except weeks after the latest
// snapshot, which preview against it, like the other tabs); games where
// either team has no value for this system are skipped and counted rather
// than silently falling back to YC's numbers. Projection locks are never
// applied — they freeze MY numbers, not another system's.
// ---------------------------------------------------------------------
function SingleSystemTab({
  games,
  ratingsByWeek,
  latestSavedWeek,
  liveByTeam,
  systemKey,
  setSystemKey,
  weekLabel,
}: {
  games: GameWithLines[];
  ratingsByWeek: Map<number, Record<string, Record<string, number>>>;
  latestSavedWeek: number | null;
  liveByTeam: Record<string, any>;
  systemKey: string;
  setSystemKey: (k: string) => void;
  weekLabel: string;
}) {
  const [mode, setMode] = useState<"spreads" | "moneyline">("spreads");
  const [hideNoLine, setHideNoLine] = useState(false);
  const [completedFilter, setCompletedFilter] = useState<"all" | "hideCompleted" | "completedOnly">("all");
  const [gradeLine, setGradeLine] = useState<"close" | "open">("close");
  const [mlEvThreshold, setMlEvThreshold] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>("betSize");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const label = RATING_SYSTEMS.find((s) => s.key === systemKey)?.label ?? systemKey;

  // Per saved week: liveByTeam with each team's rating swapped for this
  // system's value (HFA and everything else untouched).
  const synthByWeek = useMemo(() => {
    const out = new Map<number, Record<string, any>>();
    for (const [wk, byTeam] of ratingsByWeek) {
      const m: Record<string, any> = {};
      for (const [team, vals] of Object.entries(byTeam)) {
        const v = vals[systemKey];
        if (v == null) continue;
        m[team] = { ...liveByTeam[team], rating: v };
      }
      out.set(wk, m);
    }
    return out;
  }, [ratingsByWeek, liveByTeam, systemKey]);

  const { rows, skipped } = useMemo(() => {
    let skippedCount = 0;
    const computed: MatchupComputed[] = [];
    for (const g of games) {
      const snapWeek = ratingsByWeek.has(g.week) ? g.week : latestSavedWeek != null && g.week > latestSavedWeek ? latestSavedWeek : null;
      const synth = snapWeek != null ? synthByWeek.get(snapWeek) : undefined;
      if (!synth) continue;
      if (synth[g.away_team] == null || synth[g.home_team] == null) {
        skippedCount++;
        continue;
      }
      computed.push(computeRow(g, synth, "team", DEFAULT_CUSTOM_PARAMS, null, gradeLine));
    }
    return { rows: computed, skipped: skippedCount };
  }, [games, ratingsByWeek, latestSavedWeek, synthByWeek, gradeLine]);

  const visibleRows = useMemo(
    () =>
      rows.filter((c) => {
        const isCompleted = c.game.away_points != null && c.game.home_points != null;
        if (completedFilter === "hideCompleted" && isCompleted) return false;
        if (completedFilter === "completedOnly" && !isCompleted) return false;
        if (!hideNoLine) return true;
        return mode === "spreads" ? c.vegasAwaySpread != null : c.vegasMoneyline != null;
      }),
    [rows, completedFilter, hideNoLine, mode]
  );
  const sortedRows = useMemo(
    () => (sortKey ? [...visibleRows].sort((a, b) => compareValues(matchupSortValue(a, mode, sortKey), matchupSortValue(b, mode, sortKey), sortDir)) : visibleRows),
    [visibleRows, mode, sortKey, sortDir]
  );
  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const labelStyle: React.CSSProperties = { fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" };

  return (
    <div>
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <label style={labelStyle}>
          System:
          <select className="filter" value={systemKey} onChange={(e) => setSystemKey(e.target.value)}>
            {RATING_SYSTEMS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          {(
            [
              ["spreads", "Spreads"],
              ["moneyline", "Moneylines"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              className={`mode-btn ${mode === k ? "mode-btn-active" : ""}`}
              onClick={() => {
                setMode(k);
                setSortKey(k === "spreads" ? "betSize" : null);
                setSortDir("desc");
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <label style={labelStyle} title="Opening: only games with an opening line are graded — no fallback to the closing line">
          Grade vs:
          <select className="filter" value={gradeLine} onChange={(e) => setGradeLine(e.target.value as "close" | "open")}>
            <option value="close">Closing line</option>
            <option value="open">Opening line</option>
          </select>
        </label>
        <label style={labelStyle}>
          <input type="checkbox" checked={hideNoLine} onChange={(e) => setHideNoLine(e.target.checked)} />
          Hide games with no Vegas {mode === "spreads" ? "line" : "moneyline"}
        </label>
        <label style={labelStyle}>
          Games:
          <select className="filter" value={completedFilter} onChange={(e) => setCompletedFilter(e.target.value as "all" | "hideCompleted" | "completedOnly")}>
            <option value="all">All</option>
            <option value="hideCompleted">Hide completed</option>
            <option value="completedOnly">Completed only</option>
          </select>
        </label>
        {mode === "moneyline" && (
          <label style={labelStyle}>
            Filtered Bet EV threshold:
            <input type="range" min={0} max={30} step={0.5} value={mlEvThreshold} onChange={(e) => setMlEvThreshold(parseFloat(e.target.value))} style={{ width: 160 }} />
            <span style={{ fontWeight: 700, minWidth: 40 }}>{mlEvThreshold.toFixed(1)}%</span>
          </label>
        )}
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: 0 }}>
        {label}'s saved ratings for each game's week, run through the same math as Admin Matchups — spread = away rating − home rating + home-field advantage (current HFA
        values). Not YC's projection locks.
        {skipped > 0 && ` ${skipped} game${skipped === 1 ? "" : "s"} skipped: ${label} has no saved rating for one of the teams.`}
      </p>

      {sortedRows.length === 0 ? (
        <div className="empty matchups-empty">No games match these filters.</div>
      ) : (
        <div className="table-wrap" style={{ maxWidth: "none" }}>
          <div className="table-scroll">
            <table className="matchups-table" style={{ width: "100%" }}>
              <thead>
                <MatchupsHeaderRow mode={mode} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} showSelect={false} />
              </thead>
              <tbody>
                {sortedRows.map((c) => (
                  <MatchupsRow key={c.game.id} computed={c} mode={mode} mlEvThreshold={mlEvThreshold} showSelect={false} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {sortedRows.length > 0 && <BettingStatsBlock rows={sortedRows} label={label} title={`${label} — ${weekLabel} Betting Stats`} />}
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
  const [tab, setTab] = useState<"spreads" | "spreadchart" | "amountoff" | "cover" | "filtered" | "nwfb" | "results" | "system">("spreads");
  const [systemKey, setSystemKey] = useState("yc");
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
  const weekGames = useMemo(() => weekRows.map((r) => r.game), [weekRows]);
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
        <button className={`mode-btn ${tab === "system" ? "mode-btn-active" : ""}`} onClick={() => setTab("system")}>
          Single System
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
          {tab === "system" && (
            <SingleSystemTab
              games={weekGames}
              ratingsByWeek={ratingsByWeek}
              latestSavedWeek={latestSavedWeek}
              liveByTeam={liveByTeam}
              systemKey={systemKey}
              setSystemKey={setSystemKey}
              weekLabel={week === "all" ? "Season" : `Week ${week}`}
            />
          )}
        </>
      )}
    </div>
  );
}
