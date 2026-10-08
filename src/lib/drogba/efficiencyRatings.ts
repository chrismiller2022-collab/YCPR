// Walk-forward opponent-adjusted EFFICIENCY ratings (the JP+-style core). For each per-play metric
// (success rate, explosiveness, PPA, and — once the play-level pull has run — garbage-time-filtered success
// rate and isolated explosiveness) every team gets an offense effect O and a defense effect D from a ridge
// fit on that metric's per-game values:
//     metric(team on offense vs opp) = mu + O_team + D_opp + hfa·home
// Higher O = better offense; higher D = a defense that ALLOWS more (worse). Each (season, week) snapshot
// only sees games from earlier weeks, and shrinks toward a PRIOR for each team (last season's final
// ratings carried forward, or the preseason prior model's estimate) rather than toward zero. Only each
// team's own offensive numbers are used — a game's offense stat for team A is the same plays as the defense
// stat for team B, so using both would double count.
import { solveRidge, type SparseRow } from "./ridgeSolve";
import type { DGame } from "./dataset";

export type EffMetric = string;
// Metrics from the per-game advanced pull (every season) and from the play-level pull (when it has run).
export const BASE_METRICS: EffMetric[] = ["sr", "expl", "ppa"];
export const PLAY_METRICS: EffMetric[] = ["srf", "isof"];

export interface TeamGameAdv {
  gameId: string;
  team: string;
  season: number;
  week: number;
  v: Record<string, number | null>; // the offense's value of each metric in this game
  w: Record<string, number>; // how many observations stand behind it (plays, successful plays) — a weight
}

export interface RawAdvRow {
  game_id: string;
  team: string;
  season: number;
  week: number | null;
  off_success_rate: number | null;
  off_explosiveness: number | null;
  off_ppa: number | null;
}

// Per team-game aggregates from the play-level pull (see api/_playsAggregate.ts).
export interface RawPlayAggRow {
  game_id: string;
  team: string;
  season: number;
  week: number | null;
  f_plays: number | null; // scrimmage plays outside garbage time
  f_success: number | null;
  f_ppa_success_sum: number | null; // sum of PPA over successful plays (isolated explosiveness = this / f_ppa_success_n)
  f_ppa_success_n?: number | null; // successful plays that had a PPA
  st_fg_att: number | null;
  st_fg_pts_over: number | null; // field-goal points over expected for this team's kicker
  st_ppa_sum: number | null; // PPA summed over this team's kicking plays (punts / kickoffs), when CFBD supplies it
  st_n: number | null;
}

const num = (x: unknown): number | null => (x == null || Number.isNaN(Number(x)) ? null : Number(x));

export function toTeamGameAdv(rows: RawAdvRow[], plays: RawPlayAggRow[] = []): TeamGameAdv[] {
  const out = new Map<string, TeamGameAdv>();
  const key = (g: string, t: string) => `${g}|${t}`;
  for (const r of rows) {
    out.set(key(r.game_id, r.team), {
      gameId: r.game_id,
      team: r.team,
      season: r.season,
      week: r.week ?? 0,
      v: { sr: num(r.off_success_rate), expl: num(r.off_explosiveness), ppa: num(r.off_ppa) },
      w: {},
    });
  }
  for (const p of plays) {
    let t = out.get(key(p.game_id, p.team));
    if (!t) {
      t = { gameId: p.game_id, team: p.team, season: p.season, week: p.week ?? 0, v: {}, w: {} };
      out.set(key(p.game_id, p.team), t);
    }
    const plays_ = num(p.f_plays);
    const succ = num(p.f_success);
    const ppaSum = num(p.f_ppa_success_sum);
    if (plays_ != null && plays_ >= 20 && succ != null) {
      t.v.srf = succ / plays_;
      t.w.srf = plays_;
      const ppaN = num(p.f_ppa_success_n) ?? succ;
      if (ppaN >= 5 && ppaSum != null) {
        t.v.isof = ppaSum / ppaN;
        t.w.isof = ppaN;
      }
    }
  }
  return Array.from(out.values());
}

