// Moneyline bet history engine. Two data sources feed the same computation:
//   - 2024/2025: "my" spread comes from the static BET_HISTORY dataset (the
//     historical record of what was actually predicted at the time) —
//     see buildMlRowsFromBetHistory below.
//   - 2026 onward (and any season without a BET_HISTORY entry): "my" spread
//     comes from live power ratings, same awayRating - homeRating + HFA
//     formula used everywhere else on the site (matchupsCompute.ts,
//     multiRatingMatchups.ts) — see buildMlRowsFromLiveRatings below.
// Both paths converge on the same computeMlRow() so the EV/unit math is
// identical regardless of source.
//
// EV formula matches the site's one existing precedent (matchupsCompute.ts's
// `ev` field) exactly: my fair win% (from spreadToWinPct, the site's own
// calibrated spread->win% curve) minus Vegas's RAW implied win% from the
// moneyline (vig included, not de-vigged — same as matchupsCompute.ts, whose
// comment explicitly documents this as "Vegas's implied win% for the away
// side, not a de-vigged true probability"). Kept consistent with that
// existing, already-shipped convention rather than introducing a different
// methodology just for moneylines.
//
// Because vig means the two sides' Vegas implied win%s sum to slightly MORE
// than 100% while "my" two win%s (derived from one symmetric spread number)
// always sum to EXACTLY 100%, it's mathematically impossible for both sides'
// EV to be positive at once (it *is* possible for both to be negative — the
// vig eating both sides at once is the normal case when your number is close
// to the market's).

import { HFA, hfaFor, spreadToWinPct, fairMoneylineFromWinPct } from "./odds";
import { TEAMS_BY_NAME } from "../data/teams";
import { type BetHistoryRecord, BET_HISTORY } from "../data/betHistory.data";
import { computeCustomGrading, DEFAULT_CUSTOM_PARAMS, type CustomParams } from "./betHistory";
import { type GameWithLines, type BettingLineRow } from "./api/gamesLines";

export type BetSide = "away" | "home" | null;

// Same provider-preference order used elsewhere (matchupsCompute.ts,
// espnMlPool.ts) for spread lines — reused here, but a line only qualifies
// if it actually carries BOTH moneylines (some providers report spread/O-U
// only), so this scans further down the list than pickLine() would.
const PREFERRED_ML_PROVIDERS = ["consensus", "DraftKings", "Bovada", "ESPN Bet"];

export function pickMoneylineLine(lines: BettingLineRow[]): BettingLineRow | null {
  const withBoth = lines.filter((l) => l.home_moneyline != null && l.away_moneyline != null);
  if (withBoth.length === 0) return null;
  for (const p of PREFERRED_ML_PROVIDERS) {
    const match = withBoth.find((l) => l.provider === p);
    if (match) return match;
  }
  return withBoth[0];
}

/** American odds -> profit per 1 unit staked (e.g. -300 -> 0.333, +500 -> 5). */
export function profitMultiplier(americanOdds: number): number {
  return americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
}

