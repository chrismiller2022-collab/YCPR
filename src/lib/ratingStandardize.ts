// Standardized ratings: every system's saved weekly value re-expressed as
// "standard deviations better/worse than the FBS average", then multiplied
// by one shared points-per-SD number (default 13.5).
//
// Why this needs no "unscaling": every rescale applied to a source on the
// way in (the min-max onto [-30, +55] for Elo/Massey/FEI/F+/Sagarin, sign
// flips, any linear rescale done in the Google Sheet) is a linear
// transform, and a z-score is unchanged by any positive linear transform.
// So z-scoring the stored value gives exactly the z-score of the source's
// own raw number — no need to go back and find the original.
//
// Details that matter:
// - The reference group is FBS teams only, every system, every week. Some
//   systems rate FCS and some don't; letting FCS into the SD would inflate
//   it for those systems only. FCS teams still get a value, measured
//   against the FBS mean/SD.
// - The center (mean, or median for the robust option) cancels out of
//   every spread (away − home), so only the scale actually moves a line.
// - A system-week whose FBS spread is ~0 (e.g. a sheet column saved as all
//   zeros) is treated as missing rather than divided by zero.
// - YC and Consensus are rebuilt from the standardized inputs using the
//   saved weights / Consensus membership, then re-standardized: averaging
//   imperfectly correlated z-scores shrinks the spread a little, and
//   without the re-standardize the composite would effectively get a
//   smaller multiplier than its own inputs.
// - Nothing here writes anything; it's a view over saved snapshots.

import { TEAMS_BY_NAME } from "../data/teams";
import { ALL_PULLED_SYSTEMS, CONSENSUS_INPUT_SYSTEMS, YC_INPUT_SYSTEMS, isInConsensus } from "./ratingSystems";

export type ScaleStat = "sd" | "mad";

export const DEFAULT_STD_MULTIPLIER = 13.5;

/** Extra keys (not in RATING_SYSTEMS) holding the stored YC / Consensus standardized directly, for isolating the pure scale effect from the rebuild. */
export const STORED_YC_KEY = "yc_stored";
export const STORED_CONSENSUS_KEY = "consensus_stored";
/** Keys holding YC / Consensus rebuilt from the RAW stored inputs with the current weights (the control for the rebuild). */
export const REBUILT_RAW_YC_KEY = "yc_rebuilt_raw";
export const REBUILT_RAW_CONSENSUS_KEY = "consensus_rebuilt_raw";

/**
 * YC and Consensus recomputed from one week's stored (unstandardized) system
 * values with the given weights — same math as computeConglomeratedTable.
 * Used as a control: it separates "current weights vs the weights in effect
 * that week" from "standardized vs raw inputs".
 */
export function rebuildRawComposites(
  byTeam: Record<string, Record<string, number>>,
  weights: Record<string, number>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [team, vals] of Object.entries(byTeam)) {
    const entry = { ...vals };
    const cons = CONSENSUS_INPUT_SYSTEMS.filter((key) => isInConsensus(key, weights))
      .map((key) => vals[key])
      .filter((v): v is number => v != null);
    const consensus = cons.length ? cons.reduce((s, v) => s + v, 0) / cons.length : null;
    if (consensus != null) entry[REBUILT_RAW_CONSENSUS_KEY] = consensus;
    let sw = 0;
    let sv = 0;
    for (const key of YC_INPUT_SYSTEMS) {
      const w = weights[key] ?? 0;
      if (w <= 0) continue;
      const v = key === "consensus" ? consensus : vals[key];
      if (v == null) continue;
      sw += w;
      sv += w * v;
    }
    if (sw > 0) entry[REBUILT_RAW_YC_KEY] = sv / sw;
    out[team] = entry;
  }
  return out;
}

export interface SystemWeekScale {
  /** FBS mean (sd) or median (mad) of the stored values. */
  center: number;
  /** FBS standard deviation (sd) or MAD × 1.4826 (mad) of the stored values — i.e. the system's current points per SD. */
  scale: number;
  /** FBS teams that went into it. */
  n: number;
}

export interface StandardizeOptions {
  /** Points per SD applied to every system. */
  multiplier: number;
  scaleStat?: ScaleStat;
  /** Saved rating_system_weights map (weights + `consensus:<key>` membership). Null = standardize the stored YC/Consensus directly instead of rebuilding them. */
  weights?: Record<string, number> | null;
}

export interface StandardizedWeek {
  /** team -> system_key -> standardized value (z × multiplier, same sign convention: negative = better). */
  byTeam: Record<string, Record<string, number>>;
  /** Scale used for each pulled system (null = missing / zero spread that week). */
  scales: Record<string, SystemWeekScale | null>;
}

const MIN_SCALE = 1e-6;

function isFbs(team: string): boolean {
  return TEAMS_BY_NAME[team]?.div === "FBS";
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Center + scale of a set of values (FBS teams' values for one system, one week). */
export function scaleOf(values: number[], stat: ScaleStat = "sd"): SystemWeekScale | null {
  const n = values.length;
  if (n < 2) return null;
  if (stat === "mad") {
    const sorted = [...values].sort((a, b) => a - b);
    const center = median(sorted);
    const dev = values.map((v) => Math.abs(v - center)).sort((a, b) => a - b);
    const scale = median(dev) * 1.4826;
    return scale > MIN_SCALE ? { center, scale, n } : null;
  }
  const center = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - center) ** 2, 0) / (n - 1);
  const scale = Math.sqrt(variance);
  return scale > MIN_SCALE ? { center, scale, n } : null;
}

