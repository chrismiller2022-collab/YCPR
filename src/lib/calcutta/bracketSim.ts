import { formatDef, propKind } from "./formats";
import type { CalcuttaAuction, FieldTeam, FormatKey, PropKind, TeamResult } from "./types";

// Monte Carlo of a playoff bracket, for the Desk. One engine for every
// format; each format only supplies how its bracket is played out:
//
//   NFL Playoffs   2v7, 3v6, 4v5 at the higher seed; the 1 seed hosts the
//                  lowest seed left; higher seed hosts; Super Bowl neutral.
//   CFB 12         byes 1–4; first round on campus (5v12, 6v11, 7v10, 8v9);
//                  quarterfinals 1–4 vs those winners, then semis, title —
//                  all neutral bowls; fixed bracket, no reseeding.
//   CFB 24         byes 1–8; first round 9v24 … 16v17 on campus; reseeded
//                  every round (best vs worst left), higher seed hosts, title
//                  neutral.
//   March Madness  First Four play-ins, then the fixed 1v16, 8v9, 5v12, 4v13,
//                  6v11, 3v14, 7v10, 2v15 bracket in each region; Final Four
//                  region pairs from the region order. All neutral.
//
// Each game: margin ~ Normal(rating diff + home field, marginSd), rounded to
// whole points (ties → OT, decided by a field goal / a basket). Every
// simulated tournament draws its own ratings (ratingNoise, plus the sources'
// std dev if enabled), so favorites aren't overconfident. Results already
// entered on the auction are forced, so mid-tournament it prices what's left.
//
// The raw per-sim outcomes are kept (rounds cleared + each side prize's share
// per team) so payouts re-price instantly and portfolio spreads can be read.

export type SimPropKind = Exclude<PropKind, "custom">;
export const SIM_PROP_KINDS: SimPropKind[] = ["biggest_upset", "worst_loss", "cinderella", "best_ats", "lowest_f4_seed"];

export interface SimInputs {
  format: FormatKey;
  field: FieldTeam[];
  /** Points better than an average team (higher = better). */
  ratings: Record<string, { rating: number; sd: number | null }>;
  hfa: number;
  /** Per-team home field (CFB), overrides hfa when the team hosts. */
  hfaByTeam?: Record<string, number>;
  marginSd: number;
  ratingNoise: number;
  useSourceSd: boolean;
  sims: number;
  seed?: number;
  results?: Record<string, TeamResult>;
  /** March Madness region order. */
  regions?: string[];
}

