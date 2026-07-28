import { TEAMS, conferencesForDivision, type Team } from "../data/teams";
import { GAMES, gamesForTeam } from "../data/games";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { TEAM_WIN_TOTALS } from "./ranks";
import { HFA, hfaFor, spreadToWinPct, spreadToMoneyline } from "./odds";

export interface ChangeRow {
  team: Team;
  value: number;
}

/**
 * Splits a division's teams into Top 25 Gainers (most improved — most
 * negative change, since lower rating/SOR/resume is better in this app)
 * and Top 25 Losers (most declined), based on a team -> {change} map like
 * the one useWeeklyChange returns.
 */
export function topGainersAndLosers(
  division: "FBS" | "FCS",
  changeByTeam: Record<string, { change: number | null }>
): { gainers: ChangeRow[]; losers: ChangeRow[] } {
  const rows: ChangeRow[] = TEAMS.filter((t) => t.div === division)
    .map((t) => ({ team: t, value: changeByTeam[t.team]?.change ?? null }))
    .filter((r): r is ChangeRow => r.value != null);

  const gainers = [...rows].sort((a, b) => a.value - b.value).slice(0, 25);
  const losers = [...rows].sort((a, b) => b.value - a.value).slice(0, 25);

  return { gainers, losers };
}

export interface WinsLossesRow {
  team: Team;
  winProjection: number;
  totalGames: number;
  winsLeft: number;
  lossesLeft: number;
}

/**
 * Wins left = win projection - current wins.
 * Losses left = total games - win projection - current losses.
 * Actual results aren't tracked yet anywhere in the app, so current
 * wins/losses are 0 for every team for now — these values will become
 * accurate automatically once real results are wired up.
 */
export function winsLossesLeft(division: "FBS" | "FCS"): {
  byWinsLeft: WinsLossesRow[];
  byLossesLeft: WinsLossesRow[];
} {
  const currentWins = 0;
  const currentLosses = 0;

  const rows: WinsLossesRow[] = TEAMS.filter((t) => t.div === division).map((t) => {
    const winProjection = TEAM_WIN_TOTALS[t.team]?.total ?? 0;
    const totalGames = gamesForTeam(t.team).length;
    return {
      team: t,
      winProjection,
      totalGames,
      winsLeft: winProjection - currentWins,
      lossesLeft: totalGames - winProjection - currentLosses,
    };
  });

  const byWinsLeft = [...rows].sort((a, b) => b.winsLeft - a.winsLeft).slice(0, 25);
  const byLossesLeft = [...rows].sort((a, b) => b.lossesLeft - a.lossesLeft).slice(0, 25);

  return { byWinsLeft, byLossesLeft };
}

export interface ConferencePreviewRowData {
  conference: string;
  rows: {
    team: Team;
    winTotal: number;
    seasonWinLine: number | null;
    confWinTotal: number;
    confLine: number | null;
    confWinPct: number | null;
    fairPrice: number | null;
    odds: number | null;
  }[];
}

/** All conferences in a division, each with its teams' preview data. */
export function allConferencePreviews(
  division: "FBS" | "FCS",
  liveByTeam: Record<string, any> = {}
): ConferencePreviewRowData[] {
  return conferencesForDivision(division).map((conference) => {
    const teams = TEAMS.filter((t) => t.conf === conference);
    const rows = teams
      .map((t) => {
        const f = CONF_FUTURES_BY_TEAM[t.team];
        const live = liveByTeam[t.team];
        return {
          team: t,
          winTotal: live?.total_wins ?? TEAM_WIN_TOTALS[t.team]?.total ?? 0,
          seasonWinLine: live?.season_win_line ?? null,
          confWinTotal: live?.conf_proj_wins ?? TEAM_WIN_TOTALS[t.team]?.confTotal ?? 0,
          confLine: live?.conf_line ?? f?.confLine ?? null,
          confWinPct: live?.conf_win_pct ?? f?.confWinPct ?? null,
          fairPrice: live?.fair_price ?? f?.fairPrice ?? null,
          odds: live?.odds ?? f?.odds ?? null,
        };
      })
      .sort((a, b) => (b.confWinPct ?? 0) - (a.confWinPct ?? 0));
    return { conference, rows };
  });
}

export interface MatchupRow {
  dateLabel: string;
  away: Team;
  home: Team;
  awaySpread: number;
  homeSpread: number;
  awayWinPct: number | null;
  homeWinPct: number | null;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
}

/** Games in a given week where both teams are in the same division. */
export function weekMatchups(
  division: "FBS" | "FCS",
  week: number,
  liveByTeam: Record<string, any> = {}
): MatchupRow[] {
  const teamsByName = Object.fromEntries(TEAMS.map((t) => [t.team, t]));
  return GAMES.filter((g) => g.week === week)
    .map((g) => {
      const away = teamsByName[g.away];
      const home = teamsByName[g.home];
      if (!away || !home) return null;
      if (away.div !== division || home.div !== division) return null;
      const awaySpread = away.rating - home.rating + hfaFor(g.home, liveByTeam);
      const homeSpread = -awaySpread;
      const awayWinPct = spreadToWinPct(awaySpread);
      return {
        dateLabel: new Date(g.date).toLocaleDateString(undefined, {
          weekday: "short",
          month: "numeric",
          day: "numeric",
        }),
        away,
        home,
        awaySpread,
        homeSpread,
        awayWinPct,
        homeWinPct: awayWinPct != null ? 1 - awayWinPct : null,
        awayMoneyline: spreadToMoneyline(awaySpread),
        homeMoneyline: spreadToMoneyline(homeSpread),
      };
    })
    .filter((r): r is MatchupRow => r != null)
    .sort((a, b) => a.dateLabel.localeCompare(b.dateLabel));
}
