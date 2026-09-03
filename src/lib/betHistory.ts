import { type BetHistoryRecord, type BetPick } from "../data/betHistory.data";
import { TEAMS_BY_NAME } from "../data/teams";
import { isP4, bucketFor } from "./conferenceBuckets";
import { type ErrorStatsBundle, bundleErrors } from "./errorStats";
import { HFA, hfaFor } from "./odds";
import type { GameWithLines, BettingLineRow } from "./api/gamesLines";

export { isP4, bucketFor };

// ---------------------------------------------------------------------
// Tallying — shared by both tabs.
// ---------------------------------------------------------------------
export interface RecordTally {
  w: number;
  l: number;
  push: number;
}

export function emptyTally(): RecordTally {
  return { w: 0, l: 0, push: 0 };
}

function tallyAdd(t: RecordTally, result: BetPick) {
  if (result === "win") t.w++;
  else if (result === "loss") t.l++;
  else if (result === "push") t.push++;
  // null = no bet made — not counted at all, not even as a push
}

export function winPct(t: RecordTally): number {
  const decided = t.w + t.l;
  return decided === 0 ? 0 : (t.w / decided) * 100;
}

export interface TripleTally {
  everyBet: RecordTally;
  filteredBet: RecordTally;
  weightedFilteredBet: RecordTally;
  nwfb: RecordTally; // always empty for Plain History (no such column was uploaded) — real for Custom
  // Combination categories — all always empty for Plain History (these
  // concepts don't exist in the uploaded CSV), real for Custom only.
  anyBet: RecordTally; // filtered OR wfb OR nwfb signals (counted once, not double-counted — they're always the same team)
  matchAll3: RecordTally; // filtered AND wfb AND nwfb all signal simultaneously
  filteredAndWfb: RecordTally;
  wfbAndNwfb: RecordTally;
  filteredAndNwfb: RecordTally;
}

function emptyTripleTally(): TripleTally {
  return {
    everyBet: emptyTally(),
    filteredBet: emptyTally(),
    weightedFilteredBet: emptyTally(),
    nwfb: emptyTally(),
    anyBet: emptyTally(),
    matchAll3: emptyTally(),
    filteredAndWfb: emptyTally(),
    wfbAndNwfb: emptyTally(),
    filteredAndNwfb: emptyTally(),
  };
}

export interface TripleAggregate {
  overall: TripleTally;
  byWeek: Map<number, TripleTally>;
}

// ---------------------------------------------------------------------
// Plain History — uses the uploaded precomputed columns exactly as-is.
// ---------------------------------------------------------------------
export function aggregatePlain(records: BetHistoryRecord[]): TripleAggregate {
  const overall = emptyTripleTally();
  const byWeek = new Map<number, TripleTally>();

  for (const r of records) {
    const picks = picksFromPlain(r);
    tallyAdd(overall.everyBet, picks.everyBet.result);
    if (picks.filteredBet.team != null) tallyAdd(overall.filteredBet, picks.filteredBet.result);
    if (picks.weightedFilteredBet.team != null) tallyAdd(overall.weightedFilteredBet, picks.weightedFilteredBet.result);
    if (picks.nwfb.team != null) tallyAdd(overall.nwfb, picks.nwfb.result);

    const wk = byWeek.get(r.week) ?? emptyTripleTally();
    tallyAdd(wk.everyBet, picks.everyBet.result);
    if (picks.filteredBet.team != null) tallyAdd(wk.filteredBet, picks.filteredBet.result);
    if (picks.weightedFilteredBet.team != null) tallyAdd(wk.weightedFilteredBet, picks.weightedFilteredBet.result);
    if (picks.nwfb.team != null) tallyAdd(wk.nwfb, picks.nwfb.result);
    byWeek.set(r.week, wk);
  }

  return { overall, byWeek };
}

// ---------------------------------------------------------------------
// Custom — fully recomputed live from raw inputs + adjustable params.
// ---------------------------------------------------------------------
export interface CustomParams {
  filterThreshold: number; // default 6 — min absolute amount-off to count as a Filtered Bet
  minAbsLine: number; // default 1 — games at/below this absolute line are excluded from Weighted Filtered (avoids blowup near pick'em)
  posThreshold: number; // default 1.7 — relative-off must exceed this (positive side) to qualify as Weighted Filtered
  negThreshold: number; // default -1 — relative-off must be below this (negative side) to qualify as Weighted Filtered
  sigmaDivisor: number; // default 15.7 — the site's game-outcome stddev; absAmountOff / sigmaDivisor = "Sigma Off"
  sigmaThreshold: number; // default 0.4 — Sigma Off must exceed this to qualify as NWFB
}