/** z-score every team for one key, using the FBS teams as the reference group. Returns null when the key has no usable spread. */
function zScoreKey(
  byTeam: Record<string, Record<string, number>>,
  key: string,
  stat: ScaleStat
): { z: Record<string, number>; scale: SystemWeekScale } | null {
  const fbsValues: number[] = [];
  for (const [team, vals] of Object.entries(byTeam)) {
    const v = vals[key];
    if (v != null && Number.isFinite(v) && isFbs(team)) fbsValues.push(v);
  }
  const scale = scaleOf(fbsValues, stat);
  if (!scale) return null;
  const z: Record<string, number> = {};
  for (const [team, vals] of Object.entries(byTeam)) {
    const v = vals[key];
    if (v != null && Number.isFinite(v)) z[team] = (v - scale.center) / scale.scale;
  }
  return { z, scale };
}

/** Re-standardize an already-z-unit composite (team -> value) against FBS. */
function restandardize(values: Record<string, number>, stat: ScaleStat): Record<string, number> {
  const tmp: Record<string, Record<string, number>> = {};
  for (const [team, v] of Object.entries(values)) tmp[team] = { c: v };
  const res = zScoreKey(tmp, "c", stat);
  return res ? res.z : {};
}

/**
 * Standardize one week's saved snapshot (team -> system_key -> stored value,
 * as built by buildRatingsByTeam).
 */
export function standardizeWeek(
  byTeam: Record<string, Record<string, number>>,
  opts: StandardizeOptions
): StandardizedWeek {
  const stat = opts.scaleStat ?? "sd";
  const k = opts.multiplier;
  const weights = opts.weights ?? null;

  const zByKey: Record<string, Record<string, number>> = {};
  const scales: Record<string, SystemWeekScale | null> = {};
  for (const key of [...ALL_PULLED_SYSTEMS, "yc", "consensus"]) {
    const res = zScoreKey(byTeam, key, stat);
    scales[key] = res?.scale ?? null;
    if (res) zByKey[key] = res.z;
  }

  // Stored composites standardized as-is (the pure "rescale" effect).
  const storedYc = zByKey["yc"] ?? {};
  const storedConsensus = zByKey["consensus"] ?? {};

  let ycZ: Record<string, number> = storedYc;
  let consensusZ: Record<string, number> = storedConsensus;

  if (weights) {
    // Consensus: plain average of member systems' z-scores, then re-standardized.
    const members = CONSENSUS_INPUT_SYSTEMS.filter((key) => isInConsensus(key, weights) && zByKey[key]);
    const consRaw: Record<string, number> = {};
    for (const team of Object.keys(byTeam)) {
      const vals = members.map((key) => zByKey[key][team]).filter((v): v is number => v != null);
      if (vals.length > 0) consRaw[team] = vals.reduce((s, v) => s + v, 0) / vals.length;
    }
    consensusZ = restandardize(consRaw, stat);

    // YC: weighted average (renormalized over what's present) of the inputs, Consensus included, then re-standardized.
    const ycRaw: Record<string, number> = {};
    for (const team of Object.keys(byTeam)) {
      let sw = 0;
      let sv = 0;
      for (const key of YC_INPUT_SYSTEMS) {
        const w = weights[key] ?? 0;
        if (w <= 0) continue;
        const v = key === "consensus" ? consensusZ[team] : zByKey[key]?.[team];
        if (v == null) continue;
        sw += w;
        sv += w * v;
      }
      if (sw > 0) ycRaw[team] = sv / sw;
    }
    ycZ = restandardize(ycRaw, stat);
  }

  const out: Record<string, Record<string, number>> = {};
  for (const team of Object.keys(byTeam)) {
    const entry: Record<string, number> = {};
    for (const key of ALL_PULLED_SYSTEMS) {
      const v = zByKey[key]?.[team];
      if (v != null) entry[key] = v * k;
    }
    if (ycZ[team] != null) entry.yc = ycZ[team] * k;
    if (consensusZ[team] != null) entry.consensus = consensusZ[team] * k;
    if (storedYc[team] != null) entry[STORED_YC_KEY] = storedYc[team] * k;
    if (storedConsensus[team] != null) entry[STORED_CONSENSUS_KEY] = storedConsensus[team] * k;
    out[team] = entry;
  }
  return { byTeam: out, scales };
}

/** Standardize every saved week. */
export function standardizeWeeks(
  ratingsByWeek: Map<number, Record<string, Record<string, number>>>,
  opts: StandardizeOptions
): Map<number, StandardizedWeek> {
  const out = new Map<number, StandardizedWeek>();
  for (const [wk, byTeam] of ratingsByWeek) out.set(wk, standardizeWeek(byTeam, opts));
  return out;
}

/** Multiply every value of a standardized week by `factor` (used by the multiplier sweep: z-scores don't depend on the multiplier). */
export function rescaleByTeam(byTeam: Record<string, Record<string, number>>, factor: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [team, vals] of Object.entries(byTeam)) {
    const e: Record<string, number> = {};
    for (const [key, v] of Object.entries(vals)) e[key] = v * factor;
    out[team] = e;
  }
  return out;
}
