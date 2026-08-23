import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import SortHeader from "../components/SortHeader";
import { splitTeamTotal } from "../lib/gameTotals";
import { useGameTotalsEngine, type EnrichedGameRow } from "../lib/gameTotalsEngine";
import { SeasonPicker, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";
import { WeekSeasonToggle, filterByViewMode, type ViewMode } from "./PerformanceView";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(digits);
}
function fmtSpread(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function dateLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}
function kickoffLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------
// One combined per-game prediction record — both my numbers and Vegas's,
// so the three views below can just pick which columns to show rather
// than recomputing anything.
// ---------------------------------------------------------------------
interface PredRow {
  game: EnrichedGameRow;
  myAwayTT: number | null;
  myHomeTT: number | null;
  vegasAwayTT: number | null;
  vegasHomeTT: number | null;
  myAwaySpread: number | null;
  myHomeSpread: number | null;
  vegasAwaySpread: number | null;
  vegasHomeSpread: number | null;
  myTotal: number | null;
  vegasTotal: number | null;
}

function buildPredRows(rows: EnrichedGameRow[]): PredRow[] {
  return rows.map((row) => {
    const myTotal = row.projection?.projectedTotal ?? null;
    const vegasTotal = row.odds.vegasTotal;
    const mySplit = splitTeamTotal(myTotal, row.myHomeSpread ?? 0);
    const vegasSplit = splitTeamTotal(vegasTotal, row.game.homeSpread);
    return {
      game: row,
      myAwayTT: mySplit.away,
      myHomeTT: mySplit.home,
      vegasAwayTT: vegasSplit.away,
      vegasHomeTT: vegasSplit.home,
      myAwaySpread: row.myHomeSpread != null ? -row.myHomeSpread : null,
      myHomeSpread: row.myHomeSpread,
      vegasAwaySpread: row.game.homeSpread != null ? -row.game.homeSpread : null,
      vegasHomeSpread: row.game.homeSpread,
      myTotal,
      vegasTotal,
    };
  });
}

interface Column {
  key: string;
  label: string;
  align?: "right";
  value: (r: PredRow) => number | string;
  render: (r: PredRow) => ReactNode;
}

const baseCols: Column[] = [
  { key: "week", label: "Wk", value: (r) => r.game.game.week, render: (r) => r.game.game.week },
  { key: "date", label: "Date", value: (r) => r.game.game.startDate ?? "", render: (r) => dateLabel(r.game.game.startDate) },
];
const kickoffCol: Column = { key: "kickoff", label: "Kickoff", value: (r) => r.game.game.startDate ?? "", render: (r) => kickoffLabel(r.game.game.startDate) };
const awayCol: Column = { key: "away", label: "Away", value: (r) => r.game.game.awayTeam, render: (r) => r.game.game.awayTeam };
const homeCol: Column = { key: "home", label: "Home", value: (r) => r.game.game.homeTeam, render: (r) => r.game.game.homeTeam };

const MINE_COLUMNS: Column[] = [
  ...baseCols,
  kickoffCol,
  awayCol,
  { key: "myAwayTT", label: "Away TT (mine)", align: "right", value: (r) => r.myAwayTT ?? -Infinity, render: (r) => fmt(r.myAwayTT) },
  { key: "myHomeTT", label: "Home TT (mine)", align: "right", value: (r) => r.myHomeTT ?? -Infinity, render: (r) => fmt(r.myHomeTT) },
  homeCol,
  { key: "myAwaySpread", label: "My Away Spread", align: "right", value: (r) => r.myAwaySpread ?? -Infinity, render: (r) => fmtSpread(r.myAwaySpread) },
  { key: "myHomeSpread", label: "My Home Spread", align: "right", value: (r) => r.myHomeSpread ?? -Infinity, render: (r) => fmtSpread(r.myHomeSpread) },
  { key: "myTotal", label: "My Total", align: "right", value: (r) => r.myTotal ?? -Infinity, render: (r) => fmt(r.myTotal) },
];

