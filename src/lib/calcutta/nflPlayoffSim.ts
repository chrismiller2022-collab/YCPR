import { formatDef, propKind } from "./formats";
import type { CalcuttaAuction, FieldTeam, PropKind, TeamResult } from "./types";

// Monte Carlo of the 14-team NFL playoff, for the Desk.
//
// Each game: margin ~ Normal(rating diff + HFA, marginSd), rounded to whole
// points (ties go to OT, decided by a field goal). Each simulated season gets
// its own rating draw (ratingNoise, plus the sources' std dev if enabled),
// so favorites aren't overconfident. Bracket: 2v7, 3v6, 4v5 at the higher
// seed; the 1 seed hosts the lowest remaining seed; higher seed hosts after
// that; Super Bowl neutral.
//
// Results already entered on the auction (team eliminated / rounds cleared)
// are forced, so mid-playoffs it prices the rest of the bracket.
//
// The raw per-sim outcomes are kept (rounds cleared + each side prize's
// share per team) so payouts can be re-priced instantly when percentages
// change, and so a portfolio's full distribution can be read off.

export type SimPropKind = Exclude<PropKind, "custom">;
export const SIM_PROP_KINDS: SimPropKind[] = ["biggest_upset", "worst_loss", "cinderella", "best_ats"];

export interface SimInputs {
  field: FieldTeam[];
  ratings: Record<string, { rating: number; sd: number | null }>;
  hfa: number;
  marginSd: number;
  ratingNoise: number;
  useSourceSd: boolean;
  sims: number;
  seed?: number;
  results?: Record<string, TeamResult>;
}

export interface SimOutput {
  teamIds: string[];
  sims: number;
  /** rounds cleared, [sim * T + team] */
  rc: Uint8Array;
  /** share (0–1, ties fractional) of each side prize, [sim * T + team] */
  props: Record<SimPropKind, Float32Array>;
  /** P(cleared ≥ r rounds), r = 1..4, per team */
  reach: Record<string, number[]>;
  propProb: Record<SimPropKind, Record<string, number>>;
  warnings: string[];
  ms: number;
}

export const DEFAULT_SIM = { hfa: 1.5, marginSd: 13.5, ratingNoise: 1.5, useSourceSd: false, sims: 20000 };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function validateNflField(field: FieldTeam[]): string | null {
  for (const conf of ["AFC", "NFC"]) for (let s = 1; s <= 7; s++) if (!field.some((t) => t.group === conf && t.seed === s)) return `Missing ${conf} #${s} seed`;
  return null;
}

interface Game {
  w: number;
  l: number;
  margin: number; // winner's margin, > 0
}

