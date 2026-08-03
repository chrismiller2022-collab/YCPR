import { type BetHistoryRecord } from "../data/betHistory.data";
import { isP4, bucketFor } from "./conferenceBuckets";

export { isP4, bucketFor };

export type HfaMode = "flat" | "teamSpecific";

export const DEFAULT_FLAT_HFA = 2.4;
export const DEFAULT_FILTERED_THRESHOLD = 3.0;

/**
 * Historical default HFA mode actually used per season — this is what
 * the public page always uses (not customizable there), and what the
 * Admin page defaults to before you start adjusting things.
 */
export const DEFAULT_HFA_MODE_BY_SEASON: Record<number, HfaMode> = {
  2024: "flat",
  2025: "teamSpecific",
  2026: "teamSpecific",
};

// P4/G6 classification lives in ./conferenceBuckets now (shared with
// Toughest Game Stretch) — imported and re-exported above.

// ---------------------------------------------------------------------
// Grading a single record under a given HFA mode + filter threshold.
// ---------------------------------------------------------------------
export type PickResult = "win" | "loss" | "push" | "pending";

export interface GradedRecord extends BetHistoryRecord {
  projSpread: number;
  amountOff: number;
  projCoverTeam: string | null;
  actualCoverTeam: string | null;
  atsResult: PickResult;
  isFiltered: boolean;
  filteredResult: PickResult | null;
}

export function computeProjSpread(r: BetHistoryRecord, hfaMode: HfaMode): number {
  if (r.neutralSite) return r.ratingDiff;
  const hfa = hfaMode === "flat" ? DEFAULT_FLAT_HFA : r.teamSpecificHfa;
  return r.ratingDiff + hfa;
}

export function gradeRecord(r: BetHistoryRecord, hfaMode: HfaMode, threshold: number): GradedRecord {
  const projSpread = computeProjSpread(r, hfaMode);

  // Positive edge = model likes the market's closing number less than it
  // likes home; negative edge = model likes away more than the market
  // does. This determines which side the model's pick actually is,
  // graded against the market — not just "who does the model favor."
  const edge = projSpread - r.closingLine;
  const amountOff = Math.abs(edge);
  const projCoverTeam = edge < 0 ? r.awayTeam : edge > 0 ? r.homeTeam : null;

  let atsResult: PickResult = "pending";
  let actualCoverTeam: string | null = null;
  if (r.actualAwayMargin != null) {
    const coverMargin = r.actualAwayMargin + r.closingLine;
    actualCoverTeam = coverMargin > 0 ? r.awayTeam : coverMargin < 0 ? r.homeTeam : null;
    if (projCoverTeam == null || actualCoverTeam == null) {
      atsResult = "push";
    } else {
      atsResult = projCoverTeam === actualCoverTeam ? "win" : "loss";
    }
  }

  const isFiltered = amountOff >= threshold;
  const filteredResult = isFiltered ? atsResult : null;

  return { ...r, projSpread, amountOff, projCoverTeam, actualCoverTeam, atsResult, isFiltered, filteredResult };
}

/** Grades using each record's own season's historical default HFA mode — what the public page always uses. */
export function gradeRecordDefault(r: BetHistoryRecord, threshold: number): GradedRecord {
  const mode = DEFAULT_HFA_MODE_BY_SEASON[r.season] ?? "teamSpecific";
  return gradeRecord(r, mode, threshold);
}

// ---------------------------------------------------------------------
// Aggregation.
// ---------------------------------------------------------------------
export interface RecordTally {
  w: number;
  l: number;
  push: number;
}

function emptyTally(): RecordTally {
  return { w: 0, l: 0, push: 0 };
}

function tallyAdd(t: RecordTally, result: PickResult | null) {
  if (result === "win") t.w++;
  else if (result === "loss") t.l++;
  else if (result === "push") t.push++;
}

export function winPct(t: RecordTally): number {
  const decided = t.w + t.l;
  return decided === 0 ? 0 : (t.w / decided) * 100;
}

export interface AggregateResult {
  overall: RecordTally;
  filtered: RecordTally;
  byWeek: Map<number, { overall: RecordTally; filtered: RecordTally }>;
}

export function aggregate(graded: GradedRecord[]): AggregateResult {
  const overall = emptyTally();
  const filtered = emptyTally();
  const byWeek = new Map<number, { overall: RecordTally; filtered: RecordTally }>();

  for (const g of graded) {
    tallyAdd(overall, g.atsResult);
    if (g.isFiltered) tallyAdd(filtered, g.filteredResult);

    const wk = byWeek.get(g.week) ?? { overall: emptyTally(), filtered: emptyTally() };
    tallyAdd(wk.overall, g.atsResult);
    if (g.isFiltered) tallyAdd(wk.filtered, g.filteredResult);
    byWeek.set(g.week, wk);
  }

  return { overall, filtered, byWeek };
}

// ---------------------------------------------------------------------
// Filtering.
// ---------------------------------------------------------------------
export interface BetHistoryFilters {
  years: number[]; // empty = all seasons
  week: number | null; // null = all weeks
  confFilter: string; // "All" | "P4" | "G6" | an actual conference name
  teamQuery: string;
}

export function filterRecords(records: BetHistoryRecord[], f: BetHistoryFilters): BetHistoryRecord[] {
  return records.filter((r) => {
    if (f.years.length > 0 && !f.years.includes(r.season)) return false;
    if (f.week != null && r.week !== f.week) return false;

    if (f.confFilter !== "All") {
      const awayMatch =
        f.confFilter === "P4"
          ? isP4(r.awayTeam, r.awayConf)
          : f.confFilter === "G6"
          ? !isP4(r.awayTeam, r.awayConf)
          : r.awayConf === f.confFilter;
      const homeMatch =
        f.confFilter === "P4"
          ? isP4(r.homeTeam, r.homeConf)
          : f.confFilter === "G6"
          ? !isP4(r.homeTeam, r.homeConf)
          : r.homeConf === f.confFilter;
      if (!awayMatch && !homeMatch) return false;
    }

    if (f.teamQuery.trim()) {
      const q = f.teamQuery.trim().toLowerCase();
      if (!r.awayTeam.toLowerCase().includes(q) && !r.homeTeam.toLowerCase().includes(q)) return false;
    }

    return true;
  });
}
