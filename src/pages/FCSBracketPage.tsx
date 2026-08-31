import { useMemo } from "react";
import ConfLink from "../components/ConfLink";
import TeamLogo from "../components/TeamLogo";
import { BracketGame } from "./BracketPage";
import { buildFCS24Field, pairFirstRoundNoConfConflict, playGame, reseedAndPair } from "../lib/bracket24";
import { useWeeklyStats } from "../lib/api/weeklyStats";

export default function FCSBracketPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const staticField = useMemo(() => buildFCS24Field(), []);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  // Resolve every field entry's rating to its live weekly value once, so
  // seeding math, BracketGame spreads, and the field table below all agree.
  const field = useMemo(
    () =>
      staticField.map((f) => ({
        ...f,
        team: { ...f.team, rating: liveByTeam[f.team.team]?.rating ?? f.team.rating },
      })),
    [staticField, liveByTeam]
  );

  if (field.length < 24) {
    return (
      <div className="matchups-page">
        <div className="team-hero">
          <button className="back-link" onClick={onHome}>
            ‹ All rankings
          </button>
          <div className="eyebrow">FCS</div>
          <h1 className="title matchup-title">FCS PLAYOFF BRACKET</h1>
        </div>
        <div className="empty matchups-empty">
          Not enough FCS teams yet to build a full 24-team field.
        </div>
      </div>
    );
  }

  const byes = field.slice(0, 8);
  const firstRoundField = field.slice(8, 24);

  const r1Pairs = pairFirstRoundNoConfConflict(firstRoundField);
  const r1Winners = r1Pairs.map((p) => playGame(p.host, p.away, false, liveByTeam));

  const r2Pool = [...byes, ...r1Winners];
  const r2Pairs = reseedAndPair(r2Pool);
  const r2Winners = r2Pairs.map((p) => playGame(p.host, p.away, false, liveByTeam));

  const qfPairs = reseedAndPair(r2Winners);
  const qfWinners = qfPairs.map((p) => playGame(p.host, p.away, false, liveByTeam));

  const sfPairs = reseedAndPair(qfWinners);
  const sfWinners = sfPairs.map((p) => playGame(p.host, p.away, false, liveByTeam));

  const champPair = reseedAndPair(sfWinners)[0];
  const champion = playGame(champPair.host, champPair.away, true, liveByTeam);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">FCS</div>
        <h1 className="title matchup-title">FCS PLAYOFF BRACKET</h1>
        <p className="subtitle team-subtitle">
          Top 24 FCS teams seeded purely by Power Rating (conference
          auto-bids and resume-based at-large selection aren't modeled for
          FCS yet). Top 8 seeds get a bye; the better seed hosts every round
          except a neutral-site championship. Projected champion:{" "}
          <strong style={{ color: "var(--gold)" }}>{champion.team.team}</strong>.
        </p>
      </div>

      <div className="bracket-body">
        <div className="bracket-columns">
          <div className="bracket-col">
            <div className="section-label bracket-round-label">First Round</div>
            <div className="bracket-col-games">
              {r1Pairs.map((p) => (
                <BracketGame
                  key={p.host.seed}
                  seedA={p.host.seed}
                  teamA={p.host.team}
                  seedB={p.away.seed}
                  teamB={p.away.team}
                  liveByTeam={liveByTeam}
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Second Round</div>
            <div className="bracket-col-games">
              {r2Pairs.map((p) => (
                <BracketGame
                  key={p.host.seed}
                  seedA={p.host.seed}
                  teamA={p.host.team}
                  seedB={p.away.seed}
                  teamB={p.away.team}
                  liveByTeam={liveByTeam}
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Quarterfinals</div>
            <div className="bracket-col-games">
              {qfPairs.map((p) => (
                <BracketGame
                  key={p.host.seed}
                  seedA={p.host.seed}
                  teamA={p.host.team}
                  seedB={p.away.seed}
                  teamB={p.away.team}
                  liveByTeam={liveByTeam}
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Semifinals</div>
            <div className="bracket-col-games">
              {sfPairs.map((p) => (
                <BracketGame
                  key={p.host.seed}
                  seedA={p.host.seed}
                  teamA={p.host.team}
                  seedB={p.away.seed}
                  teamB={p.away.team}
                  liveByTeam={liveByTeam}
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </div>
          </div>

          <div className="bracket-col">
            <div className="section-label bracket-round-label">Championship</div>
            <div className="bracket-col-games">
              <BracketGame
                seedA={champPair.host.seed}
                teamA={champPair.host.team}
                seedB={champPair.away.seed}
                teamB={champPair.away.team}
                neutral
                liveByTeam={liveByTeam}
                onNavigateTeam={onNavigateTeam}
              />
            </div>
          </div>
        </div>

        <div className="section-label bracket-round-label">The Field</div>
        <div className="table-wrap bracket-natty-wrap playoff24-field-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="th">Seed</th>
                  <th className="th">Team</th>
                  <th className="th">Conference</th>
                  <th className="th">Bid</th>
                  <th className="th th-right">Power Rating</th>
                </tr>
              </thead>
              <tbody>
                {field.map((f) => (
                  <tr key={f.team.team}>
                    <td>
                      <span
                        className={`rank-flag ${f.seed <= 8 ? "top4" : f.seed <= 16 ? "top12" : ""}`}
                      >
                        {f.seed}
                      </span>
                    </td>
                    <td>
                      <button
                        className="team-link"
                        onClick={() => onNavigateTeam(f.team)}
                      >
                        <TeamLogo team={f.team} />
                        {f.team.team}
                      </button>
                    </td>
                    <td className="conf-cell">
                      <ConfLink conf={f.team.conf} onNavigateConference={onNavigateConference} />
                    </td>
                    <td className="futures-bet-cell">{f.bid}</td>
                    <td className={`rating-cell ${f.team.rating < 0 ? "rating-good" : "rating-bad"}`}>
                      {f.team.rating > 0 ? "+" : ""}
                      {f.team.rating.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="footer-note" data-export-exclude="true">
        Seeding is by Power Rating alone for now — conference auto-bids and
        resume-based at-large selection will be added once FCS resume
        ratings and conference futures data are wired up. First round
        pairings avoid same-conference matchups where possible; every later
        round reseeds the remaining field, pairing the best seed against the
        worst, with the better seed hosting until a neutral-site
        championship.
      </div>
    </div>
  );
}
