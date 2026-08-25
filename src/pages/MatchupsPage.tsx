import { useEffect, useMemo, useRef, useState } from "react";
import ExportPngButton from "../components/ExportPngButton";
import TeamCell from "../components/TeamCell";
import { spreadColor } from "../lib/odds";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { classOf, isTracked, computeRow, computeMatchupStats, computeErrorStats, type MatchupComputed } from "../lib/matchupsCompute";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";

function dateLabel(g: GameWithLines) {
  return g.start_date
    ? new Date(g.start_date).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })
    : "–";
}

function teamLabel(computed: MatchupComputed, side: "away" | "home" | "push" | null) {
  if (!side) return "–";
  if (side === "push") return "Push";
  return side === "away" ? computed.game.away_team : computed.game.home_team;
}

function SpreadsRow({ computed, onNavigateTeam }: { computed: MatchupComputed; onNavigateTeam: any }) {
  const {
    game,
    awayTeam,
    homeTeam,
    projAwaySpread,
    vegasAwaySpread,
    amountOff,
    projCoverTeam,
    filteredBetTeam,
    weightedFilteredBetTeam,
    wtfTeam,
    actCoverTeam,
  } = computed;
  if (!awayTeam || !homeTeam || projAwaySpread == null) return null;

  return (
    <tr>
      <td className="game-date-cell">{dateLabel(game)}</td>
      <TeamCell team={awayTeam} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={homeTeam} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-vegas-cell" style={vegasAwaySpread != null ? { color: spreadColor(vegasAwaySpread) } : undefined}>
        {vegasAwaySpread != null ? `${vegasAwaySpread > 0 ? "+" : ""}${vegasAwaySpread.toFixed(1)}` : "–"}
      </td>
      <td className="matchups-projected-cell" style={{ color: spreadColor(projAwaySpread) }}>
        {projAwaySpread > 0 ? "+" : ""}
        {projAwaySpread.toFixed(1)}
      </td>
      <td className="matchups-empty-cell">{amountOff != null ? amountOff.toFixed(1) : "–"}</td>
      <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
      <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
      <td className="matchups-winner-cell">{teamLabel(computed, projCoverTeam)}</td>
      <td className="matchups-winner-cell">{teamLabel(computed, filteredBetTeam)}</td>
      <td className="matchups-winner-cell">{teamLabel(computed, weightedFilteredBetTeam)}</td>
      <td className="matchups-winner-cell" style={wtfTeam ? { color: "#c45c52", fontWeight: 700 } : undefined}>
        {wtfTeam ? `${teamLabel(computed, wtfTeam)} ⚠️` : "–"}
      </td>
      <td className="matchups-winner-cell">{teamLabel(computed, actCoverTeam)}</td>
    </tr>
  );
}

function MoneylineRow({ computed, onNavigateTeam }: { computed: MatchupComputed; onNavigateTeam: any }) {
  const { game, awayTeam, homeTeam, projAwaySpread, vegasMoneyline, projMoneyline, vegasWinPct, projWinPct } = computed;
  if (!awayTeam || !homeTeam || projAwaySpread == null) return null;

  const projWinner = projAwaySpread < 0 ? game.away_team : projAwaySpread > 0 ? game.home_team : "Pick'em";
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
      <td className="game-date-cell">{dateLabel(game)}</td>
      <TeamCell team={awayTeam} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={homeTeam} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-projected-cell">
        {vegasMoneyline != null ? `${vegasMoneyline > 0 ? "+" : ""}${Math.round(vegasMoneyline)}` : "–"}
      </td>
      <td className="matchups-projected-cell" style={{ color: spreadColor(projAwaySpread) }}>
        {projMoneyline != null ? `${projMoneyline > 0 ? "+" : ""}${Math.round(projMoneyline)}` : "–"}
      </td>
      <td className="matchups-winpct-cell">
        {vegasWinPct != null ? `${(vegasWinPct * 100).toFixed(1)}%` : "–"}
      </td>
      <td className="matchups-winpct-cell" style={{ color: spreadColor(projAwaySpread) }}>
        {projWinPct != null ? `${(projWinPct * 100).toFixed(1)}%` : "–"}
      </td>
      <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
      <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
      <td className="matchups-winner-cell">{projWinner}</td>
      <td className="matchups-winner-cell">{actualWinner}</td>
    </tr>
  );
}

