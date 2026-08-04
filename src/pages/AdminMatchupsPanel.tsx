import { useEffect, useMemo, useState } from "react";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { classOf, isTracked, computeRow, computeMatchupStats, computeErrorStats, type MatchupComputed } from "../lib/matchupsCompute";

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
    // No local power-rating match for this CFBD team name — shown plainly
    // rather than crashing. Usually means a naming mismatch between CFBD
    // and data/teams.ts (accents, abbreviations, etc.) worth reconciling.
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

  const scoreLabel =
    game.away_points != null && game.home_points != null ? `${game.away_points}-${game.home_points}` : "–";

  const teamLabel = (side: "away" | "home" | null) => (side ? (side === "away" ? game.away_team : game.home_team) : "–");

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
        <td className="matchups-winner-cell">{teamLabel(projCoverTeam)}</td>
        <td className="matchups-winner-cell">{teamLabel(filteredBetTeam)}</td>
        <td className="matchups-winner-cell">{teamLabel(weightedFilteredBetTeam)}</td>
        <td className="matchups-winner-cell" style={wtfTeam ? { color: "#c45c52", fontWeight: 700 } : undefined}>
          {wtfTeam ? `${teamLabel(wtfTeam)} ⚠️` : "–"}
        </td>
        <td className="matchups-winner-cell">
          {actCoverTeam ? (actCoverTeam === "push" ? "Push" : actCoverTeam === "away" ? game.away_team : game.home_team) : "–"}
        </td>
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
        <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
        <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
        <td className="matchups-winner-cell">{winner}</td>
        <td className="matchups-winner-cell">{actualWinner}</td>
      </tr>
    );
  }

  // totals
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

export default function AdminMatchupsPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [weekSel, setWeekSel] = useState<"all" | number>("all");
  const [query, setQuery] = useState("");
  const [matchupType, setMatchupType] = useState("All");
  const [mode, setMode] = useState("spreads");
  const [hideNoLine, setHideNoLine] = useState(true);

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

  const filteredGames = useMemo(() => {
    return games.filter((g) => {
      const homeClass = classOf(g, "home");
      const awayClass = classOf(g, "away");

      if (matchupType === "FBSvFBS" && !(homeClass === "fbs" && awayClass === "fbs")) return false;
      if (matchupType === "FCSvFCS" && !(homeClass === "fcs" && awayClass === "fcs")) return false;
      if (matchupType === "Cross" && !((isTracked(homeClass) && isTracked(awayClass)) && homeClass !== awayClass))
        return false;

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!g.home_team.toLowerCase().includes(q) && !g.away_team.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [games, matchupType, query]);

  const computedRows = useMemo(
    () => filteredGames.map((g) => computeRow(g, liveByTeam)),
    [filteredGames, liveByTeam]
  );

  const visibleRows = useMemo(
    () => (hideNoLine ? computedRows.filter((c) => c.vegasAwaySpread != null) : computedRows),
    [computedRows, hideNoLine]
  );

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Matchups (Admin)</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Now populated from the synced CFBD games/lines data — Vegas Line, Score, and Cover
        columns show real values where the public page only shows dashes. Team rows without
        a bolded rating mean the CFBD team name didn't match a name in data/teams.ts.
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
        <input
          className="search"
          placeholder="Search for a team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="filter" value={matchupType} onChange={(e) => setMatchupType(e.target.value)}>
          <option value="All">All matchups</option>
          <option value="FBSvFBS">FBS vs FBS</option>
          <option value="FCSvFCS">FCS vs FCS</option>
          <option value="Cross">Cross-Division (FBS vs FCS)</option>
        </select>
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={hideNoLine} onChange={(e) => setHideNoLine(e.target.checked)} />
          Hide games with no Vegas line
        </label>
      </div>

      <div className="mode-toggle">
        {MATCHUPS_MODES.map((m) => (
          <button
            key={m.key}
            className={`mode-btn ${mode === m.key ? "mode-btn-active" : ""}`}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loadError && <p style={{ color: "crimson" }}>{loadError}</p>}

      <div className="table-wrap">
        {loading && <div className="empty matchups-empty">Loading…</div>}

        {!loading && visibleRows.length === 0 && (
          <div className="empty matchups-empty">
            No games saved for this selection yet — sync this season/week from the Games &
            Lines tile first.
          </div>
        )}

        {!loading && visibleRows.length > 0 && (
          <div className="table-scroll">
            <table className="matchups-table">
              <thead>
                {mode === "spreads" && (
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Away (PR)</th>
                    <th className="th">Home (PR)</th>
                    <th className="th th-right">Vegas Line</th>
                    <th className="th th-right">Projected Spread</th>
                    <th className="th th-right">Amount Off</th>
                    <th className="th th-right">Relative Off</th>
                    <th className="th th-right">Away Score</th>
                    <th className="th th-right">Home Score</th>
                    <th className="th">Proj. Cover Team</th>
                    <th className="th">Filtered Bet</th>
                    <th className="th">Weighted Filtered</th>
                    <th className="th">WTF</th>
                    <th className="th">Act. Cover Team</th>
                  </tr>
                )}
                {mode === "moneyline" && (
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Away (PR)</th>
                    <th className="th">Home (PR)</th>
                    <th className="th th-right">Vegas Moneyline</th>
                    <th className="th th-right">Projected Moneyline</th>
                    <th className="th th-right">Projected Win %</th>
                    <th className="th th-right">Away Score</th>
                    <th className="th th-right">Home Score</th>
                    <th className="th">Proj. Winner</th>
                    <th className="th">Act. Winner</th>
                  </tr>
                )}
                {mode === "totals" && (
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Away (PR)</th>
                    <th className="th">Home (PR)</th>
                    <th className="th th-right">Vegas Total</th>
                    <th className="th th-right">Projected Total</th>
                    <th className="th th-right">Away Score</th>
                    <th className="th th-right">Home Score</th>
                    <th className="th">Proj. Result (O/U)</th>
                    <th className="th">Total Result (O/U)</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {visibleRows.map((c) => (
                  <MatchupsRow key={c.game.id} computed={c} mode={mode} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && visibleRows.length > 0 && (
          <BettingStatsBlock rows={visibleRows} title={weekSel === "all" ? "Season Betting Stats" : `Week ${weekSel} Betting Stats`} />
        )}
      </div>

      <div className="footer-note">
        Projected Total isn't modeled yet (that's the future Game Totals tile) — only
        Vegas Total and, for completed games, the actual Over/Under result are shown.
      </div>
    </div>
  );
}
