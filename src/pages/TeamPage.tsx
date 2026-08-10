import { useEffect, useMemo, useState } from "react";
import RadarChart from "../components/RadarChart";
import TeamLogo from "../components/TeamLogo";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { gamesForTeam } from "../data/games";
import { TEAMS_BY_NAME, teamsForConference } from "../data/teams";
import { fmtPct } from "../lib/format";
import { hfaFor, spreadColor, spreadToWinPct } from "../lib/odds";
import { computeRadarMetrics } from "../lib/percentiles";
import { TEAM_WIN_TOTALS } from "../lib/ranks";
import { computeGraphicCardStats, computeNextOpponent } from "../lib/schedule";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeBestWorst, type BestWorstCandidate } from "../lib/bestWorst";

function ScheduleRow({ game, team, liveByTeam, onNavigateTeam }: any) {
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
    </tr>
  );
}


function computeValueTabStats(team: any, games: GameWithLines[], liveByTeam: Record<string, any>) {
  const ratingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;
  const teamRating = ratingFor(team.team, team.rating);

  let projW = 0;
  let projL = 0;
  let actW = 0;
  let actL = 0;
  let confProjW = 0;
  let confProjL = 0;
  let confActW = 0;
  let confActL = 0;

  const teamGames = games.filter((g) => g.home_team === team.team || g.away_team === team.team);

  for (const g of teamGames) {
    const isHome = g.home_team === team.team;
    const oppName = isHome ? g.away_team : g.home_team;
    const opp = TEAMS_BY_NAME[oppName];
    if (!opp) continue;

    const oppRating = ratingFor(oppName, opp.rating);
    const spread = isHome
      ? teamRating - oppRating - hfaFor(team.team, liveByTeam)
      : teamRating - oppRating + hfaFor(oppName, liveByTeam);
    const isConfGame = !!g.conference_game;

    if (spread < 0) {
      projW++;
      if (isConfGame) confProjW++;
    } else if (spread > 0) {
      projL++;
      if (isConfGame) confProjL++;
    }

    if (g.completed && g.home_points != null && g.away_points != null) {
      const teamScore = isHome ? g.home_points : g.away_points;
      const oppScore = isHome ? g.away_points : g.home_points;
      if (teamScore > oppScore) {
        actW++;
        if (isConfGame) confActW++;
      } else if (teamScore < oppScore) {
        actL++;
        if (isConfGame) confActL++;
      }
    }
  }

  const myConfOdds = liveByTeam[team.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[team.team]?.confWinPct ?? null;

  return { projW, projL, actW, actL, confProjW, confProjL, confActW, confActL, myConfOdds };
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

  const valueStats = cardView === "value" ? computeValueTabStats(team, games, liveByTeam) : null;
  const vegasWinTotal = TEAM_WIN_TOTALS[team.team]?.vegasTotal ?? null;

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
        <button
          className={`graphic-card-toggle-btn ${cardView === "value" ? "active" : ""}`}
          onClick={() => setCardView("value")}
        >
          Value
        </button>
      </div>

      {cardView !== "value" ? (
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
      ) : (
        <ValueTabGrid valueStats={valueStats} vegasWinTotal={vegasWinTotal} gamesLoaded={gamesLoaded} />
      )}
    </div>
  );
}

function ValueCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="graphic-card-cell">
      <div className="graphic-card-cell-label">{label}</div>
      <div className="graphic-card-cell-value">
        <span>{value}</span>
        {sub && <span className="graphic-card-cell-sub">{sub}</span>}
      </div>
    </div>
  );
}

function ValueTabGrid({ valueStats, vegasWinTotal, gamesLoaded }: any) {
  if (!gamesLoaded || !valueStats) {
    return <div className="graphic-card-grid" style={{ padding: "1.5rem", textAlign: "center", color: "var(--chalk-dim)" }}>Loading…</div>;
  }

  const {
    projW,
    projL,
    actW,
    actL,
    confProjW,
    confProjL,
    confActW,
    confActL,
    myConfOdds,
  } = valueStats;

  const fmtRecord = (w: number, l: number) => `${w}-${l}`;
  const fmtPctVal = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)}%` : "–");

  return (
    <div className="graphic-card-grid">
      <ValueCell label="Proj. Record" value={fmtRecord(projW, projL)} />
      <ValueCell label="Actual Record" value={fmtRecord(actW, actL)} />
      <ValueCell label="Vegas Win Total" value={vegasWinTotal != null ? vegasWinTotal.toFixed(1) : "– (not synced yet)"} />

      <ValueCell label="Proj. Conf. Record" value={fmtRecord(confProjW, confProjL)} />
      <ValueCell label="Actual Conf. Record" value={fmtRecord(confActW, confActL)} />
      <ValueCell label="Vegas Conf. Win Total" value="– (not synced yet)" />

      <ValueCell label="My Conf. Odds" value={fmtPctVal(myConfOdds)} />
      <ValueCell label="Vegas Conf. Odds" value="– (not synced yet)" />

      <ValueCell label="My Natty Odds" value="– (see Proj Title Odds on Basic tab)" />
      <ValueCell label="Vegas Natty Odds" value="– (not synced yet)" />
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

export default function TeamPage({ team, onNavigateTeam, onHome }: any) {
  const peers = teamsForConference(team.div, team.conf);
  const schedule = gamesForTeam(team.team);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const radarMetrics = computeRadarMetrics(team, liveByTeam);

  const maxConfPct = peers.reduce((max, p) => {
    const pct = liveByTeam[p.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[p.team]?.confWinPct ?? 0;
    return Math.max(max, pct);
  }, 0);

  return (
    <div className="team-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
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
                </tr>
              </thead>
              <tbody>
                {schedule.map((g) => (
                  <ScheduleRow
                    key={g.id}
                    game={g}
                    team={team}
                    liveByTeam={liveByTeam}
                    onNavigateTeam={onNavigateTeam}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
              const confWinTotal = live?.conf_proj_wins ?? TEAM_WIN_TOTALS[p.team]?.confTotal ?? 0;
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
