import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { gamesForTeam } from "../data/games";
import { NATTY_BY_TEAM } from "../data/nattyOdds";
import { SOS_BY_TEAM } from "../data/sor";
import { TEAMS, TEAMS_BY_NAME, teamsForConference } from "../data/teams";
import { HFA, hfaFor, spreadBg, spreadColor, spreadToWinPct } from "./odds";
import { TEAM_WIN_TOTALS, SOR_RANK_BY_TEAM, buildRankMap } from "./ranks";
import { pickLine } from "./matchupsCompute";
import { computeOverUnderRecord, fmtOuRecord } from "./ouRecord";

export function computeSwapSchedule(scheduleTeamName, ratingTeam, liveByTeam = {}) {
  const games = gamesForTeam(scheduleTeamName);
  const ownRating = liveByTeam[ratingTeam.team]?.rating ?? ratingTeam.rating;
  let winSum = 0;
  const rows = [];
  games.forEach((g) => {
    const isHome = g.home === scheduleTeamName;
    const oppName = isHome ? g.away : g.home;
    const staticOpp = TEAMS_BY_NAME[oppName];
    if (!staticOpp) return;
    const opp = { ...staticOpp, rating: liveByTeam[oppName]?.rating ?? staticOpp.rating };
    const spread = isHome
      ? ownRating - opp.rating - hfaFor(scheduleTeamName, liveByTeam)
      : ownRating - opp.rating + hfaFor(oppName, liveByTeam);
    const winPct = spreadToWinPct(spread);
    winSum += winPct;
    rows.push({ game: g, opp, isHome, spread, winPct });
  });
  return { rows, winSum, gamesCount: rows.length };
}


