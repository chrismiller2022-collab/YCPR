// Game Totals engine — the 5-system points-projection model, 6
// composites, and team-total splitting. Pure functions throughout, no
// data-fetching here — the admin page owns pulling TeamSeasonInputs from
// Supabase and passing them in.

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
  totalYardsOpponent: number; // yards this team's defense allowed
  passAttempts: number;
  netPassingYards: number;
  passAttemptsOpponent: number;
  netPassingYardsOpponent: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingAttemptsOpponent: number;
  rushingYardsOpponent: number;
}

function offenseYardsPerPoint(t: TeamSeasonInputs): number {
  return t.totalYards / t.pointsFor;
}
function defenseYardsPerPoint(t: TeamSeasonInputs): number {
  return t.totalYardsOpponent / t.pointsAgainst;
}

/**
 * System 1: Points per Drive x Drives per Game. Uses a BLENDED game-level
 * pace — average of the offense's own Drives/Gm and the defense's own
 * Drives/Gm faced — rather than each team's own pace multiplying back
 * into its own rate (which would just reconstruct Points/Games and add
 * nothing System 3 doesn't already capture). This is what makes pace
 * matchups (a fast offense against a slow, clock-eating defense) actually
 * move the number.
 */
function system1(offenseTeam: TeamSeasonInputs, defenseTeam: TeamSeasonInputs): number {
  const offPtsPerDrive = offenseTeam.pointsFor / offenseTeam.offenseDrives;
  const defPtsPerDriveAllowed = defenseTeam.pointsAgainst / defenseTeam.defenseDrives;

  const offDrivesPerGame = offenseTeam.offenseDrives / offenseTeam.games;
  const defDrivesPerGameFaced = defenseTeam.defenseDrives / defenseTeam.games;
  const blendedPace = (offDrivesPerGame + defDrivesPerGameFaced) / 2;

  return (blendedPace * offPtsPerDrive + blendedPace * defPtsPerDriveAllowed) / 2;
}

/**
 * System 2: Points per Play x Plays per Game. Same blended-pace fix as
 * System 1, using Plays instead of Drives.
 */
function system2(offenseTeam: TeamSeasonInputs, defenseTeam: TeamSeasonInputs): number {
  const offPtsPerPlay = offenseTeam.pointsFor / offenseTeam.offensePlays;
  const defPtsPerPlayAllowed = defenseTeam.pointsAgainst / defenseTeam.defensePlays;

  const offPlaysPerGame = offenseTeam.offensePlays / offenseTeam.games;
  const defPlaysPerGameFaced = defenseTeam.defensePlays / defenseTeam.games;
  const blendedPace = (offPlaysPerGame + defPlaysPerGameFaced) / 2;

  return (blendedPace * offPtsPerPlay + blendedPace * defPtsPerPlayAllowed) / 2;
}

/**
 * System 3: Off YPP x Off Plays/Gm = New Yards/Gm, divided by Yards Per
 * Point. Kept exactly as originally specified — still telescopes to
 * Points/Games with clean season totals (Systems 1 and 2 no longer do,
 * after the blended-pace fix above, but System 3 was left untouched per
 * instruction).
 */
function system3(offenseTeam: TeamSeasonInputs, defenseTeam: TeamSeasonInputs): number {
  const offYpp = offenseTeam.totalYards / offenseTeam.offensePlays;
  const offPlaysPerGame = offenseTeam.offensePlays / offenseTeam.games;
  const offNewYardsPerGame = offYpp * offPlaysPerGame;
  const off = offNewYardsPerGame / offenseYardsPerPoint(offenseTeam);

  const defYppAllowed = defenseTeam.totalYardsOpponent / defenseTeam.defensePlays;
  const defPlaysPerGame = defenseTeam.defensePlays / defenseTeam.games;
  const defNewYardsPerGame = defYppAllowed * defPlaysPerGame;
  const def = defNewYardsPerGame / defenseYardsPerPoint(defenseTeam);

  return (off + def) / 2;
}

