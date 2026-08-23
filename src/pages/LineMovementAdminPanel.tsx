import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "../components/SortHeader";
import { fetchGamesForTotals, type GameForTotals } from "../lib/api/gameTotalsData";
import { buildTeamMovementRows, computeTeamMovementSummaries, type TeamMovementSummary } from "../lib/lineMovement";
import { SeasonPicker, DivisionPicker } from "./GameTotalsAdminPanel";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(digits);
}
function fmtSpread(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtSigned(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function pct(n: number, d: number): string {
  return d === 0 ? "–" : `${((n / d) * 100).toFixed(1)}%`;
}

function filterGamesByDivision(games: GameForTotals[], division: string): GameForTotals[] {
  if (division === "All") return games;
  const target = division.toLowerCase();
  return games.filter((g) => g.homeClassification === target && g.awayClassification === target);
}

type SummarySortKey =
  | "team"
  | "moneyOn"
  | "moneyAgainst"
  | "netSpreadMoney"
  | "moneyOver"
  | "moneyUnder"
  | "netTotalMoney"
  | "actualOverPct";

function summarySortValue(s: TeamMovementSummary, key: SummarySortKey): number | string {
  switch (key) {
    case "team":
      return s.team;
    case "moneyOn":
      return s.moneyOn;
    case "moneyAgainst":
      return s.moneyAgainst;
    case "netSpreadMoney":
      return s.netSpreadMoney;
    case "moneyOver":
      return s.moneyOver;
    case "moneyUnder":
      return s.moneyUnder;
    case "netTotalMoney":
      return s.netTotalMoney;
    case "actualOverPct": {
      const decided = s.actualOverCount + s.actualUnderCount;
      return decided === 0 ? -1 : s.actualOverCount / decided;
    }
  }
}

function TeamListView({ summaries, onSelectTeam }: { summaries: TeamMovementSummary[]; onSelectTeam: (team: string) => void }) {
  const [sortKey, setSortKey] = useState<SummarySortKey>("netSpreadMoney");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: string) {
    const k = key as SummarySortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "team" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    return [...summaries].sort((a, b) => {
      const av = summarySortValue(a, sortKey);
      const bv = summarySortValue(b, sortKey);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [summaries, sortKey, sortDir]);

  const sh = (label: string, key: SummarySortKey, align?: "right") => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align={align} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("Team", "team")}
            {sh("Money On", "moneyOn", "right")}
            {sh("Money Against", "moneyAgainst", "right")}
            {sh("Net", "netSpreadMoney", "right")}
            {sh("Money Over", "moneyOver", "right")}
            {sh("Money Under", "moneyUnder", "right")}
            {sh("Net", "netTotalMoney", "right")}
            <th style={CP}>Actual O-U-P</th>
            {sh("Actual Over%", "actualOverPct", "right")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.team}>
              <td style={CP}>
                <button
                  className="team-link"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", color: "inherit", textDecoration: "underline" }}
                  onClick={() => onSelectTeam(s.team)}
                >
                  {s.team}
                </button>
              </td>
              <td style={{ ...CP, textAlign: "right", color: "#8fd39a" }}>{s.moneyOn > 0 ? fmt(s.moneyOn) : "–"}</td>
              <td style={{ ...CP, textAlign: "right", color: "#e07a7a" }}>{s.moneyAgainst > 0 ? fmt(s.moneyAgainst) : "–"}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmtSigned(s.netSpreadMoney)}</td>
              <td style={{ ...CP, textAlign: "right", color: "#8fd39a" }}>{s.moneyOver > 0 ? fmt(s.moneyOver) : "–"}</td>
              <td style={{ ...CP, textAlign: "right", color: "#e07a7a" }}>{s.moneyUnder > 0 ? fmt(s.moneyUnder) : "–"}</td>
              <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{fmtSigned(s.netTotalMoney)}</td>
              <td style={CP}>
                {s.actualOverCount}-{s.actualUnderCount}
                {s.actualPushCount > 0 ? `-${s.actualPushCount}` : ""}
              </td>
              <td style={{ ...CP, textAlign: "right" }}>{pct(s.actualOverCount, s.actualOverCount + s.actualUnderCount)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
                No games.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type DetailSortKey = "week" | "opponent" | "openSpread" | "closeSpread" | "change" | "openTotal" | "closeTotal" | "moneyOver" | "moneyUnder";

function TeamDetailView({ games, team, onBack }: { games: GameForTotals[]; team: string; onBack: () => void }) {
  const rows = useMemo(() => buildTeamMovementRows(games, team), [games, team]);
  const summary = useMemo(() => computeTeamMovementSummaries(games).find((s) => s.team === team), [games, team]);

  const [sortKey, setSortKey] = useState<DetailSortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: string) {
    const k = key as DetailSortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case "week":
          av = a.game.week;
          bv = b.game.week;
          break;
        case "opponent":
          av = a.opponent;
          bv = b.opponent;
          break;
        case "openSpread":
          av = a.openSpread ?? -Infinity;
          bv = b.openSpread ?? -Infinity;
          break;
        case "closeSpread":
          av = a.closeSpread ?? -Infinity;
          bv = b.closeSpread ?? -Infinity;
          break;
        case "change":
          av = a.spreadChange ?? -Infinity;
          bv = b.spreadChange ?? -Infinity;
          break;
        case "openTotal":
          av = a.openTotal ?? -Infinity;
          bv = b.openTotal ?? -Infinity;
          break;
        case "closeTotal":
          av = a.closeTotal ?? -Infinity;
          bv = b.closeTotal ?? -Infinity;
          break;
        case "moneyOver":
          av = a.moneyOver ?? -Infinity;
          bv = b.moneyOver ?? -Infinity;
          break;
        case "moneyUnder":
          av = a.moneyUnder ?? -Infinity;
          bv = b.moneyUnder ?? -Infinity;
          break;
      }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortDir]);

  const sh = (label: string, key: DetailSortKey, align?: "right") => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align={align} />
  );

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1rem" }}>
        ‹ Team List
      </button>
      <h3 style={{ marginTop: 0 }}>{team}</h3>
      {summary && (
        <p style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
          Season: <strong style={{ color: "#8fd39a" }}>{fmt(summary.moneyOn)} on</strong> /{" "}
          <strong style={{ color: "#e07a7a" }}>{fmt(summary.moneyAgainst)} against</strong> ({fmtSigned(summary.netSpreadMoney)} net) —{" "}
          <strong style={{ color: "#8fd39a" }}>{fmt(summary.moneyOver)} over</strong> /{" "}
          <strong style={{ color: "#e07a7a" }}>{fmt(summary.moneyUnder)} under</strong> ({fmtSigned(summary.netTotalMoney)} net) — actual{" "}
          {summary.actualOverCount}-{summary.actualUnderCount}
          {summary.actualPushCount > 0 ? `-${summary.actualPushCount}` : ""} O/U
        </p>
      )}
      <div className="table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {sh("Wk", "week")}
              {sh("Opp", "opponent")}
              {sh("Opening Spread", "openSpread", "right")}
              {sh("Closing Spread", "closeSpread", "right")}
              <th style={{ ...CP, textAlign: "right" }}>Money On</th>
              <th style={{ ...CP, textAlign: "right" }}>Money Against</th>
              {sh("Change", "change", "right")}
              {sh("Open Total", "openTotal", "right")}
              {sh("Close Total", "closeTotal", "right")}
              {sh("Money Over", "moneyOver", "right")}
              {sh("Money Under", "moneyUnder", "right")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.game.id}>
                <td style={CP}>{r.game.week}</td>
                <td style={CP}>{r.opponent}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmtSpread(r.openSpread)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmtSpread(r.closeSpread)}</td>
                <td style={{ ...CP, textAlign: "right", color: r.moneyOn != null ? "#8fd39a" : undefined }}>{fmt(r.moneyOn)}</td>
                <td style={{ ...CP, textAlign: "right", color: r.moneyAgainst != null ? "#e07a7a" : undefined }}>{fmt(r.moneyAgainst)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmtSigned(r.spreadChange)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.openTotal)}</td>
                <td style={{ ...CP, textAlign: "right" }}>{fmt(r.closeTotal)}</td>
                <td style={{ ...CP, textAlign: "right", color: r.moneyOver != null ? "#8fd39a" : undefined }}>{fmt(r.moneyOver)}</td>
                <td style={{ ...CP, textAlign: "right", color: r.moneyUnder != null ? "#e07a7a" : undefined }}>{fmt(r.moneyUnder)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="empty">
                  No games.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LineMovementAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const [games, setGames] = useState<GameForTotals[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedTeam(null);
    fetchGamesForTotals(season)
      .then(setGames)
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [season]);

  const filteredGames = useMemo(() => filterGamesByDivision(games, division), [games, division]);
  const summaries = useMemo(() => computeTeamMovementSummaries(filteredGames), [filteredGames]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Line Movement</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Vegas open/close lines only — no model here. "Money on" / "money against" tracks how far the spread
        moved toward or away from each team between open and close (more negative = more favored). "Money
        over" / "money under" tracks total movement, shared by both teams in a game since a total isn't
        team-specific. "Actual O-U-P" is a separate calc: the real final score vs. the closing total, not
        related to line movement at all.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : selectedTeam ? (
        <TeamDetailView games={filteredGames} team={selectedTeam} onBack={() => setSelectedTeam(null)} />
      ) : (
        <TeamListView summaries={summaries} onSelectTeam={setSelectedTeam} />
      )}
    </div>
  );
}
