import TeamLogo from "../components/TeamLogo";
import { gamesForTeam } from "../data/games";
import { TEAMS_BY_NAME, teamsForConference } from "../data/teams";
import { HFA, spreadColor, spreadToWinPct } from "../lib/odds";
import { computeGraphicCardStats, computeNextOpponent } from "../lib/schedule";

function ScheduleRow({ game, team, onNavigateTeam }: any) {
  const isHome = game.home === team.team;
  const oppName = isHome ? game.away : game.home;
  const opp = TEAMS_BY_NAME[oppName];
  if (!opp) return null;

  // Spread from this team's perspective: negative = this team favored.
  const spread = isHome
    ? team.rating - opp.rating - HFA
    : team.rating - opp.rating + HFA;
  const winPct = spreadToWinPct(spread);
  const result = spread < 0 ? "Win" : spread > 0 ? "Loss" : "Even";

  const dateObj = new Date(game.date);
  const dateLabel = dateObj.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });

  return (
    <tr>
      <td className="schedule-week-cell">{game.week}</td>
      <td className="game-date-cell">{dateLabel}</td>
      <td className="matchup-team-cell">
        <span className="schedule-loc">{isHome ? "vs" : "@"}</span>{" "}
        <button
          className="team-link matchup-team-btn"
          onClick={() => onNavigateTeam(opp)}
        >
          <TeamLogo team={opp} />
          {opp.team}
        </button>
        <span
          className={`matchup-rating ${
            opp.rating < 0 ? "rating-good" : "rating-bad"
          }`}
        >
          {opp.rating > 0 ? "+" : ""}
          {opp.rating.toFixed(2)}
        </span>
      </td>
      <td
        className="matchups-projected-cell"
        style={{ color: spreadColor(spread) }}
      >
        {spread > 0 ? "+" : ""}
        {spread.toFixed(1)}
      </td>
      <td
        className="matchups-winpct-cell"
        style={{ color: spreadColor(spread) }}
      >
        {(winPct * 100).toFixed(1)}%
      </td>
      <td className="schedule-result-cell" style={{ color: spreadColor(spread) }}>
        {result}
      </td>
    </tr>
  );
}


function TeamGraphicCard({ team, onNavigateTeam }: any) {
  const next = computeNextOpponent(team);
  const nextOpp = next?.opp ?? null;
  const nextLoc = next?.loc ?? null;
  const nextSpread = next?.spread ?? null;

  const stats = computeGraphicCardStats(team);

  return (
    <div className="graphic-card">
      <div className="graphic-card-top">
        <div className="graphic-card-team">
          <div className="graphic-card-team-name">{team.team}</div>
          <div className="graphic-card-conf">{team.conf}</div>
        </div>
        <div className="graphic-card-next">
          <div className="graphic-card-next-label">Next Opponent</div>
          {nextOpp ? (
            <>
              <button
                className="graphic-card-next-value"
                onClick={() => onNavigateTeam(nextOpp)}
              >
                <span className="graphic-card-next-loc">({nextLoc})</span>{" "}
                <span style={{ color: spreadColor(nextSpread) }}>
                  {nextSpread > 0 ? "+" : ""}
                  {nextSpread.toFixed(2)}
                </span>{" "}
                {nextOpp.team}
              </button>
              <div
                className="graphic-card-next-winpct"
                style={{ color: spreadColor(nextSpread) }}
              >
                {(spreadToWinPct(nextSpread) * 100).toFixed(1)}% to win
              </div>
            </>
          ) : (
            <span className="graphic-card-tbd">TBD</span>
          )}
        </div>
      </div>

      <div className="graphic-card-grid">
        {stats.map((s) => (
          <div className="graphic-card-cell" key={s.label}>
            <div className="graphic-card-cell-label">{s.label}</div>
            {s.real ? (
              <div
                className="graphic-card-cell-value"
                style={{ background: s.bg }}
              >
                <span style={{ color: s.color }}>{s.value}</span>
                {s.sub && (
                  <span className="graphic-card-cell-sub">{s.sub}</span>
                )}
              </div>
            ) : (
              <div className="graphic-card-cell-value graphic-card-cell-empty">
                <span className="graphic-card-tbd">TBD</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


export default function TeamPage({ team, onNavigateTeam, onHome }: any) {
  const peers = teamsForConference(team.div, team.conf);
  const schedule = gamesForTeam(team.team);

  return (
    <div className="team-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">
          {team.div} · {team.conf}
        </div>
        <h1 className="title team-title">{team.team}</h1>
      </div>

      <div className="table-wrap">
        <TeamGraphicCard team={team} onNavigateTeam={onNavigateTeam} />
      </div>

      <div className="table-wrap">
        <div className="section-label">{team.team} schedule</div>
        {schedule.length === 0 ? (
          <div className="empty matchups-empty">
            No games scheduled yet for {team.team}.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="matchups-table schedule-table">
              <thead>
                <tr>
                  <th className="th">Week</th>
                  <th className="th">Date</th>
                  <th className="th">Opponent</th>
                  <th className="th th-right">Projected</th>
                  <th className="th th-right">Win %</th>
                  <th className="th">Proj. Result</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((g) => (
                  <ScheduleRow
                    key={g.id}
                    game={g}
                    team={team}
                    onNavigateTeam={onNavigateTeam}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <div className="section-label">{team.conf} standings</div>
        <table>
          <thead>
            <tr>
              <th className="th">Rank</th>
              <th className="th">Team</th>
              <th className="th th-right">Rating</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => (
              <tr
                key={p.team}
                className={p.team === team.team ? "row-active" : ""}
              >
                <td>
                  <span
                    className={`rank-flag ${
                      p.rank <= 4 ? "top4" : p.rank <= 12 ? "top12" : ""
                    }`}
                  >
                    {p.rank}
                  </span>
                </td>
                <td>
                  {p.team === team.team ? (
                    <span className="team-name">
                      <TeamLogo team={p} />
                      {p.team}
                    </span>
                  ) : (
                    <button
                      className="team-link"
                      onClick={() => onNavigateTeam(p)}
                    >
                      <TeamLogo team={p} />
                      {p.team}
                    </button>
                  )}
                </td>
                <td
                  className={`rating-cell ${
                    p.rating < 0 ? "rating-good" : "rating-bad"
                  }`}
                >
                  {p.rating > 0 ? "+" : ""}
                  {p.rating.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
