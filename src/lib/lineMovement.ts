// Market line-movement tracking — Vegas open/close spreads and totals
// only, no model projections. Answers "which teams does the market
// consistently bet on/against" (spread) and "which teams are over/under
// teams" (total), plus a separate actual-result over/under record.
//
// Money on / money against (spread, from a team's own perspective,
// negative = favored):
//   spreadChange = openOwnSpread - closeOwnSpread
//   > 0  -> line moved toward this team (bigger favorite, or smaller
//           dog) -> "money on" += spreadChange
//   < 0  -> line moved away from this team -> "money against" +=
//           abs(spreadChange)
// Examples from spec: favored -3 -> -5 is 2 on (open 3 - close 5... wait
// using own-perspective values: -3 - (-5) = 2). Dog +7 -> +3 is 4 on
// (7 - 3 = 4). Favored -3 -> -1 is 2 against (-3 - (-1) = -2). Dog
// +10 -> +12 is 2 against (10 - 12 = -2).
//
// Money over / money under (total, shared identically by both teams in
// the game since a total isn't team-specific):
//   totalChange = closeTotal - openTotal
//   > 0 -> both teams get totalChange added to "money over"
//   < 0 -> both teams get abs(totalChange) added to "money under"
//
// Actual over/under record is a separate calc entirely: does the real
// final score (completed games only) land over or under the CLOSING
// total, per team, across their season.

import { type GameForTotals } from "./api/gameTotalsData";
import { gradeActualTotal, type OverUnderResult } from "./gameTotals";

function ownSpread(homeSpread: number | null, isHome: boolean): number | null {
  if (homeSpread == null) return null;
  return isHome ? homeSpread : -homeSpread;
}

export interface TeamMovementGameRow {
  game: GameForTotals;
  team: string;
  opponent: string;
  isHome: boolean;
  openSpread: number | null; // this team's own-perspective spread, negative = favored
  closeSpread: number | null;
  spreadChange: number | null; // open - close; + = moved toward this team, - = moved away
  moneyOn: number | null;
  moneyAgainst: number | null;
  openTotal: number | null;
  closeTotal: number | null;
  totalChange: number | null; // close - open; + = moved toward Over
  moneyOver: number | null;
  moneyUnder: number | null;
  actualTotalResult: OverUnderResult;
}

export function buildTeamMovementRows(games: GameForTotals[], team: string): TeamMovementGameRow[] {
  const rows: TeamMovementGameRow[] = [];
  for (const game of games) {
    const isHome = game.homeTeam === team;
    const isAway = game.awayTeam === team;
    if (!isHome && !isAway) continue;
    const opponent = isHome ? game.awayTeam : game.homeTeam;

    const openSpread = ownSpread(game.openingSpread, isHome);
    const closeSpread = ownSpread(game.homeSpread, isHome);
    const spreadChange = openSpread != null && closeSpread != null ? openSpread - closeSpread : null;
    const moneyOn = spreadChange != null && spreadChange > 0 ? spreadChange : null;
    const moneyAgainst = spreadChange != null && spreadChange < 0 ? -spreadChange : null;

    const openTotal = game.openingOverUnder;
    const closeTotal = game.overUnder;
    const totalChange = openTotal != null && closeTotal != null ? closeTotal - openTotal : null;
    const moneyOver = totalChange != null && totalChange > 0 ? totalChange : null;
    const moneyUnder = totalChange != null && totalChange < 0 ? -totalChange : null;

    const actualTotal = game.completed && game.homePoints != null && game.awayPoints != null ? game.homePoints + game.awayPoints : null;
    const actualTotalResult = gradeActualTotal(actualTotal, closeTotal);

    rows.push({
      game,
      team,
      opponent,
      isHome,
      openSpread,
      closeSpread,
      spreadChange,
      moneyOn,
      moneyAgainst,
      openTotal,
      closeTotal,
      totalChange,
      moneyOver,
      moneyUnder,
      actualTotalResult,
    });
  }
  return rows;
}

export interface TeamMovementSummary {
  team: string;
  moneyOn: number;
  moneyAgainst: number;
  netSpreadMoney: number; // moneyOn - moneyAgainst
  moneyOver: number;
  moneyUnder: number;
  netTotalMoney: number; // moneyOver - moneyUnder
  actualOverCount: number;
  actualUnderCount: number;
  actualPushCount: number;
  gamesWithSpread: number;
  gamesWithTotal: number;
}

function summarizeRows(team: string, rows: TeamMovementGameRow[]): TeamMovementSummary {
  let moneyOn = 0;
  let moneyAgainst = 0;
  let moneyOver = 0;
  let moneyUnder = 0;
  let gamesWithSpread = 0;
  let gamesWithTotal = 0;
  let actualOverCount = 0;
  let actualUnderCount = 0;
  let actualPushCount = 0;

  for (const r of rows) {
    if (r.spreadChange != null) {
      gamesWithSpread++;
      if (r.moneyOn != null) moneyOn += r.moneyOn;
      else if (r.moneyAgainst != null) moneyAgainst += r.moneyAgainst;
    }
    if (r.totalChange != null) {
      gamesWithTotal++;
      if (r.moneyOver != null) moneyOver += r.moneyOver;
      else if (r.moneyUnder != null) moneyUnder += r.moneyUnder;
    }
    if (r.actualTotalResult === "over") actualOverCount++;
    else if (r.actualTotalResult === "under") actualUnderCount++;
    else if (r.actualTotalResult === "push") actualPushCount++;
  }

  return {
    team,
    moneyOn,
    moneyAgainst,
    netSpreadMoney: moneyOn - moneyAgainst,
    moneyOver,
    moneyUnder,
    netTotalMoney: moneyOver - moneyUnder,
    actualOverCount,
    actualUnderCount,
    actualPushCount,
    gamesWithSpread,
    gamesWithTotal,
  };
}

export function computeTeamMovementSummaries(games: GameForTotals[]): TeamMovementSummary[] {
  const allTeams = new Set<string>();
  for (const g of games) {
    allTeams.add(g.homeTeam);
    allTeams.add(g.awayTeam);
  }
  const summaries: TeamMovementSummary[] = [];
  for (const team of allTeams) {
    summaries.push(summarizeRows(team, buildTeamMovementRows(games, team)));
  }
  return summaries;
}