export const DEFAULT_CUSTOM_PARAMS: CustomParams = {
  filterThreshold: 6,
  minAbsLine: 1,
  posThreshold: 1.7,
  negThreshold: -1,
  sigmaDivisor: 15.7,
  sigmaThreshold: 0.4,
};

export interface CustomGraded {
  everyBetTeam: string | null;
  amountOff: number;
  absAmountOff: number;
  absBettingLine: number;
  relativeAmountOff: number;
  sigmaOff: number | null;
  filteredBetTeam: string | null;
  weightedFilteredBetTeam: string | null;
  nwfbTeam: string | null;
  actualCoverTeam: string | null;
  everyBetResult: BetPick;
  filteredBetResult: BetPick;
  weightedFilteredBetResult: BetPick;
  nwfbResult: BetPick;
}

export function computeCustomGrading(r: BetHistoryRecord, params: CustomParams): CustomGraded {
  // These formulas are validated against 1,504 real historical games at
  // 100% agreement with the uploaded Every Bet Team / Actual Cover Team /
  // Every Bet Result columns — not derived from a sign-convention
  // assumption. Two things worth knowing if this logic is ever revisited:
  //   - Every Bet Team: prediction <= spread -> HOME (ties resolve home)
  //   - Cover team: (awayScore - homeScore) - spread > 0 -> away covers,
  //     otherwise home (ties also resolve home, no separate push case)
  const spread = r.spread;
  const prediction = r.prediction;

  const amountOff = spread - prediction;
  const absAmountOff = Math.abs(amountOff);
  const absBettingLine = Math.abs(spread);
  const relativeAmountOff = spread !== 0 ? absAmountOff / spread : 0;

  const everyBetTeam = prediction <= spread ? r.homeTeam : r.awayTeam;

  const filteredBetTeam = absAmountOff > params.filterThreshold ? everyBetTeam : null;

  const passesLine = absBettingLine > params.minAbsLine;
  const passesRelative = relativeAmountOff > params.posThreshold || relativeAmountOff < params.negThreshold;
  const weightedFilteredBetTeam = passesLine && passesRelative ? everyBetTeam : null;

  const sigmaOff = params.sigmaDivisor !== 0 ? absAmountOff / params.sigmaDivisor : null;
  const nwfbTeam = sigmaOff != null && sigmaOff > params.sigmaThreshold ? everyBetTeam : null;

  const coverMargin = r.awayScore - r.homeScore - spread;
  const actualCoverTeam = coverMargin > 0 ? r.awayTeam : coverMargin < 0 ? r.homeTeam : null; // null = exact push

  function grade(team: string | null): BetPick {
    if (team == null) return null; // no bet made
    if (actualCoverTeam == null) return "push"; // exact push, regardless of which side was picked
    return team === actualCoverTeam ? "win" : "loss";
  }

  const everyBetResult = grade(everyBetTeam);
  const filteredBetResult = filteredBetTeam != null ? grade(filteredBetTeam) : null;
  const weightedFilteredBetResult = weightedFilteredBetTeam != null ? grade(weightedFilteredBetTeam) : null;
  const nwfbResult = nwfbTeam != null ? grade(nwfbTeam) : null;

  return {
    everyBetTeam,
    amountOff,
    absAmountOff,
    absBettingLine,
    relativeAmountOff,
    sigmaOff,
    filteredBetTeam,
    weightedFilteredBetTeam,
    nwfbTeam,
    actualCoverTeam,
    everyBetResult,
    filteredBetResult,
    weightedFilteredBetResult,
    nwfbResult,
  };
}