export function computeNextOpponent(team, liveByTeam = {}) {
  const schedule = gamesForTeam(team.team);
  const nextGame = schedule[0] || null;
  if (!nextGame) return null;
  const isHome = nextGame.home === team.team;
  const oppName = isHome ? nextGame.away : nextGame.home;
  const staticOpp = TEAMS_BY_NAME[oppName];
  if (!staticOpp) return null;
  const opp = { ...staticOpp, rating: liveByTeam[oppName]?.rating ?? staticOpp.rating };
  const teamRating = liveByTeam[team.team]?.rating ?? team.rating;
  const spread = isHome
    ? teamRating - opp.rating - hfaFor(team.team, liveByTeam)
    : teamRating - opp.rating + hfaFor(oppName, liveByTeam);
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

export function computeGraphicCardStats(team, liveByTeam = {}, seasonGames = []) {
  const liveTeamRating = liveByTeam[team.team]?.rating ?? team.rating;
  const ratingColor = spreadColor(liveTeamRating);
  const ratingBg = spreadBg(liveTeamRating, 0.16);
  const goldBg = "rgba(255, 200, 87, 0.12)";

  const futuresData = CONF_FUTURES_BY_TEAM[team.team];
  const live = liveByTeam[team.team];

  const schedule = gamesForTeam(team.team);
  const totalGames = schedule.length;
  const confGames = schedule.filter((g) => {
    const oppName = g.home === team.team ? g.away : g.home;
    return TEAMS_BY_NAME[oppName]?.conf === team.conf;
  }).length;

  // Live Wins/Losses, Live Win Proj, Live Conf Win Proj, and ATS
  // Wins/Losses are now all computed here from real synced data —
  // completed games/scores for actual records, current model spreads
  // (via win probability) for projected records, and CFBD line data
  // for ATS — instead of reading an uploaded weekly snapshot. Ratings
  // are live-preferred throughout, matching the rest of the site.
  const ratingFor = (name, fallback) => liveByTeam[name]?.rating ?? fallback;
  const teamRating = ratingFor(team.team, team.rating);
  // Not liveByTeam[team.team]?.rank — the stored `rank` column from the
  // weekly upload is currently broken (every team comes back rank 1, a bug
  // in that upload's own rank calculation, not something safe to trust
  // here). Recompute the true national rank from scratch off the full
  // live-resolved roster instead, the same way the ranking pages elsewhere
  // on the site do. Lower rating = better, same convention as everywhere
  // else.
  const nationalRankMap = buildRankMap(
    TEAMS.map((t) => [t.team, liveByTeam[t.team]?.rating ?? t.rating]),
    false
  );
  const teamRank = nationalRankMap[team.team] ?? team.rank;

  const teamGames = seasonGames.filter((g) => g.home_team === team.team || g.away_team === team.team);

  let liveWins = 0;
  let liveLosses = 0;
  let confLiveWins = 0;
  let confLiveLosses = 0;
  let projWinsSum = 0;
  let projLossesSum = 0;
  let confProjWinsSum = 0;
  let confProjLossesSum = 0;
  let atsWins = 0;
  let atsLosses = 0;

  for (const g of teamGames) {
    const isHome = g.home_team === team.team;
    const oppName = isHome ? g.away_team : g.home_team;
    const opp = TEAMS_BY_NAME[oppName];
    const isConf = !!g.conference_game;
    const isCompleted = g.completed && g.home_points != null && g.away_points != null;

    if (isCompleted) {
      const teamScore = isHome ? g.home_points : g.away_points;
      const oppScore = isHome ? g.away_points : g.home_points;
      if (teamScore > oppScore) {
        liveWins++;
        projWinsSum += 1;
        if (isConf) {
          confLiveWins++;
          confProjWinsSum += 1;
        }
      } else if (teamScore < oppScore) {
        liveLosses++;
        projLossesSum += 1;
        if (isConf) {
          confLiveLosses++;
          confProjLossesSum += 1;
        }
      }

      const line = pickLine(g.lines ?? []);
      if (line?.spread != null) {
        const teamLine = isHome ? line.spread : -line.spread;
        const margin = teamScore - oppScore;
        const coverMargin = margin + teamLine;
        if (coverMargin > 0) atsWins++;
        else if (coverMargin < 0) atsLosses++;
        // coverMargin === 0 is a push — counted in neither.
      }
    } else if (opp) {
      const oppRating = ratingFor(oppName, opp.rating);
      const spread = isHome
        ? teamRating - oppRating - hfaFor(team.team, liveByTeam)
        : teamRating - oppRating + hfaFor(oppName, liveByTeam);
      const winPct = spreadToWinPct(spread);
      projWinsSum += winPct;
      projLossesSum += 1 - winPct;
      if (isConf) {
        confProjWinsSum += winPct;
        confProjLossesSum += 1 - winPct;
      }
    }
  }

  const overallRecord = teamGames.length > 0 ? `${liveWins}-${liveLosses}` : undefined;
  const confActualRecord = teamGames.length > 0 ? `${confLiveWins}-${confLiveLosses}` : undefined;
  const projRecord = teamGames.length > 0 ? `${projWinsSum.toFixed(1)}-${projLossesSum.toFixed(1)}` : undefined;
  const confProjRecord = teamGames.length > 0 ? `${confProjWinsSum.toFixed(1)}-${confProjLossesSum.toFixed(1)}` : undefined;
  const atsRecord = atsWins + atsLosses > 0 ? `${atsWins}-${atsLosses}` : undefined;

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

  // Vegas total (over_under) vs actual combined score, from completed
  // games with a line only. Symmetric grading — this team gets credited
  // with an over/under regardless of which side of the matchup it's on.
  const overUnderRecord = fmtOuRecord(computeOverUnderRecord(team.team, teamGames));

  const myNattyOdds = live?.natty_odds ?? NATTY_BY_TEAM[team.team];
  const vegasNattyOdds = live?.draftkings_natty_odds;
  const confPct = live?.conf_win_pct ?? futuresData?.confWinPct;
  const vegasPct = live?.implied_pct ?? futuresData?.impliedPct;
  const seasonWinLine = live?.season_win_line;

  const powerRatingCard = {
    label: "Power Rating + Rank",
    real: true,
    value: `${teamRating > 0 ? "+" : ""}${teamRating.toFixed(2)}`,
    sub: `#${teamRank}`,
    color: ratingColor,
    bg: ratingBg,
  };

  const basic = [
    powerRatingCard,
    {
      label: "SOS + Rank",
      real: sorValue != null,
      value: sorValue != null ? (sorValue > 0 ? "+" : "") + sorValue.toFixed(2) : undefined,
      sub: sorRank != null ? `#${sorRank}` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      // Not pulled from the Resume Rating admin panel yet — that page
      // computes live but doesn't persist per-team scores anywhere this
      // can read from. Shows TBD until that feed exists.
      label: "Resume Rating + Rank",
      real: false,
      value: undefined,
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
      label: "Actual Record",
      real: overallRecord != null,
      value: overallRecord,
      sub: undefined,
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
      label: "Proj Conference Record + Rank",
      real: confProjRecord != null,
      value: confProjRecord,
      sub: confWinsRank != null ? `#${confWinsRank} in conf` : undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Actual Conf Record",
      real: confActualRecord != null,
      value: confActualRecord,
      sub: undefined,
      color: "var(--gold)",
      bg: goldBg,
    },
    {
      label: "Conf Odds + Rank",
      real: confPct != null,
      value: confPct != null ? `${(confPct * 100).toFixed(1)}%` : undefined,
      sub: confPctRank != null ? `#${confPctRank} in conf` : undefined,
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
