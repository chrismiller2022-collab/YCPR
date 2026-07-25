import { useMemo } from "react";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { TEAMS } from "../data/teams";
import { fmtNum, fmtOdds, fmtPct } from "../lib/format";
import { TEAM_WIN_TOTALS } from "../lib/ranks";

function ConferencePreviewRow({ team, maxPct, onNavigateTeam }: any) {
  const f = CONF_FUTURES_BY_TEAM[team.team];
  const winTotal = TEAM_WIN_TOTALS[team.team]?.total ?? 0;
  const confWinTotal = TEAM_WIN_TOTALS[team.team]?.confTotal ?? 0;
  const pct = f?.confWinPct ?? 0;
  const barWidth = maxPct > 0 ? Math.max((pct / maxPct) * 100, pct > 0 ? 2 : 0) : 0;

  return (
    <tr>
      <td>
        <button className="team-link" onClick={() => onNavigateTeam(team)}>
          <TeamLogo team={team} />
          {team.team}
        </button>
      </td>
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell">{winTotal.toFixed(2)}</td>
      <td className="wintotals-total-cell">{confWinTotal.toFixed(2)}</td>
      <td className="wintotals-total-cell">{fmtNum(f?.confLine)}</td>
      <td className="conf-odds-cell">
        <div className="conf-odds-bar-track">
          <div className="conf-odds-bar-fill" style={{ width: `${barWidth}%` }} />
        </div>
        <span className="conf-odds-pct">{fmtPct(f?.confWinPct)}</span>
      </td>
      <td className="wintotals-total-cell">{fmtOdds(f?.odds)}</td>
    </tr>
  );
}


export default function ConferencePreviewPage({ conference, onNavigateTeam, onHome }: any) {
  const rows = useMemo(() => {
    const list = TEAMS.filter((t) => t.conf === conference);
    return [...list].sort((a, b) => {
      const pa = CONF_FUTURES_BY_TEAM[a.team]?.confWinPct;
      const pb = CONF_FUTURES_BY_TEAM[b.team]?.confWinPct;
      if (pa == null && pb == null) return a.rating - b.rating;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pb - pa;
    });
  }, [conference]);

  const maxPct = rows.reduce(
    (max, t) => Math.max(max, CONF_FUTURES_BY_TEAM[t.team]?.confWinPct ?? 0),
    0
  );

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Conference Preview</div>
        <h1 className="title matchup-title">{conference.toUpperCase()}</h1>
        <p className="subtitle team-subtitle">
          Model odds to win the conference, plus projected win totals and the
          market's conference win line for every {conference} team.
        </p>
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty matchups-empty">
            No futures data available for {conference} yet.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th th-right">Power Rating</th>
                  <th className="th th-right">Proj. Wins</th>
                  <th className="th th-right">Conf. Wins</th>
                  <th className="th th-right">Conf. Win Vegas Line</th>
                  <th className="th">Conference Odds</th>
                  <th className="th th-right">Conference Vegas Odds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <ConferencePreviewRow
                    key={t.team}
                    team={t}
                    maxPct={maxPct}
                    onNavigateTeam={onNavigateTeam}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note">
        Conference Odds bar reflects our model's probability to win the
        conference. Conference Vegas Odds is the market's current price.
        Conference Win Vegas Line is the de-vigged line, accounting for the
        juice on the over/under — for example, Ohio State at 7.5 with Over
        +115 / Under -136 de-vigs to 7.25.
      </div>
    </div>
  );
}