// ---------------------------------------------------------------------
// Live path — for seasons with no BET_HISTORY upload (2026+), builds
// BetHistoryRecord-shaped rows straight from synced games/lines + live
// power ratings, so they flow through every aggregation function above
// completely unchanged. Mirrors moneylineBetHistory.ts's
// buildMlRowsFromLiveRatings, including the same flat-2.4-vs-team-
// specific HFA toggle — live games only, since 2024/25 has no per-team
// HFA history to recompute against.
//
// Sign convention gotcha: betHistory.data.ts's spread/prediction are
// HOME-relation (negative = home favored) — the OPPOSITE of the site's
// usual away-perspective convention used everywhere else (including
// moneylineBetHistory.ts and matchupsCompute.ts). So the usual
// `awayRating - homeRating + hfa` (away-perspective) gets negated before
// being stored as `prediction` here. The raw `betting_lines.spread`
// column is already home-relation (peayPool.ts etc. negate IT to get an
// away-perspective number), so it's used as-is for `spread`.
//
// The "precomputed" fields (everyBetTeam, filteredBetTeam, etc.) only
// matter for Plain History, which has nothing to show for a season with
// no upload anyway — but they're still filled in via computeCustomGrading
// (at DEFAULT_CUSTOM_PARAMS) rather than left null/zero, so Plain History
// shows something sensible instead of a broken-looking blank row if
// someone switches to that tab for a live season.
// ---------------------------------------------------------------------
export type HfaMode = "team" | "flat";

const LIVE_PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];
function pickSpreadLine(lines: BettingLineRow[]): BettingLineRow | null {
  const withSpread = lines.filter((l) => l.spread != null);
  if (withSpread.length === 0) return null;
  for (const p of LIVE_PREFERRED_PROVIDERS) {
    const match = withSpread.find((l) => l.provider === p);
    if (match) return match;
  }
  return withSpread[0];
}

export function buildLiveBetHistoryRecords(
  games: GameWithLines[],
  liveByTeam: Record<string, any>,
  hfaMode: HfaMode = "team"
): BetHistoryRecord[] {
  const records: BetHistoryRecord[] = [];

  for (const g of games) {
    if (!g.completed || g.home_points == null || g.away_points == null) continue; // nothing to grade yet
    const line = pickSpreadLine(g.lines);
    if (!line || line.spread == null) continue;

    const homeRating = liveByTeam[g.home_team]?.rating ?? TEAMS_BY_NAME[g.home_team]?.rating ?? null;
    const awayRating = liveByTeam[g.away_team]?.rating ?? TEAMS_BY_NAME[g.away_team]?.rating ?? null;
    if (homeRating == null || awayRating == null) continue;

    const hfa = hfaMode === "flat" ? HFA : hfaFor(g.home_team, liveByTeam);
    const awayPerspectivePrediction = awayRating - homeRating + hfa;

    const base: BetHistoryRecord = {
      season: g.season,
      week: g.week,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      homeScore: g.home_points,
      awayScore: g.away_points,
      spread: line.spread,
      prediction: -awayPerspectivePrediction,
      actualFinalSpread: g.home_points - g.away_points,
      everyBetTeam: null,
      amountOff: 0,
      absAmountOff: 0,
      filteredBetTeam: null,
      weightedFilteredBetTeam: null,
      actualCoverTeam: null,
      everyBetResult: null,
      filteredBetResult: null,
      weightedFilteredBetResult: null,
      absBettingLine: Math.abs(line.spread),
      relativeAmountOff: 0,
    };

    const graded = computeCustomGrading(base, DEFAULT_CUSTOM_PARAMS);
    records.push({
      ...base,
      everyBetTeam: graded.everyBetTeam,
      amountOff: graded.amountOff,
      absAmountOff: graded.absAmountOff,
      filteredBetTeam: graded.filteredBetTeam,
      weightedFilteredBetTeam: graded.weightedFilteredBetTeam,
      actualCoverTeam: graded.actualCoverTeam,
      everyBetResult: graded.everyBetResult,
      filteredBetResult: graded.filteredBetResult,
      weightedFilteredBetResult: graded.weightedFilteredBetResult,
      relativeAmountOff: graded.relativeAmountOff,
    });
  }

  return records;
}

