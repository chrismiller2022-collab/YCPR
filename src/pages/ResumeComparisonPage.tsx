import { useRef, useState } from "react";
import RadarChart from "../components/RadarChart";
import TeamLogo from "../components/TeamLogo";
import TeamPicker from "../components/TeamPicker";
import ExportPngButton from "../components/ExportPngButton";
import { TEAMS_BY_NAME } from "../data/teams";
import { spreadColor } from "../lib/odds";
import { computeRadarMetrics } from "../lib/percentiles";
import { computeNextOpponent, computeGraphicCardStats } from "../lib/schedule";
import { useWeeklyStats } from "../lib/api/weeklyStats";

const COMPARISON_ROW_LABELS = [
  "Power Rating + Rank",
  "Overall Record",
  "Projected Record",
  "Conference Record",
  "Proj Conference Record + Rank",
  "Proj Title Odds + Rank",
  "Proj Conf Odds + Rank",
  "SOR + Rank",
  "ATS Record + Rank",
  "Over/Under Record",
  "Vegas Title Odds + Rank",
  "Vegas Conf Odds + Rank",
  "Vegas Win Total",
];


function ComparisonCell({ stat }: any) {
  if (!stat || !stat.real) {
    return <span className="compare-tbd">TBD</span>;
  }
  return (
    <span className="compare-value-wrap">
      <span style={{ color: stat.color }}>{stat.value}</span>
      {stat.sub && <span className="compare-value-sub">{stat.sub}</span>}
    </span>
  );
}


export default function ResumeComparisonPage({ onNavigateTeam, onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(() =>
    Array.from({ length: 6 }, () => ({ div: "All", conf: "All", team: "" }))
  );

  const updateSlot = (i, patch) => {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const selectedTeams = slots
    .map((s) => TEAMS_BY_NAME[s.team])
    .filter(Boolean);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const teamStats = selectedTeams.map((t) => {
    const { basic, betting } = computeGraphicCardStats(t, liveByTeam);
    return {
      team: t,
      next: computeNextOpponent(t, liveByTeam),
      stats: [...basic, ...betting.slice(1)],
    };
  });

  return (
    <div className="matchup-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">RESUME COMPARISON</h1>
        <p className="subtitle team-subtitle">
          Pick up to 6 teams to compare every stat from their team page's
          graphic card, side by side.
        </p>
        {selectedTeams.length > 0 && (
          <div style={{ marginTop: "0.75rem" }} data-export-exclude="true">
            <ExportPngButton targetRef={exportRef} filename="resume-comparison" showTweet={false} />
          </div>
        )}
      </div>

      <div className="matchup-body compare-body">
        <div className="compare-picker-grid" data-export-exclude="true">
          {slots.map((s, i) => (
            <TeamPicker
              key={i}
              label={`Team ${i + 1}`}
              division={s.div}
              conference={s.conf}
              teamName={s.team}
              onDivision={(v) => updateSlot(i, { div: v, conf: "All", team: "" })}
              onConference={(v) => updateSlot(i, { conf: v, team: "" })}
              onTeam={(v) => updateSlot(i, { team: v })}
            />
          ))}
        </div>

        {selectedTeams.length === 0 ? (
          <div className="matchup-note">Pick at least one team to start comparing.</div>
        ) : (
          <>
            {selectedTeams.length >= 2 && (
              <div className="table-wrap">
                <div className="section-label">
                  Percentile Profile — {selectedTeams[0].team} vs {selectedTeams[1].team}
                </div>
                <div className="radar-card">
                  <RadarChart
                    series={[
                      {
                        metrics: computeRadarMetrics(selectedTeams[0], liveByTeam),
                        color: "var(--gold)",
                      },
                      {
                        metrics: computeRadarMetrics(selectedTeams[1], liveByTeam),
                        color: "#6fb1e0",
                      },
                    ]}
                  />
                  <div className="radar-legend">
                    <div className="radar-legend-row">
                      <span className="radar-legend-label">
                        <span className="radar-legend-swatch" style={{ background: "var(--gold)" }} />
                        {selectedTeams[0].team}
                      </span>
                    </div>
                    <div className="radar-legend-row">
                      <span className="radar-legend-label">
                        <span className="radar-legend-swatch" style={{ background: "#6fb1e0" }} />
                        {selectedTeams[1].team}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="footer-note" style={{ marginTop: "0.75rem" }}>
                  Percentiles are relative to each team's own division, and
                  compare only the first two teams selected above.
                </div>
              </div>
            )}
            <div className="table-wrap compare-table-wrap">
            <div className="table-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th className="th">Stat</th>
                    {teamStats.map(({ team }) => (
                      <th className="th" key={team.team}>
                        <button
                          className="team-link"
                          onClick={() => onNavigateTeam(team)}
                        >
                          <TeamLogo team={team} />
                          {team.team}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="compare-row-label">Next Opponent</td>
                    {teamStats.map(({ team, next }) => (
                      <td key={team.team}>
                        {next ? (
                          <span className="compare-value-wrap">
                            <span className="compare-value-sub">
                              ({next.loc})
                            </span>{" "}
                            <span style={{ color: spreadColor(next.spread) }}>
                              {next.spread > 0 ? "+" : ""}
                              {next.spread.toFixed(2)}
                            </span>{" "}
                            <button
                              className="team-link"
                              onClick={() => onNavigateTeam(next.opp)}
                            >
                              <TeamLogo team={next.opp} />
                              {next.opp.team}
                            </button>
                          </span>
                        ) : (
                          <span className="compare-tbd">TBD</span>
                        )}
                      </td>
                    ))}
                  </tr>
                  {COMPARISON_ROW_LABELS.map((label) => (
                    <tr key={label}>
                      <td className="compare-row-label">{label}</td>
                      {teamStats.map(({ team, stats }) => (
                        <td key={team.team}>
                          <ComparisonCell
                            stat={stats.find((s) => s.label === label)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
