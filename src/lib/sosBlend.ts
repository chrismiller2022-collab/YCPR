// SOS blend — same normalize-then-weight pattern as resumeRating.ts's
// conglomerate score, applied to the site's several different "how hard
// is this schedule" numbers instead of resume-quality metrics. The one
// real difference: every SOS factor here happens to share the same
// direction (a higher raw value always means an EASIER schedule — see
// each factor's own comment below), so there's no per-factor
// higherIsBetter flag to get wrong, and normalization targets a
// -10..+10 scale (matching the site's signed rating convention: negative
// = tougher, positive = easier) instead of Resume's 1-10.

export interface RawSosFactors {
  // Average power rating of every opponent on the schedule (site
  // convention: negative = better team), sourced from the Rating
  // Systems conglomerate ("YC") — lower/more negative = tougher slate.
  avgOppPR: number | null;
  // Same idea, averaged across many Monte Carlo simulated-season
  // realizations instead of one static snapshot — see sos.ts's
  // computeAveragedSrsSos. Same sign convention as avgOppPR.
  sosSrs: number | null;
  // How many games a hypothetical #12-power-rated FBS team would win
  // playing this team's actual schedule — MORE hypothetical wins means
  // an EASIER schedule (a weak slate lets even a mediocre team pile up
  // wins), so this factor runs the opposite raw direction from the two
  // above (higher raw = easier) even though it normalizes the same way.
  hypoWins: number | null;
  // Average power rating of the 7 toughest opponents on the schedule
  // (credit: John Harris, @jhnhrris). Same sign convention as avgOppPR.
  top7: number | null;
}

export const SOS_FACTOR_KEYS: (keyof RawSosFactors)[] = ["avgOppPR", "sosSrs", "hypoWins", "top7"];

export const SOS_FACTOR_LABELS: Record<keyof RawSosFactors, string> = {
  avgOppPR: "Avg Opp PR",
  sosSrs: "SOS (SRS)",
  hypoWins: "Hypo #12 Wins",
  top7: "Top 7 Avg PR",
};

// true = a HIGHER raw value means an EASIER schedule (so it should
// normalize toward +10); false = a higher raw value means HARDER
// (normalize toward -10). avgOppPR/sosSrs/top7 are all "more negative
// opponent rating = tougher" (this site's usual convention), so a
// higher (less negative) value there is easier. hypoWins is easier at
// the high end too (more hypothetical wins = weaker schedule) — every
// current factor happens to agree, but this stays explicit per-factor
// rather than assumed, the same way resumeRating.ts's
// METRIC_HIGHER_IS_BETTER does, in case a future factor disagrees.
export const SOS_FACTOR_HIGHER_IS_EASIER: Record<keyof RawSosFactors, boolean> = {
  avgOppPR: true,
  sosSrs: true,
  hypoWins: true,
  top7: true,
};

/**
 * Min-max normalize a raw SOS factor to -10 (hardest in the pool)..+10
 * (easiest in the pool), direction-aware. Same shape as resumeRating.ts's
 * normalize(), just a different target range/midpoint (0 instead of
 * 5.5, since SOS already has a natural signed zero-ish center rather
 * than Resume's all-positive 1-10 scale).
 */
export function normalizeSosFactor(value: number | null, allValues: (number | null)[], higherIsEasier: boolean): number | null {
  if (value == null) return null;
  const valid = allValues.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) return 0;
  const pct = (value - min) / (max - min); // 0 = hardest-in-pool's raw value, 1 = easiest-in-pool's
  const directed = higherIsEasier ? pct : 1 - pct;
  return -10 + directed * 20;
}

export type SosWeights = Record<string, number>;

export const DEFAULT_SOS_WEIGHTS: SosWeights = Object.fromEntries(SOS_FACTOR_KEYS.map((k) => [k, 1]));

/**
 * Weighted average of already-normalized (-10..+10) factors — stays on
 * that same -10..+10 scale (no ×10 rescale the way Resume's score does,
 * since SOS's normalized range is already the scale we want the blend
 * to read in). A factor with weight 0, or no normalized value for this
 * team, is excluded rather than counted as 0.
 */
export function computeSosBlendScore(normalizedFactors: Partial<Record<keyof RawSosFactors, number | null>>, weights: SosWeights): number | null {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of SOS_FACTOR_KEYS) {
    const norm = normalizedFactors[key];
    const w = weights[key] ?? 0;
    if (norm == null || w === 0) continue;
    weightedSum += norm * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return null;
  return weightedSum / weightTotal;
}