/** American odds -> Vegas's raw (vig-included) implied win probability, 0-1. Same formula as matchupsCompute.ts's vegasWinPct. */
export function vegasImpliedWinPct(americanOdds: number): number {
  return americanOdds > 0 ? 100 / (americanOdds + 100) : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

export interface StakeResult {
  stake: number; // units risked
  profit: number; // units won (positive) or lost (negative, = -stake), null-safe by caller checking result != null
}

export interface MlGameRow {
  game: GameWithLines;
  myAwaySpread: number | null; // away-oriented, negative = away favored (site convention)
  myAwayWinPct: number | null;
  myHomeWinPct: number | null;
  vegasAwayMoneyline: number | null;
  vegasHomeMoneyline: number | null;
  vegasAwayWinPct: number | null;
  vegasHomeWinPct: number | null;
  evAway: number | null; // percentage points, my - vegas
  evHome: number | null;
  betSide: BetSide;
  betOdds: number | null;
  betEv: number | null;
  actualWinnerSide: "away" | "home" | null;
  result: "win" | "loss" | null; // null = not graded yet (game not final, or no bet)
  toWin1: StakeResult | null; // "bet X units to win 1 unit" mode
  flat1: StakeResult | null; // "bet 1 unit no matter what" mode
}

/** Core per-game computation — same for both data sources once each has supplied myAwaySpread and the two moneylines. */
export function computeMlRow(
  game: GameWithLines,
  myAwaySpread: number | null,
  vegasAwayMoneyline: number | null,
  vegasHomeMoneyline: number | null,
  // Bill R Method (see buildMlRowsFromLiveRatingsBillR below) doesn't go
  // through a spread number at all — it derives a win probability directly
  // from a z-score. When supplied, this wins over myAwaySpread for the
  // win%/EV/bet-side math; myAwaySpread is still kept around for display
  // (null under Bill R — there's no spread to show).
  overrideAwayWinPct?: number | null
): MlGameRow {
  const myAwayWinPct = overrideAwayWinPct != null ? overrideAwayWinPct : myAwaySpread != null ? spreadToWinPct(myAwaySpread) : null;
  const myHomeWinPct = myAwayWinPct != null ? 1 - myAwayWinPct : null;

  const vegasAwayWinPct = vegasAwayMoneyline != null ? vegasImpliedWinPct(vegasAwayMoneyline) : null;
  const vegasHomeWinPct = vegasHomeMoneyline != null ? vegasImpliedWinPct(vegasHomeMoneyline) : null;

  const evAway = myAwayWinPct != null && vegasAwayWinPct != null ? (myAwayWinPct - vegasAwayWinPct) * 100 : null;
  const evHome = myHomeWinPct != null && vegasHomeWinPct != null ? (myHomeWinPct - vegasHomeWinPct) * 100 : null;

  // Every Game rule: bet whichever side is positive EV. If neither side is
  // positive (common — vig eats both), or in the (provably impossible, but
  // guarded anyway) case both read positive, no bet.
  let betSide: BetSide = null;
  if (evAway != null && evHome != null) {
    const awayPos = evAway > 0;
    const homePos = evHome > 0;
    if (awayPos && !homePos) betSide = "away";
    else if (homePos && !awayPos) betSide = "home";
    // both positive, both negative/zero, or one/both null -> no bet
  }

  const betOdds = betSide === "away" ? vegasAwayMoneyline : betSide === "home" ? vegasHomeMoneyline : null;
  const betEv = betSide === "away" ? evAway : betSide === "home" ? evHome : null;

  let actualWinnerSide: "away" | "home" | null = null;
  if (game.completed && game.away_points != null && game.home_points != null && game.away_points !== game.home_points) {
    actualWinnerSide = game.away_points > game.home_points ? "away" : "home";
  }

  let result: "win" | "loss" | null = null;
  let toWin1: StakeResult | null = null;
  let flat1: StakeResult | null = null;
  if (betSide != null && betOdds != null && actualWinnerSide != null) {
    result = betSide === actualWinnerSide ? "win" : "loss";
    const mult = profitMultiplier(betOdds);
    if (result === "win") {
      flat1 = { stake: 1, profit: mult };
      toWin1 = { stake: 1 / mult, profit: 1 };
    } else {
      flat1 = { stake: 1, profit: -1 };
      toWin1 = { stake: 1 / mult, profit: -1 / mult };
    }
  }

  return {
    game,
    myAwaySpread,
    myAwayWinPct,
    myHomeWinPct,
    vegasAwayMoneyline,
    vegasHomeMoneyline,
    vegasAwayWinPct,
    vegasHomeWinPct,
    evAway,
    evHome,
    betSide,
    betOdds,
    betEv,
    actualWinnerSide,
    result,
    toWin1,
    flat1,
  };
}

// ---------------------------------------------------------------------
// 2024/2025 path — "my" spread from the static BET_HISTORY dataset.
// BET_HISTORY's spread/prediction are home-oriented (negative = home
// favored) — the OPPOSITE of this site's away-oriented convention — so
// negate before handing to computeMlRow. Matched to the live games/lines
// tables by (season, week, home team, away team); a BET_HISTORY record with
// no matching synced game (or no game carrying both moneylines) is skipped
// and counted as unmatched rather than silently dropped.
// ---------------------------------------------------------------------
export interface MlBacktestResult {
  rows: MlGameRow[];
  unmatchedBetHistory: BetHistoryRecord[]; // had a prediction but no synced game/line found
}

export function buildMlRowsFromBetHistory(season: number, games: GameWithLines[]): MlBacktestResult {
  const gameByKey = new Map<string, GameWithLines>();
  for (const g of games) {
    gameByKey.set(`${g.season}::${g.week}::${g.home_team}::${g.away_team}`, g);
  }

  const rows: MlGameRow[] = [];
  const unmatchedBetHistory: BetHistoryRecord[] = [];

  for (const r of BET_HISTORY) {
    if (r.season !== season) continue;
    const g = gameByKey.get(`${r.season}::${r.week}::${r.homeTeam}::${r.awayTeam}`);
    if (!g) {
      unmatchedBetHistory.push(r);
      continue;
    }
    const line = pickMoneylineLine(g.lines);
    if (!line) {
      unmatchedBetHistory.push(r);
      continue;
    }
    const myAwaySpread = -r.prediction;
    rows.push(computeMlRow(g, myAwaySpread, line.away_moneyline, line.home_moneyline));
  }

  return { rows, unmatchedBetHistory };
}

// ---------------------------------------------------------------------
// Live path — "my" spread from live power ratings (2026+, or any season
// with synced games but no BET_HISTORY entries). Same formula as
// matchupsCompute.ts's computeRow / multiRatingMatchups.ts. hfaMode picks
// between each home team's own saved HFA value (default, "team") and the
// site's flat 2.4 constant ("flat") — same A/B toggle AdminMatchupsPanel
// used to have, live-games-only since 2024/25 has no per-team HFA history
// to recompute against.
// ---------------------------------------------------------------------
export type HfaMode = "team" | "flat";

export function buildMlRowsFromLiveRatings(
  games: GameWithLines[],
  liveByTeam: Record<string, any>,
  hfaMode: HfaMode = "team"
): MlGameRow[] {
  const rows: MlGameRow[] = [];
  for (const g of games) {
    const line = pickMoneylineLine(g.lines);
    if (!line) continue;

    const staticAway = TEAMS_BY_NAME[g.away_team] ?? null;
    const staticHome = TEAMS_BY_NAME[g.home_team] ?? null;
    const awayRating = liveByTeam[g.away_team]?.rating ?? staticAway?.rating ?? null;
    const homeRating = liveByTeam[g.home_team]?.rating ?? staticHome?.rating ?? null;
    const hfa = hfaMode === "flat" ? HFA : hfaFor(g.home_team, liveByTeam);
    const myAwaySpread = awayRating != null && homeRating != null ? awayRating - homeRating + hfa : null;

    rows.push(computeMlRow(g, myAwaySpread, line.away_moneyline, line.home_moneyline));
  }
  return rows;
}

// ---------------------------------------------------------------------
// Bill R Method — an alternate moneyline derivation, live games only
// (2026+; the site's own YC/Consensus power rating has no historical
// per-week snapshot for 2024/25 to rebuild against). Skips the spread
// number entirely: ratingDiff -> HFA-adjusted margin -> z-score -> normal
// CDF -> win probability -> fair moneyline.
//
// This site's rating convention is inverted from a normal SP+-style
// rating (lower/more negative = better team here, see LiveWinTotalsPage's
// "rating < 0 ? good : bad"). So "away team's margin over home, positive
// = away better" is homeRating - awayRating, not the other way around —
// otherwise the sign would come out backwards vs. the worked example
// (Team A at Team B, higher-is-better ratings) the method was specified
// with.
// ---------------------------------------------------------------------
export const BILL_R_DEFAULT_DIVISOR = 17;
export const BILL_R_HFA = 2.5; // fixed for this method, independent of the site's normal flat/team-specific HFA (2.4 / hfaFor)

// Standard normal CDF (Abramowitz-Stegun approximation).
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

/** Away team's win probability under Bill R Method, given both teams' site power ratings (lower = better). */
export function billRAwayWinPct(awayRating: number, homeRating: number, divisor: number = BILL_R_DEFAULT_DIVISOR): number {
  const margin = homeRating - awayRating - BILL_R_HFA; // positive => away favored, after shaving off the home team's HFA
  const z = divisor !== 0 ? margin / divisor : 0;
  return normalCdf(z);
}

export function buildMlRowsFromLiveRatingsBillR(
  games: GameWithLines[],
  liveByTeam: Record<string, any>,
  divisor: number = BILL_R_DEFAULT_DIVISOR
): MlGameRow[] {
  const rows: MlGameRow[] = [];
  for (const g of games) {
    const line = pickMoneylineLine(g.lines);
    if (!line) continue;

    const staticAway = TEAMS_BY_NAME[g.away_team] ?? null;
    const staticHome = TEAMS_BY_NAME[g.home_team] ?? null;
    const awayRating = liveByTeam[g.away_team]?.rating ?? staticAway?.rating ?? null;
    const homeRating = liveByTeam[g.home_team]?.rating ?? staticHome?.rating ?? null;

    const awayWinPct = awayRating != null && homeRating != null ? billRAwayWinPct(awayRating, homeRating, divisor) : null;

    rows.push(computeMlRow(g, null, line.away_moneyline, line.home_moneyline, awayWinPct));
  }
  return rows;
}

// ---------------------------------------------------------------------
// Aggregation — unit totals under both staking modes, plus a plain W-L
// record, overall and by week.
// ---------------------------------------------------------------------
export interface MlTally {
  w: number;
  l: number;
  toWin1Units: number; // net units, "bet X to win 1" mode
  flat1Units: number; // net units, "bet 1 flat" mode
}

function emptyMlTally(): MlTally {
  return { w: 0, l: 0, toWin1Units: 0, flat1Units: 0 };
}

function addToTally(t: MlTally, row: MlGameRow) {
  if (row.result == null || row.toWin1 == null || row.flat1 == null) return;
  if (row.result === "win") t.w++;
  else t.l++;
  t.toWin1Units += row.toWin1.profit;
  t.flat1Units += row.flat1.profit;
}

export function mlWinPct(t: MlTally): number {
  const decided = t.w + t.l;
  return decided === 0 ? 0 : (t.w / decided) * 100;
}

export interface MlAggregate {
  overall: MlTally;
  byWeek: Map<number, MlTally>;
}

export function aggregateMlRows(rows: MlGameRow[]): MlAggregate {
  const overall = emptyMlTally();
  const byWeek = new Map<number, MlTally>();
  for (const row of rows) {
    addToTally(overall, row);
    const wk = byWeek.get(row.game.week) ?? emptyMlTally();
    addToTally(wk, row);
    byWeek.set(row.game.week, wk);
  }
  return { overall, byWeek };
}

/** Only counts rows where the bet side's EV exceeds evThreshold (percentage points) — "Filtered Bet," same idea as the spread side's filter threshold. Every Bet (aggregateMlRows) stays threshold-agnostic: bets whichever side is positive at all. */
export function aggregateMlRowsFiltered(rows: MlGameRow[], evThreshold: number): MlAggregate {
  return aggregateMlRows(rows.filter((r) => r.betEv != null && r.betEv > evThreshold));
}

// ---------------------------------------------------------------------
// Home / Away / Favorite / Underdog splits. Favorite/underdog reads off
// myAwaySpread's sign (negative = away favored, this file's own
// away-oriented convention, documented on MlGameRow above) — a true
// pick'em (spread exactly 0) has no favorite, so it's excluded from that
// split only (still counted in home/away). Combo cuts aren't broken out
// separately — too small a sample size for now.
// ---------------------------------------------------------------------
export interface MlSplitBucket {
  home: MlTally;
  away: MlTally;
  favorite: MlTally;
  underdog: MlTally;
}

function emptyMlSplitBucket(): MlSplitBucket {
  return { home: emptyMlTally(), away: emptyMlTally(), favorite: emptyMlTally(), underdog: emptyMlTally() };
}

function addSplitRow(bucket: MlSplitBucket, row: MlGameRow) {
  if (row.betSide == null) return;
  addToTally(row.betSide === "home" ? bucket.home : bucket.away, row);

  if (row.myAwaySpread != null && row.myAwaySpread !== 0) {
    const favoriteIsAway = row.myAwaySpread < 0;
    const pickedAway = row.betSide === "away";
    addToTally(pickedAway === favoriteIsAway ? bucket.favorite : bucket.underdog, row);
  }
}

export function aggregateMlSplits(rows: MlGameRow[]): MlSplitBucket {
  const bucket = emptyMlSplitBucket();
  for (const row of rows) addSplitRow(bucket, row);
  return bucket;
}

export function aggregateMlSplitsFiltered(rows: MlGameRow[], evThreshold: number): MlSplitBucket {
  return aggregateMlSplits(rows.filter((r) => r.betEv != null && r.betEv > evThreshold));
}

// ---------------------------------------------------------------------
// "Also bet the spread" — restricts the ML rows to games where the SPREAD
// side's own signal (Filtered / WFB / NWFB, same engine as the Admin Bet
// History page) also fired that week. Only possible for seasons with a
// BET_HISTORY entry (2024/2025 currently) — that's the only place the
// spread/prediction inputs the ATS engine needs are stored; a live 2026+
// game has no BET_HISTORY match, so it's excluded from this cut rather
// than silently guessed at.
// ---------------------------------------------------------------------
export type SpreadSignal = "filtered" | "wfb" | "nwfb";

function betHistoryKey(season: number, week: number, homeTeam: string, awayTeam: string): string {
  return `${season}::${week}::${homeTeam}::${awayTeam}`;
}

/** Which of the three spread signals fired for a BET_HISTORY record, using the same default params as the Admin Bet History page. */
function spreadSignalsFor(r: BetHistoryRecord, params: CustomParams): Set<SpreadSignal> {
  const g = computeCustomGrading(r, params);
  const set = new Set<SpreadSignal>();
  if (g.filteredBetTeam != null) set.add("filtered");
  if (g.weightedFilteredBetTeam != null) set.add("wfb");
  if (g.nwfbTeam != null) set.add("nwfb");
  return set;
}

/** Rows for a season with no BET_HISTORY coverage (e.g. 2026+ live games) always come back empty — there's no spread signal to cross-reference against yet. */
export function filterMlRowsBySpreadSignal(
  rows: MlGameRow[],
  season: number,
  signal: SpreadSignal,
  params: CustomParams = DEFAULT_CUSTOM_PARAMS
): MlGameRow[] {
  const byKey = new Map<string, BetHistoryRecord>();
  for (const r of BET_HISTORY) {
    if (r.season !== season) continue;
    byKey.set(betHistoryKey(r.season, r.week, r.homeTeam, r.awayTeam), r);
  }
  if (byKey.size === 0) return [];

  return rows.filter((row) => {
    const r = byKey.get(betHistoryKey(season, row.game.week, row.game.home_team, row.game.away_team));
    if (!r) return false;
    return spreadSignalsFor(r, params).has(signal);
  });
}

export { fairMoneylineFromWinPct };
