import { useEffect, useMemo, useRef, useState } from "react";
import ExportPngButton from "../components/ExportPngButton";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { TEAMS } from "../data/teams";
import { fmtNum, fmtOdds, fmtPct } from "../lib/format";
import { TEAM_WIN_TOTALS } from "../lib/ranks";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchTeamSos, type TeamSosRow } from "../lib/api/ratingSystems";
import { fetchMonteCarloRuns, fetchMonteCarloRun } from "../lib/api/monteCarlo";
import type { TeamSimResult } from "../lib/montecarlo/engine";
import ConferenceStandingsOddsTable from "../components/ConferenceStandingsOddsTable";

function DiffCell({ value }: any) {
  if (value == null) return <td className="wintotals-total-cell">–</td>;
  return (
    <td
      className="wintotals-total-cell"
      style={{ color: value > 0 ? "var(--pos-green)" : value < 0 ? "var(--neg-red)" : undefined }}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
    </td>
  );
}

function ConferencePreviewRow({ team, live, sos, maxPct, showVegasWinLines, onNavigateTeam }: any) {
  const f = CONF_FUTURES_BY_TEAM[team.team];
  const rating = live?.rating ?? team.rating;
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
      <td className={`rating-cell ${rating < 0 ? "rating-good" : "rating-bad"}`}>
        {rating > 0 ? "+" : ""}
        {rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell">{winTotal.toFixed(2)}</td>
      <td className="wintotals-total-cell">{confWinTotal.toFixed(2)}</td>
      <td className="conf-odds-cell">
        <div className="conf-odds-bar-track">
          <div className="conf-odds-bar-fill" style={{ width: `${barWidth}%` }} />
        </div>
        <span className="conf-odds-pct">{fmtPct(confWinPct)}</span>
      </td>
      <td className="wintotals-total-cell">{fmtOdds(fairPrice)}</td>
      <td className="wintotals-total-cell">{fmtOdds(odds)}</td>
      <td className="wintotals-total-cell">{sos != null ? sos.toFixed(2) : "–"}</td>
      {showVegasWinLines && (
        <>
          <td className="wintotals-total-cell">{fmtNum(seasonWinLine)}</td>
          <DiffCell value={seasonWinDiff} />
          <td className="wintotals-total-cell">{fmtNum(confLine)}</td>
          <DiffCell value={confWinDiff} />
        </>
      )}
    </tr>
  );
}

export default function ConferencePreviewPage({ conference, onNavigateTeam, onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const season = new Date().getFullYear();
  const [sosByTeam, setSosByTeam] = useState<Record<string, TeamSosRow>>({});
  const [mcResults, setMcResults] = useState<TeamSimResult[] | null>(null);
  const [mcNumTrials, setMcNumTrials] = useState(0);

  useEffect(() => {
    fetchTeamSos(season)
      .then(setSosByTeam)
      .catch(() => setSosByTeam({}));
  }, [season]);

  // Always the most recently saved Monte Carlo run for the season — this
  // table refreshes itself the moment a new run gets saved from Admin,
  // nothing on this page needs to change to pick it up.
  useEffect(() => {
    setMcResults(null);
    fetchMonteCarloRuns(season)
      .then((runs) => (runs.length > 0 ? fetchMonteCarloRun(runs[0].id) : null))
      .then((run) => {
        if (run) {
          setMcResults(run.results);
          setMcNumTrials(run.num_trials);
        }
      })
      .catch(() => setMcResults(null));
  }, [season]);

  const rows = useMemo(() => {
    const list = TEAMS.filter((t) => t.conf === conference);
    return [...list].sort((a, b) => {
      const pa = liveByTeam[a.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[a.team]?.confWinPct;
      const pb = liveByTeam[b.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[b.team]?.confWinPct;
      if (pa == null && pb == null) {
        const ra = liveByTeam[a.team]?.rating ?? a.rating;
        const rb = liveByTeam[b.team]?.rating ?? b.rating;
        return ra - rb;
      }
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pb - pa;
    });
  }, [conference, liveByTeam]);

  const maxPct = rows.reduce((max, t) => {
    const pct = liveByTeam[t.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[t.team]?.confWinPct ?? 0;
    return Math.max(max, pct);
  }, 0);

  // FCS doesn't have Vegas season/conference win-total lines to compare
  // against yet, so those four columns are hidden rather than shown
  // permanently blank.
  const showVegasWinLines = rows[0]?.div !== "FCS";

  return (
    <div className="matchups-page conference-preview-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Conference Preview</div>
        <h1 className="title matchup-title">{conference.toUpperCase()}</h1>
        <p className="subtitle team-subtitle">
          Model odds to win the conference, projected win totals, our fair
          conference price{showVegasWinLines ? ", and the market's lines" : ""} for
          every {conference} team.
        </p>
      </div>

      <div className="export-toolbar" data-export-exclude="true">
        <ExportPngButton targetRef={exportRef} filename={`${conference.toLowerCase().replace(/\s+/g, "-")}-preview`} />
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
                  <th className="th th-right">Conf. Wins</th>
                  <th className="th">Conference Odds</th>
                  <th className="th th-right">Fair Conference Odds</th>
                  <th className="th th-right">Vegas Conference Odds</th>
                  <th className="th th-right">In-Conference SOS</th>
                  {showVegasWinLines && (
                    <>
                      <th className="th th-right">Vegas Total Wins</th>
                      <th className="th th-right">Total Win Diff</th>
                      <th className="th th-right">Vegas Conf. Wins</th>
                      <th className="th th-right">Conf. Win Diff</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <ConferencePreviewRow
                    key={t.team}
                    team={t}
                    live={liveByTeam[t.team]}
                    sos={sosByTeam[t.team]?.sos_srs_conference ?? null}
                    maxPct={maxPct}
                    showVegasWinLines={showVegasWinLines}
                    onNavigateTeam={onNavigateTeam}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mcResults && (
        <div className="table-wrap" style={{ marginTop: "1.5rem" }}>
          <div className="section-label">Monte Carlo Conference Standings Odds</div>
          <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
            Chance each {conference} team finishes with at least N conference wins, based on{" "}
            {mcNumTrials > 0 ? mcNumTrials.toLocaleString() : "100,000"} simulations using our power ratings.
          </p>
          <ConferenceStandingsOddsTable results={mcResults} numTrials={mcNumTrials} conference={conference} />
        </div>
      )}

      <div className="footer-note" data-export-exclude="true">
        Conference Odds bar reflects our model's probability to win the
        conference. Vegas Conference Odds is the market's current price.
        Fair Conference Odds is our model's own fair American-odds price to
        win the conference. In-Conference SOS is from the admin Strength of
        Schedule page's SRS engine, run only on conference games (not simply
        an average of conference opponents' ratings) — it updates whenever
        that page is re-run and saved.
        {showVegasWinLines &&
          " Diff columns are ours minus the market's line — positive means we're projecting more wins than the market."}
      </div>
    </div>
  );
}
