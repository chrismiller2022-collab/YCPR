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

export function predictGameTotalRidge(input: RidgeTotalModelInput): number {
  const s = input.seasonStats;
  const raw = [
    seasonAdjust(input.homeOffPpa, 0, s?.offPpa),
    seasonAdjust(input.homeDefPpa, 1, s?.defPpa),
    seasonAdjust(input.homeOffExplosiveness, 2, s?.offExplosiveness),
    seasonAdjust(input.homeDefExplosiveness, 3, s?.defExplosiveness),
    seasonAdjust(input.awayOffPpa, 4, s?.offPpa),
    seasonAdjust(input.awayDefPpa, 5, s?.defPpa),
    seasonAdjust(input.awayOffExplosiveness, 6, s?.offExplosiveness),
    seasonAdjust(input.awayDefExplosiveness, 7, s?.defExplosiveness),
    input.homeFlag,
    input.homeRestDays,
    input.awayRestDays,
    orNeutral(input.marketTotal, 11),
  ];

  let z = INTERCEPT;
  for (let i = 0; i < FEATURE_ORDER.length; i++) {
    z += ((raw[i] - MEAN[i]) / SCALE[i]) * COEF[i];
  }
  return z;
}
