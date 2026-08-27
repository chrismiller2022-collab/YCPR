import { TEAMS, type Team } from "../data/teams";
import { SURVIVOR_WEEKS, type SurvivorWeek, gameForTeamInWeek, opponentOf, teamWinPct } from "./survivor";
import type { TeamSimResult } from "./montecarlo/engine";

export type SurvivorObjective = "maxSurvivalProb" | "maxExpectedWeeks";

export interface OptimizerSlot {
  weekKey: string;
  slotIndex: 0 | 1;
}

export interface OptimizerPick {
  weekKey: string;
  slotIndex: 0 | 1;
  team: string | null; // null = no eligible team found for this slot
  winProb: number | null;
}

export interface OptimizerResult {
  objective: SurvivorObjective;
  picks: OptimizerPick[];
  survivalProb: number | null; // product of all assigned win probs, through the optimized weeks only
  expectedWeeksAdded: number | null; // sum of prefix products across the optimized weeks
}

/**
 * A team's estimated win probability for a given week. Real weeks use
 * teamWinPct() (Bill R) against that week's actual scheduled opponent.
 * Conference Championship week has no scheduled matchups yet (no
 * opponent is known until the season plays out) — confTitlePct already
 * folds in both "makes the title game" and "wins it," so it's exactly
 * the right stand-in probability for a survivor pick that week, not an
 * approximation requiring further derivation.
 */
export function estimateWinProb(team: Team, week: SurvivorWeek, mcResults: TeamSimResult[] | null): number | null {
  if (week.key === "champ") {
    const mc = mcResults?.find((r) => r.team === team.team);
    return mc ? mc.confTitlePct / 100 : null;
  }
  const game = gameForTeamInWeek(team.team, week.dataWeek);
  if (!game) return null; // bye — not eligible this week
  const opp = opponentOf(game, team.team);
  if (!opp) return null;
  return teamWinPct(team, opp, game);
}

function fbsTeams(): Team[] {
  return TEAMS.filter((t) => t.div === "FBS");
}

/**
 * Maximize probability of surviving every remaining week — the standard
 * survivor-optimizer formulation (see e.g. the ILP approach in
 * maxliving/nfl-survivor's writeup): maximizing the PRODUCT of weekly
 * win probabilities is equivalent to maximizing the SUM of their logs,
 * turning this into a weighted bipartite matching problem (slots x
 * teams, one team per slot, each team used at most once). Solved here
 * via a "least flexibility first" greedy construction (assign the most
 * constrained slots — those with the smallest gap between their best
 * and second-best option — before they lose their good options to other
 * slots) followed by pairwise-swap local search (2-opt) until no swap
 * improves the total. This is a strong heuristic, not a certified exact
 * solver (a real Hungarian-algorithm/ILP implementation would guarantee
 * the global optimum) — in practice it converges to the same or a
 * near-identical answer for problems this size (a few dozen slots).
 */
function optimizeMaxSurvivalProb(
  slots: OptimizerSlot[],
  weeksByKey: Map<string, SurvivorWeek>,
  candidateTeams: Team[],
  mcResults: TeamSimResult[] | null
): OptimizerResult {
  const scores = new Map<string, Map<string, number>>(); // slotKey -> team -> log(winProb)
  const winProbs = new Map<string, Map<string, number>>(); // slotKey -> team -> raw winProb

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

  for (const slot of orderedSlots) {
    const teamScores = scores.get(slotKey(slot))!;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [team, score] of teamScores) {
      if (used.has(team)) continue;
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
        const keyA = slotKey(slots[i]);
        const keyB = slotKey(slots[j]);
        const teamA = assignment.get(keyA) ?? null;
        const teamB = assignment.get(keyB) ?? null;
        if (teamA === teamB) continue;

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

/**
 * Maximize expected number of week-slots survived, rather than
 * probability of clearing every remaining week. These are genuinely
 * different objectives: expected weeks survived is the sum of prefix
 * products of the chosen probabilities in whatever order they're
 * played, and — since a fixed multiset of probabilities maximizes that
 * sum when sorted highest-first — the exact optimum trades off which
 * TEAM goes in which WEEK against preserving each team's best slot.
 * That's a genuinely harder combinatorial problem (order and assignment
 * are coupled) than the survival-probability case, and isn't solved
 * exactly here — this is a greedy, week-by-week heuristic: at each
 * remaining week (processed in chronological order), for each
 * candidate team compute a "regret" penalty (how much better that
 * team's single best remaining week is than using it right now), and
 * pick the pair minimizing total regret while maximizing this week's
 * own combined win probability. In practice this tends toward "use
 * your standout teams as soon as they're clearly their own best fit for
 * a week," which is the commonly recommended real-world approach, but
 * it is an approximation, not a certified optimum.
 */
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

    const chosen = candidates.slice(0, 2);
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
 * picks — locked weeks (and the teams used in them) are treated as
 * fixed and excluded from the candidate pool, per Chris: "if it's week
 * one but I've saved picks for weeks 1 and 2, optimize going forward."
 */
export function optimizeSurvivorPath(
  currentPicks: Record<string, string[]>,
  objective: SurvivorObjective,
  mcResults: TeamSimResult[] | null
): OptimizerResult {
  const lockedWeekKeys = new Set(SURVIVOR_WEEKS.filter((w) => (currentPicks[w.key] || []).length === 2).map((w) => w.key));
  const usedTeams = new Set(Object.values(currentPicks).flat());

  const unlockedWeeks = SURVIVOR_WEEKS.filter((w) => !lockedWeekKeys.has(w.key));
  const weeksByKey = new Map(SURVIVOR_WEEKS.map((w) => [w.key, w]));
  const slots: OptimizerSlot[] = unlockedWeeks.flatMap((w) => [
    { weekKey: w.key, slotIndex: 0 as const },
    { weekKey: w.key, slotIndex: 1 as const },
  ]);
  const candidateTeams = fbsTeams().filter((t) => !usedTeams.has(t.team));

  if (objective === "maxExpectedWeeks") {
    return optimizeMaxExpectedWeeks(slots, weeksByKey, candidateTeams, mcResults);
  }
  return optimizeMaxSurvivalProb(slots, weeksByKey, candidateTeams, mcResults);
}
