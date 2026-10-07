// Walk-forward opponent-adjusted EFFICIENCY ratings (the JP+-style core). For each per-play metric
// (success rate, explosiveness, PPA) every team gets an offense effect O and a defense effect D from a
// ridge fit on that metric's per-game values:
//     metric(team on offense vs opp) = mu + O_team + D_opp + hfa·home
// Higher O = better offense; higher D = a defense that ALLOWS more (worse). Each (season, week) snapshot
// only sees games from earlier weeks, and shrinks toward last season's final O/D (mean-reverted) rather
// than toward zero. Only each team's own offensive numbers are used — a game's offense stat for team A
// is the same plays as the defense stat for team B, so using both would double count.
import { solveRidge, type SparseRow } from "./ridgeSolve";
import type { DGame } from "./dataset";

export type EffMetric = "sr" | "expl" | "ppa";
export const EFF_METRICS: EffMetric[] = ["sr", "expl", "ppa"];

export interface TeamGameAdv {
  gameId: string;
  team: string;
  season: number;
  week: number;
  sr: number | null; // offensive success rate
  expl: number | null; // offensive explosiveness
  ppa: number | null; // offensive PPA per play
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

export function toTeamGameAdv(rows: RawAdvRow[]): TeamGameAdv[] {
  return rows.map((r) => ({
    gameId: r.game_id,
    team: r.team,
    season: r.season,
    week: r.week ?? 0,
    sr: r.off_success_rate == null ? null : Number(r.off_success_rate),
    expl: r.off_explosiveness == null ? null : Number(r.off_explosiveness),
    ppa: r.off_ppa == null ? null : Number(r.off_ppa),
  }));
}

export interface EffConfig {
  lambda: Record<EffMetric, number>; // ridge strength, in observations — bigger = prior lasts longer
  rho: number; // share of last season's final O/D carried into the new season
}
export const DEFAULT_EFF_CONFIG: EffConfig = { lambda: { sr: 4, expl: 8, ppa: 6 }, rho: 0.6 };

export interface EffSnapshot {
  off: Map<string, number>; // team -> offense effect (metric units, higher = better)
  def: Map<string, number>; // team -> defense effect (metric units, LOWER = better, allows less)
  hfa: number;
  mu: number;
}
export type EffKey = `${number}|${number}`;
const FCS = "__FCS__";

export function buildEffSnapshots(
  games: DGame[],
  teamGames: TeamGameAdv[],
  metric: EffMetric,
  cfg: EffConfig = DEFAULT_EFF_CONFIG
): Map<EffKey, EffSnapshot> {
  const out = new Map<EffKey, EffSnapshot>();
  const gameById = new Map(games.map((g) => [g.id, g]));
  const seasons = Array.from(new Set(teamGames.map((t) => t.season))).sort((a, b) => a - b);
  let prevOff = new Map<string, number>();
  let prevDef = new Map<string, number>();

  for (const season of seasons) {
    // Observations for this season, resolved to (offense team, defense team, home flag, week, y).
    type Obs = { off: string; def: string; home: number; week: number; y: number };
    const obs: Obs[] = [];
    const teams = new Set<string>();
    for (const tg of teamGames) {
      if (tg.season !== season) continue;
      const y = tg[metric];
      if (y == null) continue;
      const g = gameById.get(tg.gameId);
      if (!g || !g.completed) continue;
      const offIsHome = g.home === tg.team;
      const offFbs = offIsHome ? g.homeFbs : g.awayFbs;
      const opp = offIsHome ? g.away : g.home;
      const oppFbs = offIsHome ? g.awayFbs : g.homeFbs;
      if (!offFbs && !oppFbs) continue;
      const off = offFbs ? tg.team : FCS;
      const def = oppFbs ? opp : FCS;
      if (offFbs) teams.add(tg.team);
      if (oppFbs) teams.add(opp);
      obs.push({ off, def, home: g.neutral ? 0 : offIsHome ? 1 : -1, week: g.week, y });
    }
    if (obs.length === 0) continue;
    const list = [FCS, ...Array.from(teams).sort()];
    const idx = new Map(list.map((t, i) => [t, i]));
    const m = list.length;
    // parameter layout: [hfa, O_0..O_{m-1}, D_0..D_{m-1}]
    const n = 1 + 2 * m;
    const oi = (t: string) => 1 + idx.get(t)!;
    const di = (t: string) => 1 + m + idx.get(t)!;
    const prior = new Array(n).fill(0);
    for (const t of list) {
      prior[oi(t)] = t === FCS ? 0 : cfg.rho * (prevOff.get(t) ?? 0);
      prior[di(t)] = t === FCS ? 0 : cfg.rho * (prevDef.get(t) ?? 0);
    }
    const lambda = new Array(n).fill(cfg.lambda[metric]);
    lambda[0] = 30;
    lambda[oi(FCS)] = 0.5;
    lambda[di(FCS)] = 0.5;
    const maxWeek = Math.max(...obs.map((o) => o.week), 1);
    let lastMu = out.size > 0 ? Array.from(out.values()).slice(-1)[0].mu : obs.reduce((s, o) => s + o.y, 0) / obs.length;

    for (let w = 1; w <= maxWeek + 1; w++) {
      const use = obs.filter((o) => o.week < w);
      let mu = lastMu;
      if (use.length >= 20) mu = use.reduce((s, o) => s + o.y, 0) / use.length;
      const rows: SparseRow[] = use.map((o) => ({ idx: [0, oi(o.off), di(o.def)], val: [o.home, 1, 1], y: o.y - mu }));
      const theta = solveRidge(rows, lambda, prior);
      const off = new Map<string, number>();
      const def = new Map<string, number>();
      for (const t of list) {
        if (t === FCS) continue;
        off.set(t, theta[oi(t)]);
        def.set(t, theta[di(t)]);
      }
      // Center O and D separately across FBS teams (the split between mu and the effects is arbitrary).
      const mo = Array.from(off.values()).reduce((s, v) => s + v, 0) / off.size;
      const md = Array.from(def.values()).reduce((s, v) => s + v, 0) / def.size;
      for (const [t, v] of off) off.set(t, v - mo);
      for (const [t, v] of def) def.set(t, v - md);
      out.set(`${season}|${w}`, { off, def, hfa: theta[0], mu: mu + mo + md });
      lastMu = mu;
    }
    prevOff = out.get(`${season}|${maxWeek + 1}`)!.off;
    prevDef = out.get(`${season}|${maxWeek + 1}`)!.def;
  }
  return out;
}

// Net efficiency of a team (offense minus what its defense allows), in metric units — higher = better.
export function netEff(snap: EffSnapshot, team: string): number | null {
  const o = snap.off.get(team);
  const d = snap.def.get(team);
  return o == null || d == null ? null : o - d;
}
