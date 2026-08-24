import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
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

const CP: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  fontSize: "0.76rem",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  whiteSpace: "nowrap",
};

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
  rows,
  cell,
}: {
  rows: MultiSystemGameRow[];
  cell: (row: MultiSystemGameRow, systemKey: string) => string;
}) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th className="th" style={CP}>Date/Time</th>
            <th className="th" style={CP}>Away</th>
            <th className="th" style={CP}>Home</th>
            <th className="th th-right" style={CP}>Vegas Spread</th>
            <th className="th th-right" style={CP}>Away Score</th>
            <th className="th th-right" style={CP}>Home Score</th>
            <th className="th th-right" style={CP}>Final Diff</th>
            {RATING_SYSTEMS.map((s) => (
              <th key={s.key} className="th th-right" style={CP}>
                {s.label}
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
                <td style={CP}>{fmtDateTime(r.game.start_date)}</td>
                <td style={CP}>
                  <TeamLogo team={r.game.away_team} /> {r.game.away_team}
                </td>
                <td style={CP}>
                  <TeamLogo team={r.game.home_team} /> {r.game.home_team}
                </td>
                <td style={{ ...CP, textAlign: "right" }}>{fmtSpread(r.vegasAwaySpread)}</td>
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
          className="cell-tip"
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
          className="cell-tip"
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
            className="cell-tip"
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
                <span><TeamLogo team={r.game.away_team} /> {r.game.away_team}</span>
                <span style={{ color: "var(--chalk-dim)" }}>@</span>
                <span><TeamLogo team={r.game.home_team} /> {r.game.home_team}</span>
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
            return (
              <tr key={s.key}>
                <td style={{ ...CP, fontWeight: 700 }}>{s.label}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(wk.everyBet)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(wk.filteredBet)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(wk.nwfb)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700, color: "var(--gold)" }}>{fmt(sn.everyBet)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700, color: "var(--gold)" }}>{fmt(sn.filteredBet)}</td>
                <td style={{ ...CP, textAlign: "right", fontWeight: 700, color: "var(--gold)" }}>{fmt(sn.nwfb)}</td>
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
  const [tab, setTab] = useState<"spreads" | "spreadchart" | "cover" | "filtered" | "nwfb" | "results">("spreads");
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

  const weekRows = useMemo(
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
        weeks={savedWeeks}
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
          {tab === "spreads" && <GamesTable rows={weekRows} cell={(r, key) => fmtSpread(r.systems[key]?.projAwaySpread ?? null)} />}
          {tab === "spreadchart" && <SpreadChartTab rows={weekRows} />}
          {tab === "cover" && (
            <GamesTable rows={weekRows} cell={(r, key) => teamName(r.game, r.systems[key]?.projCoverTeam ?? null)} />
          )}
          {tab === "filtered" && (
            <GamesTable rows={weekRows} cell={(r, key) => teamName(r.game, r.systems[key]?.filteredBetTeam ?? null)} />
          )}
          {tab === "nwfb" && (
            <GamesTable rows={weekRows} cell={(r, key) => teamName(r.game, r.systems[key]?.nwfbTeam ?? null)} />
          )}
          {tab === "results" && <ResultsTable weekRows={weekRows} seasonRows={allGradedRows} />}
        </>
      )}
    </div>
  );
}