export function aggregateCustom(records: BetHistoryRecord[], params: CustomParams): TripleAggregate {
  const overall = emptyTripleTally();
  const byWeek = new Map<number, TripleTally>();

  function addCombos(t: TripleTally, g: CustomGraded) {
    tallyAdd(t.everyBet, g.everyBetResult);
    if (g.filteredBetTeam != null) tallyAdd(t.filteredBet, g.filteredBetResult);
    if (g.weightedFilteredBetTeam != null) tallyAdd(t.weightedFilteredBet, g.weightedFilteredBetResult);
    if (g.nwfbTeam != null) tallyAdd(t.nwfb, g.nwfbResult);

    // Any Bet: at least one of the three signals. They're always the same
    // team when non-null (all derived from everyBetTeam under different
    // thresholds), so grading with everyBetResult is correct either way —
    // this counts the game once, not once per matching category.
    if (g.filteredBetTeam != null || g.weightedFilteredBetTeam != null || g.nwfbTeam != null) {
      tallyAdd(t.anyBet, g.everyBetResult);
    }
    if (g.filteredBetTeam != null && g.weightedFilteredBetTeam != null && g.nwfbTeam != null) {
      tallyAdd(t.matchAll3, g.everyBetResult);
    }
    if (g.filteredBetTeam != null && g.weightedFilteredBetTeam != null) {
      tallyAdd(t.filteredAndWfb, g.everyBetResult);
    }
    if (g.weightedFilteredBetTeam != null && g.nwfbTeam != null) {
      tallyAdd(t.wfbAndNwfb, g.everyBetResult);
    }
    if (g.filteredBetTeam != null && g.nwfbTeam != null) {
      tallyAdd(t.filteredAndNwfb, g.everyBetResult);
    }
  }

  for (const r of records) {
    const g = computeCustomGrading(r, params);
    addCombos(overall, g);

    const wk = byWeek.get(r.week) ?? emptyTripleTally();
    addCombos(wk, g);
    byWeek.set(r.week, wk);
  }

  return { overall, byWeek };
}

// ---------------------------------------------------------------------
// Home / Away / Favorite / Underdog splits — slices the same four bet
// categories (Every Game / Filtered / WFB / NWFB) by which side of the
// matchup was picked. Favorite/underdog is read off the Vegas spread's
// sign (negative = home favored, per this dataset's convention validated
// in computeCustomGrading above) — a true pick'em (spread === 0) has no
// favorite, so it's excluded from that split (but still counted in
// home/away). The four intersections (home favorite / home underdog /
// away favorite / away underdog) ARE also computed, for the same reason
// and excluded from the same pick'em case — sample size is smaller than
// the plain splits but the user wants them anyway.
// ---------------------------------------------------------------------
export interface SplitBucket {
  home: RecordTally;
  away: RecordTally;
  favorite: RecordTally;
  underdog: RecordTally;
  homeFavorite: RecordTally;
  homeUnderdog: RecordTally;
  awayFavorite: RecordTally;
  awayUnderdog: RecordTally;
}

function emptySplitBucket(): SplitBucket {
  return {
    home: emptyTally(),
    away: emptyTally(),
    favorite: emptyTally(),
    underdog: emptyTally(),
    homeFavorite: emptyTally(),
    homeUnderdog: emptyTally(),
    awayFavorite: emptyTally(),
    awayUnderdog: emptyTally(),
  };
}

export interface CategorySplitTally {
  everyBet: SplitBucket;
  filteredBet: SplitBucket;
  weightedFilteredBet: SplitBucket;
  nwfb: SplitBucket;
}

function emptyCategorySplitTally(): CategorySplitTally {
  return {
    everyBet: emptySplitBucket(),
    filteredBet: emptySplitBucket(),
    weightedFilteredBet: emptySplitBucket(),
    nwfb: emptySplitBucket(),
  };
}

export interface SplitAggregate {
  overall: CategorySplitTally;
  byWeek: Map<number, CategorySplitTally>;
}

function addSplitPick(bucket: SplitBucket, r: BetHistoryRecord, pick: CategoryPick) {
  if (pick.team == null) return;
  const isHome = pick.team === r.homeTeam;
  tallyAdd(isHome ? bucket.home : bucket.away, pick.result);

  if (r.spread !== 0) {
    const favoriteIsHome = r.spread < 0;
    const pickedFavorite = isHome === favoriteIsHome;
    tallyAdd(pickedFavorite ? bucket.favorite : bucket.underdog, pick.result);

    if (isHome) {
      tallyAdd(pickedFavorite ? bucket.homeFavorite : bucket.homeUnderdog, pick.result);
    } else {
      tallyAdd(pickedFavorite ? bucket.awayFavorite : bucket.awayUnderdog, pick.result);
    }
  }
  // spread === 0 (true pick'em): no favorite/underdog to attribute to.
}

