import { useEffect, useMemo, useState } from "react";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { classOf, isTracked, computeRow, computeMatchupStats, computeErrorStats, type MatchupComputed } from "../lib/matchupsCompute";
import SortHeader from "../components/SortHeader";

function pctLabel(w: number, l: number) {
  const decided = w + l;
  return decided === 0 ? "–" : `${((w / decided) * 100).toFixed(1)}%`;
}
function recordLabel(w: number, l: number, push?: number) {
  return `${w.toFixed ? w.toFixed(1) : w}-${l.toFixed ? l.toFixed(1) : l}${push ? `-${push}` : ""}`;
}

function BettingStatsBlock({ rows, title }: { rows: MatchupComputed[]; title?: string }) {
  const stats = useMemo(() => computeMatchupStats(rows), [rows]);
  const errorStats = useMemo(() => computeErrorStats(rows), [rows]);
  const { straightUp, ats } = stats;

  const fmtNum = (v: number | null, digits = 2) => (v == null ? "–" : v.toFixed(digits));
  const fmtDelta = (v: number | null, digits = 2) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`);

  return (
    <div className="bet-stats">
      <div className="section-label bet-stats-label">{title || "Betting Stats"}</div>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--gold)", marginBottom: "0.4rem" }}>Straight Up</div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th className="th"></th>
                <th className="th th-right">YC</th>
                <th className="th th-right">Vegas</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Wins</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{straightUp.yc.w}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{straightUp.vegas.w}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Losses</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{straightUp.yc.l}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{straightUp.vegas.l}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem", fontWeight: 700 }}>Win %</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right", fontWeight: 700 }}>
                  {pctLabel(straightUp.yc.w, straightUp.yc.l)}
                </td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right", fontWeight: 700 }}>
                  {pctLabel(straightUp.vegas.w, straightUp.vegas.l)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--gold)", marginBottom: "0.4rem" }}>ATS (Every Game)</div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th className="th"></th>
                <th className="th th-right">YC</th>
                <th className="th th-right">Breakeven Baseline</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Wins</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{ats.yc.w}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{ats.baselineWins.toFixed(1)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Losses</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{ats.yc.l}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{ats.baselineLosses.toFixed(1)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem", fontWeight: 700 }}>Win %</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right", fontWeight: 700 }}>{pctLabel(ats.yc.w, ats.yc.l)}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right", fontWeight: 700 }}>52.4%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ minWidth: 280, flex: 1 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--gold)", marginBottom: "0.4rem" }}>ATS Stats</div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th className="th"></th>
                <th className="th th-right">YC</th>
                <th className="th th-right">Vegas</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Abs Error</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{fmtNum(errorStats.yc.absError)}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{fmtNum(errorStats.vegas.absError)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Median Abs Error</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{fmtNum(errorStats.yc.medianAbsError)}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{fmtNum(errorStats.vegas.medianAbsError)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Mean Squared Error</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{fmtNum(errorStats.yc.mse)}</td>
                <td style={{ padding: "0.3rem 0.6rem", textAlign: "right" }}>{fmtNum(errorStats.vegas.mse)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>Abs Error over Vegas</td>
                <td
                  style={{
                    padding: "0.3rem 0.6rem",
                    textAlign: "right",
                    color: errorStats.absErrorOverVegasYc != null && errorStats.absErrorOverVegasYc < 0 ? "#8fd39a" : "#c45c52",
                  }}
                >
                  {fmtDelta(errorStats.absErrorOverVegasYc)}
                </td>
                <td
                  style={{
                    padding: "0.3rem 0.6rem",
                    textAlign: "right",
                    color: errorStats.absErrorOverVegasYc != null && errorStats.absErrorOverVegasYc > 0 ? "#8fd39a" : "#c45c52",
                  }}
                >
                  {fmtDelta(errorStats.absErrorOverVegasYc != null ? -errorStats.absErrorOverVegasYc : null)}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.6rem" }}>MSE over Vegas</td>
                <td
                  style={{
                    padding: "0.3rem 0.6rem",
                    textAlign: "right",
                    color: errorStats.mseOverVegasYc != null && errorStats.mseOverVegasYc < 0 ? "#8fd39a" : "#c45c52",
                  }}
                >
                  {fmtDelta(errorStats.mseOverVegasYc)}
                </td>
                <td
                  style={{
                    padding: "0.3rem 0.6rem",
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
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", margin: 0 }}>
        The ATS "Breakeven Baseline" is bankroll math, not a model comparison: at standard
        -110 spread odds, you need to win 52.4% of your decided bets just to break even
        before any profit — that's a fixed constant built into the vig, the same for every
        bettor regardless of dataset or edge size. Beating 52.4% is the bar that actually
        matters; beating 50% doesn't mean you're profitable. Abs Error / MSE compare each
        projection (YC's model, Vegas's own line) against the actual final margin —
        negative "over Vegas" values mean lower error (better) than Vegas.
      </p>
    </div>
  );
}

function TeamNameCell({ team, name }: { team: any | null; name: string }) {
  if (!team) {
    return (
      <td className="matchup-team-cell">
        <span style={{ opacity: 0.7 }}>{name}</span>
      </td>
    );
  }
  return (
    <td className="matchup-team-cell">
      <span className="team-link matchup-team-btn" style={{ cursor: "default" }}>
        {team.team}
      </span>
      <span className={`matchup-rating ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </span>
    </td>
  );
}

