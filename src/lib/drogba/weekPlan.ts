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
export function projectWeek(engine: Engine, fit: WeekFit | null, season: number, week: number): WeekRow[] {
  return engine.signals
    .filter((s) => s.g.season === season && s.g.week === week && !s.g.completed)
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
