import { useMemo } from "react";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { BRACKET_SEED_NAMES, NATTY_BY_TEAM } from "../data/nattyOdds";
import { TEAMS_BY_NAME } from "../data/teams";
import { fmtOdds } from "../lib/format";
import { HFA, spreadColor, spreadToMoneyline } from "../lib/odds";

export function BracketGame({ seedA, teamA, seedB, teamB, neutral, onNavigateTeam }: any) {
  const spreadA = neutral
    ? teamA.rating - teamB.rating
    : teamA.rating - teamB.rating - HFA;
  const spreadB = -spreadA;
  const aWins = spreadA <= 0;
  const mlA = spreadToMoneyline(spreadA);
  const mlB = spreadToMoneyline(spreadB);

  return (
    <div className="bracket-matchup">
      {neutral && <div className="bracket-neutral-strip">Neutral Site</div>}
      <div className={`bracket-team bracket-team-top ${aWins ? "bracket-winner" : ""}`}>
        <span className="bracket-seed">{seedA}</span>
        <button className="team-link bracket-team-name" onClick={() => onNavigateTeam(teamA)}>
          <TeamLogo team={teamA} />
          {teamA.team}
        </button>
        {!neutral && <span className="bracket-home-tag">HOME</span>}
        <span className="bracket-odds">
          <span className="bracket-spread" style={{ color: spreadColor(spreadA) }}>
            {spreadA > 0 ? "+" : ""}
            {spreadA.toFixed(1)}
          </span>
          <span className="bracket-ml">
            {mlA > 0 ? "+" : ""}
            {Math.round(mlA)}
          </span>
        </span>
      </div>
      <div className={`bracket-team bracket-team-bottom ${!aWins ? "bracket-winner" : ""}`}>
        <span className="bracket-seed">{seedB}</span>
        <button className="team-link bracket-team-name" onClick={() => onNavigateTeam(teamB)}>
          <TeamLogo team={teamB} />
          {teamB.team}
        </button>
        <span className="bracket-odds">
          <span className="bracket-spread" style={{ color: spreadColor(spreadB) }}>
            {spreadB > 0 ? "+" : ""}
            {spreadB.toFixed(1)}
          </span>
          <span className="bracket-ml">
            {mlB > 0 ? "+" : ""}
            {Math.round(mlB)}
          </span>
        </span>
      </div>
    </div>
  );
}


function NattyRow({ team, onNavigateTeam }: any) {
  const pct = NATTY_BY_TEAM[team.team] ?? 0;
  const f = CONF_FUTURES_BY_TEAM[team.team];
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
      <td className="wintotals-total-cell">
        {f ? `${(f.confWinPct * 100).toFixed(1)}%` : "–"}
        {f && <span className="compare-value-sub"> {fmtOdds(f.fairPrice)}</span>}
      </td>
      <td className="wintotals-total-cell">{(pct * 100).toFixed(2)}%</td>
    </tr>
  );
}