function TotalsRow({ computed, projTotalByGame, onNavigateTeam }: { computed: MatchupComputed; projTotalByGame: Map<string, number>; onNavigateTeam: any }) {
  const { game, awayTeam, homeTeam, line, totalResult } = computed;
  if (!awayTeam || !homeTeam) return null;

  const projTotal = projTotalByGame.get(`${game.week}|${game.home_team}|${game.away_team}`) ?? null;
  const projResult =
    projTotal != null && line?.over_under != null
      ? projTotal > line.over_under
        ? "Over"
        : projTotal < line.over_under
        ? "Under"
        : "Push"
      : null;

  return (
    <tr>
      <td className="game-date-cell">{dateLabel(game)}</td>
      <TeamCell team={awayTeam} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={homeTeam} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-projected-cell">{line?.over_under != null ? line.over_under : "–"}</td>
      <td className="matchups-projected-cell">{projTotal != null ? projTotal.toFixed(1) : "–"}</td>
      <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
      <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
      <td className="matchups-winner-cell">{projResult ?? "–"}</td>
      <td className="matchups-winner-cell">{totalResult ?? "–"}</td>
    </tr>
  );
}

const MATCHUPS_MODES = [
  { key: "spreads", label: "Spreads" },
  { key: "moneyline", label: "Moneylines" },
  { key: "totals", label: "Totals" },
];

