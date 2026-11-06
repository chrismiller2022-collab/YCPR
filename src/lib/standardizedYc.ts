// Standardized YC by week, for backtesting pages that grade games from the
// week's power ratings (Bet History, Moneyline History). For each saved
// Rating Systems snapshot (weekly_power_ratings), YC is rebuilt from that
// week's systems as standard deviations from the FBS average, with the
// CURRENT weights and points-per-SD setting — i.e. "what the new method
// would have rated each team that week". Read-only: nothing is written.
//
// Only seasons with saved rating-system snapshots can be standardized
// (2026 onward); older seasons have no per-system history to rebuild from.

import { useEffect, useState } from "react";
import { fetchRatingWeights, fetchWeeklyPowerRatings } from "./api/ratingSystems";
import { buildRatingsByTeam } from "./multiRatingMatchups";
import { liveStdMultiplier } from "./ratingSystems";
import { standardizeWeek } from "./ratingStandardize";

export type RatingMethod = "asRated" | "standardized";

export interface StandardizedYcResult {
  /** week -> team -> standardized YC (points, site sign convention). */
  byWeek: Map<number, Record<string, number>>;
  multiplier: number;
}

// One load per season per page visit, shared across pages/toggles (the
// snapshot table is large: every system × team × week).
const cache = new Map<number, Promise<StandardizedYcResult>>();

export function loadStandardizedYcByWeek(season: number): Promise<StandardizedYcResult> {
  let p = cache.get(season);
  if (!p) {
    p = Promise.all([fetchWeeklyPowerRatings(season), fetchRatingWeights()]).then(([rows, weights]) => {
      const multiplier = liveStdMultiplier(weights);
      const byWeekRows = new Map<number, typeof rows>();
      for (const r of rows) (byWeekRows.get(r.week) ?? byWeekRows.set(r.week, []).get(r.week)!).push(r);
      const byWeek = new Map<number, Record<string, number>>();
      for (const [wk, wkRows] of byWeekRows) {
        const std = standardizeWeek(buildRatingsByTeam(wkRows), { multiplier, weights }).byTeam;
        const yc: Record<string, number> = {};
        for (const [team, vals] of Object.entries(std)) if (vals.yc != null) yc[team] = vals.yc;
        byWeek.set(wk, yc);
      }
      return { byWeek, multiplier };
    });
    p.catch(() => cache.delete(season)); // let a later toggle retry after a failed load
    cache.set(season, p);
  }
  return p;
}

/** The standardized-YC snapshot that applies to a game in `week`: that week's own, else the latest earlier one. */
export function stdSnapshotFor(byWeek: Map<number, Record<string, number>>, week: number): Record<string, number> | null {
  let best: number | null = null;
  for (const w of byWeek.keys()) if (w <= week && (best == null || w > best)) best = w;
  return best == null ? null : byWeek.get(best) ?? null;
}

/**
 * Week-accurate ratings (week -> team -> { rating, hfa, ... }) with each team's
 * `rating` replaced by its standardized YC for that week. Everything else on
 * the row (HFA etc.) is kept. A team the snapshot has no YC for keeps its
 * as-rated number. Weeks with no snapshot at or before them are unchanged.
 */
export function overlayStandardizedRatings<T extends Record<string, any>>(
  ratingsByWeek: Record<number, Record<string, T>>,
  std: StandardizedYcResult | null
): Record<number, Record<string, T>> {
  if (!std) return ratingsByWeek;
  const out: Record<number, Record<string, T>> = {};
  for (const [wkStr, teams] of Object.entries(ratingsByWeek)) {
    const wk = Number(wkStr);
    const snap = stdSnapshotFor(std.byWeek, wk);
    if (!snap) {
      out[wk] = teams;
      continue;
    }
    const next: Record<string, T> = { ...teams };
    for (const [team, yc] of Object.entries(snap)) next[team] = { ...(teams[team] ?? ({} as T)), rating: yc };
    out[wk] = next;
  }
  return out;
}

/** Loads the standardized YC for `season` when `enabled` (no fetch otherwise). */
export function useStandardizedYc(season: number, enabled: boolean) {
  const [data, setData] = useState<StandardizedYcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadStandardizedYcByWeek(season)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load rating snapshots"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, enabled]);
  return { data: enabled ? data : null, loading: enabled && loading, error };
}
