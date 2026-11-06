// Standardized YC history: for every saved week, YC as the standardized build
// rates it (that week's rating systems as standard deviations from the FBS
// average, current weights × points per SD). Saved in weekly_power_ratings as
// system_key "yc_std" — its own key, so the ratings as rated are never touched.
//
// - Save As Week writes yc_std alongside everything else from now on.
// - computeStdHistory + saveStdHistory (Rating Systems → Performance & Weights
//   → Rebuild standardized history) fills / refreshes every saved week, e.g.
//   after a weight change.
// - Bet History / Moneyline History read only the saved yc_std rows (a few
//   thousand), so they load fast and don't recompute anything.
//
// Only seasons with saved rating-system snapshots can be standardized (2026
// onward); older seasons have no per-system history to rebuild from.

import { useEffect, useState } from "react";
import { fetchRatingWeights, fetchSavedRatingsAtOrBefore, fetchStdHistory, fetchWeeklyPowerRatings } from "./api/ratingSystems";
import { buildRatingsByTeam } from "./multiRatingMatchups";
import { liveStdMultiplier } from "./ratingSystems";
import { standardizeWeek } from "./ratingStandardize";
import { TEAMS_BY_NAME } from "../data/teams";

export const STD_HISTORY_KEY = "yc_std";

export type RatingMethod = "asRated" | "standardized";

export interface StandardizedYcResult {
  /** week -> team -> standardized YC (points, site sign convention). */
  byWeek: Map<number, Record<string, number>>;
}

// ---------------------------------------------------------------------
// Reading the saved history (what the bet-history pages use).
// ---------------------------------------------------------------------
const cache = new Map<number, Promise<StandardizedYcResult>>();

export function loadStandardizedYcByWeek(season: number): Promise<StandardizedYcResult> {
  let p = cache.get(season);
  if (!p) {
    p = fetchStdHistory(season).then((rows) => {
      const byWeek = new Map<number, Record<string, number>>();
      for (const r of rows) (byWeek.get(r.week) ?? byWeek.set(r.week, {}).get(r.week)!)[r.team] = r.value;
      return { byWeek };
    });
    p.catch(() => cache.delete(season));
    cache.set(season, p);
  }
  return p;
}

/** Forget the cached history (after a rebuild) so the next read fetches the new values. */
export function clearStandardizedYcCache(season?: number) {
  if (season == null) cache.clear();
  else cache.delete(season);
}

// ---------------------------------------------------------------------
// Building it (Rebuild standardized history).
// ---------------------------------------------------------------------
export interface StdHistoryRow {
  week: number;
  team: string;
  division: string | null;
  conference: string | null;
  value: number;
}

/** Standardized YC for every saved week of `season`, from the saved rating systems and the current weights. */
export async function computeStdHistory(season: number): Promise<{ rows: StdHistoryRow[]; weeks: number[]; multiplier: number }> {
  const [snapshots, weights] = await Promise.all([fetchWeeklyPowerRatings(season), fetchRatingWeights()]);
  const multiplier = liveStdMultiplier(weights);
  const byWeekRows = new Map<number, typeof snapshots>();
  for (const r of snapshots) {
    if (r.system_key === STD_HISTORY_KEY) continue; // never feed the history back into itself
    (byWeekRows.get(r.week) ?? byWeekRows.set(r.week, []).get(r.week)!).push(r);
  }
  const rows: StdHistoryRow[] = [];
  for (const [week, wkRows] of byWeekRows) {
    const std = standardizeWeek(buildRatingsByTeam(wkRows), { multiplier, weights }).byTeam;
    for (const [team, vals] of Object.entries(std)) {
      if (vals.yc == null) continue;
      const t = TEAMS_BY_NAME[team];
      rows.push({ week, team, division: t?.div ?? null, conference: t?.conf ?? null, value: Math.round(vals.yc * 100) / 100 });
    }
  }
  return { rows, weeks: Array.from(byWeekRows.keys()).sort((a, b) => a - b), multiplier };
}

// ---------------------------------------------------------------------
// Applying it to week-accurate ratings.
// ---------------------------------------------------------------------

/** The standardized snapshot that applies to a game in `week`: that week's own, else the latest earlier one. */
export function stdSnapshotFor(byWeek: Map<number, Record<string, number>>, week: number): Record<string, number> | null {
  let best: number | null = null;
  for (const w of byWeek.keys()) if (w <= week && (best == null || w > best)) best = w;
  return best == null ? null : byWeek.get(best) ?? null;
}

/**
 * Week-accurate ratings (week -> team -> { rating, hfa, ... }) with each team's
 * `rating` replaced by its saved standardized YC for that week. Everything else
 * on the row (HFA etc.) is kept. A team with no saved value keeps its as-rated
 * number; weeks with no saved history at or before them are unchanged.
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

/** Loads the saved standardized history for `season` when `enabled` (no fetch otherwise). */
export function useStandardizedYc(season: number, enabled: boolean) {
  const [data, setData] = useState<StandardizedYcResult | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadStandardizedYcByWeek(season)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load the standardized history"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, enabled]);
  return { data: enabled ? data : null, loading: enabled && loading, error };
}

// ---------------------------------------------------------------------
// Standardized per-system snapshot, for the rating-system charts (matchup
// popup scatter, pool report system lines): every system's saved value for
// the week as SDs from its FBS average × points per SD, so they're all on
// the same scale as the standardized YC.
// ---------------------------------------------------------------------
let weightsPromise: Promise<Record<string, number>> | null = null;
function cachedWeights() {
  if (!weightsPromise) {
    weightsPromise = fetchRatingWeights();
    weightsPromise.catch(() => (weightsPromise = null));
  }
  return weightsPromise;
}

/** The saved snapshot for `week` (or the latest earlier one), standardized. */
export async function fetchStandardizedSnapshotAtOrBefore(
  season: number,
  week: number
): Promise<{ week: number | null; byTeam: Record<string, Record<string, number>> }> {
  const [{ week: usedWeek, rows }, weights] = await Promise.all([fetchSavedRatingsAtOrBefore(season, week), cachedWeights()]);
  if (usedWeek == null) return { week: null, byTeam: {} };
  const byTeam = buildRatingsByTeam(rows.filter((r) => r.system_key !== STD_HISTORY_KEY));
  return { week: usedWeek, byTeam: standardizeWeek(byTeam, { multiplier: liveStdMultiplier(weights), weights }).byTeam };
}
