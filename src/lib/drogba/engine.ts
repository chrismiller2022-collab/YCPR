// Wires the pieces together: raw DB rows -> games -> walk-forward ratings -> per-game signals.
import { isFbsGame, type DGame } from "./dataset";
import { buildMarginSnapshots, type MarginRatingConfig, type RatingSnapshot } from "./marginRatings";
import {
  buildEffSnapshots,
  toTeamGameAdv,
  BASE_METRICS,
  PLAY_METRICS,
  type EffMetric,
  type EffSnapshot,
  type RawAdvRow,
  type RawPlayAggRow,
} from "./efficiencyRatings";
import { buildPreseasonMap, type RawPreseasonRow } from "./preseason";
import { buildPriors, newCoachMap, type PriorBundle, type RawCoachSeason } from "./preseasonPrior";
import { buildSignals, type GameSignals } from "./model";

export interface EngineInputs {
  games: DGame[];
  adv: RawAdvRow[];
  preseason: RawPreseasonRow[];
  plays?: RawPlayAggRow[]; // play-level aggregates (garbage-time-filtered success rate, isolated PPA, special teams)
  coaches?: RawCoachSeason[]; // head-coach history (for the new-coach flag in the preseason prior)
}

export interface EngineOptions {
  priorModel?: boolean; // start each season's ratings from the preseason prior model instead of carrying last year's final (default false: no gain in the bake-off)
  usePlays?: boolean; // use the play-level metrics when the data exists (default true)
  useSt?: boolean; // use the special-teams rating when the data exists (default true)
}

export interface SeasonCoverage {
  season: number;
  fbsGames: number; // completed FBS-vs-FBS games
  withOpen: number;
  withAdv: number; // of those, games where BOTH teams have per-game advanced rows
  withPlays: number; // of those, games where BOTH teams have play-level aggregates
  preseasonTeams: number;
}

export interface Engine {
  signals: GameSignals[];
  coverage: SeasonCoverage[];
  hasEff: boolean; // enough per-game data to run the efficiency layer
  hasPlays: boolean; // play-level metrics are in the model
  hasSt: boolean; // special-teams rating is in the model
  priors: PriorBundle | null;
}

export function computeCoverage(games: DGame[], adv: RawAdvRow[], preseason: RawPreseasonRow[], plays: RawPlayAggRow[] = []): SeasonCoverage[] {
  const advByGame = new Map<string, number>();
  for (const r of adv) if (r.off_ppa != null || r.off_success_rate != null) advByGame.set(r.game_id, (advByGame.get(r.game_id) ?? 0) + 1);
  const playsByGame = new Map<string, number>();
  for (const r of plays) if (r.f_plays != null && r.f_plays >= 20) playsByGame.set(r.game_id, (playsByGame.get(r.game_id) ?? 0) + 1);
  const seasons = Array.from(new Set(games.map((g) => g.season))).sort();
  return seasons.map((season) => {
    const fbs = games.filter((g) => g.season === season && g.completed && isFbsGame(g));
    return {
      season,
      fbsGames: fbs.length,
      withOpen: fbs.filter((g) => g.open != null).length,
      withAdv: fbs.filter((g) => (advByGame.get(g.id) ?? 0) >= 2).length,
      withPlays: fbs.filter((g) => (playsByGame.get(g.id) ?? 0) >= 2).length,
      preseasonTeams: preseason.filter((p) => p.season === season).length,
    };
  });
}

// Special-teams value a team produced in a game, in points: field goals over what an average kicker makes from those
// distances, plus the PPA CFBD assigns to its punts and kickoffs when it supplies one.
function stValue(p: RawPlayAggRow): number | null {
  if (p.st_n == null && p.st_fg_att == null) return null;
  return (p.st_fg_pts_over ?? 0) + (p.st_ppa_sum ?? 0);
}

const ST_CONFIG: MarginRatingConfig = { lambda: 6, rho: 0.5, cap: 10, hfa: 0, newTeamPrior: 0 };

export function buildEngine(inp: EngineInputs, opts: EngineOptions = {}): Engine {
  const coverage = computeCoverage(inp.games, inp.adv, inp.preseason, inp.plays);
  // The efficiency layer needs at least two seasons with ≥90% per-game coverage to train on, plus the
  // season being predicted having some data.
  const fullSeasons = coverage.filter((c) => c.fbsGames > 0 && c.withAdv / c.fbsGames >= 0.9).length;
  const hasEff = fullSeasons >= 2;
  const playSeasons = coverage.filter((c) => c.fbsGames > 0 && c.withPlays / c.fbsGames >= 0.85).length;
  const hasPlays = opts.usePlays !== false && playSeasons >= 2;

  const tg = toTeamGameAdv(inp.adv, hasPlays ? inp.plays : []);
  const metrics: EffMetric[] = hasEff ? [...BASE_METRICS, ...(hasPlays ? PLAY_METRICS : [])] : [];
  const pre = buildPreseasonMap(inp.preseason);
  const priors = hasEff && opts.priorModel === true ? buildPriors(inp.games, tg, metrics, pre, { newCoach: inp.coaches ? newCoachMap(inp.coaches) : undefined }) : null;

  const marginSnaps: Map<string, RatingSnapshot> = buildMarginSnapshots(inp.games, undefined, { priorFor: priors ? (s, t) => priors.margin.get(s)?.get(t) : undefined });
  const effSnaps: Record<string, Map<string, EffSnapshot>> = {};
  for (const m of metrics) effSnaps[m] = buildEffSnapshots(inp.games, tg, m, undefined, priors ? (s, t) => priors.eff.get(m)?.get(s)?.get(t) : undefined);

  // Special teams: net value per game, home minus away, rated like the scoreboard margin.
  const pairSnaps: Record<string, Map<string, RatingSnapshot>> = {};
  let hasSt = false;
  if (hasPlays && opts.useSt !== false && inp.plays) {
    const stBy = new Map<string, number>();
    for (const p of inp.plays) {
      const v = stValue(p);
      if (v != null) stBy.set(`${p.game_id}|${p.team}`, v);
    }
    if (stBy.size > 500) {
      pairSnaps.st = buildMarginSnapshots(inp.games, ST_CONFIG, {
        fcsPrior: 0,
        target: (g) => {
          const h = stBy.get(`${g.id}|${g.home}`);
          const a = stBy.get(`${g.id}|${g.away}`);
          return h == null || a == null ? null : h - a;
        },
      });
      hasSt = true;
    }
  }

  const signals = buildSignals(inp.games, marginSnaps, effSnaps, pre, pairSnaps);
  return { signals, coverage, hasEff, hasPlays, hasSt, priors };
}
