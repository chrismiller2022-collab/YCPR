// Shared win-% color scale and sample-size rule for the performance tables and
// charts (Totals History, Period Grading, ...).
//
// -110 breakeven is 52.38%: at that win rate a bet neither makes nor loses
// money, so it's the yellow midpoint. Above it fades to green, below it to red,
// reaching the full colors about 7.6 points away (60% / 44.8%).

/** Win rate at standard -110 odds where a bet breaks even. */
export const BREAKEVEN_WIN_PCT = 0.5238;
/** Buckets with fewer decided bets than this are shown muted with a small-sample tag. */
export const MIN_RELIABLE_SAMPLE = 30;

const RED = [224, 122, 122];
const YELLOW = [232, 200, 74];
const GREEN = [143, 211, 154];

function lerp(a: number[], b: number[], t: number): string {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

/** Color for a win fraction (0..1); null when there's nothing to color. */
export function winPctColor(p: number | null | undefined): string | undefined {
  if (p == null || Number.isNaN(p)) return undefined;
  const t = Math.max(-1, Math.min(1, (p - BREAKEVEN_WIN_PCT) / 0.0762));
  return t >= 0 ? lerp(YELLOW, GREEN, t) : lerp(YELLOW, RED, -t);
}

export function isSmallSample(decidedBets: number): boolean {
  return decidedBets < MIN_RELIABLE_SAMPLE;
}
