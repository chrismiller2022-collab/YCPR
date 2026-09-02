// Game Totals engine.
//
// UPDATE: the actual game-total PREDICTION now comes from a trained
// Ridge regression model (see totalModelRidge.ts) — the hand-built
// 6-system formula below (PPA/success rate/explosiveness/points-per-
// opportunity/rush/pass) is kept only to feed the legacy "Raw Data" /
// "Efficiency Inputs" admin diagnostic tabs, and no longer drives
// composite1-6 or anything used for betting/grading. Worth deleting
// those diagnostic tabs in a fast-follow rather than leaving decorative
// numbers on display. See computeGameProjection below for exactly where
// the handoff happens.
//
// Original shape of the RETIRED 6-system formula engine, for context on
// what the Raw Data/Efficiency Inputs tabs are still showing:
//   1. League averages are computed once per season from every loaded
//      team (computeLeagueAverages) — the normalization baseline every
//      relative ratio below is measured against.
//   2. For a given offense-vs-defense matchup, each side's own value in a
//      metric is expressed relative to league average, and multiplied by
//      the specific opponent's own relative value in that same metric —
//      that's "matchupFactor" below. 1.0 = an exactly league-average
//      matchup in that dimension; >1 favors the offense, <1 favors the
//      defense.
//   3. Pace is explicit and separate from efficiency: blendedPlays/
//      blendedDrives/etc. reuse the exact "own full pace + half-weighted
//      opponent pace" shape the OLD engine's System 1/2 validated against
//      a real spreadsheet example — that shape is kept because it was
//      empirically confirmed, not because it's part of the old systems.
//   4. Six systems (SYSTEM_KEYS below) each combine a pace term with one
//      or two matchup factors, anchored to the league's real scoring
//      rate (ptsPerPlay/ptsPerDrive) so every system's output is already
//      on a points scale — no arbitrary calibration constants.
//   5. Systems combine into composites exactly like before: unweighted
//      average, admin-weighted average, and versions regressed toward /
//      averaged with the market's total.

import { predictGameTotalRidge } from "./totalModelRidge";

export interface TeamSeasonInputs {
  team: string;
  games: number;
  pointsFor: number; // season total, from the games table (not in CFBD's stats endpoints)
  pointsAgainst: number;
  offensePlays: number; // season total
  defensePlays: number; // season total (plays this team's defense faced)
  offenseDrives: number;
  defenseDrives: number;
  totalYards: number;
  totalYardsOpponent: number;
  passAttempts: number;
  netPassingYards: number;
  passAttemptsOpponent: number;
  netPassingYardsOpponent: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingAttemptsOpponent: number;
  rushingYardsOpponent: number;

  // Advanced (CFBD /stats/season/advanced) — all nullable since early
  // season / FCS coverage is spottier than the basic box-score stats
  // above. A null value makes its matchupFactor default to neutral (1.0)
  // rather than killing the whole system — see matchupFactor() below.
  offPpa: number | null;
  offSuccessRate: number | null;
  offExplosiveness: number | null;
  offPointsPerOpportunity: number | null;
  offPowerSuccess: number | null;
  offStuffRate: number | null;
  offLineYards: number | null;
  offStandardDownsPpa: number | null;
  offStandardDownsSuccessRate: number | null;
  offStandardDownsExplosiveness: number | null;
  offPassingDownsPpa: number | null;
  offPassingDownsSuccessRate: number | null;
  offPassingDownsExplosiveness: number | null;
  offRushingPlaysPpa: number | null;
  offRushingPlaysSuccessRate: number | null;
  offRushingPlaysExplosiveness: number | null;
  offPassingPlaysPpa: number | null;
  offPassingPlaysSuccessRate: number | null;
  offPassingPlaysExplosiveness: number | null;
  offFieldPositionAvgStart: number | null;
  offFieldPositionAvgPredictedPoints: number | null;
  offHavocTotal: number | null;
  offHavocFrontSeven: number | null;
  offHavocDb: number | null;

