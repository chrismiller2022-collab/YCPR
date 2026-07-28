import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { gamesForTeam } from "../data/games";
import { NATTY_BY_TEAM } from "../data/nattyOdds";
import { SOS_BY_TEAM } from "../data/sor";
import { TEAMS, TEAMS_BY_NAME, teamsForConference } from "../data/teams";
import { HFA, hfaFor, spreadBg, spreadColor, spreadToWinPct } from "./odds";
import { TEAM_WIN_TOTALS, SOR_RANK_BY_TEAM, buildRankMap } from "./ranks";

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

  const confProjRecord =
    confWinTotal != null
      ? `${confWinTotal.toFixed(1)}-${Math.max(0, confGames - confWinTotal).toFixed(1)}`
      : undefined;

  // Actual conference-only results aren't tracked separately from overall
  // results yet (only total live_wins/live_losses exist) — TBD until that
  // exists, same as every other "not wired up yet" card on this site.
  const confActualRecord = undefined;

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

  // Rank of our own SOR among every team with a live value, falling back to
  // the static snapshot's rank map if no live SOR data has been saved yet.
  const liveSorEntries = TEAMS.filter((t) => liveByTeam[t.team]?.sor != null).map(
    (t) => [t.team, liveByTeam[t.team].sor]
  );
  const sorRankMap = liveSorEntries.length > 0 ? buildRankMap(liveSorEntries, false) : SOR_RANK_BY_TEAM;
  const sorValue = live?.sor ?? SOS_BY_TEAM[team.team] ?? null;
  const sorRank = sorRankMap[team.team];

  // Rank of our own (not Vegas's) natty odds among every team with a live
  // value, since the CSV's natty_rank column is specifically the Vegas rank.
  const liveNattyEntries = TEAMS.filter((t) => liveByTeam[t.team]?.natty_odds != null).map(
    (t) => [t.team, liveByTeam[t.team].natty_odds]
  );
  const myNattyRankMap = buildRankMap(liveNattyEntries, true);

  const overallRecord =
    live?.live_wins != null && live?.live_losses != null
      ? `${live.live_wins}-${live.live_losses}`
      : undefined;

  const atsRecord =
    live?.ats_wins != null && live?.ats_losses != null
      ? `${live.ats_wins}-${live.ats_losses}`
      : undefined;

  // Not tracked anywhere yet — separate from ATS record, needs its own
  // weekly data source before this can populate.
  const overUnderRecord = undefined;

  const myNattyOdds = live?.natty_odds ?? NATTY_BY_TEAM[team.team];
  const vegasNattyOdds = live?.draftkings_natty_odds;
  const confPct = live?.conf_win_pct ?? futuresData?.confWinPct;
  const vegasPct = live?.implied_pct ?? futuresData?.impliedPct;
  const seasonWinLine = live?.season_win_line;

  const powerRatingCard = {
    label: "Power Rating + Rank",
    real: true,
    value: `${team.rating > 0 ? "+" : ""}${team.rating.toFixed(2)}`,
    sub: `#${team.rank}`,
    color: ratingColor,
    bg: ratingBg,
  };

  const basic = [
    powerRatingCard,
    {
      label: "Overall Record",
      real: overallRecord != null,
      value: overallRecord,
      sub: undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Projected Record",
      real: projRecord != null,
      value: projRecord,
      sub: undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Conference Record",
      real: confActualRecord != null,
      value: confActualRecord,
      sub: undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Proj Conference Record + Rank",
      real: confProjRecord != null,
      value: confProjRecord,
      sub: confWinsRank != null ? `#${confWinsRank} in conf` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Proj Title Odds + Rank",
      real: myNattyOdds != null,
      value: myNattyOdds != null ? `${(myNattyOdds * 100).toFixed(1)}%` : undefined,
      sub: myNattyRankMap[team.team] != null ? `#${myNattyRankMap[team.team]}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Proj Conf Odds + Rank",
      real: confPct != null,
      value: confPct != null ? `${(confPct * 100).toFixed(1)}%` : undefined,
      sub: confPctRank != null ? `#${confPctRank} in conf` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "SOR + Rank",
      real: sorValue != null,
      value: sorValue != null ? (sorValue > 0 ? "+" : "") + sorValue.toFixed(2) : undefined,
      sub: sorRank != null ? `#${sorRank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
  ];

  const betting = [
    powerRatingCard,
    {
      label: "ATS Record + Rank",
      real: atsRecord != null,
      value: atsRecord,
      sub: live?.ats_rank != null ? `#${live.ats_rank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Over/Under Record",
      real: overUnderRecord != null,
      value: overUnderRecord,
      sub: undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Vegas Title Odds + Rank",
      real: vegasNattyOdds != null,
      value: vegasNattyOdds != null ? `${(vegasNattyOdds * 100).toFixed(1)}%` : undefined,
      sub: live?.natty_rank != null ? `#${live.natty_rank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Vegas Conf Odds + Rank",
      real: vegasPct != null,
      value: vegasPct != null ? `${(vegasPct * 100).toFixed(1)}%` : undefined,
      sub: vegasPctRank != null ? `#${vegasPctRank} in conf` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Vegas Win Total",
      real: seasonWinLine != null,
      value: seasonWinLine != null ? seasonWinLine.toFixed(1) : undefined,
      sub: undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
  ];

  return { basic, betting };
}
