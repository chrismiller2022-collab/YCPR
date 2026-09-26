// Key numbers that matter for the pool "through a key number" flag. Lines
// are compared in the away-team perspective (negative = away favored), so
// both +/- sides of each number count.
const KEYS = [3, 7];

/**
 * Key numbers that sit between my projected line and the pool line —
 * i.e. my number is on one side of the key and the pool's is on the other
 * (mine -2.5 vs pool +3.5 crosses both -3 and +3). Landing exactly
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
