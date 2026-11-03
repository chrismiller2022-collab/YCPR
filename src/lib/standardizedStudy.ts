// Raw vs Standardized study: grades every system's season both ways on the
// SAME set of games (a game counts for a system only when that system has a
// projection for it in both modes — so a system-week dropped by the
// standardizer, e.g. a column saved as all zeros, is dropped from the raw
// side too), plus a multiplier sweep and per-system diagnostics.
//
// Pure functions — the Rating Systems Matchups "Std Study" tab and the
// scripts/standardized-study.ts report both run this exact code.

import { hfaFor } from "./odds";
import { type GameWithLines } from "./api/gamesLines";
import {
  computeMultiSystemRow,
  emptyRecord,
  grade,
  type MultiSystemGameRow,
  type SystemPerformance,
} from "./multiRatingMatchups";
import { RATING_SYSTEMS } from "./ratingSystems";
import {
  REBUILT_RAW_CONSENSUS_KEY,
  REBUILT_RAW_YC_KEY,
  rebuildRawComposites,
  STORED_CONSENSUS_KEY,
  STORED_YC_KEY,
  rescaleByTeam,
  standardizeWeeks,
  type ScaleStat,
  type StandardizedWeek,
} from "./ratingStandardize";

export const STUDY_SYSTEMS: { key: string; label: string; rawKey: string }[] = [
  ...RATING_SYSTEMS.map((s) => ({ key: s.key, label: s.label, rawKey: s.key })),
  // The stored YC / Consensus, standardized directly — compares against raw
  // YC / Consensus with no rebuild, i.e. the pure rescale effect.
  { key: STORED_YC_KEY, label: "YC (stored, rescaled only)", rawKey: "yc" },
  { key: STORED_CONSENSUS_KEY, label: "Consensus (stored, rescaled only)", rawKey: "consensus" },
  // Control: raw side is YC / Consensus rebuilt from the raw inputs with the
  // CURRENT weights, so the only difference left is standardizing the inputs.
  { key: "yc", label: "YC (rebuilt, current weights both sides)", rawKey: REBUILT_RAW_YC_KEY },
  { key: "consensus", label: "Consensus (rebuilt, current membership both sides)", rawKey: REBUILT_RAW_CONSENSUS_KEY },
];

/** Row id for a study entry — `key` alone isn't unique once the control rows reuse "yc" / "consensus". */
export function studyRowId(s: { key: string; rawKey: string }): string {
  return s.key === s.rawKey ? s.key : `${s.key}~${s.rawKey}`;
}

export const DEFAULT_SWEEP = Array.from({ length: 17 }, (_, i) => 10 + i * 0.5); // 10 … 18

export interface SystemStudyRow {
  /** Unique row id (see studyRowId). */
  id: string;
  key: string;
  rawKey: string;
  label: string;
  raw: SystemPerformance;
  std: SystemPerformance;
  /** Completed games graded (both modes, line present). */
  games: number;
  /** Mean absolute error of the projected spread vs the actual final margin. */
  maeRaw: number | null;
  maeStd: number | null;
  /** Average across saved weeks of the system's FBS SD — its current points per SD. */
  avgPointsPerSd: number | null;
  minPointsPerSd: number | null;
  maxPointsPerSd: number | null;
  /** Least-squares multiplier (through the origin) fitting z-difference to the final margin, and to the closing line. */
  bestKMargin: number | null;
  bestKMarket: number | null;
  /** Every-bet: games where the standardized pick is the other side from the raw pick, and the standardized record on just those games. */
  flipped: number;
  flippedStd: { w: number; l: number; push: number };
  /** System-weeks dropped because the FBS spread was ~0 (e.g. saved as all zeros). */
  deadWeeks: number[];
}

export interface StudyInput {
  games: GameWithLines[];
  ratingsByWeek: Map<number, Record<string, Record<string, number>>>;
  liveByTeam: Record<string, any>;
  weights: Record<string, number> | null;
  multiplier: number;
  scaleStat: ScaleStat;
  /** Game filter (division / conference), applied before grading. */
  include?: (g: GameWithLines) => boolean;
  sweep?: number[];
}

