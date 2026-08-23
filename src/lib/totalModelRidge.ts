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
}

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

export function predictGameTotalRidge(input: RidgeTotalModelInput): number {
  const raw = [
    orNeutral(input.homeOffPpa, 0),
    orNeutral(input.homeDefPpa, 1),
    orNeutral(input.homeOffExplosiveness, 2),
    orNeutral(input.homeDefExplosiveness, 3),
    orNeutral(input.awayOffPpa, 4),
    orNeutral(input.awayDefPpa, 5),
    orNeutral(input.awayOffExplosiveness, 6),
    orNeutral(input.awayDefExplosiveness, 7),
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