  defPpa: number | null;
  defSuccessRate: number | null;
  defExplosiveness: number | null;
  defPointsPerOpportunity: number | null;
  defPowerSuccess: number | null;
  defStuffRate: number | null;
  defLineYards: number | null;
  defStandardDownsPpa: number | null;
  defStandardDownsSuccessRate: number | null;
  defStandardDownsExplosiveness: number | null;
  defPassingDownsPpa: number | null;
  defPassingDownsSuccessRate: number | null;
  defPassingDownsExplosiveness: number | null;
  defRushingPlaysPpa: number | null;
  defRushingPlaysSuccessRate: number | null;
  defRushingPlaysExplosiveness: number | null;
  defPassingPlaysPpa: number | null;
  defPassingPlaysSuccessRate: number | null;
  defPassingPlaysExplosiveness: number | null;
  defFieldPositionAvgStart: number | null;
  defFieldPositionAvgPredictedPoints: number | null;
  defHavocTotal: number | null;
  defHavocFrontSeven: number | null;
  defHavocDb: number | null;
}

// ---------------------------------------------------------------------
// League averages — the normalization baseline. ptsPerPlay/ptsPerDrive
// are POOLED (sum of points / sum of plays across every team) rather
// than an average of each team's own ratio, which is the statistically
// correct way to combine rates with different denominators. The
// efficiency-metric averages are simple means of whatever teams have a
// non-null value, since those are already rate stats on a comparable
// scale team to team.
// ---------------------------------------------------------------------
export interface LeagueAverages {
  ptsPerPlay: number;
  ptsPerDrive: number;
  offPpa: number;
  defPpaAllowed: number;
  offSuccessRate: number;
  defSuccessRateAllowed: number;
  offExplosiveness: number;
  defExplosivenessAllowed: number;
  offPointsPerOpportunity: number;
  defPointsPerOpportunityAllowed: number;
  offRushPpa: number;
  defRushPpaAllowed: number;
  offRushSuccessRate: number;
  defRushSuccessRateAllowed: number;
  offPassPpa: number;
  defPassPpaAllowed: number;
  offPassSuccessRate: number;
  defPassSuccessRateAllowed: number;
}

