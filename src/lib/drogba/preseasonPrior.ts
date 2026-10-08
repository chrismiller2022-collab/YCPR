// Preseason prior model. Predicts each team's WHOLE-SEASON strength (margin rating, and offense/defense effect on
// each efficiency metric) from what is known before the season: last year's full-season rating, returning
// production, talent composite, recruiting class, transfer-portal net rating, and whether the head coach is new.
// The prediction becomes each team's STARTING rating in the walk-forward engines (the ridge prior mean), the way
// SP+ / JP+ carry a preseason projection into week 1, instead of one more input to the game model.
//
// Walk-forward: the prior for season S is fit only on seasons before S (each season s in 2022..S-1 supplies
// "features known before s -> what s turned out to be").
import { fitDenseRidge } from "./ridgeSolve";
import { fitFullSeasonMargin } from "./marginRatings";
import { fitFullSeasonOD, type EffMetric, type EffPrior, type TeamGameAdv } from "./efficiencyRatings";
import type { DGame } from "./dataset";
import type { PreseasonZ } from "./preseason";

export interface PriorBundle {
  margin: Map<number, Map<string, number>>;
  eff: Map<EffMetric, Map<number, Map<string, EffPrior>>>;
}

export interface PriorOptions {
  alpha?: number;
  // "season|team" -> 1 when the head coach changed from the previous season (empty when coach history isn't loaded)
  newCoach?: Map<string, number>;
  firstTrainSeason?: number;
}

function standardizeFit(X: number[][], y: number[], alpha: number) {
  const p = X[0].length;
  const mean = Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[j], 0) / X.length);
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mean[j]) ** 2, 0) / X.length) || 1);
  const f = fitDenseRidge(X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j])), y, alpha);
  return (x: number[]) => f.intercept + x.reduce((a, v, j) => a + ((v - mean[j]) / sd[j]) * f.coef[j], 0);
}

export function buildPriors(games: DGame[], teamGames: TeamGameAdv[], metrics: EffMetric[], pre: Map<string, PreseasonZ>, opts: PriorOptions = {}): PriorBundle {
  const alpha = opts.alpha ?? 20;
  const first = opts.firstTrainSeason ?? 2022;
  const seasons = Array.from(new Set(games.map((g) => g.season))).sort((a, b) => a - b);
  const fullMargin = new Map<number, Map<string, number>>();
  const fullOD = new Map<EffMetric, Map<number, Map<string, EffPrior>>>();
  for (const s of seasons) {
    const m = fitFullSeasonMargin(games, s);
    if (m) fullMargin.set(s, m);
  }
  for (const metric of metrics) {
    const per = new Map<number, Map<string, EffPrior>>();
    for (const s of seasons) {
      const od = fitFullSeasonOD(games, teamGames, metric, s);
      if (od) per.set(s, od);
    }
    fullOD.set(metric, per);
  }

  const z = (s: number, team: string, j: number) => pre.get(`${s}|${team}`)?.[j] ?? 0;
  const coach = (s: number, team: string) => opts.newCoach?.get(`${s}|${team}`) ?? 0;
  const teamsIn = (s: number) => Array.from(new Set(games.filter((g) => g.season === s).flatMap((g) => [g.homeFbs ? g.home : "", g.awayFbs ? g.away : ""]).filter(Boolean)));
  const common = (s: number, team: string) => [z(s, team, 0), z(s, team, 1), z(s, team, 2), z(s, team, 3), coach(s, team)];

  const margin = new Map<number, Map<string, number>>();
  const eff = new Map<EffMetric, Map<number, Map<string, EffPrior>>>();
  for (const m of metrics) eff.set(m, new Map());

  for (const S of seasons) {
    if (S <= first) continue; // no season to learn from yet — the engines fall back to carrying last year's final rating
    // ----- margin
    {
      const X: number[][] = [];
      const y: number[] = [];
      for (let s = first; s < S; s++) {
        const full = fullMargin.get(s);
        const prev = fullMargin.get(s - 1);
        if (!full) continue;
        for (const [team, r] of full) {
          const pv = prev?.get(team);
          X.push([pv ?? 0, pv == null ? 1 : 0, ...common(s, team)]);
          y.push(r);
        }
      }
      const prevS = fullMargin.get(S - 1);
      if (X.length >= 100 && prevS) {
        const predict = standardizeFit(X, y, alpha);
        const out = new Map<string, number>();
        for (const team of teamsIn(S)) {
          const pv = prevS.get(team);
          out.set(team, predict([pv ?? 0, pv == null ? 1 : 0, ...common(S, team)]));
        }
        margin.set(S, out);
      }
    }
    // ----- efficiency offense / defense effects
    for (const metric of metrics) {
      const per = fullOD.get(metric)!;
      const Xo: number[][] = [];
      const yo: number[] = [];
      const yd: number[] = [];
      for (let s = first; s < S; s++) {
        const full = per.get(s);
        const prev = per.get(s - 1);
        if (!full) continue;
        for (const [team, r] of full) {
          const pv = prev?.get(team);
          Xo.push([pv?.off ?? 0, pv?.def ?? 0, pv == null ? 1 : 0, ...common(s, team)]);
          yo.push(r.off);
          yd.push(r.def);
        }
      }
      const prevS = per.get(S - 1);
      if (Xo.length >= 100 && prevS) {
        const pOff = standardizeFit(Xo, yo, alpha);
        const pDef = standardizeFit(Xo, yd, alpha);
        const out = new Map<string, EffPrior>();
        for (const team of teamsIn(S)) {
          const pv = prevS.get(team);
          const x = [pv?.off ?? 0, pv?.def ?? 0, pv == null ? 1 : 0, ...common(S, team)];
          out.set(team, { off: pOff(x), def: pDef(x) });
        }
        eff.get(metric)!.set(S, out);
      }
    }
  }
  return { margin, eff };
}

// "season|team" -> 1 when the head coach changed from the previous season, from team_coach_seasons rows.
export interface RawCoachSeason {
  team: string;
  year: number;
  coach_id: string;
  games: number | null;
}
export function newCoachMap(rows: RawCoachSeason[]): Map<string, number> {
  const best = new Map<string, { id: string; games: number }>(); // "year|team" -> the coach who coached most of that season
  for (const r of rows) {
    const k = `${r.year}|${r.team}`;
    const g = r.games ?? 0;
    const cur = best.get(k);
    if (!cur || g > cur.games) best.set(k, { id: r.coach_id, games: g });
  }
  const out = new Map<string, number>();
  for (const [k, v] of best) {
    const [yearStr, team] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    const prev = best.get(`${Number(yearStr) - 1}|${team}`);
    if (prev) out.set(`${yearStr}|${team}`, prev.id !== v.id ? 1 : 0);
  }
  return out;
}
