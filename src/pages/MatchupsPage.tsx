import { useMemo, useState } from "react";
import TeamCell from "../components/TeamCell";
import { GAMES } from "../data/games";
import { TEAMS_BY_NAME } from "../data/teams";
import { HFA, spreadColor, spreadToMoneyline, spreadToWinPct } from "../lib/odds";
import { dateLabelFor } from "../lib/format";
import { computeBettingStats, winPctLabel } from "../lib/betting";

function SpreadsRow({ game, onNavigateTeam }: any) {
  const away = TEAMS_BY_NAME[game.away];
  const home = TEAMS_BY_NAME[game.home];
  if (!away || !home) return null;

  // Spread is always expressed from the away team's perspective:
  // negative = away favored, positive = home favored.
  const awaySpread = away.rating - home.rating + HFA;

  return (
    <tr>
      <td className="game-date-cell">{dateLabelFor(game)}</td>
      <TeamCell team={away} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={home} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-empty-cell">–</td>
      <td
        className="matchups-projected-cell"
        style={{ color: spreadColor(awaySpread) }}
      >
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


function MoneylineRow({ game, onNavigateTeam }: any) {
  const away = TEAMS_BY_NAME[game.away];
  const home = TEAMS_BY_NAME[game.home];
  if (!away || !home) return null;

  const awaySpread = away.rating - home.rating + HFA;
  const awayWinPct = spreadToWinPct(awaySpread);
  const awayML = spreadToMoneyline(awaySpread);
  const winner = awaySpread < 0 ? away : awaySpread > 0 ? home : null;

  return (
    <tr>
      <td className="game-date-cell">{dateLabelFor(game)}</td>
      <TeamCell team={away} onNavigateTeam={onNavigateTeam} />
      <TeamCell team={home} onNavigateTeam={onNavigateTeam} />
      <td className="matchups-empty-cell">–</td>
      <td
        className="matchups-projected-cell"
        style={{ color: spreadColor(awaySpread) }}
      >
        {awayML > 0 ? "+" : ""}
        {Math.round(awayML)}
      </td>
      <td
        className="matchups-winpct-cell"
        style={{ color: spreadColor(awaySpread) }}
      >
        {(awayWinPct * 100).toFixed(1)}%
      </td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-empty-cell">–</td>
      <td className="matchups-winner-cell">
        {winner ? winner.team : "Pick'em"}
      </td>
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


function MatchupsTable({ games, onNavigateTeam, mode }: any) {
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
              <SpreadsRow key={g.id} game={g} onNavigateTeam={onNavigateTeam} />
            ))}
          {mode === "moneyline" &&
            games.map((g) => (
              <MoneylineRow key={g.id} game={g} onNavigateTeam={onNavigateTeam} />
            ))}
          {mode === "totals" &&
            games.map((g) => (
              <TotalsRow key={g.id} game={g} onNavigateTeam={onNavigateTeam} />
            ))}
        </tbody>
      </table>
    </div>
  );
}


function BettingStatsBlock({ games, title }: any) {
  const stats = useMemo(() => computeBettingStats(games), [games]);

  return (
    <div className="bet-stats">
      <div className="section-label bet-stats-label">
        {title || "Betting Stats"}
      </div>
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
      <div className="bet-stats-note">
        Records grade automatically once final scores, Vegas lines, and
        filtered-bet picks are added — currently 0-0 since that data isn't
        connected yet.
      </div>
    </div>
  );
}


export default function MatchupsPage({ subKey, subLabel, onNavigateTeam, onHome }: any) {
  const isAll = subKey === "all";
  const weekNum = isAll ? null : parseInt(subKey.replace("week", ""), 10);

  const [query, setQuery] = useState("");
  const [matchupType, setMatchupType] = useState("All");
  const [mode, setMode] = useState("spreads");

  const matchesFilters = (g) => {
    const home = TEAMS_BY_NAME[g.home];
    const away = TEAMS_BY_NAME[g.away];
    if (matchupType !== "All") {
      if (!home || !away) return false;
      if (matchupType === "FBSvFBS" && !(home.div === "FBS" && away.div === "FBS"))
        return false;
      if (matchupType === "FCSvFCS" && !(home.div === "FCS" && away.div === "FCS"))
        return false;
      if (matchupType === "Cross" && home.div === away.div) return false;
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      if (
        !g.home.toLowerCase().includes(q) &&
        !g.away.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  };

  const filteredGames = useMemo(() => {
    let list = isAll ? GAMES : GAMES.filter((g) => g.week === weekNum);
    return list.filter(matchesFilters);
  }, [isAll, weekNum, matchupType, query]);

  const groupedByWeek = useMemo(() => {
    if (!isAll) return null;
    const map = {};
    filteredGames.forEach((g) => {
      (map[g.week] = map[g.week] || []).push(g);
    });
    return Object.keys(map)
      .map(Number)
      .sort((a, b) => a - b)
      .map((w) => ({ week: w, games: map[w] }));
  }, [isAll, filteredGames]);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Weekly Matchups</div>
        <h1 className="title matchup-title">{subLabel.toUpperCase()}</h1>
        <p className="subtitle team-subtitle">
          {mode === "spreads" &&
            `Projected spreads for every game, calculated from current power ratings with a flat ${HFA}-point home field advantage.`}
          {mode === "moneyline" &&
            `Projected moneylines and win percentages for every game, derived from current power ratings with a flat ${HFA}-point home field advantage.`}
          {mode === "totals" &&
            "Projected totals for every game — coming soon once a scoring model is connected."}
        </p>
      </div>

      <div className="controls matchups-controls">
        <input
          className="search"
          placeholder="Search for a team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="filter"
          value={matchupType}
          onChange={(e) => setMatchupType(e.target.value)}
        >
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
        {!isAll && filteredGames.length === 0 && (
          <div className="empty matchups-empty">
            No games scheduled for {subLabel} yet.
          </div>
        )}

        {!isAll && filteredGames.length > 0 && (
          <>
            <MatchupsTable games={filteredGames} onNavigateTeam={onNavigateTeam} mode={mode} />
            <BettingStatsBlock games={filteredGames} title={`${subLabel} Betting Stats`} />
          </>
        )}

        {isAll && groupedByWeek.length === 0 && (
          <div className="empty matchups-empty">
            No games match that search.
          </div>
        )}

        {isAll &&
          groupedByWeek.map(({ week, games }) => (
            <div key={week} className="week-group">
              <div className="section-label week-group-label">
                Week {week}
              </div>
              <MatchupsTable games={games} onNavigateTeam={onNavigateTeam} mode={mode} />
            </div>
          ))}

        {isAll && filteredGames.length > 0 && (
          <BettingStatsBlock games={filteredGames} title="Season Betting Stats" />
        )}
      </div>

      <div className="footer-note">
        Projections use each team's current power rating and do not yet
        account for injuries, weather, or other game-specific factors.
      </div>
    </div>
  );
}
