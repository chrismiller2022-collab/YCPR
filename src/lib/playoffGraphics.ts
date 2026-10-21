// Pure data builders for the Weekly Image Dump's playoff graphics
// (src/components/graphics/*). Nothing here touches React or the network —
// the dump panel already has every input (Resume So Far rows, live weekly
// ratings, the latest Monte Carlo run) and just feeds them through.
//
// 12-team rules mirror the site's own model:
//  - Field selection / seeding: the 2026-27 CFP rules the Monte Carlo
//    engine applies per trial (montecarlo/engine.ts buildField): the four
//    Power 4 conference champions + the single highest-ranked Group of 5
//    team are auto-bids, the next-best teams fill to 12 as at-large, and
//    ALL 12 are seeded strictly by ranking (byes go to the top 4 overall,
//    champion or not). FBS Independents can only get in at-large.
//  - Bracket shape / sites: BracketPage.tsx — round 1 is 8v9, 5v12, 6v11,
//    7v10 at the higher seed's home (hfaFor); quarterfinals pair 1 with the
//    8/9 winner, 4 with 5/12, 3 with 6/11, 2 with 7/10; semis are
//    (1-8-9 / 4-5-12) and (2-7-10 / 3-6-11); QF, SF and title are neutral.
//
// 24-team builders wrap bracket24.ts unchanged.

import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor } from "./odds";
import { billRWinPctFromSpread } from "./moneylineBetHistory";
import { buildFCS24Field, buildPlayoff24Field, PLAYOFF24_AUTO_CONFERENCES, type ConfOddsByTeam, type ResumeByTeam } from "./bracket24";

// Same tiers as montecarlo/engine.ts (not exported there).
export const POWER4_CONFS = new Set(["ACC", "Big Ten", "Big 12", "SEC"]);
export const GROUP_OF_5_CONFS = new Set(["American Athletic", "Conference USA", "Mid-American", "Mountain West", "Pac-12", "Sun Belt"]);

/** Ratings source: anything keyed by team with a `rating` (lower = better, site convention), e.g. the dump's liveByTeam. */
export type RatingSource = Record<string, { rating?: number | null; hfa?: number | null } | undefined>;

/** One team in a ranking that drives selection (e.g. a soFarFull row: rank 1 = best). */
export interface RankedRow {
  team: string;
  conf: string;
  rank: number;
  /** The ranking's own metric (Resume So Far score, etc.) — display only. */
  value?: number | null;
}

/** One seeded team in a 12-team field. */
export interface SeededEntry {
  seed: number;
  team: string;
  conf: string;
  /** Power rating (lower = better). */
  rating: number;
  bid: "Auto" | "At-Large";
  /** Conference whose auto-bid this is ("G5" pick shows its own conf). */
  autoConf: string | null;
  /** Position in the ranking used to build the field (null if none). */
  sourceRank: number | null;
  sourceValue: number | null;
}

export function ratingOf(team: string, ratings?: RatingSource | null): number {
  const v = ratings?.[team]?.rating;
  return v != null ? v : TEAMS_BY_NAME[team]?.rating ?? 0;
}

/**
 * 12-team field from any ranking (Resume So Far, resume, power rating...),
 * using the Monte Carlo engine's 2026-27 auto-bid rules. Each Power 4
 * "champion" is that conference's highest-ranked team unless
 * `confChampByConf` names one (e.g. once title games are played).
 */
export function build12FromRanking(
  ranking: RankedRow[],
  ratings?: RatingSource | null,
  opts: { confChampByConf?: Record<string, string> } = {}
): SeededEntry[] {
  const sorted = [...ranking].sort((a, b) => a.rank - b.rank);
  const byTeam = new Map(sorted.map((r) => [r.team, r]));
  const autos: { row: RankedRow; conf: string }[] = [];
  for (const conf of POWER4_CONFS) {
    const named = opts.confChampByConf?.[conf];
    const row = (named && byTeam.get(named)) || sorted.find((r) => r.conf === conf);
    if (row) autos.push({ row, conf });
  }
  const g5 = sorted.find((r) => GROUP_OF_5_CONFS.has(r.conf));
  if (g5) autos.push({ row: g5, conf: g5.conf });
  const autoSet = new Set(autos.map((a) => a.row.team));
  const atLarge = sorted.filter((r) => !autoSet.has(r.team)).slice(0, Math.max(0, 12 - autos.length));
  const entries = [
    ...autos.map((a) => ({ row: a.row, bid: "Auto" as const, autoConf: a.conf })),
    ...atLarge.map((row) => ({ row, bid: "At-Large" as const, autoConf: null })),
  ].sort((a, b) => a.row.rank - b.row.rank);
  return entries.map((e, i) => ({
    seed: i + 1,
    team: e.row.team,
    conf: e.row.conf,
    rating: ratingOf(e.row.team, ratings),
    bid: e.bid,
    autoConf: e.autoConf,
    sourceRank: e.row.rank,
    sourceValue: e.row.value ?? null,
  }));
}

