// "Win Total PR": a power rating built from the preseason win-total market.
//
//  1. Price "hold" for each side (points of price worse than -110, with the +/-
//     gap across even money counted as 200):
//        hold(p) = p > 0 ? (-110 - p) + 200 : -110 - p
//     e.g. over -160 -> 50, under -120 -> 10. (Over minus under = the sheet's
//     "Hold" column, 40.)
//  2. Each side's implied line, shifted half a win per PRICE_POINTS_PER_HALF_WIN
//     points of hold — over up, under down:
//        overLine  = line + hold(over)  / 50 * 0.5     (9.5 -> 10.00)
//        underLine = line - hold(under) / 50 * 0.5     (9.5 ->  9.40)
//  3. No-vig line = the median (midpoint) of the two (-> 9.70).
//  4. Avg win % = no-vig line / games scheduled, floored at 0.
//  5. Over every FBS team: min, median, max of that avg win %, then
//        PR = -( x <= med ? (x - med) / (med - min) * 25 : (x - med) / (max - med) * 25 )
//     so the best team is -25, the median 0 and the worst +25 (negative = better,
//     like every other rating on the site).
//  6. SOS adjustment: adj = PR_WEIGHT * PR + SOS_WEIGHT * SOS blend (SOS blend is
//     -10 hardest .. +10 easiest, so a harder schedule pulls PR better), then
//     min-max rescaled so the best team is -25 and the worst +25.

/** Price points that equal half a win (so 100 points = one win). Taken from the sheet's 50/50 and 10/50 terms. */
export const PRICE_POINTS_PER_HALF_WIN = 50;
export const DEFAULT_PR_WEIGHT = 0.9;
export const DEFAULT_SOS_WEIGHT = 0.6;

export function priceHold(price: number): number {
  return price > 0 ? -110 - price + 200 : -110 - price;
}

export interface WinTotalInput {
  team: string;
  line: number;
  overPrice: number;
  underPrice: number;
  games: number | null; // games on the schedule
  sos: number | null; // latest SOS blend
  isFbs: boolean;
}

export interface WinTotalPrRow extends WinTotalInput {
  overHold: number;
  underHold: number;
  hold: number; // over hold - under hold
  overLine: number;
  underLine: number;
  noVigLine: number;
  avgWinPct: number | null;
  pr: number | null; // Win Total PR, -25 best .. +25 worst (FBS only)
  adjusted: number | null; // PR_WEIGHT * pr + SOS_WEIGHT * sos
  prSos: number | null; // adjusted, rescaled to -25 .. +25
}

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function computeWinTotalPr(inputs: WinTotalInput[], prWeight = DEFAULT_PR_WEIGHT, sosWeight = DEFAULT_SOS_WEIGHT): WinTotalPrRow[] {
  const rows: WinTotalPrRow[] = inputs.map((i) => {
    const overHold = priceHold(i.overPrice);
    const underHold = priceHold(i.underPrice);
    const overLine = i.line + (overHold / PRICE_POINTS_PER_HALF_WIN) * 0.5;
    const underLine = i.line - (underHold / PRICE_POINTS_PER_HALF_WIN) * 0.5;
    const noVigLine = (overLine + underLine) / 2;
    const avgWinPct = i.games != null && i.games > 0 ? Math.max(0, noVigLine / i.games) : null;
    return { ...i, overHold, underHold, hold: overHold - underHold, overLine, underLine, noVigLine, avgWinPct, pr: null, adjusted: null, prSos: null };
  });

  const pool = rows.filter((r) => r.isFbs && r.avgWinPct != null).map((r) => r.avgWinPct as number).sort((a, b) => a - b);
  if (pool.length >= 3) {
    const min = pool[0];
    const max = pool[pool.length - 1];
    const med = median(pool);
    for (const r of rows) {
      if (!r.isFbs || r.avgWinPct == null) continue;
      const x = r.avgWinPct;
      const raw = x <= med ? (med - min === 0 ? 0 : ((x - med) / (med - min)) * 25) : max - med === 0 ? 0 : ((x - med) / (max - med)) * 25;
      r.pr = -raw || 0; // avoid -0
    }
    const withSos = rows.filter((r) => r.pr != null && r.sos != null);
    for (const r of withSos) r.adjusted = prWeight * (r.pr as number) + sosWeight * (r.sos as number);
    if (withSos.length >= 2) {
      const adj = withSos.map((r) => r.adjusted as number);
      const lo = Math.min(...adj);
      const hi = Math.max(...adj);
      for (const r of withSos) r.prSos = hi === lo ? 0 : -25 + (((r.adjusted as number) - lo) / (hi - lo)) * 50;
    }
  }
  return rows;
}
