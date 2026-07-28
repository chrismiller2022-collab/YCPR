import { useMemo } from "react";
import ConfLink from "../components/ConfLink";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { NATTY_BY_TEAM } from "../data/nattyOdds";
import { TEAMS } from "../data/teams";
import { fmtPct } from "../lib/format";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function NattyOddsRow({ team, myOdds, vegasOdds, onNavigateTeam, onNavigateConference }: any) {
  const f = CONF_FUTURES_BY_TEAM[team.team];
  return (
    <tr>
      <td>
        <button className="team-link" onClick={() => onNavigateTeam(team)}>
          <TeamLogo team={team} />
          {team.team}
        </button>
      </td>
      <td className="conf-cell">
        <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
      </td>
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell">
        {f ? `${(f.confWinPct * 100).toFixed(1)}%` : "–"}
      </td>
      <td className="wintotals-total-cell">{fmtPct(myOdds)}</td>
      <td className="wintotals-total-cell">{fmtPct(vegasOdds)}</td>
    </tr>
  );
}

export default function NattyOddsPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const rows = useMemo(() => {
    // The field is whichever teams have a live natty_odds value saved —
    // not a fixed list, since which teams make the projected bracket
    // can change week to week. Falls back to the static snapshot only if
    // no live data has been saved yet at all.
    const hasLiveData = Object.values(liveByTeam).some((r: any) => r?.natty_odds != null);

    const list = hasLiveData
      ? TEAMS.filter((t) => liveByTeam[t.team]?.natty_odds != null)
      : TEAMS.filter((t) => NATTY_BY_TEAM[t.team] != null);

    return [...list].sort((a, b) => {
      const pa = liveByTeam[a.team]?.natty_odds ?? NATTY_BY_TEAM[a.team] ?? 0;
      const pb = liveByTeam[b.team]?.natty_odds ?? NATTY_BY_TEAM[b.team] ?? 0;
      return pb - pa;
    });
  }, [liveByTeam]);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Futures</div>
        <h1 className="title matchup-title">NATTY ODDS</h1>
        <p className="subtitle team-subtitle">
          Odds to win the national championship — projected only for the
          teams in our national championship field, since that's the field
          our model actually simulates.
        </p>
      </div>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty matchups-empty">
            No natty odds saved yet — check back once this week's data is in.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th">Conference</th>
                  <th className="th th-right">Power Rating</th>
                  <th className="th th-right">Conf Win Odds</th>
                  <th className="th th-right">My Natty Odds</th>
                  <th className="th th-right">Vegas Natty Odds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <NattyOddsRow
                    key={t.team}
                    team={t}
                    myOdds={liveByTeam[t.team]?.natty_odds ?? NATTY_BY_TEAM[t.team]}
                    vegasOdds={liveByTeam[t.team]?.draftkings_natty_odds}
                    onNavigateTeam={onNavigateTeam}
                    onNavigateConference={onNavigateConference}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note">
        My Natty Odds is our model's own projection. Vegas Natty Odds is the
        market's current price (currently only available once saved through
        the weekly upload).
      </div>
    </div>
  );
}