function teamNameFor(c: MatchupComputed, side: "away" | "home" | "push" | null): string {
  if (!side) return "–";
  if (side === "push") return "Push";
  return side === "away" ? c.game.away_team : c.game.home_team;
}

function betTeamSpreadLabel(c: MatchupComputed, side: "away" | "home" | null): string {
  if (!side || c.vegasAwaySpread == null) return "";
  const sideSpread = side === "away" ? c.vegasAwaySpread : -c.vegasAwaySpread;
  return ` (${sideSpread > 0 ? "+" : ""}${sideSpread.toFixed(1)})`;
}

function MatchupsRow({ computed, mode }: { computed: MatchupComputed; mode: string }) {
  const {
    game,
    line,
    awayTeam,
    homeTeam,
    projAwaySpread,
    vegasAwaySpread,
    amountOff,
    relativeOff,
    projWinPct,
    projMoneyline,
    vegasMoneyline,
    vegasWinPct,
    ev,
    projCoverTeam,
    filteredBetTeam,
    weightedFilteredBetTeam,
    wtfTeam,
    actCoverTeam,
    totalResult,
  } = computed;

  const dateLabel = game.start_date
    ? new Date(game.start_date).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })
    : "–";

  if (mode === "spreads") {
    return (
      <tr>
        <td className="game-date-cell">{dateLabel}</td>
        <TeamNameCell team={awayTeam} name={game.away_team} />
        <TeamNameCell team={homeTeam} name={game.home_team} />
        <td className="matchups-projected-cell" style={vegasAwaySpread != null ? { color: spreadColor(vegasAwaySpread) } : undefined}>
          {vegasAwaySpread != null ? `${vegasAwaySpread > 0 ? "+" : ""}${vegasAwaySpread.toFixed(1)}` : "–"}
        </td>
        <td className="matchups-projected-cell" style={projAwaySpread != null ? { color: spreadColor(projAwaySpread) } : undefined}>
          {projAwaySpread != null ? `${projAwaySpread > 0 ? "+" : ""}${projAwaySpread.toFixed(1)}` : "–"}
        </td>
        <td className="matchups-empty-cell">{amountOff != null ? amountOff.toFixed(1) : "–"}</td>
        <td className="matchups-empty-cell">{relativeOff != null ? relativeOff.toFixed(2) : "–"}</td>
        <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
        <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
        <td className="matchups-winner-cell">
          {teamNameFor(computed, projCoverTeam)}
          {betTeamSpreadLabel(computed, projCoverTeam)}
        </td>
        <td className="matchups-winner-cell">
          {teamNameFor(computed, filteredBetTeam)}
          {betTeamSpreadLabel(computed, filteredBetTeam)}
        </td>
        <td className="matchups-winner-cell">
          {teamNameFor(computed, weightedFilteredBetTeam)}
          {betTeamSpreadLabel(computed, weightedFilteredBetTeam)}
        </td>
        <td className="matchups-winner-cell" style={wtfTeam ? { color: "#c45c52", fontWeight: 700 } : undefined}>
          {wtfTeam ? `${teamNameFor(computed, wtfTeam)}${betTeamSpreadLabel(computed, wtfTeam)} ⚠️` : "–"}
        </td>
        <td className="matchups-winner-cell">{teamNameFor(computed, actCoverTeam)}</td>
      </tr>
    );
  }

  if (mode === "moneyline") {
    const winner = projAwaySpread != null ? (projAwaySpread < 0 ? game.away_team : projAwaySpread > 0 ? game.home_team : "Pick'em") : "–";
    const actualWinner =
      game.away_points != null && game.home_points != null
        ? game.away_points > game.home_points
          ? game.away_team
          : game.home_points > game.away_points
          ? game.home_team
          : "Tie"
        : "–";
    return (
      <tr>
        <td className="game-date-cell">{dateLabel}</td>
        <TeamNameCell team={awayTeam} name={game.away_team} />
        <TeamNameCell team={homeTeam} name={game.home_team} />
        <td className="matchups-projected-cell">
          {vegasMoneyline != null ? `${vegasMoneyline > 0 ? "+" : ""}${Math.round(vegasMoneyline)}` : "–"}
        </td>
        <td className="matchups-projected-cell" style={projAwaySpread != null ? { color: spreadColor(projAwaySpread) } : undefined}>
          {projMoneyline != null ? `${projMoneyline > 0 ? "+" : ""}${Math.round(projMoneyline)}` : "–"}
        </td>
        <td className="matchups-winpct-cell" style={projAwaySpread != null ? { color: spreadColor(projAwaySpread) } : undefined}>
          {projWinPct != null ? `${(projWinPct * 100).toFixed(1)}%` : "–"}
        </td>
        <td className="matchups-winpct-cell">{vegasWinPct != null ? `${(vegasWinPct * 100).toFixed(1)}%` : "–"}</td>
        <td className="matchups-winpct-cell" style={ev != null ? { color: ev > 0 ? "#8fd39a" : ev < 0 ? "#c45c52" : undefined } : undefined}>
          {ev != null ? `${ev > 0 ? "+" : ""}${ev.toFixed(1)}%` : "–"}
        </td>
        <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
        <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
        <td className="matchups-winner-cell">{winner}</td>
        <td className="matchups-winner-cell">{actualWinner}</td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="game-date-cell">{dateLabel}</td>
      <TeamNameCell team={awayTeam} name={game.away_team} />
      <TeamNameCell team={homeTeam} name={game.home_team} />
      <td className="matchups-projected-cell">{line?.over_under != null ? line.over_under : "–"}</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
      <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-winner-cell">{totalResult ?? "–"}</td>
    </tr>
  );
}

