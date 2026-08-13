import { useEffect, useMemo, useState } from "react";
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
                <td style={CP}>{r.game.away_team}</td>
                <td style={CP}>{r.game.home_team}</td>
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
  const [tab, setTab] = useState<"spreads" | "cover" | "filtered" | "nwfb" | "results">("spreads");
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
