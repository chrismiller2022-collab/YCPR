// Key numbers that matter for the pool "through a key number" flag. Lines
// are compared in the away-team perspective (negative = away favored), so
// both +/- sides of each number count.
const KEYS = [3, 7];

/**
 * Key numbers that sit between my projected line and the pool line —
 * i.e. my number is on one side of the key and the pool's is on the other
 * (mine -2.5 vs pool +3.5 crosses +3 only; mine -3.5 vs +3.5 crosses -3 and +3). Landing exactly
 * on a key counts as having reached it. Returns e.g. [-3, 3]; empty when
 * either line is missing or the two don't straddle any key.
 */
export function keyNumbersBetween(mine: number | null, pool: number | null): number[] {
  if (mine == null || pool == null || mine === pool) return [];
  const lo = Math.min(mine, pool);
  const hi = Math.max(mine, pool);
  const out: number[] = [];
  for (const k of KEYS) {
    for (const key of [-k, k]) {
      if (lo <= key && key <= hi) out.push(key);
    }
  }
  return out.sort((a, b) => a - b);
}

export function keyCrossLabel(keys: number[]): string {
  return keys.map((k) => (k > 0 ? `+${k}` : `${k}`)).join(", ");
}

// ---------------------------------------------------------------------
// Totals: the Totals key-number tiers (Tier 1 = most common final-score
// sums). A key counts as crossed when my total is at or past it on one
// side and Vegas's is past it on the other, same straddle rule as the
// Totals Key Numbers study (my ≤ key < Vegas → Under; my ≥ key > Vegas → Over).
// ---------------------------------------------------------------------
export const TOTALS_KEY_TIERS: { label: string; keys: number[] }[] = [
  { label: "Tier 1 — Critical", keys: [55, 48, 58, 44, 51] },
  { label: "Tier 2 — High", keys: [41, 45, 65, 59, 52] },
  { label: "Tier 3 — Elevated", keys: [62, 69, 37, 47, 49] },
  { label: "Tier 4 — Moderate", keys: [61, 38, 66, 54, 63, 57, 34, 56, 43, 40] },
];

export function totalKeysBetween(mine: number | null, vegas: number | null, maxTier = 4): { key: number; tier: number }[] {
  if (mine == null || vegas == null) return [];
  const out: { key: number; tier: number }[] = [];
  TOTALS_KEY_TIERS.forEach((t, i) => {
    if (i + 1 > maxTier) return;
    for (const key of t.keys) {
      if ((mine <= key && vegas > key) || (mine >= key && vegas < key)) out.push({ key, tier: i + 1 });
    }
  });
  return out.sort((a, b) => a.key - b.key);
}