/** System 4: pass-only yardage, divided by the same OVERALL (not pass-specific) Yards Per Point. */
function system4(offenseTeam: TeamSeasonInputs, defenseTeam: TeamSeasonInputs): number {
  const offPassYpa = offenseTeam.netPassingYards / offenseTeam.passAttempts;
  const offPassPlaysPerGame = offenseTeam.passAttempts / offenseTeam.games;
  const offNewPassYardsPerGame = offPassYpa * offPassPlaysPerGame;
  const off = offNewPassYardsPerGame / offenseYardsPerPoint(offenseTeam);

  const defPassYpaAllowed = defenseTeam.netPassingYardsOpponent / defenseTeam.passAttemptsOpponent;
  const defPassPlaysPerGameAllowed = defenseTeam.passAttemptsOpponent / defenseTeam.games;
  const defNewPassYardsPerGame = defPassYpaAllowed * defPassPlaysPerGameAllowed;
  const def = defNewPassYardsPerGame / defenseYardsPerPoint(defenseTeam);

  return (off + def) / 2;
}

/** System 5: rush-only yardage, same shape as System 4. */
function system5(offenseTeam: TeamSeasonInputs, defenseTeam: TeamSeasonInputs): number {
  const offRushYpa = offenseTeam.rushingYards / offenseTeam.rushingAttempts;
  const offRushPlaysPerGame = offenseTeam.rushingAttempts / offenseTeam.games;
  const offNewRushYardsPerGame = offRushYpa * offRushPlaysPerGame;
  const off = offNewRushYardsPerGame / offenseYardsPerPoint(offenseTeam);

  const defRushYpaAllowed = defenseTeam.rushingYardsOpponent / defenseTeam.rushingAttemptsOpponent;
  const defRushPlaysPerGameAllowed = defenseTeam.rushingAttemptsOpponent / defenseTeam.games;
  const defNewRushYardsPerGame = defRushYpaAllowed * defRushPlaysPerGameAllowed;
  const def = defNewRushYardsPerGame / defenseYardsPerPoint(defenseTeam);

  return (off + def) / 2;
}

export interface SystemResults {
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
  s45: number; // System 4 + System 5, summed — treated as one slot
}

/** All 5 systems for one team, playing as "offense" against the given opponent's "defense." */
export function computeSystemResults(team: TeamSeasonInputs, opponent: TeamSeasonInputs): SystemResults {
  const s1 = system1(team, opponent);
  const s2 = system2(team, opponent);
  const s3 = system3(team, opponent);
  const s4 = system4(team, opponent);
  const s5 = system5(team, opponent);
  return { s1, s2, s3, s4, s5, s45: s4 + s5 };
}

/** Team total: plain average of [S1, S2, S3, (S4+S5)] — a 4-item average. */
export function teamTotal(r: SystemResults): number {
  return (r.s1 + r.s2 + r.s3 + r.s45) / 4;
}

/** Team total, Composite-2 style: weighted average of [S1, S2, S3, (S4+S5)]. Default weights [2,2,1,1]. */
export function teamTotalWeighted(r: SystemResults, weights: [number, number, number, number] = [2, 2, 1, 1]): number {
  const [w1, w2, w3, w45] = weights;
  const weightSum = w1 + w2 + w3 + w45;
  return (r.s1 * w1 + r.s2 * w2 + r.s3 * w3 + r.s45 * w45) / weightSum;
}