function addCategorySplits(t: CategorySplitTally, r: BetHistoryRecord, picks: ThreeCategoryPicks) {
  addSplitPick(t.everyBet, r, picks.everyBet);
  addSplitPick(t.filteredBet, r, picks.filteredBet);
  addSplitPick(t.weightedFilteredBet, r, picks.weightedFilteredBet);
  addSplitPick(t.nwfb, r, picks.nwfb);
}

function aggregateSplits(records: BetHistoryRecord[], picksFn: (r: BetHistoryRecord) => ThreeCategoryPicks): SplitAggregate {
  const overall = emptyCategorySplitTally();
  const byWeek = new Map<number, CategorySplitTally>();

  for (const r of records) {
    const picks = picksFn(r);
    addCategorySplits(overall, r, picks);

    const wk = byWeek.get(r.week) ?? emptyCategorySplitTally();
    addCategorySplits(wk, r, picks);
    byWeek.set(r.week, wk);
  }

  return { overall, byWeek };
}

/** Plain History's NWFB bucket is always empty here too — same reason as the main triple tally: no such column in the uploaded CSV. */
export function computeSplitsPlain(records: BetHistoryRecord[]): SplitAggregate {
  return aggregateSplits(records, picksFromPlain);
}

export function computeSplitsCustom(records: BetHistoryRecord[], params: CustomParams): SplitAggregate {
  return aggregateSplits(records, (r) => picksFromCustom(r, params));
}

// ---------------------------------------------------------------------
// Filtering. Conference is looked up LIVE from data/teams.ts (current
// conference), since this upload doesn't include a historical
// conference snapshot per record — realignment means this can be
// slightly off for older seasons if a team has since switched conferences.
// ---------------------------------------------------------------------
export interface BetHistoryFilters {
  years: number[]; // empty = all seasons
  week: number | null; // null = all weeks
  confFilters: string[]; // empty = all; each entry is "P4" | "G6" | an actual conference name — matches if ANY apply
  teamQuery: string;
}

function teamMatchesConfFilter(team: string, conf: string, cf: string): boolean {
  if (cf === "P4") return isP4(team, conf);
  if (cf === "G6") return !isP4(team, conf);
  return conf === cf;
}

