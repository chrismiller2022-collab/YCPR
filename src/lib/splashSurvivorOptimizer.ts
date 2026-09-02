import { TEAMS, type Team } from "../data/teams";
import { SURVIVOR_WEEKS, type SurvivorWeek, gameForTeamInWeek, opponentOf, teamWinPct } from "./survivor";
import { isGameEligible } from "./splashSurvivor";
import type { TeamSimResult } from "./montecarlo/engine";

// Same two objectives, same algorithms (least-flexibility-first greedy +
// pairwise-swap local search for survival probability; week-by-week
// regret-minimizing greedy for expected weeks survived) as
// survivorOptimizer.ts — see that file's comments for the full
// reasoning, which doesn't change here. The only real difference is the
// candidate pool: every FBS team is a candidate (no conference filter),
// and per-week eligibility comes from isGameEligible instead of
// isOpponentEligible/selectedConfs.

export type SurvivorObjective = "maxSurvivalProb" | "maxExpectedWeeks";

export interface OptimizerSlot {
  weekKey: string;
  slotIndex: 0 | 1;
}

export interface OptimizerPick {
  weekKey: string;
  slotIndex: 0 | 1;
  team: string | null;
  winProb: number | null;
}

export interface OptimizerResult {
  objective: SurvivorObjective;
  picks: OptimizerPick[];
  survivalProb: number | null;
  expectedWeeksAdded: number | null;
}

function areOpponentsThisWeek(teamA: string, teamB: string, week: SurvivorWeek): boolean {
  const game = gameForTeamInWeek(teamA, week.dataWeek);
  if (!game) return false;
  return game.home === teamB || game.away === teamB;
}

/**
 * A team's estimated win probability for a given week — same shape as
 * survivorOptimizer.ts's estimateWinProb, but eligibility comes from
 * isGameEligible (G6-vs-G6/FCS exclusion) instead of the conference
 * filter. Conference Championship week still has no scheduled matchups,
 * so it falls back to the same Monte Carlo conference-title estimate.
 */
export function estimateWinProb(team: Team, week: SurvivorWeek, mcResults: TeamSimResult[] | null): number | null {
  if (week.key === "champ") {
    const mc = mcResults?.find((r) => r.team === team.team);
    return mc ? mc.confTitlePct / 100 : null;
  }
  const game = gameForTeamInWeek(team.team, week.dataWeek);
  if (!game) return null;
  const opp = opponentOf(game, team.team);
  if (!isGameEligible(team, opp)) return null;
  return teamWinPct(team, opp!, game);
}

function fbsTeams(): Team[] {
  return TEAMS.filter((t) => t.div === "FBS");
}