export interface EffConfig {
  lambda: Record<string, number>; // ridge strength per metric, in observations — bigger = prior lasts longer
  rho: number; // share of last season's final O/D carried into the new season (used when no prior model is given)
}
// Settings from the bake-off (tuned on 2022-23, confirmed on 2024-26): weaker shrinkage within a season,
// longer memory of last season's final ratings.
export const DEFAULT_EFF_CONFIG: EffConfig = { lambda: { sr: 2, expl: 4, ppa: 3, srf: 2, isof: 4 }, rho: 0.85 };
const lambdaFor = (cfg: EffConfig, metric: string) => cfg.lambda[metric] ?? 3;

export interface EffSnapshot {
  off: Map<string, number>; // team -> offense effect (metric units, higher = better)
  def: Map<string, number>; // team -> defense effect (metric units, LOWER = better, allows less)
  hfa: number;
  mu: number;
}
export type EffKey = `${number}|${number}`;
const FCS = "__FCS__";

export interface EffPrior {
  off: number;
  def: number;
}
export type EffPriorFn = (season: number, team: string) => EffPrior | undefined;

interface Obs {
  off: string;
  def: string;
  home: number;
  week: number;
  y: number;
  w: number;
}

function seasonObs(games: Map<string, DGame>, teamGames: TeamGameAdv[], season: number, metric: string): { obs: Obs[]; teams: Set<string> } {
  const obs: Obs[] = [];
  const teams = new Set<string>();
  let wSum = 0;
  for (const tg of teamGames) {
    if (tg.season !== season) continue;
    const y = tg.v[metric];
    if (y == null) continue;
    const g = games.get(tg.gameId);
    if (!g || !g.completed) continue;
    const offIsHome = g.home === tg.team;
    const offFbs = offIsHome ? g.homeFbs : g.awayFbs;
    const opp = offIsHome ? g.away : g.home;
    const oppFbs = offIsHome ? g.awayFbs : g.homeFbs;
    if (!offFbs && !oppFbs) continue;
    if (offFbs) teams.add(tg.team);
    if (oppFbs) teams.add(opp);
    const w = tg.w[metric] ?? 1;
    wSum += w;
    obs.push({ off: offFbs ? tg.team : FCS, def: oppFbs ? opp : FCS, home: g.neutral ? 0 : offIsHome ? 1 : -1, week: g.week, y, w });
  }
  // Normalize weights to average 1 so the ridge strengths mean the same thing with or without weighting.
  if (obs.length > 0 && wSum > 0) for (const o of obs) o.w = (o.w * obs.length) / wSum;
  return { obs, teams };
}

function solveOD(obs: Obs[], teams: Set<string>, lambdaVal: number, priorOf: (t: string) => EffPrior, muFallback = 0) {
  const list = [FCS, ...Array.from(teams).sort()];
  const idx = new Map(list.map((t, i) => [t, i]));
  const m = list.length;
  const n = 1 + 2 * m; // [hfa, O_0..O_{m-1}, D_0..D_{m-1}]
  const oi = (t: string) => 1 + idx.get(t)!;
  const di = (t: string) => 1 + m + idx.get(t)!;
  const prior = new Array(n).fill(0);
  for (const t of list) {
    if (t === FCS) continue;
    const p = priorOf(t);
    prior[oi(t)] = p.off;
    prior[di(t)] = p.def;
  }
  const lambda = new Array(n).fill(lambdaVal);
  lambda[0] = 30;
  lambda[oi(FCS)] = 0.5;
  lambda[di(FCS)] = 0.5;
  const rawMu = obs.length >= 20 ? obs.reduce((s, o) => s + o.y, 0) / obs.length : NaN;
  const mu = Number.isNaN(rawMu) ? muFallback : rawMu;
  const rows: SparseRow[] = obs.map((o) => ({ idx: [0, oi(o.off), di(o.def)], val: [o.home, 1, 1], y: o.y - mu, w: o.w }));
  const theta = solveRidge(rows, lambda, prior);
  const off = new Map<string, number>();
  const def = new Map<string, number>();
  for (const t of list) {
    if (t === FCS) continue;
    off.set(t, theta[oi(t)]);
    def.set(t, theta[di(t)]);
  }
  // Center O and D separately across FBS teams (the split between mu and the effects is arbitrary).
  const mo = off.size ? Array.from(off.values()).reduce((s, v) => s + v, 0) / off.size : 0;
  const md = def.size ? Array.from(def.values()).reduce((s, v) => s + v, 0) / def.size : 0;
  for (const [t, v] of off) off.set(t, v - mo);
  for (const [t, v] of def) def.set(t, v - md);
  return { off, def, hfa: theta[0], mu: mu + mo + md, rawMu };
}

