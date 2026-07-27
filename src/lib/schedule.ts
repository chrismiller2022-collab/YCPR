import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { gamesForTeam } from "../data/games";
import { NATTY_BY_TEAM } from "../data/nattyOdds";
import { RESUME_BY_TEAM } from "../data/resume";
import { TEAMS_BY_NAME, teamsForConference } from "../data/teams";
import { fmtOdds } from "./format";
import { HFA, hfaFor, spreadBg, spreadColor, spreadToWinPct } from "./odds";
import { TEAM_WIN_TOTALS } from "./ranks";

export function computeSwapSchedule(scheduleTeamName, ratingTeam, liveByTeam) {
  const games = gamesForTeam(scheduleTeamName);
  let winSum = 0;
  const rows = [];
  games.forEach((g) => {
    const isHome = g.home === scheduleTeamName;
    const oppName = isHome ? g.away : g.home;
    const opp = TEAMS_BY_NAME[oppName];
    if (!opp) return;
    const spread = isHome
      ? ratingTeam.rating - opp.rating - hfaFor(scheduleTeamName, liveByTeam)
      : ratingTeam.rating - opp.rating + hfaFor(oppName, liveByTeam);
    const winPct = spreadToWinPct(spread);
    winSum += winPct;
    rows.push({ game: g, opp, isHome, spread, winPct });
  });
  return { rows, winSum, gamesCount: rows.length };
}


export function computeNextOpponent(team, liveByTeam) {
  const schedule = gamesForTeam(team.team);
  const nextGame = schedule[0] || null;
  if (!nextGame) return null;
  const isHome = nextGame.home === team.team;
  const oppName = isHome ? nextGame.away : nextGame.home;
  const opp = TEAMS_BY_NAME[oppName];
  if (!opp) return null;
  const spread = isHome
    ? team.rating - opp.rating - hfaFor(team.team, liveByTeam)
    : team.rating - opp.rating + hfaFor(oppName, liveByTeam);
  return { opp, loc: isHome ? "H" : "A", spread };
}

// Ranks a team within its conference by a given live/static metric,
// highest value first (used for conference win-odds style stats where
// bigger = better). Returns null if the team's own metric is missing.
function rankWithinConference(team, liveByTeam, metricFor) {
  const peers = teamsForConference(team.div, team.conf);
  const withMetric = peers
    .map((p) => ({ team: p.team, metric: metricFor(p) }))
    .filter((r) => r.metric != null);
  if (withMetric.length === 0) return null;
  withMetric.sort((a, b) => b.metric - a.metric);
  const idx = withMetric.findIndex((r) => r.team === team.team);
  return idx === -1 ? null : idx + 1;
}

export function computeGraphicCardStats(team, liveByTeam = {}) {
  const ratingColor = spreadColor(team.rating);
  const ratingBg = spreadBg(team.rating, 0.16);
  const goldBg = "rgba(255, 200, 87, 0.12)";

  const resumeData = RESUME_BY_TEAM[team.team];
  const futuresData = CONF_FUTURES_BY_TEAM[team.team];
  const live = liveByTeam[team.team];

  const winTotal = live?.total_wins ?? TEAM_WIN_TOTALS[team.team]?.total;
  const confWinTotal = live?.conf_proj_wins ?? TEAM_WIN_TOTALS[team.team]?.confTotal;

  const schedule = gamesForTeam(team.team);
  const totalGames = schedule.length;
  const confGames = schedule.filter((g) => {
    const oppName = g.home === team.team ? g.away : g.home;
    return TEAMS_BY_NAME[oppName]?.conf === team.conf;
  }).length;

  const projRecord =
    winTotal != null
      ? `${winTotal.toFixed(1)}-${Math.max(0, totalGames - winTotal).toFixed(1)}`
      : undefined;

  const confRecord =
    confWinTotal != null
      ? `${confWinTotal.toFixed(1)}-${Math.max(0, confGames - confWinTotal).toFixed(1)}`
      : undefined;

  // Who's projected to have the best conference win total in this conference.
  const confWinsRank = rankWithinConference(
    team,
    liveByTeam,
    (p) => liveByTeam[p.team]?.conf_proj_wins ?? TEAM_WIN_TOTALS[p.team]?.confTotal ?? null
  );
  // Best model odds to win the conference outright.
  const confPctRank = rankWithinConference(
    team,
    liveByTeam,
    (p) => liveByTeam[p.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[p.team]?.confWinPct ?? null
  );
  // Best market (Vegas) odds to win the conference outright.
  const vegasPctRank = rankWithinConference(
    team,
    liveByTeam,
    (p) => liveByTeam[p.team]?.implied_pct ?? CONF_FUTURES_BY_TEAM[p.team]?.impliedPct ?? null
  );

  const overallRecord =
    live?.live_wins != null && live?.live_losses != null
      ? `${live.live_wins}-${live.live_losses}`
      : undefined;

  const atsRecord =
    live?.ats_wins != null && live?.ats_losses != null
      ? `${live.ats_wins}-${live.ats_losses}`
      : undefined;

  const nattyOdds = live?.natty_odds ?? NATTY_BY_TEAM[team.team];
  const confPct = live?.conf_win_pct ?? futuresData?.confWinPct;
  const vegasPct = live?.implied_pct ?? futuresData?.impliedPct;
  const fairPrice = live?.fair_price ?? futuresData?.fairPrice;
  const vegasOdds = live?.odds ?? futuresData?.odds;

  return [
    {
      label: "Power Rating + Rank",
      real: true,
      value: `${team.rating > 0 ? "+" : ""}${team.rating.toFixed(2)}`,
      sub: `#${team.rank}`,
      color: ratingColor,
      bg: ratingBg,
    },
    {
      label: "Conference Record + Rank",
      real: confRecord != null,
      value: confRecord,
      sub: confWinsRank != null ? `#${confWinsRank} in conf` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "CFP Resume Rating + Rank",
      real: !!resumeData,
      value: resumeData ? resumeData.rating.toFixed(2) : undefined,
      sub: resumeData ? `#${resumeData.rank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Overall Record",
      real: overallRecord != null,
      value: overallRecord,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Projected Record",
      real: projRecord != null,
      value: projRecord,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "ATS Record + Rank",
      real: atsRecord != null,
      value: atsRecord,
      sub: live?.ats_rank != null ? `#${live.ats_rank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Title Odds + Rank",
      real: nattyOdds != null,
      value: nattyOdds != null ? `${(nattyOdds * 100).toFixed(1)}%` : undefined,
      sub: live?.natty_rank != null ? `#${live.natty_rank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Proj Conf Odds",
      real: confPct != null,
      value: confPct != null ? `${(confPct * 100).toFixed(1)}%` : undefined,
      sub:
        confPctRank != null
          ? `#${confPctRank} in conf · ${fmtOdds(fairPrice)}`
          : fairPrice != null
          ? fmtOdds(fairPrice)
          : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Vegas Conf Odds",
      real: vegasPct != null,
      value: vegasPct != null ? `${(vegasPct * 100).toFixed(1)}%` : undefined,
      sub:
        vegasPctRank != null
          ? `#${vegasPctRank} in conf · ${fmtOdds(vegasOdds)}`
          : vegasOdds != null
          ? fmtOdds(vegasOdds)
          : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
  ];
}
