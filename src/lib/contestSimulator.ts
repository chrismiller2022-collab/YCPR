import type { CustomParams } from "./betHistory";

export type ContestGrade = "win" | "loss" | "push" | null;
export type ContestTier = "filtered" | "wfb" | "nwfb" | "bestBets";

export interface ContestCandidate {
  week: number;
  awayTeam: string;
  homeTeam: string;
  pick: string | null; // team picked, per the site's own model (everyBetTeam / projCoverTeam)
  grade: ContestGrade; // null = not yet played
  absAmountOff: number | null;
  myAwaySpread: number | null;
  vegasAwaySpread: number | null;
  awayScore: number | null;
  homeScore: number | null;
  qualifiesFiltered: boolean;
  qualifiesWfb: boolean;
  qualifiesNwfb: boolean;
}

export interface ContestPickDetail extends ContestCandidate {
  opponent: string; // whoever the picked team is playing
  finalMargin: number | null; // picked team's own margin, positive = won by that much
}

export interface ContestWeekResult {
  week: number;
  picks: ContestPickDetail[];
  wins: number;
  losses: number;
  pushes: number;
}

export interface ContestSeasonResult {
  tier: ContestTier;
  topN: number;
  weeks: ContestWeekResult[];
  totalWins: number;
  totalLosses: number;
  totalPushes: number;
}

function toDetail(c: ContestCandidate): ContestPickDetail | null {
  if (!c.pick) return null;
  const pickIsAway = c.pick === c.awayTeam;
  const opponent = pickIsAway ? c.homeTeam : c.awayTeam;
  let finalMargin: number | null = null;
  if (c.awayScore != null && c.homeScore != null) {
    finalMargin = pickIsAway ? c.awayScore - c.homeScore : c.homeScore - c.awayScore;
  }
  return { ...c, opponent, finalMargin };
}

function qualifies(c: ContestCandidate, tier: Exclude<ContestTier, "bestBets">): boolean {
  if (tier === "filtered") return c.qualifiesFiltered;
  if (tier === "wfb") return c.qualifiesWfb;
  return c.qualifiesNwfb;
}

/**
 * Filtered/WFB/NWFB are real threshold gates (same definitions as Admin
 * Matchups/Bet History — see matchupsCompute.ts's computeRow), not a
 * pure ranking — a week only gets as many picks as actually clear that
 * tier's bar, up to topN, sorted by absAmountOff within the qualifying
 * set. A week can show fewer than topN picks; that's the real
 * constraint of the tier, not a bug.
 */
export function simulateTier(candidates: ContestCandidate[], topN: number, tier: Exclude<ContestTier, "bestBets">): ContestSeasonResult {
  const byWeek = new Map<number, ContestCandidate[]>();
  for (const c of candidates) {
    const list = byWeek.get(c.week) ?? [];
    list.push(c);
    byWeek.set(c.week, list);
  }

  const weeks: ContestWeekResult[] = [];
  let totalWins = 0;
  let totalLosses = 0;
  let totalPushes = 0;

  for (const week of Array.from(byWeek.keys()).sort((a, b) => a - b)) {
    const pool = byWeek.get(week)!.filter((c) => c.pick != null && qualifies(c, tier));
    const sorted = [...pool].sort((a, b) => (b.absAmountOff ?? 0) - (a.absAmountOff ?? 0));
    const picks = sorted.slice(0, topN).map(toDetail).filter((p): p is ContestPickDetail => p != null);

    let wins = 0;
    let losses = 0;
    let pushes = 0;
    for (const p of picks) {
      if (p.grade === "win") wins++;
      else if (p.grade === "loss") losses++;
      else if (p.grade === "push") pushes++;
    }
    weeks.push({ week, picks, wins, losses, pushes });
    totalWins += wins;
    totalLosses += losses;
    totalPushes += pushes;
  }

  return { tier, topN, weeks, totalWins, totalLosses, totalPushes };
}

