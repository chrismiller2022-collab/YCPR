import { useMemo, useState } from "react";
import TeamCell from "../components/TeamCell";
import { GAMES, WEEKS } from "../data/games";
import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor, spreadColor, spreadToMoneyline, spreadToWinPct } from "../lib/odds";
import { dateLabelFor } from "../lib/format";
import { computeBettingStats, winPctLabel } from "../lib/betting";
import { useWeeklyStats } from "../lib/api/weeklyStats";

// ---------------------------------------------------------------------
// NOTE: this is currently a straight clone of the public MatchupsPage,
// per the plan to use the public page as a starting template. It's
// expected to diverge from the public version over time (e.g. showing
// actual CFBD lines from the games/betting_lines tables alongside our
// own projections, or admin-only editing controls) — TBD.
// ---------------------------------------------------------------------

function SpreadsRow({ game, liveByTeam, onNavigateTeam }: any) {
  const away = TEAMS_BY_NAME[game.away];
  const home = TEAMS_BY_NAME[game.home];
  if (!away || !home) return null;

  const awaySpread = away.rating - home.rating + hfaFor(game.home, liveByTeam);

  return (
    <tr>
      <td className="game-date-cell">{dateLabelFor(game)}</td>
      <TeamCell team={away} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={home} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-projected-cell" style={{ color: spreadColor(awaySpread) }}>
        {awaySpread > 0 ? "+" : ""}
        {awaySpread.toFixed(1)}
      </td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
    </tr>
  );
}

function MoneylineRow({ game, liveByTeam, onNavigateTeam }: any) {
  const away = TEAMS_BY_NAME[game.away];
  const home = TEAMS_BY_NAME[game.home];
  if (!away || !home) return null;

  const awaySpread = away.rating - home.rating + hfaFor(game.home, liveByTeam);
  const awayWinPct = spreadToWinPct(awaySpread);
  const awayML = spreadToMoneyline(awaySpread);
  const winner = awaySpread < 0 ? away : awaySpread > 0 ? home : null;

  return (
    <tr>
      <td className="game-date-cell">{dateLabelFor(game)}</td>
      <TeamCell team={away} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={home} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-projected-cell" style={{ color: spreadColor(awaySpread) }}>
        {awayML > 0 ? "+" : ""}
        {Math.round(awayML)}
      </td>
      <td className="matchups-winpct-cell" style={{ color: spreadColor(awaySpread) }}>
        {(awayWinPct * 100).toFixed(1)}%
      </td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-winner-cell">{winner ? winner.team : "Pick'em"}</td>
      <td className="matchups-empty-cell">–</td>
    </tr>
  );
}

function TotalsRow({ game, onNavigateTeam }: any) {
  const away = TEAMS_BY_NAME[game.away];
  const home = TEAMS_BY_NAME[game.home];
  if (!away || !home) return null;

  return (
    <tr>
      <td className="game-date-cell">{dateLabelFor(game)}</td>
      <TeamCell team={away} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={home} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
    </tr>
  );
}

const MATCHUPS_MODES = [
  { key: "spreads", label: "Spreads" },
  { key: "moneyline", label: "Moneylines" },
  { key: "totals", label: "Totals" },
];

function MatchupsTable({ games, liveByTeam, onNavigateTeam, mode }: any) {
  return (
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
          {mode === "spreads" &&
            games.map((g) => (
              <SpreadsRow key={g.id} game={g} liveByTeam={liveByTeam} onNavigateTeam={onNavigateTeam} />
            ))}
          {mode === "moneyline" &&
            games.map((g) => (
              <MoneylineRow key={g.id} game={g} liveByTeam={liveByTeam} onNavigateTeam={onNavigateTeam} />
            ))}
          {mode === "totals" &&
            games.map((g) => <TotalsRow key={g.id} game={g} onNavigateTeam={onNavigateTeam} />)}
        </tbody>
      </table>
    </div>
  );
}

function BettingStatsBlock({ games, liveByTeam, title }: any) {
  const stats = useMemo(() => computeBettingStats(games, liveByTeam), [games, liveByTeam]);

  return (
    <div className="bet-stats">
      <div className="section-label bet-stats-label">{title || "Betting Stats"}</div>
      <div className="bet-stats-row">
        <div className="bet-stats-card">
          <div className="bet-stats-title">Straight Up</div>
          <div className="bet-stats-record">
            {stats.su.w}-{stats.su.l}
          </div>
          <div className="bet-stats-pct">{winPctLabel(stats.su)}</div>
        </div>
        <div className="bet-stats-card">
          <div className="bet-stats-title">ATS</div>
          <div className="bet-stats-record">
            {stats.ats.w}-{stats.ats.l}
          </div>
          <div className="bet-stats-pct">{winPctLabel(stats.ats)}</div>
        </div>
        <div className="bet-stats-card">
          <div className="bet-stats-title">Filtered Bets</div>
          <div className="bet-stats-record">
            {stats.fb.w}-{stats.fb.l}
          </div>
          <div className="bet-stats-pct">{winPctLabel(stats.fb)}</div>
        </div>
      </div>
    </div>
  );
}

export default function AdminMatchupsPanel({ onBack }: { onBack: () => void }) {
  const [weekSel, setWeekSel] = useState("all");
  const isAll = weekSel === "all";
  const weekNum = isAll ? null : parseInt(weekSel.replace("week", ""), 10);

  const [query, setQuery] = useState("");
  const [matchupType, setMatchupType] = useState("All");
  const [mode, setMode] = useState("spreads");
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const matchesFilters = (g: any) => {
    const home = TEAMS_BY_NAME[g.home];
    const away = TEAMS_BY_NAME[g.away];
    if (matchupType !== "All") {
      if (!home || !away) return false;
      if (matchupType === "FBSvFBS" && !(home.div === "FBS" && away.div === "FBS")) return false;
      if (matchupType === "FCSvFCS" && !(home.div === "FCS" && away.div === "FCS")) return false;
      if (matchupType === "Cross" && home.div === away.div) return false;
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      if (!g.home.toLowerCase().includes(q) && !g.away.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const filteredGames = useMemo(() => {
    let list = isAll ? GAMES : GAMES.filter((g) => g.week === weekNum);
    return list.filter(matchesFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAll, weekNum, matchupType, query]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Matchups (Admin)</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Currently a copy of the public Matchups page — this will diverge later (e.g.
        showing real CFBD lines alongside our projections, or edit controls).
      </p>

      <div className="controls matchups-controls">
        <select className="filter" value={weekSel} onChange={(e) => setWeekSel(e.target.value)}>
          <option value="all">All weeks</option>
          {WEEKS.map((w) => (
            <option key={w.key} value={w.key}>
              {w.label}
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
          <option value="Cross">Cross-Division</option>
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

      <div className="table-wrap">
        {filteredGames.length === 0 && (
          <div className="empty matchups-empty">No games match that search.</div>
        )}

        {filteredGames.length > 0 && (
          <>
            <MatchupsTable games={filteredGames} liveByTeam={liveByTeam} onNavigateTeam={() => {}} mode={mode} />
            <BettingStatsBlock games={filteredGames} liveByTeam={liveByTeam} title="Betting Stats" />
          </>
        )}
      </div>
    </div>
  );
}