export function simulateNflPlayoffs(inp: SimInputs): SimOutput {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const warnings: string[] = [];
  const bad = validateNflField(inp.field);
  if (bad) throw new Error(bad);
  const teams = [...inp.field].sort((a, b) => a.group.localeCompare(b.group) || (a.seed ?? 0) - (b.seed ?? 0));
  const T = teams.length;
  const ids = teams.map((t) => t.id);
  const seedOf = teams.map((t) => t.seed ?? 0);
  const base = teams.map((t) => {
    const r = inp.ratings[t.id];
    if (!r) warnings.push(`No rating for ${t.name} — using 0`);
    return r?.rating ?? 0;
  });
  const noise = teams.map((t) => {
    const sd = inp.useSourceSd ? inp.ratings[t.id]?.sd ?? 0 : 0;
    return Math.sqrt(inp.ratingNoise ** 2 + sd ** 2);
  });
  const idx = (conf: string, seed: number) => teams.findIndex((t) => t.group === conf && t.seed === seed);

  // known[team][round]: +1 won, -1 lost, 0 not played yet
  const known = teams.map((t) => {
    const r = inp.results?.[t.id];
    return [0, 1, 2, 3].map((round) => {
      if (!r) return 0;
      if (r.roundsCleared > round) return 1;
      if (r.eliminated && r.roundsCleared === round) return -1;
      return 0;
    });
  });

  const N = inp.sims;
  const rand = mulberry32(inp.seed ?? 12345);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  const rc = new Uint8Array(N * T);
  const props = Object.fromEntries(SIM_PROP_KINDS.map((k) => [k, new Float32Array(N * T)])) as Record<SimPropKind, Float32Array>;
  const R = new Float64Array(T);
  const atsW = new Int32Array(T);
  const atsG = new Int32Array(T);
  const cleared = new Uint8Array(T);

  for (let s = 0; s < N; s++) {
    for (let i = 0; i < T; i++) {
      R[i] = base[i] + noise[i] * gauss();
      atsW[i] = 0;
      atsG[i] = 0;
      cleared[i] = 0;
    }
    const games: Game[] = [];
    const play = (h: number, a: number, round: number, neutral: boolean): number => {
      const d = R[h] - R[a] + (neutral ? 0 : inp.hfa);
      let m = Math.round(d + inp.marginSd * gauss());
      if (m === 0) m = rand() < 0.5 + d / 40 ? 3 : -3;
      const kh = known[h][round];
      const ka = known[a][round];
      if (kh === 1 || ka === -1) m = Math.abs(m);
      else if (kh === -1 || ka === 1) m = -Math.abs(m);
      // ATS vs the model's own line (home -d)
      const cov = m - d;
      if (Math.abs(cov) > 1e-9) {
        atsG[h]++;
        atsG[a]++;
        if (cov > 0) atsW[h]++;
        else atsW[a]++;
      }
      const w = m > 0 ? h : a;
      games.push({ w, l: w === h ? a : h, margin: Math.abs(m) });
      cleared[w] = round + 1;
      return w;
    };

    const champs: number[] = [];
    for (const conf of ["AFC", "NFC"]) {
      const one = idx(conf, 1);
      cleared[one] = 1; // bye
      const wc = [play(idx(conf, 2), idx(conf, 7), 0, false), play(idx(conf, 3), idx(conf, 6), 0, false), play(idx(conf, 4), idx(conf, 5), 0, false)];
      wc.sort((x, y) => seedOf[x] - seedOf[y]);
      const d1 = play(one, wc[2], 1, false);
      const d2 = play(wc[0], wc[1], 1, false);
      const [h, a] = seedOf[d1] <= seedOf[d2] ? [d1, d2] : [d2, d1];
      champs.push(play(h, a, 2, false));
    }
    const sb = play(champs[0], champs[1], 3, true);

    const off = s * T;
    for (let i = 0; i < T; i++) rc[off + i] = cleared[i];

    // Biggest upset by seed (tiebreak: margin). None → Super Bowl champ.
    let bestDiff = 0;
    let bestMargin = -1;
    let ups: number[] = [];
    for (const g of games) {
      const diff = seedOf[g.w] - seedOf[g.l];
      if (diff <= 0) continue;
      if (diff > bestDiff || (diff === bestDiff && g.margin > bestMargin)) {
        bestDiff = diff;
        bestMargin = g.margin;
        ups = [g.w];
      } else if (diff === bestDiff && g.margin === bestMargin && !ups.includes(g.w)) ups.push(g.w);
    }
    if (!ups.length) ups = [sb];
    for (const u of ups) props.biggest_upset[off + u] += 1 / ups.length;

    // Worst margin of defeat
    let worst = 0;
    for (const g of games) worst = Math.max(worst, g.margin);
    const losers = [...new Set(games.filter((g) => g.margin === worst).map((g) => g.l))];
    for (const u of losers) props.worst_loss[off + u] += 1 / losers.length;

    // Cinderella: furthest 5–7 seed, tiebreak lower seed
    let ck = -1;
    let cw: number[] = [];
    for (let i = 0; i < T; i++) {
      if (seedOf[i] < 5) continue;
      const key = cleared[i] * 10 + seedOf[i];
      if (key > ck) {
        ck = key;
        cw = [i];
      } else if (key === ck) cw.push(i);
    }
    for (const u of cw) props.cinderella[off + u] += 1 / cw.length;

    // Best ATS %, tiebreak most ATS wins
    let ak = -1;
    let aw: number[] = [];
    for (let i = 0; i < T; i++) {
      if (!atsG[i]) continue;
      const key = (atsW[i] / atsG[i]) * 100 + atsW[i] / 100;
      if (key > ak + 1e-9) {
        ak = key;
        aw = [i];
      } else if (Math.abs(key - ak) <= 1e-9) aw.push(i);
    }
    for (const u of aw) props.best_ats[off + u] += 1 / aw.length;
  }

  const reach: Record<string, number[]> = {};
  const propProb = Object.fromEntries(SIM_PROP_KINDS.map((k) => [k, {} as Record<string, number>])) as SimOutput["propProb"];
  for (let i = 0; i < T; i++) {
    const r = [0, 0, 0, 0];
    const pp = Object.fromEntries(SIM_PROP_KINDS.map((k) => [k, 0])) as Record<SimPropKind, number>;
    for (let s = 0; s < N; s++) {
      const v = rc[s * T + i];
      for (let k = 0; k < v; k++) r[k]++;
      for (const k of SIM_PROP_KINDS) pp[k] += props[k][s * T + i];
    }
    reach[ids[i]] = r.map((x) => x / N);
    for (const k of SIM_PROP_KINDS) propProb[k][ids[i]] = pp[k] / N;
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { teamIds: ids, sims: N, rc, props, reach, propProb, warnings, ms: t1 - t0 };
}

/**
 * Each team's payout in each sim, as % of the net pot, under the auction's
 * current payout rules. Custom side prizes the sim can't model are priced
 * as an even split across the field (and flagged in the UI).
 */
export function payoutMatrix(sim: SimOutput, a: CalcuttaAuction): Float32Array {
  const T = sim.teamIds.length;
  const out = new Float32Array(sim.sims * T);
  const rounds = formatDef(a.format).rounds;
  const field = new Map(a.field.map((t) => [t.id, t]));
  const cum: number[] = [0];
  for (const r of rounds) cum.push(cum[cum.length - 1] + (a.payouts.roundPct[r.key] ?? 0));
  const firstPct = a.payouts.roundPct[rounds[0]?.key] ?? 0;
  const byeAdj = sim.teamIds.map((id) => (field.get(id)?.bye && !a.payouts.byeCountsAsWin ? firstPct : 0));
  let customEach = 0;
  const modeled: { kind: SimPropKind; pct: number }[] = [];
  for (const p of a.payouts.props) {
    const k = propKind(p);
    if (k === "custom") customEach += p.pct / T;
    else modeled.push({ kind: k, pct: p.pct });
  }
  for (let s = 0; s < sim.sims; s++) {
    const off = s * T;
    for (let i = 0; i < T; i++) {
      const c = sim.rc[off + i];
      let v = cum[c] - (c >= 1 ? byeAdj[i] : 0) + customEach;
      for (const m of modeled) v += m.pct * sim.props[m.kind][off + i];
      out[off + i] = v;
    }
  }
  return out;
}

/** Mean of each team's payout % (its fair share of the net pot). */
export function fairShares(sim: SimOutput, matrix: Float32Array): Record<string, number> {
  const T = sim.teamIds.length;
  const sums = new Float64Array(T);
  for (let s = 0; s < sim.sims; s++) for (let i = 0; i < T; i++) sums[i] += matrix[s * T + i];
  return Object.fromEntries(sim.teamIds.map((id, i) => [id, sums[i] / sim.sims]));
}
