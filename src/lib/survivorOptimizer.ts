import type { SurvivorWeek } from "./survivor";

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
 * What the optimizer needs to know about the board, so it works for both Survivor and Splash rules and for whichever
 * projection (YC or Vegas) the page is showing. `winProb` returns null when a team can't be picked that week (bye,
 * ineligible opponent); Conference Championship week returns each team's Monte Carlo conference-title odds.
 * `areOpponents` is a hard exclusion: two teams in the same game can't both win, so never pair them in one week.
 */
export interface OptimizerContext {
  winProb: (team: string, week: SurvivorWeek) => number | null;
  areOpponents: (teamA: string, teamB: string, week: SurvivorWeek) => boolean;
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
  candidateTeams: string[],
  ctx: OptimizerContext
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
      const p = ctx.winProb(team, week);
      if (p != null && p > 0) {
        teamScores.set(team, Math.log(p));
        teamProbs.set(team, p);
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
      // Can't pick two opponents as the same week's two picks — at most
      // one of them can win, so surviving that week would be impossible.
      if (siblingTeam && ctx.areOpponents(team, siblingTeam, week)) continue;
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

        // Reject a swap that would pit either slot's new team against its
        // own sibling in the same week — same reasoning as the greedy pass.
        const siblingOfA = assignment.get(siblingSlotKey(slotA)) ?? null;
        const siblingOfB = assignment.get(siblingSlotKey(slotB)) ?? null;
        if (teamB && siblingOfA && siblingOfA !== teamA && ctx.areOpponents(teamB, siblingOfA, weeksByKey.get(slotA.weekKey)!)) continue;
        if (teamA && siblingOfB && siblingOfB !== teamB && ctx.areOpponents(teamA, siblingOfB, weeksByKey.get(slotB.weekKey)!)) continue;

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
  candidateTeams: string[],
  ctx: OptimizerContext
): OptimizerResult {
  const weekOrder = Array.from(new Set(slots.map((s) => s.weekKey))).sort(
    (a, b) => weeksByKey.get(a)!.dataWeek - weeksByKey.get(b)!.dataWeek
  );

  const probByTeamWeek = new Map<string, Map<string, number>>();
  for (const team of candidateTeams) {
    const byWeek = new Map<string, number>();
    for (const weekKey of weekOrder) {
      const p = ctx.winProb(team, weeksByKey.get(weekKey)!);
      if (p != null && p > 0) byWeek.set(weekKey, p);
    }
    probByTeamWeek.set(team, byWeek);
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
      .filter((t) => !used.has(t))
      .map((t) => {
        const p = probByTeamWeek.get(t)!.get(weekKey);
        if (p == null) return null;
        const regret = Math.max(0, bestFutureProb(t) - p);
        return { team: t, prob: p, value: p - regret };
      })
      .filter((c): c is { team: string; prob: number; value: number } => c != null)
      .sort((a, b) => b.value - a.value);

    // Pick the top candidate, then the next-best candidate that isn't
    // that team's opponent this week — two opponents can't both win, so
    // pairing them would make surviving this week impossible no matter
    // how good either one looks individually.
    const week = weeksByKey.get(weekKey)!;
    const first = candidates[0] ?? null;
    const second = first ? candidates.slice(1).find((c) => !ctx.areOpponents(c.team, first.team, week)) ?? null : null;
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
 * Entry point. Optimizes `weeks` (the caller passes only weeks still open: not yet played and without 2 picks), with
 * every team already picked anywhere taken off the board. `candidateTeams` is the caller's eligible row list minus the
 * don't-use list.
 */
export function optimizeSurvivorPath(
  currentPicks: Record<string, string[]>,
  objective: SurvivorObjective,
  weeks: SurvivorWeek[],
  candidateTeams: string[],
  ctx: OptimizerContext
): OptimizerResult {
  const usedTeams = new Set(Object.values(currentPicks).flat());
  const weeksByKey = new Map(weeks.map((w) => [w.key, w]));
  const slots: OptimizerSlot[] = weeks.flatMap((w) => [
    { weekKey: w.key, slotIndex: 0 as const },
    { weekKey: w.key, slotIndex: 1 as const },
  ]);
  const candidates = candidateTeams.filter((t) => !usedTeams.has(t));
  if (objective === "maxExpectedWeeks") return optimizeMaxExpectedWeeks(slots, weeksByKey, candidates, ctx);
  return optimizeMaxSurvivalProb(slots, weeksByKey, candidates, ctx);
}
