// Historical spread-bet category win rates (Filtered / WFB / NWFB) —
// extracted out of WeeklyBettingReportPanel.tsx so the matchup handicap
// popup (and anywhere else showing a specific game's bet call) can reuse
// the exact same numbers instead of recomputing a second, potentially
// drifting copy. These are GLOBAL, not team-specific: "the Filtered Bet
// category has won X% historically" is one number regardless of which
// team's spread call happens to qualify for it in a given game — the
// OTHER team's side of that same bet is just the complement (see
// invertRecord below), not a second thing to compute.
import type { GameWithLines } from "./api/gamesLines";
import type { MatchupComputed } from "./matchupsCompute";
import { computeMatchupStats } from "./matchupsCompute";
import { DEFAULT_CUSTOM_PARAMS } from "./betHistory";
import { BET_HISTORY } from "../data/betHistory.data";

export const FILTER_THRESHOLD = DEFAULT_CUSTOM_PARAMS.filterThreshold; // 6 points
const SIGMA_THRESHOLD = DEFAULT_CUSTOM_PARAMS.sigmaThreshold; // 0.4
const SIGMA_DIVISOR = DEFAULT_CUSTOM_PARAMS.sigmaDivisor; // 15.7
export const NWFB_POINTS_THRESHOLD = SIGMA_THRESHOLD * SIGMA_DIVISOR; // ~6.28 points

export type SpreadCategory = "filtered" | "wfb" | "nwfb";

export interface CategoryTally {
  w: number;
  l: number;
}

function categoryRecordFromHistory(category: SpreadCategory, season?: number): CategoryTally {
  let w = 0;
  let l = 0;
  for (const r of BET_HISTORY) {
    if (season != null && r.season !== season) continue;
    let result: "win" | "loss" | "push" | null = null;
    if (category === "filtered") result = r.filteredBetResult;
    else if (category === "wfb") result = r.weightedFilteredBetResult;
    else if (category === "nwfb") result = r.absAmountOff > NWFB_POINTS_THRESHOLD ? r.filteredBetResult : null;
    if (result === "win") w++;
    else if (result === "loss") l++;
  }
  return { w, l };
}

// All-time (2024/2025) never changes — BET_HISTORY is a frozen dataset.
export const ALL_TIME_CATEGORY_STATS: Record<SpreadCategory, CategoryTally> = {
  filtered: categoryRecordFromHistory("filtered"),
  wfb: categoryRecordFromHistory("wfb"),
  nwfb: categoryRecordFromHistory("nwfb"),
};

/** This-season's Filtered/WFB/NWFB tallies from an already-computed set of MatchupComputed rows (one per game) — pass whatever a caller already built via computeRow, no separate fetch needed. */
export function computeSeasonCategoryStats(rows: MatchupComputed[]): Record<SpreadCategory, CategoryTally> {
  const bundle = computeMatchupStats(rows);
  return {
    filtered: { w: bundle.filtered.w, l: bundle.filtered.l },
    wfb: { w: bundle.wfb.w, l: bundle.wfb.l },
    nwfb: { w: bundle.nwfb.w, l: bundle.nwfb.l },
  };
}

export function winPctOf(rec: CategoryTally): number | null {
  const decided = rec.w + rec.l;
  return decided === 0 ? null : rec.w / decided;
}

export function pctLabelOf(rec: CategoryTally): string {
  const pct = winPctOf(rec);
  return pct == null ? "–" : `${(pct * 100).toFixed(0)}%`;
}

/** The complementary side of the SAME bet population — betting the other team in every one of these games would have won exactly the losses and lost exactly the wins (pushes carry over unchanged, they're not either side's win or loss). */
export function invertRecord(rec: CategoryTally): CategoryTally {
  return { w: rec.l, l: rec.w };
}

/** Which of the three categories a specific game's spread call qualifies for, and which team (away/home) each names — straight off computeRow's own fields, so this can never disagree with the Totals/Matchups tables that already use those fields directly. */
export function spreadCallCategories(c: MatchupComputed): { category: SpreadCategory; team: "away" | "home" }[] {
  const out: { category: SpreadCategory; team: "away" | "home" }[] = [];
  if (c.filteredBetTeam) out.push({ category: "filtered", team: c.filteredBetTeam });
  if (c.weightedFilteredBetTeam) out.push({ category: "wfb", team: c.weightedFilteredBetTeam });
  if (c.nwfbTeam) out.push({ category: "nwfb", team: c.nwfbTeam });
  return out;
}

export const CATEGORY_LABELS: Record<SpreadCategory, string> = {
  filtered: "Filtered Bet",
  wfb: "Weighted Filtered Bet",
  nwfb: "Non-Weighted Filtered Bet",
};
