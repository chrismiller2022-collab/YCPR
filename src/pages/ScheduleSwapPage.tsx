import { useState } from "react";
import TeamLogo from "../components/TeamLogo";
import TeamPicker from "../components/TeamPicker";
import { TEAMS } from "../data/teams";
import { spreadColor } from "../lib/odds";
import { computeSwapSchedule } from "../lib/schedule";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function SwapScheduleRow({ item, ratingTeam, onNavigateTeam }: any) {
  const { game, opp, isHome, spread, winPct } = item;
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
      <td className="matchups-projected-cell" style={{ color: spreadColor(spread) }}>
        {spread > 0 ? "+" : ""}
        {spread.toFixed(1)}
      </td>
      <td className="matchups-winpct-cell" style={{ color: spreadColor(spread) }}>
        {(winPct * 100).toFixed(1)}%
      </td>
      <td className="schedule-result-cell" style={{ color: spreadColor(spread) }}>
        {result}
      </td>
    </tr>
  );
}


function SwapScheduleTable({ title, ratingTeam, opponentLabel, data, onNavigateTeam }: any) {
  const wins = data.winSum;
  const losses = data.gamesCount - wins;

  return (
    <div className="swap-table-col">
      <div className="swap-table-header">
        <div className="section-label swap-table-title">{title}</div>
        <div className="swap-table-record">
          {wins.toFixed(2)}-{losses.toFixed(2)}
        </div>
      </div>
      {data.rows.length === 0 ? (
        <div className="empty matchups-empty">No games scheduled.</div>
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
              {data.rows.map((item) => (
                <SwapScheduleRow
                  key={item.game.id}
                  item={item}
                  ratingTeam={ratingTeam}
                  onNavigateTeam={onNavigateTeam}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


export default function ScheduleSwapPage({ onNavigateTeam, onHome }: any) {
  const [divA, setDivA] = useState("All");
  const [confA, setConfA] = useState("All");
  const [teamAName, setTeamAName] = useState("");

  const [divB, setDivB] = useState("All");
  const [confB, setConfB] = useState("All");
  const [teamBName, setTeamBName] = useState("");

  const teamA = TEAMS.find((t) => t.team === teamAName) || null;
  const teamB = TEAMS.find((t) => t.team === teamBName) || null;
  const bothSelected = teamA && teamB;
  const sameTeam = bothSelected && teamA.team === teamB.team;

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const teamAOwn = bothSelected ? computeSwapSchedule(teamA.team, teamA, liveByTeam) : null;
  const teamBOwn = bothSelected ? computeSwapSchedule(teamB.team, teamB, liveByTeam) : null;
  const teamAOnB = bothSelected ? computeSwapSchedule(teamB.team, teamA, liveByTeam) : null;
  const teamBOnA = bothSelected ? computeSwapSchedule(teamA.team, teamB, liveByTeam) : null;

  return (
    <div className="matchup-page schedule-swap-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Simulator</div>
        <h1 className="title matchup-title">SCHEDULE SWAP</h1>
        <p className="subtitle team-subtitle">
          Compare two teams' projected records on their own schedule, then see
          how those records would change if they swapped schedules entirely.
        </p>
      </div>

      <div className="matchup-body">
        <div className="picker-grid">
          <TeamPicker
            label="Team A"
            division={divA}
            conference={confA}
            teamName={teamAName}
            onDivision={(v) => {
              setDivA(v);
              setConfA("All");
              setTeamAName("");
            }}
            onConference={(v) => {
              setConfA(v);
              setTeamAName("");
            }}
            onTeam={setTeamAName}
          />

          <div className="vs-divider">VS</div>

          <TeamPicker
            label="Team B"
            division={divB}
            conference={confB}
            teamName={teamBName}
            onDivision={(v) => {
              setDivB(v);
              setConfB("All");
              setTeamBName("");
            }}
            onConference={(v) => {
              setConfB(v);
              setTeamBName("");
            }}
            onTeam={setTeamBName}
          />
        </div>

        {sameTeam && (
          <div className="matchup-note">Pick two different teams to compare.</div>
        )}

        {bothSelected && !sameTeam && (
          <>
            <div className="swap-summary swap-summary-first">
              <div className="swap-summary-card">
                <div className="swap-summary-label">{teamA.team}</div>
                <div className="swap-summary-sub">Current schedule</div>
                <div className="swap-summary-record">
                  {teamAOwn.winSum.toFixed(2)}-
                  {(teamAOwn.gamesCount - teamAOwn.winSum).toFixed(2)}
                </div>
              </div>
              <div className="swap-summary-card">
                <div className="swap-summary-label">{teamB.team}</div>
                <div className="swap-summary-sub">Current schedule</div>
                <div className="swap-summary-record">
                  {teamBOwn.winSum.toFixed(2)}-
                  {(teamBOwn.gamesCount - teamBOwn.winSum).toFixed(2)}
                </div>
              </div>
              <div className="swap-summary-card swap-summary-swapped">
                <div className="swap-summary-label">{teamA.team}</div>
                <div className="swap-summary-sub">On {teamB.team}'s schedule</div>
                <div className="swap-summary-record">
                  {teamAOnB.winSum.toFixed(2)}-
                  {(teamAOnB.gamesCount - teamAOnB.winSum).toFixed(2)}
                </div>
              </div>
              <div className="swap-summary-card swap-summary-swapped">
                <div className="swap-summary-label">{teamB.team}</div>
                <div className="swap-summary-sub">On {teamA.team}'s schedule</div>
                <div className="swap-summary-record">
                  {teamBOnA.winSum.toFixed(2)}-
                  {(teamBOnA.gamesCount - teamBOnA.winSum).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="section-label swap-section-label">
              Swapped schedules
            </div>
            <div className="swap-table-row">
              <SwapScheduleTable
                title={`${teamA.team} — on ${teamB.team}'s schedule`}
                ratingTeam={teamA}
                data={teamAOnB}
                onNavigateTeam={onNavigateTeam}
              />
              <SwapScheduleTable
                title={`${teamB.team} — on ${teamA.team}'s schedule`}
                ratingTeam={teamB}
                data={teamBOnA}
                onNavigateTeam={onNavigateTeam}
              />
            </div>

            <div className="section-label swap-section-label">
              Current schedules
            </div>
            <div className="swap-table-row">
              <SwapScheduleTable
                title={`${teamA.team} — actual schedule`}
                ratingTeam={teamA}
                data={teamAOwn}
                onNavigateTeam={onNavigateTeam}
              />
              <SwapScheduleTable
                title={`${teamB.team} — actual schedule`}
                ratingTeam={teamB}
                data={teamBOwn}
                onNavigateTeam={onNavigateTeam}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