/**
 * Best Bets: combine tiers instead of picking one. NWFB games first
 * (the strictest, highest-conviction signal), then fill remaining slots
 * with WFB games, then Filtered games if still short of topN — always
 * using DEFAULT_CUSTOM_PARAMS (the real site-wide definitions used by
 * Bet History and Admin Matchups), never whatever the Filtered/WFB/NWFB
 * tabs' own parameters have been loosened to, per Chris: "no opening
 * parameters for these."
 */
export function simulateBestBets(candidates: ContestCandidate[], topN: number): ContestSeasonResult {
  const byWeek = new Map<number, ContestCandidate[]>();
  for (const c of candidates) {
    const list = byWeek.get(c.week) ?? [];
    list.push(c);
    byWeek.set(c.week, list);
  }

  const weeks: ContestWeekResult[] = [];
  let totalWins = 0;
  let totalLosses = 0;
  let totalPushes = 0;

  for (const week of Array.from(byWeek.keys()).sort((a, b) => a - b)) {
    const weekCandidates = byWeek.get(week)!.filter((c) => c.pick != null);
    const byAbsOff = (a: ContestCandidate, b: ContestCandidate) => (b.absAmountOff ?? 0) - (a.absAmountOff ?? 0);

    const chosen: ContestCandidate[] = [];
    const chosenKeys = new Set<string>();
    function key(c: ContestCandidate) {
      return `${c.awayTeam}@${c.homeTeam}`;
    }
    function takeFrom(pool: ContestCandidate[]) {
      for (const c of [...pool].sort(byAbsOff)) {
        if (chosen.length >= topN) break;
        if (chosenKeys.has(key(c))) continue;
        chosen.push(c);
        chosenKeys.add(key(c));
      }
    }
    takeFrom(weekCandidates.filter((c) => c.qualifiesNwfb));
    if (chosen.length < topN) takeFrom(weekCandidates.filter((c) => c.qualifiesWfb));
    if (chosen.length < topN) takeFrom(weekCandidates.filter((c) => c.qualifiesFiltered));

    const picks = chosen.map(toDetail).filter((p): p is ContestPickDetail => p != null);
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    for (const p of picks) {
      if (p.grade === "win") wins++;
      else if (p.grade === "loss") losses++;
      else if (p.grade === "push") pushes++;
    }
    weeks.push({ week, picks, wins, losses, pushes });
    totalWins += wins;
    totalLosses += losses;
    totalPushes += pushes;
  }

  return { tier: "bestBets", topN, weeks, totalWins, totalLosses, totalPushes };
}

export function contestWinPct(r: { totalWins: number; totalLosses: number }): number | null {
  const decided = r.totalWins + r.totalLosses;
  return decided > 0 ? (r.totalWins / decided) * 100 : null;
}

/** How many of the weeks present in `candidates` have at least `topN` qualifying games for this tier — the live feedback Chris asked for while adjusting a tier's parameters. */
export function weeksReachingTopN(candidates: ContestCandidate[], topN: number, tier: Exclude<ContestTier, "bestBets">): { weeksAtOrAboveTopN: number; totalWeeks: number } {
  const byWeek = new Map<number, ContestCandidate[]>();
  for (const c of candidates) {
    const list = byWeek.get(c.week) ?? [];
    list.push(c);
    byWeek.set(c.week, list);
  }
  let weeksAtOrAboveTopN = 0;
  for (const list of byWeek.values()) {
    const qualifyingCount = list.filter((c) => c.pick != null && qualifies(c, tier)).length;
    if (qualifyingCount >= topN) weeksAtOrAboveTopN++;
  }
  return { weeksAtOrAboveTopN, totalWeeks: byWeek.size };
}

export const PARAM_STORAGE_KEY = "pool_history_custom_params_v1";

export function loadSavedParams(defaults: CustomParams): CustomParams {
  try {
    const raw = localStorage.getItem(PARAM_STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveParams(params: CustomParams): void {
  localStorage.setItem(PARAM_STORAGE_KEY, JSON.stringify(params));
}
