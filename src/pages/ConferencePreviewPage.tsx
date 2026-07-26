import { useMemo } from "react";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { TEAMS } from "../data/teams";
import { fmtNum, fmtOdds, fmtPct } from "../lib/format";
import { TEAM_WIN_TOTALS } from "../lib/ranks";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function DiffCell({ value }: any) {
  if (value == null) return <td className="wintotals-total-cell">–</td>;
  return (
    <td className="wintotals-total-cell">
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
    </td>
  );
}

function ConferencePreviewRow({ team, live, maxPct, onNavigateTeam }: any) {
  const f = CONF_FUTURES_BY_TEAM[team.team];
  const winTotal = live?.total_wins ?? TEAM_WIN_TOTALS[team.team]?.total ?? 0;
  const confWinTotal = live?.conf_proj_wins ?? TEAM_WIN_TOTALS[team.team]?.confTotal ?? 0;
  const seasonWinLine = live?.season_win_line ?? null;
  const confLine = live?.conf_line ?? f?.confLine ?? null;
  const fairPrice = live?.fair_price ?? f?.fairPrice ?? null;
  const confWinPct = live?.conf_win_pct ?? f?.confWinPct ?? 0;
  const odds = live?.odds ?? f?.odds ?? null;

  const seasonWinDiff = seasonWinLine != null ? winTotal - seasonWinLine : null;
  const confWinDiff = confLine != null ? confWinTotal - confLine : null;

  const pct = confWinPct ?? 0;
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
      <td className="wintotals-total-cell">{fmtNum(seasonWinLine)}</td>
      <DiffCell value={seasonWinDiff} />
      <td className="wintotals-total-cell">{confWinTotal.toFixed(2)}</td>
      <td className="wintotals-total-cell">{fmtNum(confLine)}</td>
      <DiffCell value={confWinDiff} />
      <td className="wintotals-total-cell">{fmtOdds(fairPrice)}</td>
      <td className="conf-odds-cell">
        <div className="conf-odds-bar-track">
          <div className="conf-odds-bar-fill" style={{ width: `${barWidth}%` }} />
        </div>
        <span className="conf-odds-pct">{fmtPct(confWinPct)}</span>
      </td>
      <td className="wintotals-total-cell">{fmtOdds(odds)}</td>
    </tr>
  );
}

export default function ConferencePreviewPage({ conference, onNavigateTeam, onHome }: any) {
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const rows = useMemo(() => {
    const list = TEAMS.filter((t) => t.conf === conference);
    return [...list].sort((a, b) => {
      const pa = liveByTeam[a.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[a.team]?.confWinPct;
      const pb = liveByTeam[b.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[b.team]?.confWinPct;
      if (pa == null && pb == null) return a.rating - b.rating;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pb - pa;
    });
  }, [conference, liveByTeam]);

  const maxPct = rows.reduce((max, t) => {
    const pct = liveByTeam[t.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[t.team]?.confWinPct ?? 0;
    return Math.max(max, pct);
  }, 0);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Conference Preview</div>
        <h1 className="title matchup-title">{conference.toUpperCase()}</h1>
        <p className="subtitle team-subtitle">
          Model odds to win the conference, projected win totals (season and
          conference), the market's lines for both, and our fair conference
          price for every {conference} team.
        </p>
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty matchups-empty">
            No teams found for {conference}.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th th-right">Power Rating</th>
                  <th className="th th-right">Proj. Wins</th>
                  <th className="th th-right">Vegas Win Total</th>
                  <th className="th th-right">Win Total Diff</th>
                  <th className="th th-right">Conf. Wins</th>
                  <th className="th th-right">Conf. Win Vegas Line</th>
                  <th className="th th-right">Conf. Win Diff</th>
                  <th className="th th-right">Fair Conf. Price</th>
                  <th className="th">Conference Odds</th>
                  <th className="th th-right">Conference Vegas Odds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <ConferencePreviewRow
                    key={t.team}
                    team={t}
                    live={liveByTeam[t.team]}
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
        Fair Conf. Price is our model's own fair American-odds price to win
        the conference. Diff columns are ours minus the market's line —
        positive means we're projecting more wins than the market.
      </div>
    </div>
  );
}
