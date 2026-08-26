/**
 * Tiny in-memory request cache/dedupe layer — module-level, so it lives
 * for as long as the page tab is open (not across a hard reload) and is
 * shared by every caller regardless of which component triggered the
 * fetch first.
 *
 * Exists specifically to cut Supabase egress: fetchGamesWithLines,
 * fetchTeamSeasonInputs, and fetchGamesForTotals are each called
 * independently by a dozen-plus pages/components for the same season,
 * with no caching — navigating Totals -> Predictions -> Team page ->
 * back to Totals re-pulled the identical rows from Supabase every time.
 *
 * Caches the in-flight PROMISE, not just the resolved value, so
 * concurrent callers within the TTL window (e.g. two components mounting
 * on the same page load) share one request instead of firing N
 * duplicate ones.
 */
interface CacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

export function cachedFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs = 5 * 60 * 1000): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = fetcher().catch((err) => {
    cache.delete(key); // don't cache a failure — the next call should retry cleanly
    throw err;
  });
  cache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}

/**
 * Clear every cached fetch. Call this after any admin write that touches
 * games/betting_lines/team_season_stats (CFBD sync, CSV import) so the
 * next read reflects what was just written instead of serving a stale
 * cached response for up to the TTL window.
 */
export function invalidateCache(): void {
  cache.clear();
}

/**
 * Clear one cached key (or every key starting with a prefix, when
 * `prefix` is true) — for a manual "Refresh" button that should force a
 * fresh fetch of just its own data without evicting everything else
 * currently cached (e.g. the season's games/lines a different tab is
 * mid-render with).
 */
export function invalidateCacheKey(key: string, prefix = false): void {
  if (!prefix) {
    cache.delete(key);
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(key)) cache.delete(k);
  }
}
