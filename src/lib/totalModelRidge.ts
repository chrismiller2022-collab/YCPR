// Game Totals — Ridge regression model, replacing the old hand-built
// 6-system formula engine per Chris's instruction ("I dont really care
// about my model, I dont think its working... I like the idea of
// gmalbert's total model, how can we go about using it on my site?").
//
// Methodology mirrors github.com/gmalbert/college-football-predictions'
// totals model: StandardScaler + Ridge(alpha=10) regression predicting a
// game's TOTAL points directly (not home/away separately, not derived
// from a margin model — Ridge trained straight on total_points).
//
// Why a frozen/offline-trained model instead of a live formula: this app
// has no Python/ML runtime, so training can't happen in the browser or a
// Vercel function. Instead it's trained ONCE (see the training script
// referenced below) on real Supabase data — 5 seasons (2021-2025) of
// completed FBS-vs-FBS games joined against team_season_stats (CFBD
// advanced stats) and betting_lines (market total) — and the resulting
// coefficients are frozen here as plain constants. Retraining later is
// just re-running the same query + fit and pasting in new numbers below;
// there's no live retraining loop.
//
// Real, honest accuracy numbers from training (3,730 games, 5-fold CV):
//   - This model:                    RMSE ≈ 15.05 points
//   - Vegas closing total alone:     RMSE ≈ 15.74 points
//   - Always guessing the average:   RMSE ≈ 16.93 points
// So it's a real, modest edge over the market (~0.7 pts RMSE) and a
// bigger edge over a naive average (~1.9 pts) — not a home run, but a
// legitimate, honestly-measured improvement, and it matches gmalbert's
// own reported RMSE (15.14) almost exactly, which is a good sign this
// replication is faithful rather than a fluke.
//
// Feature order below MUST match the order the model was trained on —
// don't reorder without re-deriving mean/scale/coef together.

export interface RidgeTotalModelInput {
  homeOffPpa: number | null;
  homeDefPpa: number | null;
  homeOffExplosiveness: number | null;
  homeDefExplosiveness: number | null;
  awayOffPpa: number | null;
  awayDefPpa: number | null;
  awayOffExplosiveness: number | null;
  awayDefExplosiveness: number | null;
  homeFlag: number; // 1.0 = true home game, 0.5 = neutral site
  homeRestDays: number;
  awayRestDays: number;
  marketTotal: number | null; // closing (preferred) or opening over/under; null falls back to the training-set average
  // The current season's FBS mean and std dev for each team stat. When given, each of the
  // eight team-stat inputs is converted to a z-score against THIS pool, clipped to
  // ±Z_CLIP, and read as if it sat on the training distribution (training mean +
  // z × training scale). Without it the raw value is used as before.
  seasonStats?: Partial<Record<"offPpa" | "defPpa" | "offExplosiveness" | "defExplosiveness", { mean: number; sd: number }>>;
}

// Why this exists: the coefficients were fit on full-season stats from 2021-25, but
// early in a season each team has a handful of games, so the stats are shifted (2026
// defensive PPA averaged 0.06 vs a training mean of 0.16, ~1.2 training SDs) and much
// more spread out (SD 0.12 vs 0.08). A linear model reads that as two elite defenses
// in nearly every game and projected totals ran ~3 points under the market, with
// absurd outliers (Texas-Oklahoma 16.7). Re-standardizing within the season removes
// the shift and the clip caps the extremes — no regression toward Vegas involved.
export const Z_CLIP = 2.5;

const FEATURE_ORDER = [
  "home_off_ppa",
  "home_def_ppa",
  "home_off_expl",
  "home_def_expl",
  "away_off_ppa",
  "away_def_ppa",
  "away_off_expl",
  "away_def_expl",
  "home_flag",
  "home_rest_days",
  "away_rest_days",
  "market_total",
] as const;

// StandardScaler mean/scale, Ridge coef + intercept — from the 2026-08-22
// training run (3,730 games, seasons 2021-2025, alpha=10.0).
const MEAN = [
  0.18564016085790883, 0.1585688471849866, 1.2566147184986594, 1.2554567292225203, 0.17982168900804288,
  0.16374131367292225, 1.2582808847184987, 1.2592439410187668, 0.9840482573726541, 7.964343163538874,
  7.911796246648794, 53.34627345844503,
];
const SCALE = [
  0.09158516493058723, 0.08183529440405997, 0.08555746556983258, 0.09393153267168958, 0.09095284936936998,
  0.08209322841190543, 0.08503009473087239, 0.09327598834728444, 0.08787157231337014, 2.405771525500505,
  2.3608730246197767, 7.543308786823632,
];
const COEF = [
  2.915190497866509, 2.302015284905537, 0.49781210194344244, 0.7998688960422408, 2.2573389614968598,
  2.4631153085203557, 1.3044605604270139, 1.0072589107275394, 0.4926869308260105, 0.04143806986086213,
  -0.09395516901085736, 2.321819724162297,
];
const INTERCEPT = 53.73297587131367;