function MatchupsTable({ rows, onNavigateTeam, mode, projTotalByGame }: { rows: MatchupComputed[]; onNavigateTeam: any; mode: string; projTotalByGame: Map<string, number> }) {
  return (
    <div className="table-scroll">
      <table className="matchups-table" style={{ width: "100%" }}>
        <thead>
          {mode === "spreads" && (
            <tr>
              <th className="th">Date</th>
              <th className="th">Away (PR)</th>
              <th className="th">Home (PR)</th>
              <th className="th th-right">Vegas Line</th>
              <th className="th th-right">Projected Spread</th>
              <th className="th th-right">Amount Off</th>
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
              <th className="th th-right">Implied Vegas Win %</th>
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
          {mode === "spreads" && rows.map((c) => <SpreadsRow key={c.game.id} computed={c} onNavigateTeam={onNavigateTeam} />)}
          {mode === "moneyline" && rows.map((c) => <MoneylineRow key={c.game.id} computed={c} onNavigateTeam={onNavigateTeam} />)}
          {mode === "totals" && rows.map((c) => <TotalsRow key={c.game.id} computed={c} projTotalByGame={projTotalByGame} onNavigateTeam={onNavigateTeam} />)}
        </tbody>
      </table>
    </div>
  );
}

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

export default function MatchupsPage({ subKey, subLabel, onNavigateTeam, onHome }: any) {
  const isAll = subKey === "all";
  const weekNum = isAll ? null : parseInt(subKey.replace("week", ""), 10);
  const season = new Date().getFullYear();

  const [query, setQuery] = useState("");
  const [matchupType, setMatchupType] = useState("All");
  const [mode, setMode] = useState("spreads");
  const [hideNoLine, setHideNoLine] = useState(true);
  const exportRef = useRef<HTMLDivElement>(null);

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const currentSeason = new Date().getFullYear();
  const weekNumbersInView = useMemo(() => Array.from(new Set(games.map((g) => g.week))), [games]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbersInView, currentSeason);
  const { rows: totalsEngineRows } = useGameTotalsEngine(season);

  // Same week+teams keying as the team page's Proj. Score column — the
  // Game/Team Totals engine's own game ids are CFBD ids, a different
  // space than this page's Vegas-lines game ids.
  const projTotalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsEngineRows]);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetchGamesWithLines(season, isAll ? undefined : weekNum ?? undefined)
      .then(setGames)
      .catch((err) => setLoadError(err.message ?? "Failed to load games"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, subKey]);

  const matchesFilters = (g: GameWithLines) => {
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
  };

  const filteredGames = useMemo(() => games.filter(matchesFilters), [games, matchupType, query]);

  const computedRows = useMemo(
    () => filteredGames.map((g) => computeRow(g, ratingsByWeek[g.week] ?? {})),
    [filteredGames, ratingsByWeek]
  );

  const visibleRows = useMemo(
    () => (hideNoLine ? computedRows.filter((c) => c.vegasAwaySpread != null) : computedRows),
    [computedRows, hideNoLine]
  );

  const groupedByWeek = useMemo(() => {
    if (!isAll) return null;
    const map = new Map<number, MatchupComputed[]>();
    for (const c of visibleRows) {
      const list = map.get(c.game.week) ?? [];
      list.push(c);
      map.set(c.game.week, list);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([week, rows]) => ({ week, rows }));
  }, [isAll, visibleRows]);

  return (
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Weekly Matchups</div>
        <h1 className="title matchup-title">{subLabel.toUpperCase()}</h1>
        <p className="subtitle team-subtitle">
          {mode === "spreads" &&
            `Projected spreads for every game, calculated from current power ratings, alongside the live Vegas line.`}
          {mode === "moneyline" &&
            `Projected moneylines and win percentages for every game, derived from current power ratings.`}
          {mode === "totals" && "Vegas totals and, once games are final, the actual Over/Under result."}
        </p>
      </div>

      <div className="controls matchups-controls" data-export-exclude="true">
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="filter" value={matchupType} onChange={(e) => setMatchupType(e.target.value)}>
          <option value="All">All matchups</option>
          <option value="FBSvFBS">FBS vs FBS</option>
          <option value="FCSvFCS">FCS vs FCS</option>
          <option value="Cross">Cross-Division</option>
        </select>
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={hideNoLine} onChange={(e) => setHideNoLine(e.target.checked)} />
          Hide games with no Vegas line
        </label>
        <ExportPngButton targetRef={exportRef} filename={`matchups-${subLabel}-${mode}`.toLowerCase().replace(/\s+/g, "-")} />
      </div>

      <div className="mode-toggle" data-export-exclude="true">
        {MATCHUPS_MODES.map((m) => (
          <button key={m.key} className={`mode-btn ${mode === m.key ? "mode-btn-active" : ""}`} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      {loadError && <p style={{ color: "crimson" }}>{loadError}</p>}

      <div className="table-wrap" style={{ maxWidth: "none" }}>
          {loading && <div className="empty matchups-empty">Loading…</div>}

          {!loading && !isAll && visibleRows.length === 0 && (
            <div className="empty matchups-empty">No games scheduled for {subLabel} yet.</div>
          )}

          {!loading && !isAll && visibleRows.length > 0 && (
            <>
              <MatchupsTable rows={visibleRows} onNavigateTeam={onNavigateTeam} mode={mode} projTotalByGame={projTotalByGame} />
              <BettingStatsBlock rows={visibleRows} title={`${subLabel} Betting Stats`} />
            </>
          )}

          {!loading && isAll && (!groupedByWeek || groupedByWeek.length === 0) && (
            <div className="empty matchups-empty">No games match that search.</div>
          )}

          {!loading &&
            isAll &&
            groupedByWeek &&
            groupedByWeek.map(({ week, rows }) => (
              <div key={week} className="week-group">
                <div className="section-label week-group-label">Week {week}</div>
                <MatchupsTable rows={rows} onNavigateTeam={onNavigateTeam} mode={mode} projTotalByGame={projTotalByGame} />
              </div>
            ))}

          {!loading && isAll && visibleRows.length > 0 && <BettingStatsBlock rows={visibleRows} title="Season Betting Stats" />}
        </div>

      <div className="footer-note" data-export-exclude="true">
        Projections use each team's current power rating and do not yet account for injuries,
        weather, or other game-specific factors. Vegas lines are synced from CollegeFootballData
        and may not be available for every game, especially further out.
      </div>
    </div>
  );
}
