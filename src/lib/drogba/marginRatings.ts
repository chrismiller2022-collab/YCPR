// Walk-forward opponent-adjusted PAIRWISE ratings: the same ridge machinery rates teams on final scoring margin
// (the "scoreboard" rating) and on any other per-game head-to-head quantity, e.g. special-teams value. For every
// (season, week) it fits a ridge rating per team using ONLY games from earlier weeks of that season, shrunk
// toward a prior for each team (last season's final rating carried forward with mean reversion, or the preseason
// prior model's estimate) instead of toward zero. So week 1 is mostly the prior, and the prior is gradually
// replaced by in-season results — the same idea JP+ describes.
import { solveRidgeFull, type SparseRow } from "./ridgeSolve";
import { margin, type DGame } from "./dataset";

export interface MarginRatingConfig {
  lambda: number; // ridge strength per team, in "games of evidence" — bigger = trusts the prior longer
  rho: number; // share of last season's final rating carried into the new season
  cap: number; // targets are clipped to ±cap so blowouts don't dominate
  hfa: number; // starting home-field points (also refit each solve, lightly penalized)
  newTeamPrior: number; // prior rating for a team with no previous season (negative = worse than average)
}

// Settings from the bake-off (tuned on 2022-23, confirmed on 2024-26).
export const DEFAULT_MARGIN_CONFIG: MarginRatingConfig = { lambda: 3, rho: 0.5, cap: 28, hfa: 2.5, newTeamPrior: -4 };

export interface RatingSnapshot {
  ratings: Map<string, number>; // team -> points better than an average FBS team (positive = better)
  se: Map<string, number>; // team -> standard error of that rating, in points (only when asked for)
  hfa: number;
  gamesPlayed: Map<string, number>;
}

export interface PairOptions {
  withSe?: boolean;
  // Quantity the rating explains for the HOME side minus the AWAY side (default: final margin). null = skip the game.
  target?: (g: DGame) => number | null;
  // Prior rating for a team in a season (e.g. from the preseason prior model); undefined = carry last season's final.
  priorFor?: (season: number, team: string) => number | undefined;
  // Rating of a team the prior is NOT defined for and that has no previous season.
  fcsPrior?: number;
}

export type SnapshotKey = `${number}|${number}`;
const FCS = "__FCS__";
const MARGIN_NOISE_SD = 13;