export interface SimOutput {
  format: FormatKey;
  teamIds: string[];
  sims: number;
  rounds: number;
  /** rounds cleared, [sim * T + team] */
  rc: Uint8Array;
  /** share (0–1, ties fractional) of each side prize, [sim * T + team] */
  props: Record<SimPropKind, Float32Array>;
  /** P(cleared ≥ r rounds), r = 1..rounds, per team */
  reach: Record<string, number[]>;
  /** P(won the First Four), March Madness play-in teams only */
  playInWin: Record<string, number>;
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

export const MM_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

/** Region order for March Madness: the auction's, else first appearance in the field. */
export function regionOrder(field: FieldTeam[], regions?: string[]): string[] {
  const seen: string[] = [];
  for (const t of field) if (t.group && !seen.includes(t.group)) seen.push(t.group);
  if (regions && regions.length === seen.length && regions.every((r) => seen.includes(r))) return regions;
  return seen;
}

/** Why this field can't be simulated yet, or null if it can. */
export function validateField(format: FormatKey, field: FieldTeam[], regions?: string[]): string | null {
  if (format === "nfl_playoffs") {
    for (const conf of ["AFC", "NFC"]) for (let s = 1; s <= 7; s++) if (!field.some((t) => t.group === conf && t.seed === s)) return `Missing ${conf} #${s} seed`;
    return null;
  }
  if (format === "cfb_playoff12" || format === "cfb_playoff24") {
    const n = formatDef(format).fieldSize;
    for (let s = 1; s <= n; s++) if (!field.some((t) => t.seed === s)) return `Missing the #${s} seed`;
    return null;
  }
  if (format === "march_madness") {
    const regs = regionOrder(field, regions);
    if (regs.length !== 4) return `Need 4 regions (have ${regs.length})`;
    for (const r of regs)
      for (let s = 1; s <= 16; s++) {
        const n = field.filter((t) => t.group === r && t.seed === s).length;
        if (n === 0) return `${r} is missing its #${s} seed`;
        if (n > 2) return `${r} has ${n} teams on the #${s} line`;
      }
    return null;
  }
  return "No bracket for this format yet";
}

/** Kept for older callers. */
export const validateNflField = (field: FieldTeam[]) => validateField("nfl_playoffs", field);

interface Game {
  w: number;
  l: number;
  margin: number;
  round: number;
}

export function simulateBracket(inp: SimInputs): SimOutput {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const def = formatDef(inp.format);
  const bad = validateField(inp.format, inp.field, inp.regions);
  if (bad) throw new Error(bad);
  const warnings: string[] = [];
  const teams = [...inp.field].sort((a, b) => a.group.localeCompare(b.group) || (a.seed ?? 0) - (b.seed ?? 0) || a.name.localeCompare(b.name));
  const T = teams.length;
  const ids = teams.map((t) => t.id);
  const seedOf = teams.map((t) => t.seed ?? 0);
  const R_ = def.rounds.length;
  const base = teams.map((t) => {
    const r = inp.ratings[t.id];
    if (!r) warnings.push(`No rating for ${t.name} — using 0`);
    return r?.rating ?? 0;
  });
  const noise = teams.map((t) => Math.sqrt(inp.ratingNoise ** 2 + (inp.useSourceSd ? inp.ratings[t.id]?.sd ?? 0 : 0) ** 2));
  const hostHfa = teams.map((t) => inp.hfaByTeam?.[t.id] ?? inp.hfa);
  const at = (group: string | null, seed: number) => {
    const out: number[] = [];
    teams.forEach((t, i) => {
      if (t.seed === seed && (group == null || t.group === group)) out.push(i);
    });
    return out;
  };
  const one = (group: string | null, seed: number) => at(group, seed)[0];
  const regions = regionOrder(inp.field, inp.regions);

  // known[team][round]: +1 won, −1 lost, 0 not played yet. Index 0 = play-in.
  const known = teams.map((t) => {
    const r = inp.results?.[t.id];
    const out = [r?.playIn === "won" ? 1 : r?.playIn === "lost" ? -1 : 0];
    for (let round = 0; round < R_; round++) {
      if (!r) out.push(0);
      else if (r.roundsCleared > round) out.push(1);
      else if (r.eliminated && r.roundsCleared === round && r.playIn !== "lost") out.push(-1);
      else out.push(0);
    }
    return out;
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
  const playInWins = new Float64Array(T);
  const R = new Float64Array(T);
  const atsW = new Int32Array(T);
  const atsG = new Int32Array(T);
  const cleared = new Uint8Array(T);
  const ot = inp.format === "march_madness" ? 2 : 3;
  let games: Game[] = [];

  /** Plays one game; `h` hosts unless neutral (for neutral games pass the better seed first). */
  const play = (h: number, a: number, round: number, neutral: boolean): number => {
    const d = R[h] - R[a] + (neutral ? 0 : hostHfa[h]);
    let m = Math.round(d + inp.marginSd * gauss());
    if (m === 0) m = rand() < 0.5 + d / 40 ? ot : -ot;
    const kh = known[h][round + 1];
    const ka = known[a][round + 1];
    if (kh === 1 || ka === -1) m = Math.abs(m);
    else if (kh === -1 || ka === 1) m = -Math.abs(m);
    const w = m > 0 ? h : a;
    if (round >= 0) {
      const cov = m - d;
      if (Math.abs(cov) > 1e-9) {
        atsG[h]++;
        atsG[a]++;
        if (cov > 0) atsW[h]++;
        else atsW[a]++;
      }
      games.push({ w, l: w === h ? a : h, margin: Math.abs(m), round });
      cleared[w] = round + 1;
    } else playInWins[w]++;
    return w;
  };
  const better = (x: number, y: number): [number, number] => (seedOf[x] <= seedOf[y] ? [x, y] : [y, x]);
  const playBetterFirst = (x: number, y: number, round: number, neutral: boolean) => {
    const [h, a] = better(x, y);
    return play(h, a, round, neutral);
  };

  const runners: Record<string, () => number> = {
    nfl_playoffs: () => {
      const champs: number[] = [];
      for (const conf of ["AFC", "NFC"]) {
        const top = one(conf, 1);
        cleared[top] = 1;
        const wc = [play(one(conf, 2), one(conf, 7), 0, false), play(one(conf, 3), one(conf, 6), 0, false), play(one(conf, 4), one(conf, 5), 0, false)];
        wc.sort((x, y) => seedOf[x] - seedOf[y]);
        const d1 = play(top, wc[2], 1, false);
        const d2 = play(wc[0], wc[1], 1, false);
        champs.push(playBetterFirst(d1, d2, 2, false));
      }
      return play(champs[0], champs[1], 3, true);
    },
    cfb_playoff12: () => {
      const s = (n: number) => one(null, n);
      for (let n = 1; n <= 4; n++) cleared[s(n)] = 1;
      const w89 = play(s(8), s(9), 0, false);
      const w512 = play(s(5), s(12), 0, false);
      const w710 = play(s(7), s(10), 0, false);
      const w611 = play(s(6), s(11), 0, false);
      const q1 = play(s(1), w89, 1, true);
      const q4 = play(s(4), w512, 1, true);
      const q2 = play(s(2), w710, 1, true);
      const q3 = play(s(3), w611, 1, true);
      const f1 = playBetterFirst(q1, q4, 2, true);
      const f2 = playBetterFirst(q2, q3, 2, true);
      return playBetterFirst(f1, f2, 3, true);
    },
    cfb_playoff24: () => {
      const s = (n: number) => one(null, n);
      let pool: number[] = [];
      for (let n = 1; n <= 8; n++) {
        cleared[s(n)] = 1;
        pool.push(s(n));
      }
      for (let n = 9; n <= 16; n++) pool.push(play(s(n), s(33 - n), 0, false));
      for (let round = 1; round <= 3; round++) {
        pool.sort((x, y) => seedOf[x] - seedOf[y]);
        const next: number[] = [];
        for (let i = 0; i < pool.length / 2; i++) next.push(play(pool[i], pool[pool.length - 1 - i], round, false));
        pool = next;
      }
      return playBetterFirst(pool[0], pool[1], 4, true);
    },
    march_madness: () => {
      const champs = regions.map((reg) => {
        let cur = MM_ORDER.map((seed) => {
          const slot = at(reg, seed);
          return slot.length === 2 ? play(slot[0], slot[1], -1, true) : slot[0];
        });
        for (let round = 0; round < 4; round++) {
          const next: number[] = [];
          for (let i = 0; i < cur.length; i += 2) next.push(playBetterFirst(cur[i], cur[i + 1], round, true));
          cur = next;
        }
        return cur[0];
      });
      const f1 = playBetterFirst(champs[0], champs[1], 4, true);
      const f2 = playBetterFirst(champs[2], champs[3], 4, true);
      return playBetterFirst(f1, f2, 5, true);
    },
  };
  const run = runners[inp.format];
  if (!run) throw new Error("No bracket for this format yet");

  for (let s = 0; s < N; s++) {
    for (let i = 0; i < T; i++) {
      R[i] = base[i] + noise[i] * gauss();
      atsW[i] = 0;
      atsG[i] = 0;
      cleared[i] = 0;
    }
    games = [];
    const champ = run();
    const off = s * T;
    for (let i = 0; i < T; i++) rc[off + i] = cleared[i];

    // Biggest upset by seed (tiebreak: margin). None → champion.
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
    if (!ups.length) ups = [champ];
    for (const u of ups) props.biggest_upset[off + u] += 1 / ups.length;

    // Worst margin of defeat
    let worst = 0;
    for (const g of games) worst = Math.max(worst, g.margin);
    const losers = [...new Set(games.filter((g) => g.margin === worst).map((g) => g.l))];
    for (const u of losers) props.worst_loss[off + u] += 1 / losers.length;

    // Cinderella: furthest low seed, tiebreak lower seed
    let ck = -1;
    let cw: number[] = [];
    for (let i = 0; i < T; i++) {
      if (seedOf[i] < def.cinderellaMinSeed) continue;
      const key = cleared[i] * 100 + seedOf[i];
      if (key > ck) {
        ck = key;
        cw = [i];
      } else if (key === ck) cw.push(i);
    }
    for (const u of cw) props.cinderella[off + u] += 1 / cw.length;

    // Lowest seed (highest number) among the last four teams, ties split
    let lf = -1;
    let lw: number[] = [];
    for (let i = 0; i < T; i++) {
      if (cleared[i] < R_ - 2) continue;
      if (seedOf[i] > lf) {
        lf = seedOf[i];
        lw = [i];
      } else if (seedOf[i] === lf) lw.push(i);
    }
    for (const u of lw) props.lowest_f4_seed[off + u] += 1 / lw.length;

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
  const playInWin: Record<string, number> = {};
  const propProb = Object.fromEntries(SIM_PROP_KINDS.map((k) => [k, {} as Record<string, number>])) as SimOutput["propProb"];
  for (let i = 0; i < T; i++) {
    const r = new Array(R_).fill(0);
    const pp = Object.fromEntries(SIM_PROP_KINDS.map((k) => [k, 0])) as Record<SimPropKind, number>;
    for (let s = 0; s < N; s++) {
      const v = rc[s * T + i];
      for (let k = 0; k < v; k++) r[k]++;
      for (const k of SIM_PROP_KINDS) pp[k] += props[k][s * T + i];
    }
    reach[ids[i]] = r.map((x) => x / N);
    if (playInWins[i] > 0 || at(teams[i].group, seedOf[i]).length === 2) playInWin[ids[i]] = playInWins[i] / N;
    for (const k of SIM_PROP_KINDS) propProb[k][ids[i]] = pp[k] / N;
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { format: inp.format, teamIds: ids, sims: N, rounds: R_, rc, props, reach, playInWin, propProb, warnings, ms: t1 - t0 };
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