function meanOf(values: (number | null | undefined)[]): number {
  const valid = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function sumOf(values: (number | null | undefined)[]): number {
  return values.reduce((s: number, v) => s + (v ?? 0), 0);
}

export function computeLeagueAverages(teams: TeamSeasonInputs[]): LeagueAverages {
  const totalPoints = sumOf(teams.map((t) => t.pointsFor));
  const totalPlays = sumOf(teams.map((t) => t.offensePlays));
  const totalDrives = sumOf(teams.map((t) => t.offenseDrives));

  return {
    ptsPerPlay: totalPlays > 0 ? totalPoints / totalPlays : 0,
    ptsPerDrive: totalDrives > 0 ? totalPoints / totalDrives : 0,
    offPpa: meanOf(teams.map((t) => t.offPpa)),
    defPpaAllowed: meanOf(teams.map((t) => t.defPpa)),
    offSuccessRate: meanOf(teams.map((t) => t.offSuccessRate)),
    defSuccessRateAllowed: meanOf(teams.map((t) => t.defSuccessRate)),
    offExplosiveness: meanOf(teams.map((t) => t.offExplosiveness)),
    defExplosivenessAllowed: meanOf(teams.map((t) => t.defExplosiveness)),
    offPointsPerOpportunity: meanOf(teams.map((t) => t.offPointsPerOpportunity)),
    defPointsPerOpportunityAllowed: meanOf(teams.map((t) => t.defPointsPerOpportunity)),
    offRushPpa: meanOf(teams.map((t) => t.offRushingPlaysPpa)),
    defRushPpaAllowed: meanOf(teams.map((t) => t.defRushingPlaysPpa)),
    offRushSuccessRate: meanOf(teams.map((t) => t.offRushingPlaysSuccessRate)),
    defRushSuccessRateAllowed: meanOf(teams.map((t) => t.defRushingPlaysSuccessRate)),
    offPassPpa: meanOf(teams.map((t) => t.offPassingPlaysPpa)),
    defPassPpaAllowed: meanOf(teams.map((t) => t.defPassingPlaysPpa)),
    offPassSuccessRate: meanOf(teams.map((t) => t.offPassingPlaysSuccessRate)),
    defPassSuccessRateAllowed: meanOf(teams.map((t) => t.defPassingPlaysSuccessRate)),
  };
}

// ---------------------------------------------------------------------
// Matchup factor: this team's own value in a metric, relative to league
// average, times the SPECIFIC opponent's own value in that metric,
// relative to league average. 1.0 = league-average matchup. A null input
// (missing advanced-stat data) falls back to a neutral 1.0 ratio rather
// than propagating null through the whole system — early-season or
// sparsely-tracked teams still get a system output, it just leans more
// on pace/pure scoring rate until their efficiency data fills in.
// ---------------------------------------------------------------------
function ratio(value: number | null, leagueAvg: number): number {
  if (value == null || leagueAvg === 0) return 1;
  return value / leagueAvg;
}

function matchupFactor(offValue: number | null, leagueOffAvg: number, defAllowedValue: number | null, leagueDefAvg: number): number {
  return ratio(offValue, leagueOffAvg) * ratio(defAllowedValue, leagueDefAvg);
}

// Geometric mean of two matchup factors — used when a system blends two
// metrics (e.g. PPA x Success Rate: how VALUABLE plays are x how OFTEN
// they succeed). A plain product would compound both factors' deviation
// from 1.0 on top of each other (two +20% factors multiplying to +44%,
// not +20%); the geometric mean keeps the combined swing on the same
// scale as either factor alone while still rewarding alignment between
// the two metrics over either one alone.
function geoMean(a: number, b: number): number {
  const product = a * b;
  return product > 0 ? Math.sqrt(product) : (a + b) / 2;
}

// ---------------------------------------------------------------------
// Blended pace — reused verbatim from the old engine's empirically
// validated shape (own full per-game rate + HALF the specific opponent's
// own per-game rate). This shape isn't part of "the old systems" being
// ditched; it's a pace primitive that was reverse-engineered from a real
// spreadsheet example and confirmed against it, so it's kept as the
// pace foundation for every new system below.
// ---------------------------------------------------------------------
function perGame(total: number, games: number): number {
  return games > 0 ? total / games : 0;
}

function blendedPlays(offense: TeamSeasonInputs, defense: TeamSeasonInputs): number {
  return perGame(offense.offensePlays, offense.games) + perGame(defense.defensePlays, defense.games) / 2;
}
function blendedDrives(offense: TeamSeasonInputs, defense: TeamSeasonInputs): number {
  return perGame(offense.offenseDrives, offense.games) + perGame(defense.defenseDrives, defense.games) / 2;
}
function blendedRushAttempts(offense: TeamSeasonInputs, defense: TeamSeasonInputs): number {
  return perGame(offense.rushingAttempts, offense.games) + perGame(defense.rushingAttemptsOpponent, defense.games) / 2;
}
function blendedPassAttempts(offense: TeamSeasonInputs, defense: TeamSeasonInputs): number {
  return perGame(offense.passAttempts, offense.games) + perGame(defense.passAttemptsOpponent, defense.games) / 2;
}

// ---------------------------------------------------------------------
// The six systems. Each projects ONE team's points, playing offense
// against a specific opponent's defense. Rush/Pass use the OVERALL
// league ptsPerPlay (not a rush-specific or pass-specific scoring rate)
// as their point-scale anchor — same choice the old engine's System 4/5
// made for pass/rush yardage (dividing by the overall, not split, yards
// per point), kept here for the same reason: it keeps every system's
// output on one consistent, comparable scale.
// ---------------------------------------------------------------------
function systemPpaSuccessRate(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): number {
  const plays = blendedPlays(offense, defense);
  const ppaFactor = matchupFactor(offense.offPpa, league.offPpa, defense.defPpa, league.defPpaAllowed);
  const srFactor = matchupFactor(offense.offSuccessRate, league.offSuccessRate, defense.defSuccessRate, league.defSuccessRateAllowed);
  return league.ptsPerPlay * plays * geoMean(ppaFactor, srFactor);
}

function systemSuccessRate(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): number {
  const plays = blendedPlays(offense, defense);
  const factor = matchupFactor(offense.offSuccessRate, league.offSuccessRate, defense.defSuccessRate, league.defSuccessRateAllowed);
  return league.ptsPerPlay * plays * factor;
}

function systemExplosiveness(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): number {
  const plays = blendedPlays(offense, defense);
  const factor = matchupFactor(offense.offExplosiveness, league.offExplosiveness, defense.defExplosiveness, league.defExplosivenessAllowed);
  return league.ptsPerPlay * plays * factor;
}

function systemPointsPerOpportunity(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): number {
  const drives = blendedDrives(offense, defense);
  const factor = matchupFactor(
    offense.offPointsPerOpportunity,
    league.offPointsPerOpportunity,
    defense.defPointsPerOpportunity,
    league.defPointsPerOpportunityAllowed
  );
  return league.ptsPerDrive * drives * factor;
}

function systemRush(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): number {
  const attempts = blendedRushAttempts(offense, defense);
  const ppaFactor = matchupFactor(offense.offRushingPlaysPpa, league.offRushPpa, defense.defRushingPlaysPpa, league.defRushPpaAllowed);
  const srFactor = matchupFactor(
    offense.offRushingPlaysSuccessRate,
    league.offRushSuccessRate,
    defense.defRushingPlaysSuccessRate,
    league.defRushSuccessRateAllowed
  );
  return league.ptsPerPlay * attempts * geoMean(ppaFactor, srFactor);
}

function systemPass(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): number {
  const attempts = blendedPassAttempts(offense, defense);
  const ppaFactor = matchupFactor(offense.offPassingPlaysPpa, league.offPassPpa, defense.defPassingPlaysPpa, league.defPassPpaAllowed);
  const srFactor = matchupFactor(
    offense.offPassingPlaysSuccessRate,
    league.offPassSuccessRate,
    defense.defPassingPlaysSuccessRate,
    league.defPassSuccessRateAllowed
  );
  return league.ptsPerPlay * attempts * geoMean(ppaFactor, srFactor);
}

export const SYSTEM_KEYS = ["ppaSr", "successRate", "explosiveness", "pointsPerOpp", "rush", "pass"] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

export const SYSTEM_LABELS: Record<SystemKey, string> = {
  ppaSr: "PPA x Success Rate",
  successRate: "Success Rate",
  explosiveness: "Explosiveness",
  pointsPerOpp: "Points per Opportunity",
  rush: "Rush Efficiency",
  pass: "Pass Efficiency",
};

export type SystemResults = Record<SystemKey, number>;

/** All 6 systems for one team, playing as "offense" against the given opponent's "defense." */
export function computeSystemResults(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): SystemResults {
  return {
    ppaSr: systemPpaSuccessRate(offense, defense, league),
    successRate: systemSuccessRate(offense, defense, league),
    explosiveness: systemExplosiveness(offense, defense, league),
    pointsPerOpp: systemPointsPerOpportunity(offense, defense, league),
    rush: systemRush(offense, defense, league),
    pass: systemPass(offense, defense, league),
  };
}

// Kept only because saved GameTotalsSettings rows still have a `weights`
// field (backward compat, see normalizeWeights in gameTotalsEngine.ts) —
// teamTotal/teamTotalWeighted, the functions this was originally for,
// were removed since nothing calls them anymore (composites don't derive
// from the 6-system breakdown now, see computeGameProjection).
export type SystemWeights = Record<SystemKey, number>;
export const DEFAULT_SYSTEM_WEIGHTS: SystemWeights = Object.fromEntries(SYSTEM_KEYS.map((k) => [k, 1])) as SystemWeights;

// ---------------------------------------------------------------------
// Efficiency Inputs — the matchup factors + blended pace terms feeding
// the systems above, exposed on their own so the admin page can show the
// "work" between raw advanced stats and final system outputs, the same
// role the old engine's SystemInputs played.
// ---------------------------------------------------------------------
export interface EfficiencyInputs {
  blendedPlays: number;
  blendedDrives: number;
  blendedRushAttempts: number;
  blendedPassAttempts: number;
  ppaFactor: number;
  successRateFactor: number;
  explosivenessFactor: number;
  pointsPerOppFactor: number;
  rushPpaFactor: number;
  rushSuccessRateFactor: number;
  passPpaFactor: number;
  passSuccessRateFactor: number;
}

export function computeEfficiencyInputs(offense: TeamSeasonInputs, defense: TeamSeasonInputs, league: LeagueAverages): EfficiencyInputs {
  return {
    blendedPlays: blendedPlays(offense, defense),
    blendedDrives: blendedDrives(offense, defense),
    blendedRushAttempts: blendedRushAttempts(offense, defense),
    blendedPassAttempts: blendedPassAttempts(offense, defense),
    ppaFactor: matchupFactor(offense.offPpa, league.offPpa, defense.defPpa, league.defPpaAllowed),
    successRateFactor: matchupFactor(offense.offSuccessRate, league.offSuccessRate, defense.defSuccessRate, league.defSuccessRateAllowed),
    explosivenessFactor: matchupFactor(
      offense.offExplosiveness,
      league.offExplosiveness,
      defense.defExplosiveness,
      league.defExplosivenessAllowed
    ),
    pointsPerOppFactor: matchupFactor(
      offense.offPointsPerOpportunity,
      league.offPointsPerOpportunity,
      defense.defPointsPerOpportunity,
      league.defPointsPerOpportunityAllowed
    ),
    rushPpaFactor: matchupFactor(offense.offRushingPlaysPpa, league.offRushPpa, defense.defRushingPlaysPpa, league.defRushPpaAllowed),
    rushSuccessRateFactor: matchupFactor(
      offense.offRushingPlaysSuccessRate,
      league.offRushSuccessRate,
      defense.defRushingPlaysSuccessRate,
      league.defRushSuccessRateAllowed
    ),
    passPpaFactor: matchupFactor(offense.offPassingPlaysPpa, league.offPassPpa, defense.defPassingPlaysPpa, league.defPassPpaAllowed),
    passSuccessRateFactor: matchupFactor(
      offense.offPassingPlaysSuccessRate,
      league.offPassSuccessRate,
      defense.defPassingPlaysSuccessRate,
      league.defPassSuccessRateAllowed
    ),
  };
}

// ---------------------------------------------------------------------
// Odds / composites / bet grading / team-total splitting — UNCHANGED
// from the old engine. None of this is a "system"; it's the generic
// layer that combines whatever systems exist into a total, compares
// against the market, and grades results. Still applies as-is to the
// new 6-system pool above.
// ---------------------------------------------------------------------
export interface GameOdds {
  vegasTotal: number | null;
  vegasTotalIsOpeningFallback: boolean;
  openingTotal: number | null;
  closingTotal: number | null;
}

export function resolveGameOdds(currentOverUnder: number | null, openingOverUnder: number | null): GameOdds {
  const closingTotal = currentOverUnder;
  const openingTotal = openingOverUnder;
  const vegasTotal = closingTotal ?? openingTotal ?? null;
  return {
    vegasTotal,
    vegasTotalIsOpeningFallback: closingTotal == null && openingTotal != null,
    openingTotal,
    closingTotal,
  };
}

export interface TeamSplit {
  home: number | null;
  away: number | null;
}

export function splitTeamTotal(total: number | null, homeSpread: number | null): TeamSplit {
  if (total == null || homeSpread == null) return { home: null, away: null };
  const half = (total - Math.abs(homeSpread)) / 2;
  const favoriteHalf = half + Math.abs(homeSpread);
  const homeIsFavorite = homeSpread < 0;
  // The Total model (Ridge regression on box-score inputs) and the spread
  // (power-rating differential) are computed independently, so nothing
  // stops the spread from exceeding the total — a 50-point favorite in a
  // 49-point game, for instance. Left unclamped, the underdog's half goes
  // negative (e.g. -0.4), which isn't a real football score. Floor each
  // side at 0 rather than trying to reconcile the two models against each
  // other.
  const favoriteScore = Math.max(0, favoriteHalf);
  const underdogScore = Math.max(0, half);
  return homeIsFavorite ? { home: favoriteScore, away: underdogScore } : { home: underdogScore, away: favoriteScore };
}

/**
 * "Away 27 – Home 24"-style label for a game's projected score, split
 * from a total via splitTeamTotal. Shared by the pool tools' key/
 * special-game info line (ESPN ML/Spread/Confidence, Brit, CBS Pickem)
 * so the score-from-total-and-spread math lives in exactly one place.
 * homeSpread follows the site-wide convention (negative = home
 * favored) — pass -awaySpread if that's what's on hand.
 */
export function formatProjectedScore(total: number | null, homeSpread: number | null, awayTeam: string, homeTeam: string): string | null {
  const split = splitTeamTotal(total, homeSpread);
  if (split.away == null || split.home == null) return null;
  return `${awayTeam} ${Math.round(split.away)} – ${homeTeam} ${Math.round(split.home)}`;
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export interface BetCall {
  amountOff: number | null;
  call: "Over" | "Under" | null;
}

export function determineBetCall(compositeValue: number | null, vegasLine: number | null): BetCall {
  if (compositeValue == null || vegasLine == null) return { amountOff: null, call: null };
  const amountOff = compositeValue - vegasLine;
  if (amountOff === 0) return { amountOff, call: null };
  return { amountOff, call: amountOff > 0 ? "Over" : "Under" };
}

export function isFilteredBet(amountOff: number | null, poolStdDev: number, thresholdMultiplier = 0.5): boolean {
  if (amountOff == null || poolStdDev === 0) return false;
  return Math.abs(amountOff) >= thresholdMultiplier * poolStdDev;
}

export type OverUnderResult = "over" | "under" | "push" | null;

export function gradeActualTotal(actualTotal: number | null, vegasLine: number | null): OverUnderResult {
  if (actualTotal == null || vegasLine == null) return null;
  if (actualTotal > vegasLine) return "over";
  if (actualTotal < vegasLine) return "under";
  return "push";
}

export type BetGrade = "win" | "loss" | "push" | null;

export function gradeBetCall(call: "Over" | "Under" | null, actualResult: OverUnderResult): BetGrade {
  if (call == null || actualResult == null) return null;
  if (actualResult === "push") return "push";
  return call.toLowerCase() === actualResult ? "win" : "loss";
}

export interface GameProjection {
  homeResults: SystemResults;
  awayResults: SystemResults;
  // The one number: raw Ridge model output, nothing blended toward market.
  // Used to be 6 "composite" variants (unweighted/weighted 6-system
  // averages, regressed-toward-market, open/close blends) — retired all
  // of that per Chris: "I don't really need them if there's only one
  // projection... I really only need the one." If a market-blended
  // number is wanted again later, derive it at the call site from
  // projectedTotal + odds rather than reintroducing multiple stored
  // variants.
  projectedTotal: number;
}

export function computeGameProjection(
  home: TeamSeasonInputs,
  away: TeamSeasonInputs,
  league: LeagueAverages,
  odds: GameOdds,
  context: { homeFlag: number; homeRestDays: number; awayRestDays: number }
): GameProjection {
  // homeResults/awayResults are the old 6-system formula breakdown — kept
  // around ONLY so the Raw Data / Efficiency Inputs admin tabs still have
  // something to show. They no longer feed the actual prediction; that's
  // now the Ridge model below. Worth removing those tabs in a fast-follow
  // rather than leaving legacy numbers on display indefinitely.
  const homeResults = computeSystemResults(home, away, league);
  const awayResults = computeSystemResults(away, home, league);

  const projectedTotal = predictGameTotalRidge({
    homeOffPpa: home.offPpa,
    homeDefPpa: home.defPpa,
    homeOffExplosiveness: home.offExplosiveness,
    homeDefExplosiveness: home.defExplosiveness,
    awayOffPpa: away.offPpa,
    awayDefPpa: away.defPpa,
    awayOffExplosiveness: away.offExplosiveness,
    awayDefExplosiveness: away.defExplosiveness,
    homeFlag: context.homeFlag,
    homeRestDays: context.homeRestDays,
    awayRestDays: context.awayRestDays,
    marketTotal: odds.vegasTotal,
  });

  return { homeResults, awayResults, projectedTotal };
}
