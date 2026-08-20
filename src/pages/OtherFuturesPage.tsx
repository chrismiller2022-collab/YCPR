import { useEffect, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import TeamLogo from "../components/TeamLogo";
import { TEAMS } from "../data/teams";
import { fetchMonteCarloRuns, fetchMonteCarloRun, type MonteCarloRunSummary } from "../lib/api/monteCarlo";
import { undefeatedPct, winsAtLeastPct, type TeamSimResult } from "../lib/montecarlo/engine";
import { useRef } from "react";

function fmtPct(v: number | null | undefined) {
  return v == null ? "–" : `${v.toFixed(1)}%`;
}

function teamInfo(name: string) {
  return TEAMS.find((t) => t.team === name);
}

// ---------------------------------------------------------------------
// "Other Futures" — everything the main Win Totals page doesn't cover:
// bowl eligibility, playoff qualification, and the CFP bracket rounds.
// Sourced entirely from saved Monte Carlo runs, one per week (plus the
// most recent being "Live"), the same way Win Totals/Ratings/Resume/SOS
// already browse by week.
// ---------------------------------------------------------------------
export default function OtherFuturesPage({ subKey, subLabel, onNavigateTeam, onNavigateConference, onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [season] = useState(new Date().getFullYear());
  const [runs, setRuns] = useState<MonteCarloRunSummary[]>([]);
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [numTrials, setNumTrials] = useState(0);
  const [loading, setLoading] = useState(true);

  const isLive = subKey === "live";
  const weekNum = isLive ? null : parseInt(String(subKey).replace("week", ""), 10);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResults(null);
    fetchMonteCarloRuns(season).then(async (list) => {
      if (cancelled) return;
      setRuns(list);
      const target = isLive ? list[0] : list.find((r) => r.week === weekNum);
      if (target) {
        const run = await fetchMonteCarloRun(target.id);
        if (!cancelled && run) {
          setResults(run.results);
          setNumTrials(run.num_trials);
        }
      }
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [season, isLive, weekNum]);

  const rows = useMemo(() => {
    if (!results) return [];
    return [...results]
      .map((r) => ({
        r,
        bowlPct: winsAtLeastPct(r, numTrials, 6),
        undefeatedPct: undefeatedPct(r, numTrials),
      }))
      .sort((a, b) => b.r.nattyPct - a.r.nattyPct || b.r.playoffPct - a.r.playoffPct || b.bowlPct - a.bowlPct);
  }, [results, numTrials]);

  return (
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Futures</div>
        <h1 className="title matchup-title">OTHER FUTURES{isLive ? "" : ` — ${subLabel ?? ""}`}</h1>
        <p className="subtitle team-subtitle">
          Bowl eligibility, playoff qualification, and CFP bracket-round odds — from the Monte
          Carlo simulation saved for this week.
        </p>
      </div>

      <div className="export-toolbar" data-export-exclude="true">
        <ExportPngButton targetRef={exportRef} filename={`other-futures-${isLive ? "live" : subKey}`} />
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty matchups-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty matchups-empty">
            No Monte Carlo run saved for {isLive ? "the current week" : subLabel} yet — check back
            once it's been run and saved.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th">Conference</th>
                  <th className="th th-right">Bowl (6+ wins)</th>
                  <th className="th th-right">Make Playoff</th>
                  <th className="th th-right">Make Quarterfinals</th>
                  <th className="th th-right">Make Semifinals</th>
                  <th className="th th-right">Make NCG</th>
                  <th className="th th-right">Win NCG</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, bowlPct }) => {
                  const t = teamInfo(r.team);
                  return (
                    <tr key={r.team}>
                      <td>
                        <button className="team-link" onClick={() => t && onNavigateTeam(t)}>
                          {t && <TeamLogo team={t} />}
                          {r.team}
                        </button>
                      </td>
                      <td className="conf-cell">
                        <ConfLink conf={r.conf} onNavigateConference={onNavigateConference} />
                      </td>
                      <td className="wintotals-total-cell">{fmtPct(bowlPct)}</td>
                      <td className="wintotals-total-cell">{fmtPct(r.playoffPct)}</td>
                      <td className="wintotals-total-cell">{fmtPct(r.quarterfinalPct)}</td>
                      <td className="wintotals-total-cell">{fmtPct(r.semifinalPct)}</td>
                      <td className="wintotals-total-cell">{fmtPct(r.nattyGamePct)}</td>
                      <td className="wintotals-total-cell">{fmtPct(r.nattyPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note" data-export-exclude="true">
        Make Quarterfinals / Semifinals / NCG require a Monte Carlo run saved after bracket-round
        tracking was added — older saved weeks may show "–" for those columns. Live shows the
        most recently saved run.
      </div>
    </div>
  );
}