export default function BracketPage({ subLabel, onNavigateTeam, onHome }: any) {
  const seeds = useMemo(
    () => BRACKET_SEED_NAMES.map((name) => TEAMS_BY_NAME[name]).filter(Boolean),
    []
  );

  if (seeds.length < 12) {
    return (
      <div className="matchups-page">
        <div className="team-hero">
          <button className="back-link" onClick={onHome}>
            ‹ All rankings
          </button>
          <div className="eyebrow">FBS Playoff Bracket</div>
          <h1 className="title matchup-title">12-TEAM BRACKET</h1>
        </div>
        <div className="empty matchups-empty">Not enough FBS teams ranked yet.</div>
      </div>
    );
  }

  // Round 1: higher seed (5-8) hosts the lower seed (9-12).
  const r1Pairs = [
    { hostSeed: 8, awaySeed: 9 },
    { hostSeed: 5, awaySeed: 12 },
    { hostSeed: 6, awaySeed: 11 },
    { hostSeed: 7, awaySeed: 10 },
  ];

  const r1Results = r1Pairs.map((p) => {
    const host = seeds[p.hostSeed - 1];
    const away = seeds[p.awaySeed - 1];
    const spread = host.rating - away.rating - HFA;
    const hostWins = spread <= 0;
    return {
      hostSeed: p.hostSeed,
      host,
      awaySeed: p.awaySeed,
      away,
      winner: hostWins ? host : away,
      winnerSeed: hostWins ? p.hostSeed : p.awaySeed,
    };
  });

  // Quarterfinals: seeds 1-4 play the round 1 winner from their bracket slot,
  // at a neutral site (no home-field advantage).
  const qfPairs = [
    { seed: 1, r1Index: 0 },
    { seed: 2, r1Index: 3 },
    { seed: 3, r1Index: 2 },
    { seed: 4, r1Index: 1 },
  ];

  const qfResults = qfPairs.map((q) => {
    const host = seeds[q.seed - 1];
    const opp = r1Results[q.r1Index].winner;
    const oppSeed = r1Results[q.r1Index].winnerSeed;
    const spread = host.rating - opp.rating;
    const hostWins = spread <= 0;
    return {
      seed: q.seed,
      host,
      oppSeed,
      opp,
      winner: hostWins ? host : opp,
      winnerSeed: hostWins ? q.seed : oppSeed,
    };
  });

  // Semifinals and Championship are projected at a neutral site.
  const sf1A = { team: qfResults[0].winner, seed: qfResults[0].winnerSeed };
  const sf1B = { team: qfResults[3].winner, seed: qfResults[3].winnerSeed };
  const sf2A = { team: qfResults[1].winner, seed: qfResults[1].winnerSeed };
  const sf2B = { team: qfResults[2].winner, seed: qfResults[2].winnerSeed };

  const sf1Winner =
    sf1A.team.rating - sf1B.team.rating <= 0
      ? sf1A
      : sf1B;
  const sf2Winner =
    sf2A.team.rating - sf2B.team.rating <= 0
      ? sf2A
      : sf2B;

  const nattyRows = [...seeds].sort(
    (a, b) => (NATTY_BY_TEAM[b.team] ?? 0) - (NATTY_BY_TEAM[a.team] ?? 0)
  );

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">FBS Playoff Bracket · {subLabel}</div>
        <h1 className="title matchup-title">12-TEAM BRACKET</h1>
        <p className="subtitle team-subtitle">
          Our projected 12-team field, played out round by round — the
          favored team in each game advances. First round is hosted by the
          higher seed; quarterfinals, semifinals, and championship are all
          projected at a neutral site.
        </p>
      </div>

      <div className="bracket-body">
        <div className="bracket-columns">
          <div className="bracket-col">
            <div className="section-label bracket-round-label">First Round</div>
            <div className="bracket-col-games">
              {r1Results.map((m) => (
                <BracketGame
                  key={m.hostSeed}
                  seedA={m.hostSeed}
                  teamA={m.host}
                  seedB={m.awaySeed}
                  teamB={m.away}
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Quarterfinals</div>
            <div className="bracket-col-games">
              {qfResults.map((q) => (
                <BracketGame
                  key={q.seed}
                  seedA={q.seed}
                  teamA={q.host}
                  seedB={q.oppSeed}
                  teamB={q.opp}
                  neutral
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Semifinals</div>
            <div className="bracket-col-games">
              <BracketGame
                seedA={sf1A.seed}
                teamA={sf1A.team}
                seedB={sf1B.seed}
                teamB={sf1B.team}
                neutral
                onNavigateTeam={onNavigateTeam}
              />
              <BracketGame
                seedA={sf2A.seed}
                teamA={sf2A.team}
                seedB={sf2B.seed}
                teamB={sf2B.team}
                neutral
                onNavigateTeam={onNavigateTeam}
              />
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Championship</div>
            <div className="bracket-col-games">
              <BracketGame
                seedA={sf1Winner.seed}
                teamA={sf1Winner.team}
                seedB={sf2Winner.seed}
                teamB={sf2Winner.team}
                neutral
                onNavigateTeam={onNavigateTeam}
              />
            </div>
          </div>
        </div>

        <div className="section-label bracket-round-label">
          Natty Odds — Field Only
        </div>
        <div className="table-wrap bracket-natty-wrap">
          <table>
            <thead>
              <tr>
                <th className="th">Team</th>
                <th className="th th-right">Power Rating</th>
                <th className="th th-right">Conf Win Odds</th>
                <th className="th th-right">Win Natty</th>
              </tr>
            </thead>
            <tbody>
              {nattyRows.map((t) => (
                <NattyRow key={t.team} team={t} onNavigateTeam={onNavigateTeam} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footer-note">
        Natty odds are projected only for the 12 teams in this bracket
        field. The highlighted team in each game is our projected winner.
      </div>
    </div>
  );
}
