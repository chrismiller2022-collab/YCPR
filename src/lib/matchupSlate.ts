import { isMidweekET, isSaturdayET } from "./watchability";
import { homeSideMlValues, type MatchupComputed } from "./matchupsCompute";

// One flattened, display-ready row per game for the mobile Matchup Slate
// graphic (MatchupSlateGraphic.tsx) — pulled from the same MatchupComputed
// the desktop table already uses, so the numbers can never drift apart
// from what's shown there. Deliberately a narrower field set than the
// desktop table (no opening line, no NWFB) — just what Chris asked to see
// on the graphic itself.
export interface SlateGameRow {
  gameId: string;
  kickoffIso: string | null;
  awayTeam: string;
  homeTeam: string;
  completed: boolean;
  awayScore: number | null;
  homeScore: number | null;

  vegasAwaySpread: number | null; // away-perspective, site convention throughout
  myAwaySpread: number | null;
  vegasTotal: number | null;
  myTotal: number | null;
  vegasAwayMoneyline: number | null;
  myAwayMoneyline: number | null;
  vegasHomeMoneyline: number | null;
  myHomeMoneyline: number | null;
  myAwayWinPct: number | null; // 0-1

  projWinner: "away" | "home" | null; // straight-up (moneyline) pick
  projCoverTeam: "away" | "home" | null; // ATS pick vs. the Vegas line
  // "Spread Bet" per Chris's spec: Filtered OR Weighted Filtered only —
  // deliberately NOT falling through to NWFB the way MatchupComputed's own
  // combined `betTeam` field does.
  spreadBetTeam: "away" | "home" | null;
  // How many standard deviations my total projection sits from Vegas's,
  // using the same pool-wide std dev gameTotalsEngine.ts's own bet-row
  // machinery (poolStdDevForTotal/buildBetRows) computes for the Totals
  // admin page — null unless the caller supplies a pool std dev (see
  // buildSlateRow's poolStdForTotal param; MatchupsPage.tsx's own call
  // doesn't pass one, so this stays null there).
  totalStdDevOff: number | null;
  // "Total Bet" per Chris's spec: fires at 1+ standard deviations off,
  // same threshold he uses for judging spread bets "good" in chat, not
  // whatever filterThresholdMultiplier the Totals admin page happens to
  // be set to.
  totalBetCall: "Over" | "Under" | null;

  actualWinner: "away" | "home" | "tie" | null;
  actCoverTeam: "away" | "home" | "push" | null;
  projTotalResult: "Over" | "Under" | "Push" | null;
  totalResult: "Over" | "Under" | "Push" | null;
}

export function buildSlateRow(computed: MatchupComputed, myTotal: number | null, poolStdForTotal?: number): SlateGameRow {
  const { game, projAwaySpread, vegasAwaySpread, line, vegasMoneyline, projMoneyline, projWinPct, projCoverTeam, filteredBetTeam, weightedFilteredBetTeam } = computed;
  const { homeMoneyline } = homeSideMlValues(computed);

  const projWinner: "away" | "home" | null = projAwaySpread == null ? null : projAwaySpread < 0 ? "away" : projAwaySpread > 0 ? "home" : null;

  const actualWinner: "away" | "home" | "tie" | null =
    game.away_points != null && game.home_points != null
      ? game.away_points > game.home_points
        ? "away"
        : game.home_points > game.away_points
        ? "home"
        : "tie"
      : null;

  const projTotalResult: "Over" | "Under" | "Push" | null =
    myTotal != null && line?.over_under != null ? (myTotal > line.over_under ? "Over" : myTotal < line.over_under ? "Under" : "Push") : null;

  const totalStdDevOff =
    myTotal != null && line?.over_under != null && poolStdForTotal != null && poolStdForTotal !== 0
      ? (myTotal - line.over_under) / poolStdForTotal
      : null;
  const totalBetCall: "Over" | "Under" | null =
    totalStdDevOff != null && Math.abs(totalStdDevOff) >= 1 ? (totalStdDevOff > 0 ? "Over" : "Under") : null;

  return {
    gameId: game.id,
    kickoffIso: game.start_date,
    awayTeam: game.away_team,
    homeTeam: game.home_team,
    completed: game.completed,
    awayScore: game.away_points,
    homeScore: game.home_points,

    vegasAwaySpread,
    myAwaySpread: projAwaySpread,
    vegasTotal: line?.over_under ?? null,
    myTotal,
    vegasAwayMoneyline: vegasMoneyline,
    myAwayMoneyline: projMoneyline,
    vegasHomeMoneyline: line?.home_moneyline ?? null,
    myHomeMoneyline: homeMoneyline,
    myAwayWinPct: projWinPct,

    projWinner,
    projCoverTeam,
    spreadBetTeam: filteredBetTeam ?? weightedFilteredBetTeam,
    totalStdDevOff,
    totalBetCall,

    actualWinner,
    actCoverTeam: computed.actCoverTeam,
    projTotalResult,
    totalResult: computed.totalResult,
  };
}

export type SlateDayFilter = "all" | "midweek" | "saturday";

export function filterSlateRowsByDay(rows: SlateGameRow[], filter: SlateDayFilter): SlateGameRow[] {
  if (filter === "all") return rows;
  if (filter === "saturday") return rows.filter((r) => isSaturdayET(r.kickoffIso));
  return rows.filter((r) => isMidweekET(r.kickoffIso));
}