export function buildEffSnapshots(
  games: DGame[],
  teamGames: TeamGameAdv[],
  metric: EffMetric,
  cfg: EffConfig = DEFAULT_EFF_CONFIG,
  priorFn?: EffPriorFn
): Map<EffKey, EffSnapshot> {
  const out = new Map<EffKey, EffSnapshot>();
  const gameById = new Map(games.map((g) => [g.id, g]));
  const seasons = Array.from(new Set(teamGames.filter((t) => t.v[metric] != null).map((t) => t.season))).sort((a, b) => a - b);
  let prevOff = new Map<string, number>();
  let prevDef = new Map<string, number>();
  let lastMu = NaN;

  for (const season of seasons) {
    const { obs, teams } = seasonObs(gameById, teamGames, season, metric);
    if (obs.length === 0) continue;
    const priorOf = (t: string): EffPrior => priorFn?.(season, t) ?? { off: cfg.rho * (prevOff.get(t) ?? 0), def: cfg.rho * (prevDef.get(t) ?? 0) };
    const maxWeek = Math.max(...obs.map((o) => o.week), 1);
    if (Number.isNaN(lastMu)) lastMu = obs.reduce((s, o) => s + o.y, 0) / obs.length;
    for (let w = 1; w <= maxWeek + 1; w++) {
      const use = obs.filter((o) => o.week < w);
      // Before there are enough games this season to estimate the league average, reuse the last one.
      const r = solveOD(use, teams, lambdaFor(cfg, metric), priorOf, lastMu);
      out.set(`${season}|${w}`, { off: r.off, def: r.def, hfa: r.hfa, mu: r.mu });
      if (!Number.isNaN(r.rawMu)) lastMu = r.rawMu;
    }
    prevOff = out.get(`${season}|${maxWeek + 1}`)!.off;
    prevDef = out.get(`${season}|${maxWeek + 1}`)!.def;
  }
  return out;
}

// What a team's offense/defense effects were over a WHOLE season with minimal shrinkage (λ = 1, zero prior) —
// the quantity a preseason prior should be predicting.
export function fitFullSeasonOD(games: DGame[], teamGames: TeamGameAdv[], metric: EffMetric, season: number): Map<string, EffPrior> | null {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const { obs, teams } = seasonObs(gameById, teamGames, season, metric);
  if (obs.length < 200) return null;
  const r = solveOD(obs, teams, 1, () => ({ off: 0, def: 0 }));
  const out = new Map<string, EffPrior>();
  for (const t of teams) out.set(t, { off: r.off.get(t) ?? 0, def: r.def.get(t) ?? 0 });
  return out;
}

// Net efficiency of a team (offense minus what its defense allows), in metric units — higher = better.
export function netEff(snap: EffSnapshot, team: string): number | null {
  const o = snap.off.get(team);
  const d = snap.def.get(team);
  return o == null || d == null ? null : o - d;
}