export function filterRecords(records: BetHistoryRecord[], f: BetHistoryFilters): BetHistoryRecord[] {
  return records.filter((r) => {
    if (f.years.length > 0 && !f.years.includes(r.season)) return false;
    if (f.week != null && r.week !== f.week) return false;

    if (f.confFilters.length > 0) {
      const homeConf = TEAMS_BY_NAME[r.homeTeam]?.conf ?? "";
      const awayConf = TEAMS_BY_NAME[r.awayTeam]?.conf ?? "";
      const matchesAny = f.confFilters.some(
        (cf) => teamMatchesConfFilter(r.homeTeam, homeConf, cf) || teamMatchesConfFilter(r.awayTeam, awayConf, cf)
      );
      if (!matchesAny) return false;
    }

    if (f.teamQuery.trim()) {
      const q = f.teamQuery.trim().toLowerCase();
      if (!r.homeTeam.toLowerCase().includes(q) && !r.awayTeam.toLowerCase().includes(q)) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------
// Breakdowns — slice the three bet categories by conference or by team,
// instead of just one aggregate number. A game is attributed to whichever
// team was actually PICKED for that category (not both teams in the
// game) — "how does the model do betting on SEC teams" means games where
// the picked side belongs to the SEC, not just games involving an SEC team.
// ---------------------------------------------------------------------
interface CategoryPick {
  team: string | null;
  result: BetPick;
}
interface ThreeCategoryPicks {
  everyBet: CategoryPick;
  filteredBet: CategoryPick;
  weightedFilteredBet: CategoryPick;
  nwfb: CategoryPick;
}

/** True push: the actual result landed exactly on the spread, so the pick (whichever side) neither won nor lost. */
export function isExactPush(r: BetHistoryRecord): boolean {
  return r.awayScore - r.homeScore - r.spread === 0;
}

function picksFromPlain(r: BetHistoryRecord): ThreeCategoryPicks {
  const push = isExactPush(r);
  const withPush = (team: string | null, result: BetPick): CategoryPick => ({
    team,
    result: team == null ? null : push ? "push" : result,
  });
  return {
    everyBet: withPush(r.everyBetTeam, r.everyBetResult),
    filteredBet: withPush(r.filteredBetTeam, r.filteredBetResult),
    weightedFilteredBet: withPush(r.weightedFilteredBetTeam, r.weightedFilteredBetResult),
    nwfb: { team: null, result: null }, // no such column in the uploaded CSV — Plain History has nothing to show here
  };
}

function picksFromCustom(r: BetHistoryRecord, params: CustomParams): ThreeCategoryPicks {
  const g = computeCustomGrading(r, params);
  return {
    everyBet: { team: g.everyBetTeam, result: g.everyBetResult },
    filteredBet: { team: g.filteredBetTeam, result: g.filteredBetResult },
    weightedFilteredBet: { team: g.weightedFilteredBetTeam, result: g.weightedFilteredBetResult },
    nwfb: { team: g.nwfbTeam, result: g.nwfbResult },
  };
}

export interface BreakdownTriple {
  everyBet: Map<string, RecordTally>;
  filteredBet: Map<string, RecordTally>;
  weightedFilteredBet: Map<string, RecordTally>;
  nwfb: Map<string, RecordTally>;
}

function breakdownGeneric(
  records: BetHistoryRecord[],
  picksFn: (r: BetHistoryRecord) => ThreeCategoryPicks,
  keyFor: (team: string) => string | null
): BreakdownTriple {
  const everyBet = new Map<string, RecordTally>();
  const filteredBet = new Map<string, RecordTally>();
  const weightedFilteredBet = new Map<string, RecordTally>();
  const nwfb = new Map<string, RecordTally>();

  function addTo(map: Map<string, RecordTally>, pick: CategoryPick) {
    if (pick.team == null) return;
    const key = keyFor(pick.team);
    if (key == null) return;
    const t = map.get(key) ?? emptyTally();
    tallyAdd(t, pick.result);
    map.set(key, t);
  }

  for (const r of records) {
    const picks = picksFn(r);
    addTo(everyBet, picks.everyBet);
    addTo(filteredBet, picks.filteredBet);
    addTo(weightedFilteredBet, picks.weightedFilteredBet);
    addTo(nwfb, picks.nwfb);
  }

  return { everyBet, filteredBet, weightedFilteredBet, nwfb };
}

export function breakdownByConference(
  records: BetHistoryRecord[],
  mode: "plain" | "custom",
  params?: CustomParams
): BreakdownTriple {
  const picksFn = mode === "plain" ? picksFromPlain : (r: BetHistoryRecord) => picksFromCustom(r, params!);
  return breakdownGeneric(records, picksFn, (team) => TEAMS_BY_NAME[team]?.conf ?? null);
}

export function breakdownByTeam(records: BetHistoryRecord[], mode: "plain" | "custom", params?: CustomParams): BreakdownTriple {
  const picksFn = mode === "plain" ? picksFromPlain : (r: BetHistoryRecord) => picksFromCustom(r, params!);
  return breakdownGeneric(records, picksFn, (team) => team);
}

// ---------------------------------------------------------------------
// Amount-Off Matrix — every game (there's always a pick, everyBetTeam) is
// a data point with two numbers: the betting line, SIGNED from the picked
// team's own perspective (positive = picked the underdog/getting points,
// negative = picked the favorite/giving points — same convention as the
// favorite/underdog split above, just kept per-game instead of collapsed
// into one bucket), and how many points off that line the model's own
// prediction was (a magnitude — perspective-invariant, same absAmountOff
// computeCustomGrading already produces). Rows bucket by line, columns
// bucket by a "amount off >= X" threshold, so a cell answers "of the
// games where the betting line was in this range AND the model disagreed
// with it by at least this much, how did picking the model's side do."
// This is a manual threshold-hunting tool, not a graded bet category —
// unlike Filtered/WFB/NWFB it has no saved default, it's meant to be
// stared at and used to pick numbers for those by hand.
// ---------------------------------------------------------------------
export interface AmountOffPoint {
  lineSigned: number; // from the picked team's own perspective; positive = underdog, negative = favorite
  absAmountOff: number;
  result: BetPick;
}

export function computeAmountOffPoints(records: BetHistoryRecord[], params: CustomParams): AmountOffPoint[] {
  return records.map((r) => {
    const g = computeCustomGrading(r, params);
    const pickedIsHome = g.everyBetTeam === r.homeTeam;
    const lineSigned = pickedIsHome ? r.spread : -r.spread;
    return { lineSigned, absAmountOff: g.absAmountOff, result: g.everyBetResult };
  });
}

export interface AmountOffLineBucket {
  min: number; // inclusive
  max: number; // exclusive
}

// Fixed bucket ladder Chris specified by hand, not 1-point auto-generated
// — deliberately uneven widths and gaps (e.g. nothing between 2 and 2.5)
// built around football's actual key numbers (3, 7, 10, 14, 17, 21, 24,
// 28, 35, 45), not a mechanical even split. The center bucket (0-1,
// signed as -1 to 1) plus these 15 positive-side buckets; signed mode
// mirrors the 15 onto the negative side, abs mode uses them as-is.
const POSITIVE_LINE_BUCKETS: AmountOffLineBucket[] = [
  { min: 1, max: 2 },
  { min: 2.5, max: 3.5 },
  { min: 3.5, max: 6.5 },
  { min: 6.5, max: 7.5 },
  { min: 7.5, max: 9.5 },
  { min: 9.5, max: 10.5 },
  { min: 10.5, max: 13.5 },
  { min: 13.5, max: 14.5 },
  { min: 14.5, max: 17.5 },
  { min: 17.5, max: 21.5 },
  { min: 21.5, max: 24.5 },
  { min: 24.5, max: 28.5 },
  { min: 28.5, max: 35 },
  { min: 35, max: 45 },
  { min: 45, max: Infinity },
];

/**
 * Row buckets from the fixed ladder above instead of 1-point auto-
 * generated ranges. Signed mode mirrors the positive ladder onto the
 * negative side (most-extreme-favorite first, ascending, to match the
 * old ascending order) with one shared -1-to-1 center bucket; abs mode
 * is just the ladder as-is with a 0-to-1 center bucket.
 */
export function buildLineBuckets(points: AmountOffPoint[], absValues: boolean): AmountOffLineBucket[] {
  if (points.length === 0) return [];
  if (absValues) {
    return [{ min: 0, max: 1 }, ...POSITIVE_LINE_BUCKETS];
  }
  const negative = [...POSITIVE_LINE_BUCKETS].reverse().map((b) => ({ min: -b.max, max: -b.min }));
  return [...negative, { min: -1, max: 1 }, ...POSITIVE_LINE_BUCKETS];
}

/** Threshold columns, 0.5-wide, from 0 up to 10 — capped there regardless of the data's actual max; the last column (>=10) is the catch-all "10+". */
export function buildAmountOffThresholds(points: AmountOffPoint[]): number[] {
  if (points.length === 0) return [];
  const max = Math.max(...points.map((p) => p.absAmountOff));
  const roundedMax = Math.min(10, Math.ceil(max * 2) / 2);
  const thresholds: number[] = [];
  for (let t = 0; t <= roundedMax + 1e-9; t += 0.5) thresholds.push(Math.round(t * 10) / 10);
  return thresholds;
}

function lineInBucket(lineSigned: number, bucket: AmountOffLineBucket, absValues: boolean): boolean {
  const v = absValues ? Math.abs(lineSigned) : lineSigned;
  return v >= bucket.min && v < bucket.max;
}

export interface AmountOffMatrix {
  lineBuckets: AmountOffLineBucket[];
  thresholds: number[];
  cells: RecordTally[][]; // cells[rowIndex][colIndex]
}

export function buildAmountOffMatrix(points: AmountOffPoint[], absValues: boolean): AmountOffMatrix {
  const lineBuckets = buildLineBuckets(points, absValues);
  const thresholds = buildAmountOffThresholds(points);

  const cells: RecordTally[][] = lineBuckets.map(() => thresholds.map(() => emptyTally()));

  for (const p of points) {
    const rowIdx = lineBuckets.findIndex((b) => lineInBucket(p.lineSigned, b, absValues));
    if (rowIdx === -1) continue;
    for (let colIdx = 0; colIdx < thresholds.length; colIdx++) {
      if (p.absAmountOff >= thresholds[colIdx]) {
        tallyAdd(cells[rowIdx][colIdx], p.result);
      }
    }
  }

  return { lineBuckets, thresholds, cells };
}

/**
 * The standalone "custom bucket" row — one ad hoc min/max line range (kept
 * signed, since that's what makes min=0/max=positive mean "underdog only"
 * and min=negative/max=0 mean "favorite only", per how this is meant to
 * be used) plus one amount-off threshold, graded independent of whatever
 * bucket widths the grid below is currently using.
 */
export function tallyAmountOffCustom(points: AmountOffPoint[], min: number, max: number, threshold: number): RecordTally {
  const t = emptyTally();
  for (const p of points) {
    if (p.lineSigned < min || p.lineSigned > max) continue;
    if (p.absAmountOff < threshold) continue;
    tallyAdd(t, p.result);
  }
  return t;
}

// ---------------------------------------------------------------------
// NWFB sigma-parameter sweep — sigmaOff = absAmountOff / sigmaDivisor,
// NWFB fires at sigmaOff >= sigmaThreshold. This recomputes that ratio
// for every (sigmaThreshold, sigmaDivisor) pair in the sweep range
// against every game's already-computed absAmountOff, rather than
// against the live NWFB signal itself — a parameter-hunting tool for
// calibrating the two NWFB constants (DEFAULT_CUSTOM_PARAMS.sigmaDivisor/
// sigmaThreshold), same spirit as the Amount-Off Matrix above.
// ---------------------------------------------------------------------
export function buildSigmaOffs(): number[] {
  const out: number[] = [];
  for (let s = 0; s <= 1.5 + 1e-9; s += 0.1) out.push(Math.round(s * 10) / 10);
  return out;
}

export function buildSigmaDivisors(): number[] {
  const out: number[] = [];
  for (let d = 13; d <= 18 + 1e-9; d += 0.2) out.push(Math.round(d * 10) / 10);
  return out;
}

export interface NwfbSigmaMatrix {
  sigmaOffs: number[]; // rows
  sigmaDivisors: number[]; // columns
  cells: RecordTally[][]; // cells[rowIndex][colIndex]
}

export function buildNwfbSigmaMatrix(points: AmountOffPoint[]): NwfbSigmaMatrix {
  const sigmaOffs = buildSigmaOffs();
  const sigmaDivisors = buildSigmaDivisors();
  const cells: RecordTally[][] = sigmaOffs.map(() => sigmaDivisors.map(() => emptyTally()));

  for (const p of points) {
    for (let colIdx = 0; colIdx < sigmaDivisors.length; colIdx++) {
      const sigmaOff = p.absAmountOff / sigmaDivisors[colIdx];
      for (let rowIdx = 0; rowIdx < sigmaOffs.length; rowIdx++) {
        if (sigmaOff >= sigmaOffs[rowIdx]) {
          tallyAdd(cells[rowIdx][colIdx], p.result);
        }
      }
    }
  }

  return { sigmaOffs, sigmaDivisors, cells };
}

// ---------------------------------------------------------------------
// Error metrics (Abs Error, Median Abs Error, MSE, "over Vegas" deltas) —
// same underlying math as the Matchups pages, but this dataset's `spread`
// and `prediction` use the OPPOSITE sign convention (negative = home
// favored, validated at 100% earlier in this file's history) from the
// Matchups pages' own projAwaySpread/vegasAwaySpread (positive = home
// favored). So where Matchups subtracts directly, this ADDS the raw
// spread/prediction to the actual home margin — same formula, flipped
// input sign. Easy to get backwards; don't "simplify" this to match
// Matchups' subtraction without re-flipping the sign first.
// ---------------------------------------------------------------------
export function computeErrorStatsFromBetHistory(records: BetHistoryRecord[]): ErrorStatsBundle {
  const ycErrors: number[] = [];
  const vegasErrors: number[] = [];

  for (const r of records) {
    const actualHomeMargin = r.homeScore - r.awayScore;
    ycErrors.push(actualHomeMargin + r.prediction);
    vegasErrors.push(actualHomeMargin + r.spread);
  }

  return bundleErrors(ycErrors, vegasErrors);
}
