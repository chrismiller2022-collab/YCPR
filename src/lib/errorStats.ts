// Shared by both Matchups pages (live current-season data) and Bet
// History (multi-year historical data) — same error-metric math, one
// place, so the two can never quietly drift apart on the formula.

export interface ErrorStatsSide {
  absError: number | null;
  medianAbsError: number | null;
  mse: number | null;
  n: number;
}

export interface ErrorStatsBundle {
  yc: ErrorStatsSide;
  vegas: ErrorStatsSide;
  absErrorOverVegasYc: number | null; // negative = YC's error is lower (better) than Vegas's
  mseOverVegasYc: number | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function summarizeErrors(errors: number[]): ErrorStatsSide {
  if (errors.length === 0) return { absError: null, medianAbsError: null, mse: null, n: 0 };
  const abs = errors.map((e) => Math.abs(e));
  const sq = errors.map((e) => e * e);
  return {
    absError: abs.reduce((s, v) => s + v, 0) / abs.length,
    medianAbsError: median(abs),
    mse: sq.reduce((s, v) => s + v, 0) / sq.length,
    n: errors.length,
  };
}

export function bundleErrors(ycErrors: number[], vegasErrors: number[]): ErrorStatsBundle {
  const yc = summarizeErrors(ycErrors);
  const vegas = summarizeErrors(vegasErrors);
  return {
    yc,
    vegas,
    absErrorOverVegasYc: yc.absError != null && vegas.absError != null ? yc.absError - vegas.absError : null,
    mseOverVegasYc: yc.mse != null && vegas.mse != null ? yc.mse - vegas.mse : null,
  };
}
