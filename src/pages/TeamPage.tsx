import { useEffect, useMemo, useRef, useState } from "react";
import RadarChart from "../components/RadarChart";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { gamesForTeam } from "../data/games";
import { TEAMS_BY_NAME, teamsForConference } from "../data/teams";
import { fmtPct } from "../lib/format";
import { hfaFor, spreadColor, spreadToWinPct } from "../lib/odds";
import { computeRadarMetrics } from "../lib/percentiles";
import { computeGraphicCardStats, computeNextOpponent } from "../lib/schedule";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { useLatestMonteCarloWinTotals } from "../lib/api/monteCarlo";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeBestWorst, type BestWorstCandidate } from "../lib/bestWorst";
import { computeHomeRoadSplits, type SplitRecord } from "../lib/homeRoadSplits";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { splitTeamTotal } from "../lib/gameTotals";
import ExportPngButton from "../components/ExportPngButton";
import { fetchMonteCarloRuns, fetchMonteCarloRun } from "../lib/api/monteCarlo";
import { winTotalBuckets, type WinTotalBucket } from "../lib/montecarlo/distribution";
import WinDistributionBarChart from "../components/WinDistributionBarChart";

function ScheduleRow({ game, team, liveByTeam, projRow, onNavigateTeam }: any) {
  const isHome = game.home === team.team;
  const oppName = isHome ? game.away : game.home;
  const opp = TEAMS_BY_NAME[oppName];
  if (!opp) return null;

  // Live-preferred, matching every other live number on the site — this
  // was previously using the static preseason rating directly for both
  // sides, silently going stale the moment a weekly upload landed.
  const teamRating = liveByTeam[team.team]?.rating ?? team.rating;
  const oppRating = liveByTeam[oppName]?.rating ?? opp.rating;

  // Spread from this team's perspective: negative = this team favored.
  const spread = isHome
    ? teamRating - oppRating - hfaFor(team.team, liveByTeam)
    : teamRating - oppRating + hfaFor(oppName, liveByTeam);
  const winPct = spreadToWinPct(spread);
  const result = spread < 0 ? "Win" : spread > 0 ? "Loss" : "Even";

  // Individual-team score projection — sourced from the same Game/Team
  // Totals engine the admin panel uses (Ridge total model + our power-
  // rating spread split into a home/away score), not recomputed here.
  const split =
    projRow?.projection?.projectedTotal != null
      ? splitTeamTotal(projRow.projection.projectedTotal, projRow.myHomeSpread)
      : null;
  const teamProjScore = split ? (isHome ? split.home : split.away) : null;
  const oppProjScore = split ? (isHome ? split.away : split.home) : null;

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
            oppRating < 0 ? "rating-good" : "rating-bad"
          }`}
        >
          {oppRating > 0 ? "+" : ""}
          {oppRating.toFixed(2)}
        </span>
      </td>
      <td
        className="matchups-projected-cell"
        style={{ color: spreadColor(spread) }}
      >
        {spread > 0 ? "+" : ""}
        {spread.toFixed(1)}
      </td>
      <td
        className="matchups-winpct-cell"
        style={{ color: spreadColor(spread) }}
      >
        {(winPct * 100).toFixed(1)}%
      </td>
      <td className="schedule-result-cell" style={{ color: spreadColor(spread) }}>
        {result}
      </td>
      <td className="wintotals-total-cell">
        {teamProjScore != null && oppProjScore != null
          ? `${teamProjScore.toFixed(1)}-${oppProjScore.toFixed(1)}`
          : "–"}
      </td>
    </tr>
  );
}


function TeamGraphicCard({ team, liveByTeam, onNavigateTeam }: any) {
  const next = computeNextOpponent(team, liveByTeam);
  const nextOpp = next?.opp ?? null;
  const nextLoc = next?.loc ?? null;
  const nextSpread = next?.spread ?? null;

  const [cardView, setCardView] = useState("basic");

  const [games, setGames] = useState<GameWithLines[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const season = new Date().getFullYear();

  // Fetched unconditionally now (not just for the Value tab) — Live
  // Wins/Losses, Live Win Proj, Live Conf Win Proj, and ATS on the Basic
  // tab all need real game results and lines too now.
  useEffect(() => {
    if (gamesLoaded) return;
    fetchGamesWithLines(season)
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setGamesLoaded(true));
  }, [season, gamesLoaded]);

  const { basic, betting } = computeGraphicCardStats(team, liveByTeam, games);
  const stats = cardView === "basic" ? basic : betting;

  return (
    <div className="graphic-card">
      <div className="graphic-card-top">
        <div className="graphic-card-team">
          <div className="graphic-card-team-name">{team.team}</div>
          <div className="graphic-card-conf">{team.conf}</div>
        </div>
        <div className="graphic-card-next">
          <div className="graphic-card-next-label">Next Opponent</div>
          {nextOpp ? (
            <>
              <button
                className="graphic-card-next-value"
                onClick={() => onNavigateTeam(nextOpp)}
              >
                <span className="graphic-card-next-loc">({nextLoc})</span>{" "}
                <span style={{ color: spreadColor(nextSpread) }}>
                  {nextSpread > 0 ? "+" : ""}
                  {nextSpread.toFixed(2)}
                </span>{" "}
                {nextOpp.team}
              </button>
              <div
                className="graphic-card-next-winpct"
                style={{ color: spreadColor(nextSpread) }}
              >
                {(spreadToWinPct(nextSpread) * 100).toFixed(1)}% to win
              </div>
            </>
          ) : (
            <span className="graphic-card-tbd">TBD</span>
          )}
        </div>
      </div>

      <div className="graphic-card-toggle">
        <button
          className={`graphic-card-toggle-btn ${cardView === "basic" ? "active" : ""}`}
          onClick={() => setCardView("basic")}
        >
          Basic
        </button>
        <button
          className={`graphic-card-toggle-btn ${cardView === "betting" ? "active" : ""}`}
          onClick={() => setCardView("betting")}
        >
          Betting
        </button>
      </div>

      <div className="graphic-card-grid">
        {stats.map((s) => (
          <div className="graphic-card-cell" key={s.label}>
            <div className="graphic-card-cell-label">{s.label}</div>
            {s.real ? (
              <div
                className="graphic-card-cell-value"
                style={{ background: s.bg }}
              >
                <span style={{ color: s.color }}>{s.value}</span>
                {s.sub && (
                  <span className="graphic-card-cell-sub">{s.sub}</span>
                )}
              </div>
            ) : (
              <div className="graphic-card-cell-value graphic-card-cell-empty">
                <span className="graphic-card-tbd">TBD</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


function BestWorstCell({
  candidate,
  isProj,
  emptyLabel,
  onNavigateTeam,
}: {
  candidate: BestWorstCandidate | null;
  isProj: boolean;
  emptyLabel: string;
  onNavigateTeam: any;
}) {
  if (!candidate) {
    return (
      <div style={{ padding: "0.9rem 1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 10 }}>
        <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
          {isProj ? "Projected" : "Actual"}
        </div>
        <div style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>{emptyLabel}</div>
      </div>
    );
  }

  const { opponent, oppCurrentRating, week, projSpread, teamScore, oppScore } = candidate;

  return (
    <div style={{ padding: "0.9rem 1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 10 }}>
      <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
        {isProj ? "Projected" : "Actual"} · Week {week}
      </div>
      <button className="team-link matchup-team-btn" onClick={() => onNavigateTeam(opponent)} style={{ fontSize: "0.95rem" }}>
        <TeamLogo team={opponent} />
        {opponent.team}
      </button>
      <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>
        Current rating: <span style={{ color: oppCurrentRating < 0 ? "var(--gold)" : "var(--chalk-dim)" }}>
          {oppCurrentRating > 0 ? "+" : ""}
          {oppCurrentRating.toFixed(2)}
        </span>
      </div>
      <div style={{ marginTop: "0.5rem", fontWeight: 700, color: isProj ? spreadColor(projSpread) : undefined }}>
        {isProj
          ? `${projSpread > 0 ? "+" : ""}${projSpread.toFixed(1)} proj.`
          : `${teamScore}-${oppScore}`}
      </div>
    </div>
  );
}

function BestWorstBlock({ team, onNavigateTeam }: { team: any; onNavigateTeam: any }) {
  const season = new Date().getFullYear();
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    setLoading(true);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, [season]);

  const results = useMemo(() => computeBestWorst(team, games, liveByTeam), [team, games, liveByTeam]);

  if (loading) return null;

  const rows = [
    { label: "Best Win", result: results.bestWin, emptyProj: "No projected wins", emptyActual: "No wins yet" },
    { label: "Best Loss", result: results.bestLoss, emptyProj: "No projected losses", emptyActual: "No losses yet" },
    { label: "Worst Loss", result: results.worstLoss, emptyProj: "No projected losses", emptyActual: "No losses yet" },
  ];

  return (
    <div className="table-wrap">
      <div className="section-label">{team.team} best/worst results</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--gold)", marginBottom: "0.5rem" }}>{r.label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <BestWorstCell candidate={r.result.proj} isProj emptyLabel={r.emptyProj} onNavigateTeam={onNavigateTeam} />
              <BestWorstCell candidate={r.result.actual} isProj={false} emptyLabel={r.emptyActual} onNavigateTeam={onNavigateTeam} />
            </div>
          </div>
        ))}
      </div>
      <div className="footer-note" style={{ marginTop: "0.75rem" }}>
        Opponent ratings shown are current (live, as of now) — not a snapshot from the week
        each game was played. Projected uses each game's model spread; Actual only considers
        completed games. A highly-rated opponent in the Worst Loss slot is actually a plus for
        a resume — it means even the worst loss of the season came against a quality team.
      </div>
    </div>
  );
}

function fmtRecord(wins: number, losses: number, pushes?: number): string {
  if (pushes) return `${wins}-${losses}-${pushes}`;
  return `${wins}-${losses}`;
}

function SplitCard({ label, r }: { label: string; r: SplitRecord }) {
  const gp = r.wins + r.losses;
  const atsGp = r.atsWins + r.atsLosses + r.atsPushes;
  const ouGp = r.overs + r.unders + r.ouPushes;
  return (
    <div style={{ padding: "0.9rem 1rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 10 }}>
      <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--chalk-dim)", marginBottom: "0.6rem" }}>
        {label}
      </div>
      {gp === 0 ? (
        <div style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>No completed games</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--chalk-dim)", fontSize: "0.8rem" }}>Record</span>
            <span style={{ fontWeight: 700 }}>{fmtRecord(r.wins, r.losses)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--chalk-dim)", fontSize: "0.8rem" }}>ATS Record</span>
            <span style={{ fontWeight: 700 }}>{atsGp > 0 ? fmtRecord(r.atsWins, r.atsLosses, r.atsPushes) : "–"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--chalk-dim)", fontSize: "0.8rem" }}>O/U Record</span>
            <span style={{ fontWeight: 700 }}>{ouGp > 0 ? fmtRecord(r.overs, r.unders, r.ouPushes) : "–"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function WinDistributionBlock({ team, season }: { team: any; season: number }) {
  const [buckets, setBuckets] = useState<WinTotalBucket[]>([]);
  const [numTrials, setNumTrials] = useState(0);
  const [loading, setLoading] = useState(true);
  const [meanWins, setMeanWins] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMonteCarloRuns(season).then(async (list) => {
      if (cancelled) return;
      const latest = list[0];
      if (!latest) {
        setLoading(false);
        return;
      }
      const run = await fetchMonteCarloRun(latest.id);
      if (cancelled || !run) {
        setLoading(false);
        return;
      }
      const result = run.results.find((r) => r.team === team.team);
      setBuckets(result ? winTotalBuckets(result) : []);
      setMeanWins(result ? result.meanWins : null);
      setNumTrials(run.num_trials);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [season, team.team]);

  if (loading) return null;
  if (buckets.length === 0) return null;

  const byWins = [...buckets].sort((a, b) => a.wins - b.wins);

  const ROW_HEIGHT = 30;

  return (
    <div className="table-wrap">
      <div className="section-label">{team.team} win-total distribution</div>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <table className="win-dist-table" style={{ flex: "0 0 auto", width: "auto", fontSize: "0.78rem" }}>
          <thead>
            <tr style={{ height: ROW_HEIGHT }}>
              <th className="th th-right" style={{ padding: "0 0.6rem" }}>
                Wins
              </th>
              <th className="th" style={{ padding: "0 0.6rem" }}>
                Record
              </th>
              <th className="th th-right" style={{ padding: "0 0.6rem" }}>
                Probability
              </th>
            </tr>
          </thead>
          <tbody>
            {byWins.map((b) => (
              <tr key={b.wins} style={{ height: ROW_HEIGHT }}>
                <td className="wintotals-total-cell" style={{ padding: "0 0.6rem" }}>
                  {b.wins}
                </td>
                <td style={{ padding: "0 0.6rem" }}>{`${b.wins}-${b.losses}`}</td>
                <td className="wintotals-total-cell" style={{ padding: "0 0.6rem" }}>
                  {b.pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ flex: "1 1 280px", minWidth: 240 }}>
          <WinDistributionBarChart buckets={byWins} rowHeight={ROW_HEIGHT} headerHeight={ROW_HEIGHT} />
        </div>
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", margin: "0.75rem 0 0" }}>
        {meanWins != null && <>Mean projected record: {meanWins.toFixed(1)} wins. </>}
        Based on {numTrials > 0 ? numTrials.toLocaleString() : "100,000"} simulations using our power
        ratings.
      </p>
    </div>
  );
}

function HomeRoadSplitsBlock({ team }: { team: any }) {
  const season = new Date().getFullYear();
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, [season]);

  const splits = useMemo(() => computeHomeRoadSplits(team.team, games), [team, games]);

  if (loading) return null;

  return (
    <div className="table-wrap">
      <div className="section-label">{team.team} home/road splits</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <SplitCard label="Home" r={splits.home} />
        <SplitCard label="Away" r={splits.away} />
      </div>
      <div className="footer-note" style={{ marginTop: "0.75rem" }}>
        Completed games only. Neutral-site games are excluded from both splits.
      </div>
    </div>
  );
}

export default function TeamPage({ team, onNavigateTeam, onHome }: any) {
  const peers = teamsForConference(team.div, team.conf);
  const schedule = gamesForTeam(team.team);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const season = new Date().getFullYear();
  // Same "most recently saved Monte Carlo run" data Win Totals itself
  // uses now — was a static formula off each team's hardcoded preseason
  // rating, treating already-decided games as uncertain coin flips.
  const { byTeam: winTotalsByTeam } = useLatestMonteCarloWinTotals(season);
  const radarMetrics = computeRadarMetrics(team, liveByTeam);
  const { rows: totalsRows } = useGameTotalsEngine(season);
  const exportRef = useRef<HTMLDivElement>(null);

  // Schedule table only: each game gets its OWN week's ratings snapshot
  // (not "latest") so a played/projected Week 3 game doesn't silently
  // reflect Week 8's ratings once Week 8 is uploaded. The graphic card,
  // radar profile, and conference standings above intentionally keep
  // using "latest" — those represent the team's current standing right
  // now, not a specific game's own-week projection.
  const scheduleWeekNumbers = useMemo(() => schedule.map((g) => g.week), [schedule]);
  const { byWeek: scheduleRatingsByWeek } = useWeekAccurateRatings(season, scheduleWeekNumbers, season);

  // Game/Team Totals engine keys games by CFBD id (different id space
  // than the static schedule bundle's own ids), so match on week + both
  // team names instead — reliable since both sources describe the same
  // real-world schedule.
  const totalsRowByGame = useMemo(() => {
    const map = new Map<string, (typeof totalsRows)[number]>();
    for (const row of totalsRows) {
      map.set(`${row.game.week}|${row.game.homeTeam}|${row.game.awayTeam}`, row);
    }
    return map;
  }, [totalsRows]);

  const maxConfPct = peers.reduce((max, p) => {
    const pct = liveByTeam[p.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[p.team]?.confWinPct ?? 0;
    return Math.max(max, pct);
  }, 0);

  return (
    <div className="team-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">
          {team.div} · {team.conf}
        </div>
        <div className="team-title-row">
          <TeamLogo team={team} size="3.2rem" />
          <h1 className="title team-title">{team.team}</h1>
        </div>
      </div>

      <div className="export-toolbar" data-export-exclude="true">
        <ExportPngButton targetRef={exportRef} filename={() => `${team.team.toLowerCase().replace(/\s+/g, "-")}-team-page`} showTweet={false} />
      </div>

      <div className="table-wrap">
        <TeamGraphicCard team={team} liveByTeam={liveByTeam} onNavigateTeam={onNavigateTeam} />
      </div>

      <div className="table-wrap">
        <div className="section-label">{team.team} percentile profile ({team.div})</div>
        <div className="radar-card">
          <RadarChart series={[{ metrics: radarMetrics, color: "var(--gold)" }]} />
          <div className="radar-legend">
            {radarMetrics.map((m) => (
              <div className="radar-legend-row" key={m.key}>
                <span className="radar-legend-label">{m.label}</span>
                <span className="radar-legend-value">
                  {m.percentile != null ? `${Math.round(m.percentile)}th pct` : "–"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="footer-note" style={{ marginTop: "0.75rem" }}>
          Percentiles are relative to {team.div} only, and inverted from raw
          rank — the #1 team in a metric shows near the 100th percentile.
        </div>
      </div>

      <div className="table-wrap">
        <div className="section-label">{team.team} schedule</div>
        {schedule.length === 0 ? (
          <div className="empty matchups-empty">
            No games scheduled yet for {team.team}.
          </div>
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
                  <th className="th th-right">Proj. Score</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((g) => (
                  <ScheduleRow
                    key={g.id}
                    game={g}
                    team={team}
                    liveByTeam={scheduleRatingsByWeek[g.week] ?? {}}
                    projRow={totalsRowByGame.get(`${g.week}|${g.home}|${g.away}`) ?? null}
                    onNavigateTeam={onNavigateTeam}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WinDistributionBlock team={team} season={season} />

      <HomeRoadSplitsBlock team={team} />

      <BestWorstBlock team={team} onNavigateTeam={onNavigateTeam} />

      <div className="table-wrap">
        <div className="section-label">{team.conf} standings</div>
        <table>
          <thead>
            <tr>
              <th className="th">Team</th>
              <th className="th th-right">Power Rating</th>
              <th className="th">Conference Odds</th>
              <th className="th th-right">Conf. Win Proj.</th>
              <th className="th th-right">Record</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => {
              const live = liveByTeam[p.team];
              const f = CONF_FUTURES_BY_TEAM[p.team];
              const confWinPct = live?.conf_win_pct ?? f?.confWinPct ?? 0;
              const confWinTotal = winTotalsByTeam[p.team]?.meanConfWins ?? live?.conf_proj_wins ?? 0;
              const liveWins = live?.live_wins ?? 0;
              const liveLosses = live?.live_losses ?? 0;
              const barWidth = maxConfPct > 0 ? Math.max((confWinPct / maxConfPct) * 100, confWinPct > 0 ? 2 : 0) : 0;
              return (
                <tr
                  key={p.team}
                  className={p.team === team.team ? "row-active" : ""}
                >
                  <td>
                    {p.team === team.team ? (
                      <span className="team-name">
                        <TeamLogo team={p} />
                        {p.team}
                      </span>
                    ) : (
                      <button
                        className="team-link"
                        onClick={() => onNavigateTeam(p)}
                      >
                        <TeamLogo team={p} />
                        {p.team}
                      </button>
                    )}
                  </td>
                  <td
                    className={`rating-cell ${
                      p.rating < 0 ? "rating-good" : "rating-bad"
                    }`}
                  >
                    {p.rating > 0 ? "+" : ""}
                    {p.rating.toFixed(2)}
                  </td>
                  <td className="conf-odds-cell">
                    <div className="conf-odds-bar-track">
                      <div className="conf-odds-bar-fill" style={{ width: `${barWidth}%` }} />
                    </div>
                    <span className="conf-odds-pct">{fmtPct(confWinPct)}</span>
                  </td>
                  <td className="wintotals-total-cell">{confWinTotal.toFixed(2)}</td>
                  <td className="wintotals-total-cell">{liveWins}-{liveLosses}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