// Training-set mean is also the fallback for a missing input (early
// season teams with no advanced stats yet, or a game with no market
// total posted) — the same neutral-fallback philosophy the old formula
// engine used (matchupFactor() defaulting to 1.0 rather than propagating
// a null through the whole calculation).
function orNeutral(value: number | null, index: number): number {
  return value == null || Number.isNaN(value) ? MEAN[index] : value;
}

// Maps one team-stat value onto the training distribution through the season's own mean/sd.
function seasonAdjust(value: number | null, index: number, stats: { mean: number; sd: number } | undefined): number {
  const v = orNeutral(value, index);
  if (!stats || !(stats.sd > 0) || value == null || Number.isNaN(value)) return v;
  const z = Math.max(-Z_CLIP, Math.min(Z_CLIP, (v - stats.mean) / stats.sd));
  return MEAN[index] + z * SCALE[index];
}

// Calibration constant added to every projection. After re-standardizing, the 2026 backtest
// (271 finished FBS games) had the model +1.4 over the Vegas close while actual games
// landed only +0.5 over, so every unlocked game leaned Over. Subtracting 2.0 puts the
// average projection ~0.6 under Vegas (a slight Under lean) and, measured on the same
// games, did not hurt accuracy (MAE vs actual 10.80 -> 10.62). It is a plain shift of the
// output — rank order of games and the size of every disagreement between games is
// unchanged. Set to 0 to remove. Re-check it with the bias backtest after a few more weeks.
export const TOTAL_BIAS_OFFSET = -2.0;

export const FEATURE_LABELS: Record<(typeof FEATURE_ORDER)[number], string> = {
  home_off_ppa: "Home offense PPA",
  home_def_ppa: "Home defense PPA allowed",
  home_off_expl: "Home offense explosiveness",
  home_def_expl: "Home defense explosiveness allowed",
  away_off_ppa: "Away offense PPA",
  away_def_ppa: "Away defense PPA allowed",
  away_off_expl: "Away offense explosiveness",
  away_def_expl: "Away defense explosiveness allowed",
  home_flag: "Home flag (1 home / 0.5 neutral)",
  home_rest_days: "Home rest days",
  away_rest_days: "Away rest days",
  market_total: "Market total (Vegas)",
};

export interface RidgeFeatureStep {
  key: (typeof FEATURE_ORDER)[number];
  label: string;
  given: number | null; // what the caller supplied (null = missing, fell back to the training mean)
  used: number; // after the season re-standardization / clip / fallback — what the regression sees
  clipped: boolean;
  trainingMean: number;
  trainingScale: number;
  zScore: number; // (used - trainingMean) / trainingScale
  coef: number;
  contribution: number; // zScore * coef, in points
}

export interface RidgeTotalBreakdown {
  intercept: number;
  steps: RidgeFeatureStep[];
  rawTotal: number; // intercept + sum of contributions
  biasOffset: number;
  total: number; // rawTotal + biasOffset — same number predictGameTotalRidge returns
}

// Same math as predictGameTotalRidge, but keeps every intermediate number so the
// Methodology tab and the hypothetical matchup tool can show the work.
export function explainGameTotalRidge(input: RidgeTotalModelInput): RidgeTotalBreakdown {
  const s = input.seasonStats;
  const given: (number | null)[] = [
    input.homeOffPpa,
    input.homeDefPpa,
    input.homeOffExplosiveness,
    input.homeDefExplosiveness,
    input.awayOffPpa,
    input.awayDefPpa,
    input.awayOffExplosiveness,
    input.awayDefExplosiveness,
    input.homeFlag,
    input.homeRestDays,
    input.awayRestDays,
    input.marketTotal,
  ];
  const statKeys = ["offPpa", "defPpa", "offExplosiveness", "defExplosiveness", "offPpa", "defPpa", "offExplosiveness", "defExplosiveness"] as const;
  const steps: RidgeFeatureStep[] = [];
  let rawTotal = INTERCEPT;
  for (let i = 0; i < FEATURE_ORDER.length; i++) {
    const g = given[i];
    let used: number;
    let clipped = false;
    if (i < 8) {
      used = seasonAdjust(g, i, s?.[statKeys[i]]);
      const st = s?.[statKeys[i]];
      if (st && st.sd > 0 && g != null && !Number.isNaN(g)) clipped = Math.abs((g - st.mean) / st.sd) > Z_CLIP;
    } else {
      used = orNeutral(g, i);
    }
    const zScore = (used - MEAN[i]) / SCALE[i];
    const contribution = zScore * COEF[i];
    rawTotal += contribution;
    steps.push({
      key: FEATURE_ORDER[i],
      label: FEATURE_LABELS[FEATURE_ORDER[i]],
      given: g == null || Number.isNaN(g) ? null : g,
      used,
      clipped,
      trainingMean: MEAN[i],
      trainingScale: SCALE[i],
      zScore,
      coef: COEF[i],
      contribution,
    });
  }
  return { intercept: INTERCEPT, steps, rawTotal, biasOffset: TOTAL_BIAS_OFFSET, total: rawTotal + TOTAL_BIAS_OFFSET };
}

export function predictGameTotalRidge(input: RidgeTotalModelInput): number {
  return explainGameTotalRidge(input).total;
}