export interface GameOdds {
  vegasTotal: number | null; // current/closing over_under, falls back to opening if that's all that's synced
  vegasTotalIsOpeningFallback: boolean;
  openingTotal: number | null;
  closingTotal: number | null; // "close or live" — whatever the most recent synced total is
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

export interface CompositeResults {
  composite1: number; // team1 + team2, unweighted
  composite2: number; // team1 + team2, weighted
  composite3: number | null; // composite1 regressed toward Vegas total — null if no Vegas total synced
  composite4: number | null; // avg[opening, closing, composite1] — null if neither opening nor closing exists
  composite5: number | null; // avg[opening, closing, composite2]
  composite6: number | null; // avg[opening, closing, composite3]
}

export function computeComposites(
  team1Results: SystemResults,
  team2Results: SystemResults,
  odds: GameOdds,
  options: { weights?: [number, number, number, number]; regressPct?: number } = {}
): CompositeResults {
  const weights = options.weights ?? [2, 2, 1, 1];
  const regressPct = options.regressPct ?? 0.3;

  const t1Total = teamTotal(team1Results);
  const t2Total = teamTotal(team2Results);
  const composite1 = t1Total + t2Total;

  const t1TotalW = teamTotalWeighted(team1Results, weights);
  const t2TotalW = teamTotalWeighted(team2Results, weights);
  const composite2 = t1TotalW + t2TotalW;

  // Regress toward close/live when available, opening as fallback —
  // per instruction. If neither exists, Composite 3 has nothing to
  // regress toward and is left null (not silently treated as 0% blend).
  const regressTarget = odds.closingTotal ?? odds.openingTotal ?? null;
  const composite3 = regressTarget != null ? composite1 * (1 - regressPct) + regressTarget * regressPct : null;

  const avgOf = (a: number | null, b: number | null, c: number): number | null => {
    const vals = [a, b, c].filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  const composite4 = avgOf(odds.openingTotal, odds.closingTotal, composite1);
  const composite5 = avgOf(odds.openingTotal, odds.closingTotal, composite2);
  const composite6 = composite3 != null ? avgOf(odds.openingTotal, odds.closingTotal, composite3) : null;

  return { composite1, composite2, composite3, composite4, composite5, composite6 };
}

// ---------------------------------------------------------------------
// Team-total splitting: subtract the spread from the total, halve,
// add the spread back to the favorite (the underdog is left as-is).
// Spread convention here: from the FAVORITE team's own perspective it
// would be negative — this function takes the spread as "points the
// home team is favored by" (negative = home favored, matching the
// site's vegasAwaySpread-flipped convention) and returns {home, away}.
// ---------------------------------------------------------------------
export interface TeamSplit {
  home: number | null;
  away: number | null;
}

export function splitTeamTotal(total: number | null, homeSpread: number | null): TeamSplit {
  if (total == null || homeSpread == null) return { home: null, away: null };
  // homeSpread negative = home favored, positive = away favored.
  const half = (total - Math.abs(homeSpread)) / 2;
  const favoriteHalf = half + Math.abs(homeSpread);
  const homeIsFavorite = homeSpread < 0;
  return homeIsFavorite ? { home: favoriteHalf, away: half } : { home: half, away: favoriteHalf };
}

export type SpreadSource = "vegas" | "mine" | "vegas-fill-mine";

/**
 * Resolves which spread to use for team-total splitting, per the
 * 3-way toggle: all-Vegas (blank where no Vegas spread synced), all-mine
 * (own projected spread, never blank), or Vegas-where-available else
 * mine (hybrid, never blank). A missing spread only blanks the TEAM
 * SPLIT for that game — it never affects the game-level composite
 * totals, which don't need a spread at all.
 */
export function resolveSplitSpread(mode: SpreadSource, vegasSpread: number | null, myProjSpread: number): number | null {
  if (mode === "vegas") return vegasSpread;
  if (mode === "mine") return myProjSpread;
  return vegasSpread ?? myProjSpread;
}

// ---------------------------------------------------------------------
// System Inputs — the derived per-team rates/paces that feed the five
// systems, exposed on their own so the admin page can show the "work"
// between raw stats and final system outputs. Per-team, not per-matchup
// (the blended pace itself IS per-matchup — computed at display time by
// combining two teams' own paces from here).
// ---------------------------------------------------------------------
export interface SystemInputs {
  offPtsPerDrive: number;
  offDrivesPerGame: number;
  defPtsPerDriveAllowed: number;
  defDrivesPerGameFaced: number;
  offPtsPerPlay: number;
  offPlaysPerGame: number;
  defPtsPerPlayAllowed: number;
  defPlaysPerGameFaced: number;
  offYpp: number;
  offYardsPerPoint: number;
  defYppAllowed: number;
  defYardsPerPoint: number;
  offPassYpa: number;
  offPassPlaysPerGame: number;
  defPassYpaAllowed: number;
  defPassPlaysPerGameFaced: number;
  offRushYpa: number;
  offRushPlaysPerGame: number;
  defRushYpaAllowed: number;
  defRushPlaysPerGameFaced: number;
}

export function computeSystemInputs(t: TeamSeasonInputs): SystemInputs {
  return {
    offPtsPerDrive: t.pointsFor / t.offenseDrives,
    offDrivesPerGame: t.offenseDrives / t.games,
    defPtsPerDriveAllowed: t.pointsAgainst / t.defenseDrives,
    defDrivesPerGameFaced: t.defenseDrives / t.games,
    offPtsPerPlay: t.pointsFor / t.offensePlays,
    offPlaysPerGame: t.offensePlays / t.games,
    defPtsPerPlayAllowed: t.pointsAgainst / t.defensePlays,
    defPlaysPerGameFaced: t.defensePlays / t.games,
    offYpp: t.totalYards / t.offensePlays,
    offYardsPerPoint: offenseYardsPerPoint(t),
    defYppAllowed: t.totalYardsOpponent / t.defensePlays,
    defYardsPerPoint: defenseYardsPerPoint(t),
    offPassYpa: t.netPassingYards / t.passAttempts,
    offPassPlaysPerGame: t.passAttempts / t.games,
    defPassYpaAllowed: t.netPassingYardsOpponent / t.passAttemptsOpponent,
    defPassPlaysPerGameFaced: t.passAttemptsOpponent / t.games,
    offRushYpa: t.rushingYards / t.rushingAttempts,
    offRushPlaysPerGame: t.rushingAttempts / t.games,
    defRushYpaAllowed: t.rushingYardsOpponent / t.rushingAttemptsOpponent,
    defRushPlaysPerGameFaced: t.rushingAttemptsOpponent / t.games,
  };
}

// ---------------------------------------------------------------------
// Bets, filtering, and grading — shared by both the Game Totals and
// Team Totals admin pages (Team Totals just runs these twice per game,
// once for each team's split total).
// ---------------------------------------------------------------------
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export interface BetCall {
  amountOff: number | null; // signed: composite - vegasLine. Positive = composite likes the Over.
  call: "Over" | "Under" | null;
}

export function determineBetCall(compositeValue: number | null, vegasLine: number | null): BetCall {
  if (compositeValue == null || vegasLine == null) return { amountOff: null, call: null };
  const amountOff = compositeValue - vegasLine;
  if (amountOff === 0) return { amountOff, call: null };
  return { amountOff, call: amountOff > 0 ? "Over" : "Under" };
}

/**
 * Filtered Bet: is this game's amount-off at least `thresholdMultiplier`
 * standard deviations away from the line, using the STD DEV OF THIS
 * COMPOSITE'S amount-off values ACROSS EVERY GAME in the current pool
 * (computed by the caller via stdDev() over all games' amountOff for
 * this composite, then passed in here per-game). Default threshold is
 * half a standard deviation; customizable.
 */
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

// ---------------------------------------------------------------------
// Full per-game bundle — ties everything above together for one game.
// ---------------------------------------------------------------------
export interface GameProjection {
  homeResults: SystemResults; // home team's own 5 systems (home offense vs away defense)
  awayResults: SystemResults; // away team's own 5 systems (away offense vs home defense)
  composites: CompositeResults;
}

export function computeGameProjection(
  home: TeamSeasonInputs,
  away: TeamSeasonInputs,
  odds: GameOdds,
  options: { weights?: [number, number, number, number]; regressPct?: number } = {}
): GameProjection {
  const homeResults = computeSystemResults(home, away);
  const awayResults = computeSystemResults(away, home);
  const composites = computeComposites(homeResults, awayResults, odds, options);
  return { homeResults, awayResults, composites };
}
