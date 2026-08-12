import { useState } from "react";
import TeamPicker from "../components/TeamPicker";
import { TEAMS } from "../data/teams";
import { hfaFor, spreadColor, spreadToWinPct } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";

export default function MatchupPage({ onHome }: any) {
  const [divA, setDivA] = useState("All");
  const [confA, setConfA] = useState("All");
  const [teamAName, setTeamAName] = useState("");

  const [divB, setDivB] = useState("All");
  const [confB, setConfB] = useState("All");
  const [teamBName, setTeamBName] = useState("");

  const [home, setHome] = useState("neutral");

  const staticTeamA = TEAMS.find((t) => t.team === teamAName) || null;
  const staticTeamB = TEAMS.find((t) => t.team === teamBName) || null;

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  // Resolve both teams' rating/rank to their live weekly value (falling
  // back to the static preseason snapshot) once, here — every calculation
  // and display below reads from these resolved objects.
  const teamA = staticTeamA
    ? { ...staticTeamA, rating: liveByTeam[staticTeamA.team]?.rating ?? staticTeamA.rating, rank: liveByTeam[staticTeamA.team]?.rank ?? staticTeamA.rank }
    : null;
  const teamB = staticTeamB
    ? { ...staticTeamB, rating: liveByTeam[staticTeamB.team]?.rating ?? staticTeamB.rating, rank: liveByTeam[staticTeamB.team]?.rank ?? staticTeamB.rank }
    : null;
  const bothSelected = teamA && teamB;
  const sameTeam = bothSelected && teamA.team === teamB.team;

  let spreadA = null;
  if (bothSelected && !sameTeam) {
    spreadA = teamA.rating - teamB.rating;
    if (home === "A") spreadA -= hfaFor(teamA.team, liveByTeam);
    if (home === "B") spreadA += hfaFor(teamB.team, liveByTeam);
  }
  const spreadB = spreadA === null ? null : -spreadA;

  const favored =
    spreadA === null ? null : spreadA < 0 ? teamA : spreadA > 0 ? teamB : null;
  const margin = spreadA === null ? null : Math.abs(spreadA);

  const siteLabel =
    home === "A" && teamA
      ? `at ${teamA.team}`
      : home === "B" && teamB
      ? `at ${teamB.team}`
      : "neutral site";

  return (
    <div className="matchup-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Simulator</div>
        <h1 className="title matchup-title">HYPOTHETICAL MATCHUP</h1>
        <p className="subtitle team-subtitle">
          Pick any two teams to calculate a projected spread from their power
          ratings.
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

        <div className="home-select">
          <div className="section-label home-select-label">Field</div>
          <div className="home-toggle">
            <button
              className={`home-btn ${home === "neutral" ? "home-btn-active" : ""}`}
              onClick={() => setHome("neutral")}
            >
              Neutral site
            </button>
            <button
              className={`home-btn ${home === "A" ? "home-btn-active" : ""}`}
              disabled={!teamA}
              onClick={() => setHome("A")}
            >
              {teamA ? `${teamA.team} home` : "Team A home"}
            </button>
            <button
              className={`home-btn ${home === "B" ? "home-btn-active" : ""}`}
              disabled={!teamB}
              onClick={() => setHome("B")}
            >
              {teamB ? `${teamB.team} home` : "Team B home"}
            </button>
          </div>
        </div>

        {sameTeam && (
          <div className="matchup-note">Pick two different teams to see a spread.</div>
        )}

        {bothSelected && !sameTeam && (
          <div className="spread-result">
            <div className="spread-cards">
              <div
                className={`spread-card ${
                  favored && favored.team === teamA.team ? "spread-favored" : ""
                }`}
              >
                <div className="spread-team">{teamA.team}</div>
                <div className="spread-context">
                  <span className="spread-context-rating">
                    {teamA.rating > 0 ? "+" : ""}
                    {teamA.rating.toFixed(2)} rating
                  </span>
                </div>
                <div className="spread-value" style={{ color: spreadColor(spreadA) }}>
                  {spreadA > 0 ? "+" : ""}
                  {spreadA.toFixed(1)}
                </div>
                <div className="spread-tag">
                  {spreadA < 0 ? "Favored" : spreadA > 0 ? "Underdog" : "Pick'em"}
                </div>
                <div className="spread-winpct" style={{ color: spreadColor(spreadA) }}>
                  {(spreadToWinPct(spreadA) * 100).toFixed(1)}% to win
                </div>
              </div>

              <div
                className={`spread-card ${
                  favored && favored.team === teamB.team ? "spread-favored" : ""
                }`}
              >
                <div className="spread-team">{teamB.team}</div>
                <div className="spread-context">
                  <span className="spread-context-rating">
                    {teamB.rating > 0 ? "+" : ""}
                    {teamB.rating.toFixed(2)} rating
                  </span>
                </div>
                <div className="spread-value" style={{ color: spreadColor(spreadB) }}>
                  {spreadB > 0 ? "+" : ""}
                  {spreadB.toFixed(1)}
                </div>
                <div className="spread-tag">
                  {spreadB < 0 ? "Favored" : spreadB > 0 ? "Underdog" : "Pick'em"}
                </div>
                <div className="spread-winpct" style={{ color: spreadColor(spreadB) }}>
                  {(spreadToWinPct(spreadB) * 100).toFixed(1)}% to win
                </div>
              </div>
            </div>

            <p className="spread-sentence">
              {favored
                ? `${favored.team} is favored by ${margin.toFixed(1)} points (${siteLabel}).`
                : `Dead even matchup — a true pick'em (${siteLabel}).`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