/** Resume So Far rows exactly as WeeklyImageDumpAdminPanel's `soFarFull` ({team, conf, rating, rank}). */
export interface SoFarRow {
  team: string;
  conf: string;
  rating: number;
  rank: number;
}

export function soFarToRanking(rows: SoFarRow[]): RankedRow[] {
  return rows.map((r) => ({ team: r.team, conf: r.conf, rank: r.rank, value: r.rating }));
}

/** "Actual bracket" if the season ended today: 12-team field from Resume So Far. */
export function build12FromResumeSoFar(soFarFull: SoFarRow[], ratings?: RatingSource | null): SeededEntry[] {
  return build12FromRanking(soFarToRanking(soFarFull), ratings);
}

/** Minimal TeamSimResult shape needed (montecarlo/engine.ts). */
export interface McResultLite {
  team: string;
  playoffPct: number;
  avgSeed: number | null;
  confTitlePct?: number | null;
}

/**
 * The projected field exactly as BracketPage.tsx derives it (top 12 by
 * playoffPct, seeded by avgSeed). The MC run doesn't record which bid a
 * team used, so for display "Auto" marks, per Power 4 conference, the field
 * team with the best confTitlePct, plus the field's best G5 team by
 * playoffPct. `ranking` (optional) fills sourceRank for the "lines" list.
 */