export interface StudyResult {
  rows: SystemStudyRow[];
  sweep: number[];
  /** key -> per-multiplier performance (same matched game set as the main table). */
  sweepPerf: Record<string, SystemPerformance[]>;
  weeks: number[];
  gamesGraded: number;
}

function hfaOf(g: GameWithLines, liveByTeam: Record<string, any>) {
  return g.neutral_site ? 0 : hfaFor(g.home_team, liveByTeam);
}

export function runStandardizedStudy(input: StudyInput): StudyResult {
  const { games, ratingsByWeek, liveByTeam, weights, multiplier, scaleStat } = input;
  const include = input.include ?? (() => true);
  const sweep = input.sweep ?? DEFAULT_SWEEP;
  const keys = Array.from(new Set(STUDY_SYSTEMS.map((s) => s.key)));
  const ids = STUDY_SYSTEMS.map(studyRowId);
  const rawKeys = Array.from(new Set(STUDY_SYSTEMS.map((s) => s.rawKey)));
  const rawWeeks = new Map<number, Record<string, Record<string, number>>>();
  for (const [wk, bt] of ratingsByWeek) rawWeeks.set(wk, weights ? rebuildRawComposites(bt, weights) : bt);

  // z-units (multiplier 1): every multiplier is just a rescale of these.
  const zWeeks: Map<number, StandardizedWeek> = standardizeWeeks(ratingsByWeek, { multiplier: 1, scaleStat, weights });

  const perf = () => ({ everyBet: emptyRecord(), filteredBet: emptyRecord(), nwfb: emptyRecord() });
  const raw = Object.fromEntries(ids.map((k) => [k, perf()])) as Record<string, SystemPerformance>;
  const std = Object.fromEntries(ids.map((k) => [k, perf()])) as Record<string, SystemPerformance>;
  const sweepPerf: Record<string, SystemPerformance[]> = Object.fromEntries(ids.map((k) => [k, sweep.map(perf)]));
  const acc = Object.fromEntries(
    ids.map((k) => [k, { n: 0, aeRaw: 0, aeStd: 0, xyM: 0, xyV: 0, xx: 0, xxV: 0, flipped: 0, flippedStd: emptyRecord() }])
  ) as Record<string, { n: number; aeRaw: number; aeStd: number; xyM: number; xyV: number; xx: number; xxV: number; flipped: number; flippedStd: ReturnType<typeof emptyRecord> }>;

  // Pre-scale each week once per sweep multiplier.
  const scaledByWeek = new Map<number, { std: Record<string, Record<string, number>>; sweep: Record<string, Record<string, number>>[] }>();
  for (const [wk, z] of zWeeks) {
    scaledByWeek.set(wk, {
      std: rescaleByTeam(z.byTeam, multiplier),
      sweep: sweep.map((m) => rescaleByTeam(z.byTeam, m)),
    });
  }

  let gamesGraded = 0;
  for (const g of games) {
    if (!include(g)) continue;
    const rawByTeam = rawWeeks.get(g.week);
    const scaled = scaledByWeek.get(g.week);
    const z = zWeeks.get(g.week);
    if (!rawByTeam || !scaled || !z) continue;

    const rawRow: MultiSystemGameRow = computeMultiSystemRow(g, rawByTeam, liveByTeam, rawKeys);
    if (rawRow.actCoverTeam == null) continue; // not completed / no line
    const stdRow = computeMultiSystemRow(g, scaled.std, liveByTeam, keys);
    const sweepRows = scaled.sweep.map((bt) => computeMultiSystemRow(g, bt, liveByTeam, keys));
    gamesGraded++;

    const hfa = hfaOf(g, liveByTeam);
    const actual = (g.home_points as number) - (g.away_points as number); // home − away = the away-perspective spread a perfect projection would show

    for (const s of STUDY_SYSTEMS) {
      const id = studyRowId(s);
      const r = rawRow.systems[s.rawKey];
      const t = stdRow.systems[s.key];
      if (r?.projAwaySpread == null || t?.projAwaySpread == null) continue;

      grade(r.projCoverTeam, rawRow.actCoverTeam, raw[id].everyBet);
      grade(r.filteredBetTeam, rawRow.actCoverTeam, raw[id].filteredBet);
      grade(r.nwfbTeam, rawRow.actCoverTeam, raw[id].nwfb);
      grade(t.projCoverTeam, stdRow.actCoverTeam, std[id].everyBet);
      grade(t.filteredBetTeam, stdRow.actCoverTeam, std[id].filteredBet);
      grade(t.nwfbTeam, stdRow.actCoverTeam, std[id].nwfb);
      sweepRows.forEach((sr, i) => {
        const x = sr.systems[s.key];
        if (!x) return;
        grade(x.projCoverTeam, sr.actCoverTeam, sweepPerf[id][i].everyBet);
        grade(x.filteredBetTeam, sr.actCoverTeam, sweepPerf[id][i].filteredBet);
        grade(x.nwfbTeam, sr.actCoverTeam, sweepPerf[id][i].nwfb);
      });

      const a = acc[id];
      a.n++;
      if (r.projCoverTeam && t.projCoverTeam && r.projCoverTeam !== t.projCoverTeam) {
        a.flipped++;
        grade(t.projCoverTeam, stdRow.actCoverTeam, a.flippedStd);
      }
      a.aeRaw += Math.abs(r.projAwaySpread - actual);
      a.aeStd += Math.abs(t.projAwaySpread - actual);
      const zAway = z.byTeam[g.away_team]?.[s.key];
      const zHome = z.byTeam[g.home_team]?.[s.key];
      if (zAway != null && zHome != null) {
        const x = zAway - zHome;
        a.xx += x * x;
        a.xyM += x * (actual - hfa);
        if (rawRow.vegasAwaySpread != null) {
          a.xxV += x * x;
          a.xyV += x * (rawRow.vegasAwaySpread - hfa);
        }
      }
    }
  }

  const weeks = Array.from(zWeeks.keys()).sort((a, b) => a - b);
  const rows: SystemStudyRow[] = STUDY_SYSTEMS.map((s) => {
    const id = studyRowId(s);
    const a = acc[id];
    const sdKey = s.key === STORED_YC_KEY || s.rawKey === REBUILT_RAW_YC_KEY ? "yc" : s.key === STORED_CONSENSUS_KEY || s.rawKey === REBUILT_RAW_CONSENSUS_KEY ? "consensus" : s.key;
    const sds = weeks.map((w) => zWeeks.get(w)!.scales[sdKey]?.scale).filter((v): v is number => v != null);
    const deadWeeks = weeks.filter((w) => ratingsByWeek.get(w) && Object.values(ratingsByWeek.get(w)!).some((v) => v[sdKey] != null) && zWeeks.get(w)!.scales[sdKey] == null);
    return {
      id,
      key: s.key,
      rawKey: s.rawKey,
      label: s.label,
      raw: raw[id],
      std: std[id],
      flipped: a.flipped,
      flippedStd: a.flippedStd,
      games: a.n,
      maeRaw: a.n ? a.aeRaw / a.n : null,
      maeStd: a.n ? a.aeStd / a.n : null,
      avgPointsPerSd: sds.length ? sds.reduce((x, y) => x + y, 0) / sds.length : null,
      minPointsPerSd: sds.length ? Math.min(...sds) : null,
      maxPointsPerSd: sds.length ? Math.max(...sds) : null,
      bestKMargin: a.xx > 0 ? a.xyM / a.xx : null,
      bestKMarket: a.xxV > 0 ? a.xyV / a.xxV : null,
      deadWeeks,
    };
  });

  return { rows, sweep, sweepPerf, weeks, gamesGraded };
}
