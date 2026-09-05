import { useEffect, useMemo, useRef, useState } from "react";
import TeamPicker from "../components/TeamPicker";
import TeamLogo from "../components/TeamLogo";
import ExportPngButton from "../components/ExportPngButton";
import { TEAMS } from "../data/teams";
import { hfaFor, spreadColor, spreadToWinPct } from "../lib/odds";
import { buildRankMap } from "../lib/ranks";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchTeamSeasonInputs } from "../lib/api/gameTotalsData";
import { computeGameProjection, computeLeagueAverages, resolveGameOdds, splitTeamTotal, type TeamSeasonInputs } from "../lib/gameTotals";

export default function MatchupPage({ onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
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

  // Same Ridge total model / team-total split used by Matchups and the
  // Totals admin pages — fetched once here (not per-team), since
  // computeLeagueAverages needs the whole season's inputs to establish a
  // baseline, not just the two teams picked. No market total exists for
  // a hypothetical game, so odds is always the empty resolveGameOdds(null,
  // null) — predictGameTotalRidge falls back to its training-set mean for
  // that one input, same as it does for any real game with no line posted
  // yet.
  const currentSeason = new Date().getFullYear();
  const [teamInputsMap, setTeamInputsMap] = useState<Record<string, TeamSeasonInputs>>({});
  useEffect(() => {
    let cancelled = false;
    fetchTeamSeasonInputs(currentSeason)
      .then((map) => {
        if (!cancelled) setTeamInputsMap(map);
      })
      .catch(() => {
        // Best-effort — if this fails, the page still works as a
        // spread-only tool (its original scope), just without the Proj.
        // Total/Score row.
      });
    return () => {
      cancelled = true;
    };
  }, [currentSeason]);
  const league = useMemo(() => {
    const values = Object.values(teamInputsMap);
    return values.length > 0 ? computeLeagueAverages(values) : null;
  }, [teamInputsMap]);

  // National rank is always derived from resolved rating, never trusted
  // from a stored/pasted "rank" column — that column turned out to be
  // saved as a flat 1 for every team in every saved week (a spreadsheet/
  // upload-side bug), which silently broke every page reading live.rank.
  // Computing it here the same way HomePage/LiveWinTotalsPage do makes it
  // self-correcting regardless of what's sitting in weekly_team_stats.
  const nationalRankByTeam = useMemo(
    () => buildRankMap(TEAMS.map((t) => [t.team, liveByTeam[t.team]?.rating ?? t.rating]), false),
    [liveByTeam]
  );

  // Resolve both teams' rating/rank to their live weekly value (falling
  // back to the static preseason snapshot) once, here — every calculation
  // and display below reads from these resolved objects.
  const teamA = staticTeamA
    ? { ...staticTeamA, rating: liveByTeam[staticTeamA.team]?.rating ?? staticTeamA.rating, rank: nationalRankByTeam[staticTeamA.team] }
    : null;
  const teamB = staticTeamB
    ? { ...staticTeamB, rating: liveByTeam[staticTeamB.team]?.rating ?? staticTeamB.rating, rank: nationalRankByTeam[staticTeamB.team] }
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

  // Projected total (Ridge model) + each team's share of it, split by
  // the same spread already shown above — not a second, disagreeing
  // spread estimate. "Home" here just picks which side of splitTeamTotal's
  // home/away convention to use; for a neutral site it doesn't matter
  // which team fills that slot since computeGameProjection's homeFlag
  // (0.5) already accounts for there being no real home-field edge.
  const homeIsA = home !== "B";
  const homeInputs = bothSelected ? teamInputsMap[homeIsA ? teamA.team : teamB.team] : null;
  const awayInputs = bothSelected ? teamInputsMap[homeIsA ? teamB.team : teamA.team] : null;
  const projectedTotal =
    !sameTeam && league && homeInputs && awayInputs
      ? computeGameProjection(homeInputs, awayInputs, league, resolveGameOdds(null, null), {
          homeFlag: home === "neutral" ? 0.5 : 1.0,
          homeRestDays: 7,
          awayRestDays: 7,
        }).projectedTotal
      : null;
  const totalSplit = projectedTotal != null ? splitTeamTotal(projectedTotal, homeIsA ? spreadA : spreadB) : null;
  const scoreA = totalSplit ? (homeIsA ? totalSplit.home : totalSplit.away) : null;
  const scoreB = totalSplit ? (homeIsA ? totalSplit.away : totalSplit.home) : null;

  return (
    <div className="matchup-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Simulator</div>
        <h1 className="title matchup-title">HYPOTHETICAL MATCHUP</h1>
        <p className="subtitle team-subtitle">
          Pick any two teams to calculate a projected spread from their power
          ratings.
        </p>
        {bothSelected && !sameTeam && (
          <div style={{ marginTop: "0.75rem" }} data-export-exclude="true">
            <ExportPngButton
              targetRef={exportRef}
              filename={() => `matchup-${teamA.team}-vs-${teamB.team}`.toLowerCase().replace(/\s+/g, "-")}
              showTweet={false}
            />
          </div>
        )}
      </div>

      <div className="matchup-body">
        <div className="picker-grid" data-export-exclude="true">
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

        <div className="home-select" data-export-exclude="true">
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
                <div className="spread-team" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
                  <TeamLogo team={teamA.team} size={28} />
                  {teamA.team}
                </div>
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
                {scoreA != null && (
                  <div className="spread-winpct" style={{ marginTop: "0.3rem" }}>
                    Proj. score: <strong>{scoreA.toFixed(0)}</strong>
                  </div>
                )}
              </div>

              <div
                className={`spread-card ${
                  favored && favored.team === teamB.team ? "spread-favored" : ""
                }`}
              >
                <div className="spread-team" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
                  <TeamLogo team={teamB.team} size={28} />
                  {teamB.team}
                </div>
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
                {scoreB != null && (
                  <div className="spread-winpct" style={{ marginTop: "0.3rem" }}>
                    Proj. score: <strong>{scoreB.toFixed(0)}</strong>
                  </div>
                )}
              </div>
            </div>

            <p className="spread-sentence">
              {favored
                ? `${favored.team} is favored by ${margin.toFixed(1)} points (${siteLabel}).`
                : `Dead even matchup — a true pick'em (${siteLabel}).`}
            </p>
            {projectedTotal != null && scoreA != null && scoreB != null && (
              <p className="spread-sentence">
                Projected total: <strong>{projectedTotal.toFixed(1)}</strong> ({teamA.team} {scoreA.toFixed(0)} –{" "}
                {teamB.team} {scoreB.toFixed(0)}).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