export function buildMarginSnapshots(games: DGame[], cfg: MarginRatingConfig = DEFAULT_MARGIN_CONFIG, opts: PairOptions = {}): Map<SnapshotKey, RatingSnapshot> {
  const target = opts.target ?? ((g: DGame) => margin(g));
  const out = new Map<SnapshotKey, RatingSnapshot>();
  const seasons = Array.from(new Set(games.map((g) => g.season))).sort((a, b) => a - b);
  let finalPrev = new Map<string, number>();

  for (const season of seasons) {
    const sg = games.filter((g) => g.season === season && (g.homeFbs || g.awayFbs));
    const teams = new Set<string>();
    for (const g of sg) {
      if (g.homeFbs) teams.add(g.home);
      if (g.awayFbs) teams.add(g.away);
    }
    const list = [FCS, ...Array.from(teams).sort()];
    const index = new Map(list.map((t, i) => [t, i + 1])); // slot 0 = hfa
    const n = list.length + 1;
    const prior = new Array(n).fill(0);
    prior[0] = cfg.hfa;
    for (const t of list) {
      if (t === FCS) prior[index.get(t)!] = opts.fcsPrior ?? -22;
      else {
        const p = opts.priorFor?.(season, t);
        prior[index.get(t)!] = p != null ? p : finalPrev.has(t) ? cfg.rho * finalPrev.get(t)! : cfg.newTeamPrior;
      }
    }
    const lambda = new Array(n).fill(cfg.lambda);
    lambda[0] = 25; // mild pull of the home-field estimate toward its starting value
    lambda[index.get(FCS)!] = 1; // the pooled FCS team should move freely

    const weeks = sg.map((g) => g.week);
    const maxWeek = weeks.length ? Math.max(...weeks) : 1;
    const rowsUpTo = (w: number): SparseRow[] => {
      const rows: SparseRow[] = [];
      for (const g of sg) {
        if (!g.completed || g.week >= w) continue;
        const raw = target(g);
        if (raw == null) continue;
        const h = index.get(g.homeFbs ? g.home : FCS)!;
        const a = index.get(g.awayFbs ? g.away : FCS)!;
        rows.push({ idx: [0, h, a], val: [g.neutral ? 0 : 1, 1, -1], y: Math.max(-cfg.cap, Math.min(cfg.cap, raw)) });
      }
      return rows;
    };

    const snap = (w: number) => {
      const rows = rowsUpTo(w);
      const { theta, diagInv } = solveRidgeFull(rows, lambda, prior, !!opts.withSe);
      const played = new Map<string, number>();
      for (const g of sg) {
        if (!g.completed || g.week >= w) continue;
        if (g.homeFbs) played.set(g.home, (played.get(g.home) ?? 0) + 1);
        if (g.awayFbs) played.set(g.away, (played.get(g.away) ?? 0) + 1);
      }
      const ratings = new Map<string, number>();
      for (const t of list) if (t !== FCS) ratings.set(t, theta[index.get(t)!]);
      // Re-center so the average FBS team is 0 (the pooled FCS team and the prior can drift the mean).
      const mean = Array.from(ratings.values()).reduce((s, v) => s + v, 0) / ratings.size;
      for (const [t, v] of ratings) ratings.set(t, v - mean);
      // Posterior standard error: sqrt(diag(A⁻¹)) times the typical game-to-game noise (≈ the 13-point SD of a margin).
      const se = new Map<string, number>();
      if (diagInv) for (const t of list) if (t !== FCS) se.set(t, Math.sqrt(diagInv[index.get(t)!]) * MARGIN_NOISE_SD);
      return { ratings, se, hfa: theta[0], gamesPlayed: played } as RatingSnapshot;
    };

    for (let w = 1; w <= maxWeek + 1; w++) out.set(`${season}|${w}`, snap(w));
    finalPrev = out.get(`${season}|${maxWeek + 1}`)!.ratings;
  }
  return out;
}

// Opponent-adjusted rating over a WHOLE season with minimal shrinkage (λ = 1, zero prior) — what a preseason prior
// is trying to predict. Centered so the average FBS team is 0.
export function fitFullSeasonMargin(games: DGame[], season: number, opts: PairOptions = {}): Map<string, number> | null {
  const target = opts.target ?? ((g: DGame) => margin(g));
  const gs = games.filter((g) => g.season === season && g.completed && (g.homeFbs || g.awayFbs));
  if (gs.length < 200) return null;
  const teams = Array.from(new Set(gs.flatMap((g) => [g.homeFbs ? g.home : "", g.awayFbs ? g.away : ""]).filter(Boolean))).sort();
  const idx = new Map<string, number>([[FCS, 1], ...teams.map((t, i) => [t, i + 2] as [string, number])]);
  const n = idx.size + 1;
  const rows: SparseRow[] = [];
  for (const g of gs) {
    const y = target(g);
    if (y == null) continue;
    rows.push({ idx: [0, idx.get(g.homeFbs ? g.home : FCS)!, idx.get(g.awayFbs ? g.away : FCS)!], val: [g.neutral ? 0 : 1, 1, -1], y: Math.max(-28, Math.min(28, y)) });
  }
  const lam = new Array(n).fill(1);
  lam[0] = 25;
  lam[1] = 0.5;
  const pr = new Array(n).fill(0);
  pr[0] = 2.5;
  pr[1] = -22;
  const { theta } = solveRidgeFull(rows, lam, pr, false);
  const out = new Map<string, number>();
  let sum = 0;
  for (const t of teams) {
    out.set(t, theta[idx.get(t)!]);
    sum += theta[idx.get(t)!];
  }
  for (const t of teams) out.set(t, out.get(t)! - sum / teams.length);
  return out;
}