const VEGAS_COLUMNS: Column[] = [
  ...baseCols,
  kickoffCol,
  awayCol,
  { key: "vegasAwayTT", label: "Away TT (Vegas)", align: "right", value: (r) => r.vegasAwayTT ?? -Infinity, render: (r) => fmt(r.vegasAwayTT) },
  { key: "vegasHomeTT", label: "Home TT (Vegas)", align: "right", value: (r) => r.vegasHomeTT ?? -Infinity, render: (r) => fmt(r.vegasHomeTT) },
  homeCol,
  { key: "vegasAwaySpread", label: "Vegas Away Spread", align: "right", value: (r) => r.vegasAwaySpread ?? -Infinity, render: (r) => fmtSpread(r.vegasAwaySpread) },
  { key: "vegasHomeSpread", label: "Vegas Home Spread", align: "right", value: (r) => r.vegasHomeSpread ?? -Infinity, render: (r) => fmtSpread(r.vegasHomeSpread) },
  { key: "vegasTotal", label: "Vegas Total", align: "right", value: (r) => r.vegasTotal ?? -Infinity, render: (r) => fmt(r.vegasTotal) },
];

const COMBINED_COLUMNS: Column[] = [
  ...baseCols,
  kickoffCol,
  awayCol,
  { key: "vegasAwayTT", label: "Away TT (Vegas)", align: "right", value: (r) => r.vegasAwayTT ?? -Infinity, render: (r) => fmt(r.vegasAwayTT) },
  { key: "myAwayTT", label: "Away TT (mine)", align: "right", value: (r) => r.myAwayTT ?? -Infinity, render: (r) => fmt(r.myAwayTT) },
  { key: "vegasHomeTT", label: "Home TT (Vegas)", align: "right", value: (r) => r.vegasHomeTT ?? -Infinity, render: (r) => fmt(r.vegasHomeTT) },
  { key: "myHomeTT", label: "Home TT (mine)", align: "right", value: (r) => r.myHomeTT ?? -Infinity, render: (r) => fmt(r.myHomeTT) },
  homeCol,
  { key: "vegasAwaySpread", label: "Vegas Away Spread", align: "right", value: (r) => r.vegasAwaySpread ?? -Infinity, render: (r) => fmtSpread(r.vegasAwaySpread) },
  { key: "myAwaySpread", label: "My Away Spread", align: "right", value: (r) => r.myAwaySpread ?? -Infinity, render: (r) => fmtSpread(r.myAwaySpread) },
  { key: "vegasHomeSpread", label: "Vegas Home Spread", align: "right", value: (r) => r.vegasHomeSpread ?? -Infinity, render: (r) => fmtSpread(r.vegasHomeSpread) },
  { key: "myHomeSpread", label: "My Home Spread", align: "right", value: (r) => r.myHomeSpread ?? -Infinity, render: (r) => fmtSpread(r.myHomeSpread) },
  { key: "vegasTotal", label: "Vegas Total", align: "right", value: (r) => r.vegasTotal ?? -Infinity, render: (r) => fmt(r.vegasTotal) },
  { key: "myTotal", label: "My Total", align: "right", value: (r) => r.myTotal ?? -Infinity, render: (r) => fmt(r.myTotal) },
];

