// Walk-forward opponent-adjusted scoring-margin ratings. For every (season, week) it fits a ridge
// rating per team using ONLY games from earlier weeks of that season, shrunk toward last season's
// final rating (carried forward with mean reversion) instead of toward zero. So week 1 is mostly the
// prior, and the prior is gradually replaced by in-season results — the same idea JP+ describes.
import { solveRidgeFull, type SparseRow } from "./ridgeSolve";
import { margin, type DGame } from "./dataset";

export interface MarginRatingConfig {
  lambda: number; // ridge strength per team, in "games of evidence" — bigger = trusts the prior longer
  rho: number; // share of last season's final rating carried into the new season
  cap: number; // margins are clipped to ±cap so blowouts don't dominate
  hfa: number; // starting home-field points (also refit each solve, lightly penalized)
  newTeamPrior: number; // prior rating for a team with no previous season (negative = worse than average)
}

export const DEFAULT_MARGIN_CONFIG: MarginRatingConfig = { lambda: 3, rho: 0.5, cap: 28, hfa: 2.5, newTeamPrior: -4 };

export interface RatingSnapshot {
  ratings: Map<string, number>; // team -> points better than an average FBS team (positive = better)
  se: Map<string, number>; // team -> standard error of that rating, in points (large early in a season, shrinks as games accumulate)
  hfa: number;
  gamesPlayed: Map<string, number>;
}

export type SnapshotKey = `${number}|${number}`;
const FCS = "__FCS__";
const MARGIN_NOISE_SD = 13;

// withSe also computes each rating's standard error (an extra O(n³) per snapshot — about 3s for six seasons); the
// bake-off found no out-of-sample gain from a confidence filter built on it, so it is off by default.
export function buildMarginSnapshots(games: DGame[], cfg: MarginRatingConfig = DEFAULT_MARGIN_CONFIG, opts: { withSe?: boolean } = {}): Map<SnapshotKey, RatingSnapshot> {
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
      if (t === FCS) prior[index.get(t)!] = -22;
      else prior[index.get(t)!] = finalPrev.has(t) ? cfg.rho * finalPrev.get(t)! : cfg.newTeamPrior;
    }
    const lambda = new Array(n).fill(cfg.lambda);
    lambda[0] = 25; // mild pull of the home-field estimate toward its starting value
    lambda[index.get(FCS)!] = 1; // the pooled FCS team should move freely

    const maxWeek = Math.max(...sg.map((g) => g.week), 1);
    const rowsUpTo = (w: number): SparseRow[] =>
      sg
        .filter((g) => g.completed && g.week < w)
        .map((g) => {
          const h = index.get(g.homeFbs ? g.home : FCS)!;
          const a = index.get(g.awayFbs ? g.away : FCS)!;
          const m = Math.max(-cfg.cap, Math.min(cfg.cap, margin(g)));
          return { idx: [0, h, a], val: [g.neutral ? 0 : 1, 1, -1], y: m };
        });

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