const MATCHUPS_MODES = [
  { key: "spreads", label: "Spreads" },
  { key: "moneyline", label: "Moneylines" },
  { key: "totals", label: "Totals" },
];

const WEEK_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1);

function sortValue(c: MatchupComputed, mode: string, key: string): number | string | null {
  switch (key) {
    case "date":
      return c.game.start_date ? new Date(c.game.start_date).getTime() : null;
    case "away":
      return c.game.away_team;
    case "home":
      return c.game.home_team;
    case "awayScore":
      return c.game.away_points;
    case "homeScore":
      return c.game.home_points;
  }
  if (mode === "spreads") {
    switch (key) {
      case "vegasLine":
        return c.vegasAwaySpread;
      case "projSpread":
        return c.projAwaySpread;
      case "amountOff":
        return c.amountOff;
      case "relativeOff":
        return c.relativeOff;
      case "projCover":
        return c.projCoverTeam ? teamNameFor(c, c.projCoverTeam) : null;
      case "filteredBet":
        return c.filteredBetTeam ? teamNameFor(c, c.filteredBetTeam) : null;
      case "weightedFiltered":
        return c.weightedFilteredBetTeam ? teamNameFor(c, c.weightedFilteredBetTeam) : null;
      case "wtf":
        return c.wtfTeam ? teamNameFor(c, c.wtfTeam) : null;
      case "actCover":
        return c.actCoverTeam ? teamNameFor(c, c.actCoverTeam) : null;
    }
  }
  if (mode === "moneyline") {
    switch (key) {
      case "vegasML":
        return c.vegasMoneyline;
      case "projML":
        return c.projMoneyline;
      case "projWinPct":
        return c.projWinPct;
      case "vegasWinPct":
        return c.vegasWinPct;
      case "ev":
        return c.ev;
      case "projWinner":
        return c.projAwaySpread != null
          ? c.projAwaySpread < 0
            ? c.game.away_team
            : c.projAwaySpread > 0
            ? c.game.home_team
            : "Pick'em"
          : null;
      case "actWinner":
        if (c.game.away_points == null || c.game.home_points == null) return null;
        return c.game.away_points > c.game.home_points
          ? c.game.away_team
          : c.game.home_points > c.game.away_points
          ? c.game.home_team
          : "Tie";
    }
  }
  if (mode === "totals") {
    switch (key) {
      case "vegasTotal":
        return c.line?.over_under ?? null;
      case "totalResult":
        return c.totalResult;
    }
  }
  return null;
}

