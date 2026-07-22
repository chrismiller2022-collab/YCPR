import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { gamesForTeam } from "../data/games";
import { RESUME_BY_TEAM } from "../data/resume";
import { TEAMS_BY_NAME } from "../data/teams";
import { fmtOdds } from "./format";
import { HFA, spreadBg, spreadColor, spreadToWinPct } from "./odds";
import { TEAM_WIN_TOTALS } from "./ranks";

export function computeSwapSchedule(scheduleTeamName, ratingTeam) {
  const games = gamesForTeam(scheduleTeamName);
  let winSum = 0;
  const rows = [];
  games.forEach((g) => {
    const isHome = g.home === scheduleTeamName;
    const oppName = isHome ? g.away : g.home;
    const opp = TEAMS_BY_NAME[oppName];
    if (!opp) return;
    const spread = isHome
      ? ratingTeam.rating - opp.rating - HFA
      : ratingTeam.rating - opp.rating + HFA;
    const winPct = spreadToWinPct(spread);
    winSum += winPct;
    rows.push({ game: g, opp, isHome, spread, winPct });
  });
  return { rows, winSum, gamesCount: rows.length };
}


export function computeNextOpponent(team) {
  const schedule = gamesForTeam(team.team);
  const nextGame = schedule[0] || null;
  if (!nextGame) return null;
  const isHome = nextGame.home === team.team;
  const oppName = isHome ? nextGame.away : nextGame.home;
  const opp = TEAMS_BY_NAME[oppName];
  if (!opp) return null;
  const spread = isHome
    ? team.rating - opp.rating - HFA
    : team.rating - opp.rating + HFA;
  return { opp, loc: isHome ? "H" : "A", spread };
}

export function computeGraphicCardStats(team) {
  const ratingColor = spreadColor(team.rating);
  const ratingBg = spreadBg(team.rating, 0.16);
  const goldBg = "rgba(255, 200, 87, 0.12)";

  const resumeData = RESUME_BY_TEAM[team.team];
  const futuresData = CONF_FUTURES_BY_TEAM[team.team];
  const winTotal = TEAM_WIN_TOTALS[team.team]?.total;

  return [
    {
      label: "Power Rating + Rank",
      real: true,
      value: `${team.rating > 0 ? "+" : ""}${team.rating.toFixed(2)}`,
      sub: `#${team.rank}`,
      color: ratingColor,
      bg: ratingBg,
    },
    { label: "Conference Record + Rank" },
    {
      label: "CFP Resume Rating + Rank",
      real: !!resumeData,
      value: resumeData ? resumeData.rating.toFixed(2) : undefined,
      sub: resumeData ? `#${resumeData.rank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    { label: "Overall Record" },
    {
      label: "Win Total",
      real: winTotal != null,
      value: winTotal != null ? winTotal.toFixed(2) : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    { label: "ATS Record + Rank" },
    { label: "Title Odds + Rank" },
    {
      label: "Proj Conf Odds",
      real: !!futuresData,
      value: futuresData ? `${(futuresData.confWinPct * 100).toFixed(1)}%` : undefined,
      sub: futuresData ? fmtOdds(futuresData.fairPrice) : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Vegas Conf Odds",
      real: !!(futuresData && futuresData.impliedPct != null),
      value:
        futuresData && futuresData.impliedPct != null
          ? `${(futuresData.impliedPct * 100).toFixed(1)}%`
          : undefined,
      sub:
        futuresData && futuresData.odds != null
          ? fmtOdds(futuresData.odds)
          : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
  ];
}
