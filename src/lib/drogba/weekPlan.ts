// Week selection and projection for a single week — shared by the This week tab and the Sunday checklist, so both
// show exactly the same numbers.
import { isFbsGame, type DGame } from "./dataset";
import type { Engine } from "./engine";
import { fitEdgeResponse, fitLayer1, predictEdge, predictLayer1, type EdgePrediction, type EdgeResponse, type GameSignals, type Layer1 } from "./model";
import { gameTier, type Tier } from "./tiers";

export interface WeekSplit {
  season: number;
  last: number; // most recent week that has (mostly) been played; 0 when none
  upcoming: number; // the week being bet next
}

// "Upcoming" is the first week of the latest season that is less than half played (so on a Thursday of week 6, week 5 is
// last and week 6 is upcoming; once Saturday's games are in, week 7 is upcoming). Falls back to the last week with games.
export function currentWeekSplit(games: DGame[]): WeekSplit | null {
  const fbs = games.filter(isFbsGame);
  if (!fbs.length) return null;
  const season = Math.max(...fbs.map((g) => g.season));
  const inSeason = fbs.filter((g) => g.season === season);
  const weeks = Array.from(new Set(inSeason.map((g) => g.week))).sort((a, b) => a - b);
  let upcoming = weeks[weeks.length - 1];
  for (const w of weeks) {
    const wk = inSeason.filter((g) => g.week === w);
    if (wk.filter((g) => g.completed).length / wk.length < 0.5) {
      upcoming = w;
      break;
    }
  }
  const prior = weeks.filter((w) => w < upcoming);
  return { season, last: prior.length ? prior[prior.length - 1] : 0, upcoming };
}

export interface WeekFit {
  l1: Layer1;
  resp: EdgeResponse;
  trainN: number;
}

// Fit only on games finished before the week being looked at. The edge response is measured on the most recent three
// seasons: the edge was much stronger in 2023 than since, and an all-seasons average overstates today's.
export function fitForWeek(engine: Engine, season: number, week: number): WeekFit | null {
  if (!engine.hasEff) return null;
  const train = engine.signals.filter((s) => s.g.completed && (s.g.season < season || (s.g.season === season && s.g.week < week)));
  const l1 = fitLayer1(train);
  const resp = l1 ? fitEdgeResponse(train.filter((s) => s.g.season >= season - 2), l1) : null;
  return l1 && resp ? { l1, resp, trainN: train.length } : null;
}

export interface WeekRow {
  s: GameSignals;
  g: DGame;
  tier: Tier;
  open: number | null;
  modelSpread: number | null; // home-relation, negative = home favored
  pred: EdgePrediction | null; // null when there is no model number or no opening line
}

// Every unplayed FBS-vs-FBS game of the week, with or without an opening line (the Sunday checklist needs the ones
// without; the This week tab filters to games that have one).
export function projectWeek(engine: Engine, fit: WeekFit | null, season: number, week: number, includeCompleted = false): WeekRow[] {
  return engine.signals
    .filter((s) => s.g.season === season && s.g.week === week && (includeCompleted || !s.g.completed))
    .map((s) => {
      const tier = gameTier(s.g);
      const m = fit ? predictLayer1(fit.l1, s) : null;
      const modelSpread = m == null ? null : -m;
      const pred = fit && m != null && s.g.open != null ? predictEdge(fit.resp, s, m) : null;
      return { s, g: s.g, tier, open: s.g.open, modelSpread, pred };
    })
    .sort((a, b) => Math.abs(b.pred?.edge ?? 0) - Math.abs(a.pred?.edge ?? 0));
}

// Why a game can't be projected, or projects on fewer inputs than usual. Empty = fully covered.
export function projectionGaps(s: GameSignals, hasPlays: boolean, hasSt: boolean): { blocking: string[]; degraded: string[] } {
  const blocking: string[] = [];
  const degraded: string[] = [];
  if (s.mrMargin == null) blocking.push("no scoreboard rating");
  const missingBase = ["sr", "expl", "ppa"].filter((m) => s.effDiff[m] == null);
  if (missingBase.length) blocking.push(`no efficiency rating for a team (${missingBase.join(", ")})`);
  if (hasPlays && (s.effDiff.srf == null || s.effDiff.isof == null)) degraded.push("no play-level rating for a team (uses the base model)");
  if (hasSt && s.extra.st == null) degraded.push("no special-teams rating for a team");
  return { blocking, degraded };
}

export const MODEL_VERSION = "drogba-v2-independent";
export const DEFAULT_MIN_EDGE = 5; // JP+'s published threshold; the backtest shows what each level has actually done

// The rows saved to the picks log: every projected game with an opening line, flagged when its edge passes the filter.
export function buildPickRows(rows: WeekRow[], minEdge: number) {
  return rows
    .filter((r) => r.pred && r.modelSpread != null && r.open != null)
    .map((r) => ({
      game_id: r.g.id,
      season: r.g.season,
      week: r.g.week,
      home_team: r.g.home,
      away_team: r.g.away,
      model_home_spread: r.modelSpread!,
      open_spread: r.open!,
      open_provider: r.g.openProvider,
      edge: r.pred!.edge,
      tier: r.tier,
      side: r.pred!.edge > 0 ? ("home" as const) : ("away" as const),
      filtered: Math.abs(r.pred!.edge) >= minEdge,
      model_version: MODEL_VERSION,
    }));
}

export interface GapPlan {
  gamesWeeks: number[]; // weeks whose games have no final score long after kickoff
  advWeeks: number[]; // weeks with finished games missing per-game advanced stats
  playWeeks: number[]; // weeks with finished games missing play-level data
  needOpeners: boolean; // the upcoming week has games with no FanDuel opener
}

// What a "fill gaps" run has to fetch: only weeks of the current season, before the upcoming one, plus the openers.
export function findGaps(
  games: DGame[],
  gameStats: Map<string, { adv: number; plays: number }>,
  split: WeekSplit,
  fanduel: Map<string, unknown>,
  hasPlays: boolean,
  nowMs: number
): GapPlan {
  const inSeason = games.filter((g) => g.season === split.season && isFbsGame(g));
  const gamesWeeks = new Set<number>();
  const advWeeks = new Set<number>();
  const playWeeks = new Set<number>();
  for (const g of inSeason) {
    if (g.week >= split.upcoming) continue;
    if (!g.completed) {
      if (g.startMs != null && nowMs - g.startMs > 6 * 3600_000) gamesWeeks.add(g.week);
      continue;
    }
    const st = gameStats.get(g.id);
    if ((st?.adv ?? 0) < 2) advWeeks.add(g.week);
    if (hasPlays && (st?.plays ?? 0) < 2) playWeeks.add(g.week);
  }
  const needOpeners = inSeason.some((g) => g.week === split.upcoming && !g.completed && !fanduel.has(g.id));
  const sorted = (x: Set<number>) => Array.from(x).sort((a, b) => a - b);
  return { gamesWeeks: sorted(gamesWeeks), advWeeks: sorted(advWeeks), playWeeks: sorted(playWeeks), needOpeners };
}
