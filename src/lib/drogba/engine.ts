// Wires the pieces together: raw DB rows -> games -> walk-forward ratings -> per-game signals.
import { isFbsGame, type DGame } from "./dataset";
import { buildMarginSnapshots } from "./marginRatings";
import { buildEffSnapshots, toTeamGameAdv, EFF_METRICS, type EffMetric, type EffSnapshot, type RawAdvRow } from "./efficiencyRatings";
import { buildPreseasonMap, type RawPreseasonRow } from "./preseason";
import { buildSignals, type GameSignals } from "./model";

export interface EngineInputs {
  games: DGame[];
  adv: RawAdvRow[];
  preseason: RawPreseasonRow[];
}

export interface SeasonCoverage {
  season: number;
  fbsGames: number; // completed FBS-vs-FBS games
  withOpen: number;
  withAdv: number; // of those, games where BOTH teams have per-game advanced rows
  preseasonTeams: number;
}

export interface Engine {
  signals: GameSignals[];
  coverage: SeasonCoverage[];
  hasEff: boolean; // enough per-game data to run the efficiency layer
}

export function computeCoverage(games: DGame[], adv: RawAdvRow[], preseason: RawPreseasonRow[]): SeasonCoverage[] {
  const advByGame = new Map<string, number>();
  for (const r of adv) if (r.off_ppa != null || r.off_success_rate != null) advByGame.set(r.game_id, (advByGame.get(r.game_id) ?? 0) + 1);
  const seasons = Array.from(new Set(games.map((g) => g.season))).sort();
  return seasons.map((season) => {
    const fbs = games.filter((g) => g.season === season && g.completed && isFbsGame(g));
    return {
      season,
      fbsGames: fbs.length,
      withOpen: fbs.filter((g) => g.open != null).length,
      withAdv: fbs.filter((g) => (advByGame.get(g.id) ?? 0) >= 2).length,
      preseasonTeams: preseason.filter((p) => p.season === season).length,
    };
  });
}

export function buildEngine(inp: EngineInputs): Engine {
  const coverage = computeCoverage(inp.games, inp.adv, inp.preseason);
  // The efficiency layer needs at least two seasons with ≥90% per-game coverage to train on, plus the
  // season being predicted having some data.
  const fullSeasons = coverage.filter((c) => c.fbsGames > 0 && c.withAdv / c.fbsGames >= 0.9).length;
  const hasEff = fullSeasons >= 2;
  const marginSnaps = buildMarginSnapshots(inp.games);
  const effSnaps: Partial<Record<EffMetric, Map<string, EffSnapshot>>> = {};
  if (hasEff) {
    const tg = toTeamGameAdv(inp.adv);
    for (const m of EFF_METRICS) effSnaps[m] = buildEffSnapshots(inp.games, tg, m);
  }
  const signals = buildSignals(inp.games, marginSnaps, effSnaps, buildPreseasonMap(inp.preseason));
  return { signals, coverage, hasEff };
}
