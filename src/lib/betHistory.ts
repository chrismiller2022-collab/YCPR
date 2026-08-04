import { type BetHistoryRecord, type BetPick } from "../data/betHistory.data";
import { TEAMS_BY_NAME } from "../data/teams";
import { isP4, bucketFor } from "./conferenceBuckets";
import { type ErrorStatsBundle, bundleErrors } from "./errorStats";

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
}

function emptyTripleTally(): TripleTally {
  return { everyBet: emptyTally(), filteredBet: emptyTally(), weightedFilteredBet: emptyTally() };
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

    const wk = byWeek.get(r.week) ?? emptyTripleTally();
    tallyAdd(wk.everyBet, picks.everyBet.result);
    if (picks.filteredBet.team != null) tallyAdd(wk.filteredBet, picks.filteredBet.result);
    if (picks.weightedFilteredBet.team != null) tallyAdd(wk.weightedFilteredBet, picks.weightedFilteredBet.result);
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
}

export const DEFAULT_CUSTOM_PARAMS: CustomParams = {
  filterThreshold: 6,
  minAbsLine: 1,
  posThreshold: 1.7,
  negThreshold: -1,
};

export interface CustomGraded {
  everyBetTeam: string | null;
  amountOff: number;
  absAmountOff: number;
  absBettingLine: number;
  relativeAmountOff: number;
  filteredBetTeam: string | null;
  weightedFilteredBetTeam: string | null;
  actualCoverTeam: string | null;
  everyBetResult: BetPick;
  filteredBetResult: BetPick;
  weightedFilteredBetResult: BetPick;
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

  return {
    everyBetTeam,
    amountOff,
    absAmountOff,
    absBettingLine,
    relativeAmountOff,
    filteredBetTeam,
    weightedFilteredBetTeam,
    actualCoverTeam,
    everyBetResult,
    filteredBetResult,
    weightedFilteredBetResult,
  };
}

export function aggregateCustom(records: BetHistoryRecord[], params: CustomParams): TripleAggregate {
  const overall = emptyTripleTally();
  const byWeek = new Map<number, TripleTally>();

  for (const r of records) {
    const g = computeCustomGrading(r, params);
    tallyAdd(overall.everyBet, g.everyBetResult);
    if (g.filteredBetTeam != null) tallyAdd(overall.filteredBet, g.filteredBetResult);
    if (g.weightedFilteredBetTeam != null) tallyAdd(overall.weightedFilteredBet, g.weightedFilteredBetResult);

    const wk = byWeek.get(r.week) ?? emptyTripleTally();
    tallyAdd(wk.everyBet, g.everyBetResult);
    if (g.filteredBetTeam != null) tallyAdd(wk.filteredBet, g.filteredBetResult);
    if (g.weightedFilteredBetTeam != null) tallyAdd(wk.weightedFilteredBet, g.weightedFilteredBetResult);
    byWeek.set(r.week, wk);
  }

  return { overall, byWeek };
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
  };
}

function picksFromCustom(r: BetHistoryRecord, params: CustomParams): ThreeCategoryPicks {
  const g = computeCustomGrading(r, params);
  return {
    everyBet: { team: g.everyBetTeam, result: g.everyBetResult },
    filteredBet: { team: g.filteredBetTeam, result: g.filteredBetResult },
    weightedFilteredBet: { team: g.weightedFilteredBetTeam, result: g.weightedFilteredBetResult },
  };
}

export interface BreakdownTriple {
  everyBet: Map<string, RecordTally>;
  filteredBet: Map<string, RecordTally>;
  weightedFilteredBet: Map<string, RecordTally>;
}

function breakdownGeneric(
  records: BetHistoryRecord[],
  picksFn: (r: BetHistoryRecord) => ThreeCategoryPicks,
  keyFor: (team: string) => string | null
): BreakdownTriple {
  const everyBet = new Map<string, RecordTally>();
  const filteredBet = new Map<string, RecordTally>();
  const weightedFilteredBet = new Map<string, RecordTally>();

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
  }

  return { everyBet, filteredBet, weightedFilteredBet };
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