function optimizeMaxSurvivalProb(
  slots: OptimizerSlot[],
  weeksByKey: Map<string, SurvivorWeek>,
  candidateTeams: Team[],
  mcResults: TeamSimResult[] | null
): OptimizerResult {
  const scores = new Map<string, Map<string, number>>();
  const winProbs = new Map<string, Map<string, number>>();

  function slotKey(s: OptimizerSlot) {
    return `${s.weekKey}:${s.slotIndex}`;
  }

  for (const slot of slots) {
    const week = weeksByKey.get(slot.weekKey)!;
    const teamScores = new Map<string, number>();
    const teamProbs = new Map<string, number>();
    for (const team of candidateTeams) {
      const p = estimateWinProb(team, week, mcResults);
      if (p != null && p > 0) {
        teamScores.set(team.team, Math.log(p));
        teamProbs.set(team.team, p);
      }
    }
    scores.set(slotKey(slot), teamScores);
    winProbs.set(slotKey(slot), teamProbs);
  }

  function flexibilityMargin(slot: OptimizerSlot): number {
    const teamScores = Array.from(scores.get(slotKey(slot))!.values()).sort((a, b) => b - a);
    if (teamScores.length <= 1) return Infinity;
    return teamScores[0] - teamScores[1];
  }

  const orderedSlots = [...slots].sort((a, b) => flexibilityMargin(a) - flexibilityMargin(b));
  const used = new Set<string>();
  const assignment = new Map<string, string | null>();

  function siblingSlotKey(s: OptimizerSlot): string {
    return slotKey({ weekKey: s.weekKey, slotIndex: s.slotIndex === 0 ? 1 : 0 });
  }

  for (const slot of orderedSlots) {
    const teamScores = scores.get(slotKey(slot))!;
    const week = weeksByKey.get(slot.weekKey)!;
    const siblingTeam = assignment.get(siblingSlotKey(slot)) ?? null;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [team, score] of teamScores) {
      if (used.has(team)) continue;
      if (siblingTeam && areOpponentsThisWeek(team, siblingTeam, week)) continue;
      if (score > bestScore) {
        bestScore = score;
        best = team;
      }
    }
    assignment.set(slotKey(slot), best);
    if (best) used.add(best);
  }

  let improved = true;
  let iterations = 0;
  while (improved && iterations < 500) {
    improved = false;
    iterations++;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const slotA = slots[i];
        const slotB = slots[j];
        const keyA = slotKey(slotA);
        const keyB = slotKey(slotB);
        const teamA = assignment.get(keyA) ?? null;
        const teamB = assignment.get(keyB) ?? null;
        if (teamA === teamB) continue;

        const siblingOfA = assignment.get(siblingSlotKey(slotA)) ?? null;
        const siblingOfB = assignment.get(siblingSlotKey(slotB)) ?? null;
        if (teamB && siblingOfA && siblingOfA !== teamA && areOpponentsThisWeek(teamB, siblingOfA, weeksByKey.get(slotA.weekKey)!)) continue;
        if (teamA && siblingOfB && siblingOfB !== teamB && areOpponentsThisWeek(teamA, siblingOfB, weeksByKey.get(slotB.weekKey)!)) continue;

        const scoreA_now = teamA ? scores.get(keyA)!.get(teamA) ?? -Infinity : 0;
        const scoreB_now = teamB ? scores.get(keyB)!.get(teamB) ?? -Infinity : 0;
        const scoreA_swapped = teamB ? scores.get(keyA)!.get(teamB) ?? -Infinity : 0;
        const scoreB_swapped = teamA ? scores.get(keyB)!.get(teamA) ?? -Infinity : 0;

        if (scoreA_swapped + scoreB_swapped > scoreA_now + scoreB_now + 1e-9) {
          assignment.set(keyA, teamB);
          assignment.set(keyB, teamA);
          improved = true;
        }
      }
    }
  }

  const picks: OptimizerPick[] = slots.map((slot) => {
    const team = assignment.get(slotKey(slot)) ?? null;
    const winProb = team ? winProbs.get(slotKey(slot))!.get(team) ?? null : null;
    return { weekKey: slot.weekKey, slotIndex: slot.slotIndex, team, winProb };
  });

  const validProbs = picks.map((p) => p.winProb).filter((p): p is number => p != null);
  const survivalProb = validProbs.length === picks.length && picks.length > 0 ? validProbs.reduce((a, b) => a * b, 1) : null;

  return { objective: "maxSurvivalProb", picks, survivalProb, expectedWeeksAdded: null };
}

