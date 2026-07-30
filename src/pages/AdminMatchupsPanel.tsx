import { useEffect, useMemo, useState } from "react";
import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor, spreadColor, spreadToMoneyline, spreadToWinPct } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines, type BettingLineRow } from "../lib/api/gamesLines";

// ---------------------------------------------------------------------
// This is the first "real" version of Admin Matchups — it now pulls
// actual games and betting lines from Supabase (synced from CFBD)
// instead of cloning the public page's local data/games.ts. Same table
// format/columns as the public page, but Vegas Line / Score / Cover
// columns are now populated with real data where the public page only
// ever showed placeholder dashes.
//
// SIGN CONVENTION — worth double-checking against real results:
// This site's existing convention (TeamPage, public MatchupsPage,
// ScheduleSwapPage) expresses spread from the AWAY team's perspective:
// negative = away favored, positive = home favored. CFBD's raw `spread`
// field is documented as home-team-perspective (negative = home
// favored), so it's negated here to convert into our convention:
//   vegasAwaySpread = -cfbdLine.spread
// This has NOT yet been verified against a completed game with a known
// final line — once a real graded game is in the data, it's worth
// eyeballing one row to confirm "Act. Cover Team" comes out right.
// ---------------------------------------------------------------------

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];

function pickLine(lines: BettingLineRow[]): BettingLineRow | null {
  if (lines.length === 0) return null;
  for (const p of PREFERRED_PROVIDERS) {
    const match = lines.find((l) => l.provider === p);
    if (match) return match;
  }
  return lines[0];
}

function classOf(g: GameWithLines, side: "home" | "away"): string {
  const c = side === "home" ? g.home_classification : g.away_classification;
  return (c ?? "").toLowerCase();
}

function isTracked(c: string) {
  return c === "fbs" || c === "fcs";
}

interface MatchupComputed {
  game: GameWithLines;
  line: BettingLineRow | null;
  awayTeam: any | null;
  homeTeam: any | null;
  projAwaySpread: number | null;
  vegasAwaySpread: number | null;
  amountOff: number | null;
  projWinPct: number | null;
  projMoneyline: number | null;
  vegasMoneyline: number | null;
  projCoverTeam: "away" | "home" | null;
  actCoverTeam: "away" | "home" | "push" | null;
  totalResult: "Over" | "Under" | "Push" | null;
}

function computeRow(game: GameWithLines, liveByTeam: Record<string, any>): MatchupComputed {
  const line = pickLine(game.lines);
  const awayTeam = TEAMS_BY_NAME[game.away_team] ?? null;
  const homeTeam = TEAMS_BY_NAME[game.home_team] ?? null;

  const projAwaySpread =
    awayTeam && homeTeam
      ? awayTeam.rating - homeTeam.rating + hfaFor(game.home_team, liveByTeam)
      : null;

  const vegasAwaySpread = line?.spread != null ? -line.spread : null;

  const amountOff =
    projAwaySpread != null && vegasAwaySpread != null ? projAwaySpread - vegasAwaySpread : null;

  const projWinPct = projAwaySpread != null ? spreadToWinPct(projAwaySpread) : null;
  const projMoneyline = projAwaySpread != null ? spreadToMoneyline(projAwaySpread) : null;
  const vegasMoneyline = line?.away_moneyline ?? null;

  let projCoverTeam: "away" | "home" | null = null;
  if (projAwaySpread != null && vegasAwaySpread != null) {
    const projDiff = vegasAwaySpread - projAwaySpread;
    projCoverTeam = projDiff > 0 ? "away" : projDiff < 0 ? "home" : null;
  }

  let actCoverTeam: "away" | "home" | "push" | null = null;
  if (game.completed && game.away_points != null && game.home_points != null && vegasAwaySpread != null) {
    const actualAwayMargin = game.away_points - game.home_points;
    const coverMargin = actualAwayMargin + vegasAwaySpread;
    actCoverTeam = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
  }

  let totalResult: "Over" | "Under" | "Push" | null = null;
  if (game.completed && game.away_points != null && game.home_points != null && line?.over_under != null) {
    const actualTotal = game.away_points + game.home_points;
    totalResult = actualTotal > line.over_under ? "Over" : actualTotal < line.over_under ? "Under" : "Push";
  }

  return {
    game,
    line,
    awayTeam,
    homeTeam,
    projAwaySpread,
    vegasAwaySpread,
    amountOff,
    projWinPct,
    projMoneyline,
    vegasMoneyline,
    projCoverTeam,
    actCoverTeam,
    totalResult,
  };
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
  const { game, line, awayTeam, homeTeam, projAwaySpread, vegasAwaySpread, amountOff, projWinPct, projMoneyline, vegasMoneyline, projCoverTeam, actCoverTeam, totalResult } = computed;

  const dateLabel = game.start_date
    ? new Date(game.start_date).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })
    : "–";

  const scoreLabel =
    game.away_points != null && game.home_points != null ? `${game.away_points}-${game.home_points}` : "–";

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
        <td className="matchups-empty-cell">{game.away_points ?? "–"}</td>
        <td className="matchups-empty-cell">{game.home_points ?? "–"}</td>
        <td className="matchups-winner-cell">
          {projCoverTeam ? (projCoverTeam === "away" ? game.away_team : game.home_team) : "–"}
        </td>
        <td className="matchups-empty-cell">–</td>
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

        {!loading && computedRows.length === 0 && (
          <div className="empty matchups-empty">
            No games saved for this selection yet — sync this season/week from the Games &
            Lines tile first.
          </div>
        )}

        {!loading && computedRows.length > 0 && (
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
                    <th className="th th-right">Away Score</th>
                    <th className="th th-right">Home Score</th>
                    <th className="th">Proj. Cover Team</th>
                    <th className="th">Filtered Bet</th>
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
                {computedRows.map((c) => (
                  <MatchupsRow key={c.game.id} computed={c} mode={mode} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note">
        Projected Total isn't modeled yet (that's the future Game Totals tile) — only
        Vegas Total and, for completed games, the actual Over/Under result are shown.
      </div>
    </div>
  );
}