function compareValues(a: number | string | null, b: number | string | null, dir: "asc" | "desc"): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return dir === "asc" ? a - b : b - a;
  }
  const as = String(a);
  const bs = String(b);
  return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
}

export default function AdminMatchupsPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [weekSel, setWeekSel] = useState<"all" | number>("all");
  const [query, setQuery] = useState("");
  const [matchupType, setMatchupType] = useState("All");
  const [mode, setMode] = useState("spreads");
  const [hideNoLine, setHideNoLine] = useState(true);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetchGamesWithLines(season, weekSel === "all" ? undefined : weekSel)
      .then(setGames)
      .catch((err) => setLoadError(err.message ?? "Failed to load games"))
      .finally(() => setLoading(false));
  }, [season, weekSel]);

  useEffect(() => {
    setSortKey(null);
  }, [mode]);

  const filteredGames = useMemo(() => {
    return games.filter((g) => {
      const homeClass = classOf(g, "home");
      const awayClass = classOf(g, "away");

      if (matchupType === "FBSvFBS" && !(homeClass === "fbs" && awayClass === "fbs")) return false;
      if (matchupType === "FCSvFCS" && !(homeClass === "fcs" && awayClass === "fcs")) return false;
      if (matchupType === "Cross" && !(isTracked(homeClass) && isTracked(awayClass) && homeClass !== awayClass)) return false;

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!g.home_team.toLowerCase().includes(q) && !g.away_team.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [games, matchupType, query]);

  const computedRows = useMemo(() => filteredGames.map((g) => computeRow(g, liveByTeam)), [filteredGames, liveByTeam]);

  const visibleRows = useMemo(() => {
    if (!hideNoLine) return computedRows;
    return computedRows.filter((c) => {
      if (mode === "spreads") return c.vegasAwaySpread != null;
      if (mode === "moneyline") return c.vegasMoneyline != null;
      if (mode === "totals") return c.line?.over_under != null;
      return true;
    });
  }, [computedRows, hideNoLine, mode]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return visibleRows;
    return [...visibleRows].sort((a, b) => compareValues(sortValue(a, mode, sortKey), sortValue(b, mode, sortKey), sortDir));
  }, [visibleRows, mode, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Matchups (Admin)</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Now populated from the synced CFBD games/lines data — Vegas Line, Score, and Cover
        columns show real values where the public page only shows dashes. Team rows without
        a bolded rating mean the CFBD team name didn't match a name in data/teams.ts. Click
        any column header to sort — text columns push every non-blank pick to the top.
      </p>

      <div className="controls matchups-controls">
        <label>
          Season{" "}
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)}
            style={{ width: 90 }}
          />
        </label>
        <select
          className="filter"
          value={weekSel}
          onChange={(e) => setWeekSel(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
        >
          <option value="all">All weeks (whole season)</option>
          {WEEK_OPTIONS.map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="filter" value={matchupType} onChange={(e) => setMatchupType(e.target.value)}>
          <option value="All">All matchups</option>
          <option value="FBSvFBS">FBS vs FBS</option>
          <option value="FCSvFCS">FCS vs FCS</option>
          <option value="Cross">Cross-Division (FBS vs FCS)</option>
        </select>
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={hideNoLine} onChange={(e) => setHideNoLine(e.target.checked)} />
          Hide games with no Vegas {mode === "spreads" ? "line" : mode === "moneyline" ? "moneyline" : "total"}
        </label>
      </div>

      <div className="mode-toggle">
        {MATCHUPS_MODES.map((m) => (
          <button key={m.key} className={`mode-btn ${mode === m.key ? "mode-btn-active" : ""}`} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      {loadError && <p style={{ color: "crimson" }}>{loadError}</p>}

      <div className="table-wrap" style={{ maxWidth: "none" }}>
          {loading && <div className="empty matchups-empty">Loading…</div>}

          {!loading && sortedRows.length === 0 && (
            <div className="empty matchups-empty">
              No games saved for this selection yet — sync this season/week from the Games &
              Lines tile first.
            </div>
          )}

          {!loading && sortedRows.length > 0 && (
            <div className="table-scroll">
              <table className="matchups-table" style={{ width: "100%" }}>
                <thead>
                  {mode === "spreads" && (
                    <tr>
                      <SortHeader label="Date" sortKey="date" active={sortKey === "date"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Away (PR)" sortKey="away" active={sortKey === "away"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Home (PR)" sortKey="home" active={sortKey === "home"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Vegas Line" sortKey="vegasLine" active={sortKey === "vegasLine"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Projected Spread" sortKey="projSpread" active={sortKey === "projSpread"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Amount Off" sortKey="amountOff" active={sortKey === "amountOff"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Relative Off" sortKey="relativeOff" active={sortKey === "relativeOff"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Away Score" sortKey="awayScore" active={sortKey === "awayScore"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Home Score" sortKey="homeScore" active={sortKey === "homeScore"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Proj. Cover Team" sortKey="projCover" active={sortKey === "projCover"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Filtered Bet" sortKey="filteredBet" active={sortKey === "filteredBet"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Weighted Filtered" sortKey="weightedFiltered" active={sortKey === "weightedFiltered"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="WTF" sortKey="wtf" active={sortKey === "wtf"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Act. Cover Team" sortKey="actCover" active={sortKey === "actCover"} dir={sortDir} onClick={handleSort} />
                    </tr>
                  )}
                  {mode === "moneyline" && (
                    <tr>
                      <SortHeader label="Date" sortKey="date" active={sortKey === "date"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Away (PR)" sortKey="away" active={sortKey === "away"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Home (PR)" sortKey="home" active={sortKey === "home"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Vegas Moneyline" sortKey="vegasML" active={sortKey === "vegasML"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Projected Moneyline" sortKey="projML" active={sortKey === "projML"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Projected Win %" sortKey="projWinPct" active={sortKey === "projWinPct"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Vegas Win %" sortKey="vegasWinPct" active={sortKey === "vegasWinPct"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="EV" sortKey="ev" active={sortKey === "ev"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Away Score" sortKey="awayScore" active={sortKey === "awayScore"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Home Score" sortKey="homeScore" active={sortKey === "homeScore"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Proj. Winner" sortKey="projWinner" active={sortKey === "projWinner"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Act. Winner" sortKey="actWinner" active={sortKey === "actWinner"} dir={sortDir} onClick={handleSort} />
                    </tr>
                  )}
                  {mode === "totals" && (
                    <tr>
                      <SortHeader label="Date" sortKey="date" active={sortKey === "date"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Away (PR)" sortKey="away" active={sortKey === "away"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Home (PR)" sortKey="home" active={sortKey === "home"} dir={sortDir} onClick={handleSort} />
                      <SortHeader label="Vegas Total" sortKey="vegasTotal" active={sortKey === "vegasTotal"} dir={sortDir} onClick={handleSort} align="right" />
                      <th className="th th-right">Projected Total</th>
                      <SortHeader label="Away Score" sortKey="awayScore" active={sortKey === "awayScore"} dir={sortDir} onClick={handleSort} align="right" />
                      <SortHeader label="Home Score" sortKey="homeScore" active={sortKey === "homeScore"} dir={sortDir} onClick={handleSort} align="right" />
                      <th className="th">Proj. Result (O/U)</th>
                      <SortHeader label="Total Result (O/U)" sortKey="totalResult" active={sortKey === "totalResult"} dir={sortDir} onClick={handleSort} />
                    </tr>
                  )}
                </thead>
                <tbody>
                  {sortedRows.map((c) => (
                    <MatchupsRow key={c.game.id} computed={c} mode={mode} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && sortedRows.length > 0 && (
            <BettingStatsBlock rows={sortedRows} title={weekSel === "all" ? "Season Betting Stats" : `Week ${weekSel} Betting Stats`} />
          )}
        </div>

      <div className="footer-note">
        Projected Total isn't modeled yet (that's the future Game Totals tile) — only
        Vegas Total and, for completed games, the actual Over/Under result are shown.
      </div>
    </div>
  );
}