export function build12FromMonteCarlo(mcResults: McResultLite[], ratings?: RatingSource | null, ranking?: RankedRow[] | null): SeededEntry[] {
  const withOdds = mcResults.filter((r) => r.playoffPct > 0 && r.avgSeed != null);
  const top12 = [...withOdds].sort((a, b) => b.playoffPct - a.playoffPct).slice(0, 12);
  const seeded = [...top12].sort((a, b) => (a.avgSeed ?? 99) - (b.avgSeed ?? 99)).filter((r) => TEAMS_BY_NAME[r.team]);
  const autoSet = new Set<string>();
  for (const conf of POWER4_CONFS) {
    const best = seeded.filter((r) => TEAMS_BY_NAME[r.team].conf === conf).sort((a, b) => (b.confTitlePct ?? 0) - (a.confTitlePct ?? 0))[0];
    if (best) autoSet.add(best.team);
  }
  const g5 = seeded.filter((r) => GROUP_OF_5_CONFS.has(TEAMS_BY_NAME[r.team].conf)).sort((a, b) => b.playoffPct - a.playoffPct)[0];
  if (g5) autoSet.add(g5.team);
  const rankOf = new Map((ranking ?? []).map((r) => [r.team, r]));
  return seeded.map((r, i) => {
    const conf = TEAMS_BY_NAME[r.team].conf;
    return {
      seed: i + 1,
      team: r.team,
      conf,
      rating: ratingOf(r.team, ratings),
      bid: autoSet.has(r.team) ? "Auto" : "At-Large",
      autoConf: autoSet.has(r.team) ? conf : null,
      sourceRank: rankOf.get(r.team)?.rank ?? null,
      sourceValue: rankOf.get(r.team)?.value ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// 12-team bracket shape (BracketPage.tsx) and exact advance odds.
// ---------------------------------------------------------------------------

/** Round 1 host/away seeds, in bracket (top-to-bottom) order. */
export const R1_GAMES: { host: number; away: number }[] = [
  { host: 8, away: 9 },
  { host: 5, away: 12 },
  { host: 6, away: 11 },
  { host: 7, away: 10 },
];
/** Bye seed facing each R1 game's winner, same order (1v8/9, 4v5/12, 3v6/11, 2v7/10). */
export const QF_BYE_SEEDS = [1, 4, 3, 2];
// Semis: QF[0] vs QF[1], QF[2] vs QF[3] (BracketPage sf1 = 1-side vs 4-side, sf2 = 2-side vs 3-side).

export interface AdvanceOptions {
  /** Ratings/HFA source (liveByTeam). Field entries' own `rating` is used for strength; this supplies per-team HFA via hfaFor. */
  liveByTeam?: RatingSource | null;
  /** Override home-field advantage (points) for a home team. Default hfaFor(team, liveByTeam). */
  hfa?: (homeTeam: string) => number;
  /** Win probability for a team given its own spread (negative = favored). Default billRWinPctFromSpread. */
  winProbFromSpread?: (spread: number) => number;
}

export interface AdvanceOddsRow {
  seed: number;
  team: string;
  conf: string;
  rating: number;
  bye: boolean;
  qf: number;
  sf: number;
  ncg: number;
  win: number;
}

type Dist = Map<string, number>;

/** P(a beats b). hostTeam = whichever plays at home, or null for neutral. */
export function gameWinProb(a: { team: string; rating: number }, b: { team: string; rating: number }, hostTeam: string | null, opts: AdvanceOptions = {}): number {
  const hfa = opts.hfa ?? ((t: string) => hfaFor(t, opts.liveByTeam));
  const wp = opts.winProbFromSpread ?? billRWinPctFromSpread;
  let spreadA = a.rating - b.rating; // lower rating = better, so negative = A favored
  if (hostTeam === a.team) spreadA -= hfa(a.team);
  else if (hostTeam === b.team) spreadA += hfa(b.team);
  return wp(spreadA);
}

/** Exact winner distribution of a game between two sub-bracket distributions. */
function playDist(A: Dist, B: Dist, byTeam: Map<string, SeededEntry>, host: string | null, opts: AdvanceOptions): Dist {
  const out: Dist = new Map();
  for (const [a, pa] of A) {
    for (const [b, pb] of B) {
      const p = gameWinProb(byTeam.get(a)!, byTeam.get(b)!, host, opts);
      out.set(a, (out.get(a) ?? 0) + pa * pb * p);
      out.set(b, (out.get(b) ?? 0) + pa * pb * (1 - p));
    }
  }
  return out;
}

/**
 * Exact (full enumeration of the bracket tree, no simulation) probability
 * of each team reaching the QF, SF, NCG and winning the title. Round 1 is
 * at the higher seed's home; everything after is neutral. Bye seeds 1-4
 * have qf = 1. Rows come back sorted by `win` desc (seed asc on ties).
 * Invariant: Σqf = 8, Σsf = 4, Σncg = 2, Σwin = 1 (checked, warns in dev).
 */
export function computeAdvanceOdds(field: SeededEntry[], opts: AdvanceOptions = {}): AdvanceOddsRow[] {
  if (field.length !== 12) return [];
  const bySeed = new Map(field.map((f) => [f.seed, f]));
  const byTeam = new Map(field.map((f) => [f.team, f]));
  const leaf = (seed: number): Dist => new Map([[bySeed.get(seed)!.team, 1]]);

  const r1 = R1_GAMES.map((g) => playDist(leaf(g.host), leaf(g.away), byTeam, bySeed.get(g.host)!.team, opts));
  const qf = r1.map((d, i) => playDist(leaf(QF_BYE_SEEDS[i]), d, byTeam, null, opts));
  const sf = [playDist(qf[0], qf[1], byTeam, null, opts), playDist(qf[2], qf[3], byTeam, null, opts)];
  const title = playDist(sf[0], sf[1], byTeam, null, opts);

  const sum = (ds: Dist[], team: string) => ds.reduce((s, d) => s + (d.get(team) ?? 0), 0);
  const rows: AdvanceOddsRow[] = field.map((f) => {
    const bye = f.seed <= 4;
    return {
      seed: f.seed,
      team: f.team,
      conf: f.conf,
      rating: f.rating,
      bye,
      qf: bye ? 1 : sum(r1, f.team),
      sf: sum(qf, f.team),
      ncg: sum(sf, f.team),
      win: title.get(f.team) ?? 0,
    };
  });

  const check = advanceOddsSums(rows);
  const off = Math.abs(check.qf - 8) + Math.abs(check.sf - 4) + Math.abs(check.ncg - 2) + Math.abs(check.win - 1);
  if (off > 1e-9 && typeof console !== "undefined") console.warn("computeAdvanceOdds: round sums off", check);

  return rows.sort((a, b) => b.win - a.win || a.seed - b.seed);
}

export function advanceOddsSums(rows: AdvanceOddsRow[]) {
  return rows.reduce((s, r) => ({ qf: s.qf + r.qf, sf: s.sf + r.sf, ncg: s.ncg + r.ncg, win: s.win + r.win }), { qf: 0, sf: 0, ncg: 0, win: 0 });
}

/** One projected game (favorite advances), BracketPage-style. */
export interface ProjectedGame {
  top: SeededEntry;
  bottom: SeededEntry;
  /** Home team, or null when neutral. */
  host: string | null;
  /** Spread for `top` (negative = favored), HFA included. */
  topSpread: number;
  /** P(top wins). */
  topWinProb: number;
  winner: SeededEntry;
}

/** Walk the 12-team bracket with "favored team advances" like BracketPage does (spread <= 0 wins). */
export function projectTwelveTeamBracket(field: SeededEntry[], opts: AdvanceOptions = {}) {
  if (field.length !== 12) return null;
  const bySeed = new Map(field.map((f) => [f.seed, f]));
  const hfa = opts.hfa ?? ((t: string) => hfaFor(t, opts.liveByTeam));
  const play = (top: SeededEntry, bottom: SeededEntry, host: string | null): ProjectedGame => {
    let topSpread = top.rating - bottom.rating;
    if (host === top.team) topSpread -= hfa(top.team);
    else if (host === bottom.team) topSpread += hfa(bottom.team);
    return { top, bottom, host, topSpread, topWinProb: gameWinProb(top, bottom, host, opts), winner: topSpread <= 0 ? top : bottom };
  };
  const firstRound = R1_GAMES.map((g) => play(bySeed.get(g.host)!, bySeed.get(g.away)!, bySeed.get(g.host)!.team));
  const quarterfinals = firstRound.map((g, i) => play(bySeed.get(QF_BYE_SEEDS[i])!, g.winner, null));
  const semifinals = [play(quarterfinals[0].winner, quarterfinals[1].winner, null), play(quarterfinals[2].winner, quarterfinals[3].winner, null)];
  const final = play(semifinals[0].winner, semifinals[1].winner, null);
  return { firstRound, quarterfinals, semifinals, final, champion: final.winner };
}

// ---------------------------------------------------------------------------
// 24-team builders (bracket24.ts) — entries keep bracket24's own shape
// ({team: Team, bidConf, bid, seed}) so pairFirstRoundNoConfConflict /
// reseedAndPair / playGame work on them directly.
// ---------------------------------------------------------------------------

export interface Field24Entry {
  seed: number;
  team: { team: string; conf: string; div: string; rating: number; rank?: number };
  bidConf: string;
  bid: string;
}

function withRatings(field: any[], ratings?: RatingSource | null): Field24Entry[] {
  return field.map((f) => ({ ...f, team: { ...f.team, rating: ratingOf(f.team.team, ratings) } }));
}

/** FBS projected — identical to Playoff24Page (auto-bids by MC conference-title odds, at-large/seeding by saved resume). */
export function build24FbsProjected(confOdds: ConfOddsByTeam | null, resume: ResumeByTeam | null, ratings?: RatingSource | null): Field24Entry[] {
  return withRatings(buildPlayoff24Field(confOdds, resume), ratings);
}

/**
 * FBS so far — bracket24's rules with Resume So Far standing in for both
 * inputs: each of the 10 auto-bid conferences goes to its highest-ranked
 * Resume So Far team (fed to computeAutoBidChampion as a pseudo-odds score),
 * and at-large bids + seeding use Resume So Far rank.
 */
export function build24FbsSoFar(soFarFull: SoFarRow[], ratings?: RatingSource | null): Field24Entry[] {
  const resume: ResumeByTeam = {};
  const pseudoOdds: ConfOddsByTeam = {};
  for (const r of soFarFull) {
    resume[r.team] = { rank: r.rank, rating: r.rating };
    pseudoOdds[r.team] = 1 / r.rank;
  }
  return withRatings(buildPlayoff24Field(pseudoOdds, resume), ratings);
}

/** FCS projected — identical to FCSBracketPage (top 24 FCS by power rating; ratings = liveByTeam). */
export function build24FcsProjected(ratings?: RatingSource | null): Field24Entry[] {
  return withRatings(buildFCS24Field(ratings as any), ratings);
}

/**
 * FCS so far — same FCS shape (no auto-bids, top 8 seeds get byes) but the
 * 24 and their order come from a so-far ranking (e.g. FCS rows of
 * team_resume_ratings_finished, ranked by score) instead of power rating.
 */
export function build24FcsSoFar(soFarRows: SoFarRow[], ratings?: RatingSource | null): Field24Entry[] {
  const fcs = [...soFarRows].filter((r) => TEAMS_BY_NAME[r.team]?.div === "FCS").sort((a, b) => a.rank - b.rank).slice(0, 24);
  return fcs.map((r, i) => {
    const t = TEAMS_BY_NAME[r.team];
    return { seed: i + 1, team: { ...t, rating: ratingOf(r.team, ratings) }, bidConf: t.conf, bid: i < 8 ? "Top Seed" : "At-Large" };
  });
}

export { PLAYOFF24_AUTO_CONFERENCES };