const VIEWS = [
  { key: "mine", label: "Mine", columns: MINE_COLUMNS },
  { key: "vegas", label: "Vegas", columns: VEGAS_COLUMNS },
  { key: "combined", label: "Combined", columns: COMBINED_COLUMNS },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

// ---------------------------------------------------------------------
// Team schedule view — one team's whole season, one row per game. Same
// shape as the Mine/Vegas/Combined tables (reuses PredictionsTable), just
// a different column set: away/home shown as actual teams (the selected
// team lands in whichever slot it's in — no separate H/A column needed),
// scores combined into one "Away-Home" column, spreads and total after.
// Always full season regardless of the week/season toggle above (the
// toggle only applies to the Games tab) — a one-week schedule isn't
// useful.
// ---------------------------------------------------------------------
const TEAM_COLUMNS: Column[] = [
  ...baseCols,
  kickoffCol,
  awayCol,
  {
    key: "score",
    label: "Score (mine)",
    align: "right",
    value: (r) => r.myHomeTT ?? -Infinity,
    render: (r) => `${fmt(r.myAwayTT)}-${fmt(r.myHomeTT)}`,
  },
  homeCol,
  { key: "myHomeSpread", label: "Home Spread", align: "right", value: (r) => r.myHomeSpread ?? -Infinity, render: (r) => fmtSpread(r.myHomeSpread) },
  { key: "myAwaySpread", label: "Away Spread", align: "right", value: (r) => r.myAwaySpread ?? -Infinity, render: (r) => fmtSpread(r.myAwaySpread) },
  { key: "myTotal", label: "Game Total", align: "right", value: (r) => r.myTotal ?? -Infinity, render: (r) => fmt(r.myTotal) },
];

function TeamScheduleTab({ predRows, teams }: { predRows: PredRow[]; teams: string[] }) {
  const [team, setTeam] = useState<string>("");

  // teams loads async — default to the first one once the list shows up,
  // but don't stomp on a selection the user already made.
  useEffect(() => {
    if (!team && teams.length > 0) setTeam(teams[0]);
  }, [teams, team]);

  const schedule = useMemo(
    () => (team ? predRows.filter((r) => r.game.game.homeTeam === team || r.game.game.awayTeam === team) : []),
    [predRows, team]
  );

  return (
    <div>
      <select className="filter" value={team} onChange={(e) => setTeam(e.target.value)} style={{ marginBottom: "1rem" }}>
        {teams.length === 0 && <option value="">No teams loaded</option>}
        {teams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <PredictionsTable rows={schedule} columns={TEAM_COLUMNS} />
    </div>
  );
}

const TOP_TABS = [
  { key: "games", label: "Games" },
  { key: "team", label: "Team" },
] as const;
type TopTabKey = (typeof TOP_TABS)[number]["key"];

function PredictionsTable({ rows, columns }: { rows: PredRow[]; columns: Column[] }) {
  const [sortKey, setSortKey] = useState(columns[0].key);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const activeCol = columns.find((c) => c.key === sortKey) ?? columns[0];

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = activeCol.value(a);
      const bv = activeCol.value(b);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, activeCol, sortDir]);

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <SortHeader key={c.key} label={c.label} sortKey={c.key} active={sortKey === c.key} dir={sortDir} onClick={handleSort} align={c.align} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.game.game.id}>
              {columns.map((c) => (
                <td key={c.key} style={{ ...CP, textAlign: c.align === "right" ? "right" : undefined }}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                No games.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function PredictionsAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, loading, error } = useGameTotalsEngine(season);
  const rows = filterRowsByDivision(allRows, division);
  const [topTab, setTopTab] = useState<TopTabKey>("games");
  const [view, setView] = useState<ViewKey>("mine");

  const [viewMode, setViewMode] = useState<ViewMode>("season");
  const [viewWeek, setViewWeek] = useState(1);
  const availableWeeks = useMemo(() => Array.from(new Set(rows.map((r) => r.game.week))).sort((a, b) => a - b), [rows]);
  const viewRows = useMemo(() => filterByViewMode(rows, viewMode, viewWeek), [rows, viewMode, viewWeek]);

  const predRows = useMemo(() => buildPredRows(viewRows), [viewRows]);
  const activeView = VIEWS.find((v) => v.key === view)!;

  // Team tab always works off the full (division-filtered but not
  // week-filtered) season, since a one-week schedule view isn't useful.
  const seasonPredRows = useMemo(() => buildPredRows(rows), [rows]);
  const allTeams = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => [r.game.homeTeam, r.game.awayTeam]))).sort(),
    [rows]
  );

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Predictions</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Every game's projected total and spread, split into team totals — no bet-call or
        amount-off columns here, just the raw numbers side by side. See Totals / Team Totals
        for the bet tracking.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TOP_TABS.map((t) => (
          <button key={t.key} className={`mode-btn ${topTab === t.key ? "mode-btn-active" : ""}`} onClick={() => setTopTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : topTab === "games" ? (
        <>
          <WeekSeasonToggle mode={viewMode} setMode={setViewMode} week={viewWeek} setWeek={setViewWeek} availableWeeks={availableWeeks} />
          <div className="mode-toggle" style={{ marginBottom: "1rem" }}>
            {VIEWS.map((v) => (
              <button key={v.key} className={`mode-btn ${view === v.key ? "mode-btn-active" : ""}`} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
          <PredictionsTable rows={predRows} columns={activeView.columns} />
        </>
      ) : (
        <TeamScheduleTab predRows={seasonPredRows} teams={allTeams} />
      )}
    </div>
  );
}