function optimizeMaxExpectedWeeks(
  slots: OptimizerSlot[],
  weeksByKey: Map<string, SurvivorWeek>,
  candidateTeams: Team[],
  mcResults: TeamSimResult[] | null
): OptimizerResult {
  const weekOrder = Array.from(new Set(slots.map((s) => s.weekKey))).sort(
    (a, b) => weeksByKey.get(a)!.dataWeek - weeksByKey.get(b)!.dataWeek
  );

  const probByTeamWeek = new Map<string, Map<string, number>>();
  for (const team of candidateTeams) {
    const byWeek = new Map<string, number>();
    for (const weekKey of weekOrder) {
      const p = estimateWinProb(team, weeksByKey.get(weekKey)!, mcResults);
      if (p != null && p > 0) byWeek.set(weekKey, p);
    }
    probByTeamWeek.set(team.team, byWeek);
  }

  const used = new Set<string>();
  const assignment = new Map<string, string | null>();
  let survivalSoFar = 1;
  let expectedWeeksAdded = 0;

  for (const weekKey of weekOrder) {
    const remainingWeeks = weekOrder.slice(weekOrder.indexOf(weekKey) + 1);

    function bestFutureProb(team: string): number {
      const byWeek = probByTeamWeek.get(team)!;
      let best = 0;
      for (const w of remainingWeeks) {
        const p = byWeek.get(w);
        if (p != null && p > best) best = p;
      }
      return best;
    }

    const candidates = candidateTeams
      .filter((t) => !used.has(t.team))
      .map((t) => {
        const p = probByTeamWeek.get(t.team)!.get(weekKey);
        if (p == null) return null;
        const regret = Math.max(0, bestFutureProb(t.team) - p);
        return { team: t.team, prob: p, value: p - regret };
      })
      .filter((c): c is { team: string; prob: number; value: number } => c != null)
      .sort((a, b) => b.value - a.value);

    const week = weeksByKey.get(weekKey)!;
    const first = candidates[0] ?? null;
    const second = first ? candidates.slice(1).find((c) => !areOpponentsThisWeek(c.team, first.team, week)) ?? null : null;
    const chosen = [first, second].filter((c): c is { team: string; prob: number; value: number } => c != null);
    for (let i = 0; i < 2; i++) {
      const c = chosen[i];
      assignment.set(`${weekKey}:${i}`, c ? c.team : null);
      if (c) used.add(c.team);
    }

    const weekCombinedProb = chosen.length === 2 ? chosen[0].prob * chosen[1].prob : 0;
    expectedWeeksAdded += survivalSoFar * weekCombinedProb;
    survivalSoFar *= weekCombinedProb;
  }

  const picks: OptimizerPick[] = slots.map((slot) => {
    const team = assignment.get(`${slot.weekKey}:${slot.slotIndex}`) ?? null;
    const winProb = team ? probByTeamWeek.get(team)!.get(slot.weekKey) ?? null : null;
    return { weekKey: slot.weekKey, slotIndex: slot.slotIndex, team, winProb };
  });

  return { objective: "maxExpectedWeeks", picks, survivalProb: survivalSoFar, expectedWeeksAdded };
}

/**
 * Entry point. Only optimizes weeks that don't already have 2 saved
 * picks, same "locked weeks are fixed" rule as the original tool.
 * candidateTeams is every FBS team (no conference filter — that's the
 * whole point of this tool) minus whatever's already used or on the
 * don't-use list.
 */
export function optimizeSurvivorPath(
  currentPicks: Record<string, string[]>,
  objective: SurvivorObjective,
  mcResults: TeamSimResult[] | null,
  excludedTeams: Set<string> = new Set()
): OptimizerResult {
  const lockedWeekKeys = new Set(SURVIVOR_WEEKS.filter((w) => (currentPicks[w.key] || []).length === 2).map((w) => w.key));
  const usedTeams = new Set(Object.values(currentPicks).flat());

  const unlockedWeeks = SURVIVOR_WEEKS.filter((w) => !lockedWeekKeys.has(w.key));
  const weeksByKey = new Map(SURVIVOR_WEEKS.map((w) => [w.key, w]));
  const slots: OptimizerSlot[] = unlockedWeeks.flatMap((w) => [
    { weekKey: w.key, slotIndex: 0 as const },
    { weekKey: w.key, slotIndex: 1 as const },
  ]);
  const candidateTeams = fbsTeams().filter((t) => !usedTeams.has(t.team) && !excludedTeams.has(t.team));

  if (objective === "maxExpectedWeeks") {
    return optimizeMaxExpectedWeeks(slots, weeksByKey, candidateTeams, mcResults);
  }
  return optimizeMaxSurvivalProb(slots, weeksByKey, candidateTeams, mcResults);
}
