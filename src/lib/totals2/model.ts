// Totals v2 — a TEAM-level residual model for game totals and team totals.
//
// Why team level: a game total is two team totals, and team totals are the softer market, so the model is built
// around one team's points against one defense. The game total is simply the sum of the two sides.
//
// Two layers, both walk-forward (a season is only ever predicted by fits on EARLIER seasons):
//   Layer 1 (market-blind): a team's points from point-in-time, opponent-adjusted ratings — efficiency (PPA,
//     success rate, explosiveness, garbage-time-filtered success rate and isolated explosiveness), scoring
//     (points, points per drive), pace (drives and plays per game), special teams, home field, preseason talent.
//     Every rating at week w is solved from games BEFORE week w only (src/lib/drogba/efficiencyRatings.ts), shrunk
//     toward last season's final rating; how fast it lets go of that prior depends on returning production.
//   Layer 2 (residual): target = actual team points − the MARKET's implied team points (from the total and spread),
//     i.e. the market's own number carries a weight of exactly 1. Inputs: the layer-1 disagreement with the market
//     (capped, separate weights before/after week 4), weather, and the market number itself (does the market over-
//     or under-shoot at the extremes?). Heavy shrinkage — the fitted weights are the honest size of the edge.
// Fitted against the closing line ("beat the close", for bets near kickoff) and separately against the opening
// line (for bets when lines open — graded by closing-line value).
import { fitDenseRidge, solveRidge } from "../drogba/ridgeSolve";
import { buildEffSnapshots, toTeamGameAdv, type EffSnapshot, type RawAdvRow, type RawPlayAggRow, type TeamGameAdv } from "../drogba/efficiencyRatings";
import { buildMarginSnapshots, type RatingSnapshot } from "../drogba/marginRatings";
import { kickAverages, stValue, ST_CONFIG } from "../drogba/engine";
import { buildPreseasonMap, earlyWeight, type PreseasonZ, type RawPreseasonRow } from "../drogba/preseason";
import type { DGame, RawLineRow } from "../drogba/dataset";
import { WEATHER_FEATURES, weatherFeatureVector, type GameWeatherInputs, type WeatherFeature } from "./weatherFeatures";

// ------------------------------------------------------------------ config
export const T2_METRICS = ["ppa", "sr", "expl", "srf", "isof", "pts", "ppd", "drives", "plays"] as const;
export type T2Metric = (typeof T2_METRICS)[number];

export interface T2Config {
  lambda: Record<T2Metric, number>; // ridge strength per metric, in games of evidence (bigger = prior lasts longer)
  rho: number; // share of last season's final rating carried into the new season, for an average-returning team
  retLambdaK: number; // prior strength × exp(k · returning-production z): k > 0 = low-returning teams let go of the prior faster
  retRhoK: number; // carried share + k · returning z: k > 0 = low-returning teams start closer to average
  alpha1: number; // layer-1 ridge (standardized features)
  alpha2: number; // layer-2 ridge (raw-unit features)
  edgeCap: number; // layer-2 caps the layer-1 disagreement at ±this many points per team
}

// Chosen by walk-forward tuning on 2023-24 only (scripts/totals_v2/train.ts --tune), then reported untouched on 2025-26.
export const DEFAULT_T2_CONFIG: T2Config = {
  lambda: { ppa: 3, sr: 2, expl: 4, srf: 2, isof: 4, pts: 3, ppd: 3, drives: 4, plays: 4 },
  rho: 0.7,
  retLambdaK: 1.0,
  retRhoK: 0.3,
  alpha1: 200,
  alpha2: 8000,
  edgeCap: 4,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ market
export interface Market {
  provider: string | null;
  openTotal: number | null;
  openSpread: number | null; // home-relation (negative = home favored)
  closeTotal: number | null;
  closeSpread: number | null;
}
// Bovada first: the only book with open AND close on nearly every FBS game 2021-26 (see drogba/dataset.ts).
export const T2_MARKET_ORDER = ["Bovada", "DraftKings", "Draft Kings", "ESPN Bet", "consensus", "market_median", "William Hill (New Jersey)", "Caesars Sportsbook (Colorado)"];

export function buildMarkets(lines: RawLineRow[]): Map<string, Market> {
  const by = new Map<string, RawLineRow[]>();
  for (const l of lines) by.set(l.game_id, [...(by.get(l.game_id) ?? []), l]);
  const rank = (p: string | null) => {
    const i = T2_MARKET_ORDER.indexOf(p ?? "");
    return i < 0 ? 99 : i;
  };
  const out = new Map<string, Market>();
  for (const [id, ls] of by) {
    const sorted = [...ls].sort((a, b) => rank(a.provider) - rank(b.provider));
    const close = sorted.find((l) => l.over_under != null && l.spread != null);
    const sameOpen = close && close.opening_over_under != null && close.opening_spread != null ? close : undefined;
    const open = sameOpen ?? sorted.find((l) => l.opening_over_under != null && l.opening_spread != null);
    out.set(id, {
      provider: close?.provider ?? open?.provider ?? null,
      closeTotal: close?.over_under ?? null,
      closeSpread: close?.spread ?? null,
      openTotal: open?.opening_over_under ?? null,
      openSpread: open?.opening_spread ?? null,
    });
  }
  return out;
}

/** The market's points for one side: total split by the spread (homeSpread negative = home favored). */
export const impliedPoints = (total: number, homeSpread: number, side: "home" | "away") => (side === "home" ? (total - homeSpread) / 2 : (total + homeSpread) / 2);

// ------------------------------------------------------------------ ratings
export interface RawAdvRowT2 extends RawAdvRow {
  off_plays: number | null;
  off_drives: number | null;
}

export interface T2Inputs {
  games: DGame[];
  adv: RawAdvRowT2[];
  plays: RawPlayAggRow[];
  preseason: RawPreseasonRow[];
}

export interface T2Ratings {
  eff: Record<T2Metric, Map<string, EffSnapshot>>;
  st: Map<string, RatingSnapshot>;
  pre: Map<string, PreseasonZ>;
}

function teamGames(inp: T2Inputs): TeamGameAdv[] {
  const tg = toTeamGameAdv(inp.adv, inp.plays);
  const advBy = new Map(inp.adv.map((r) => [`${r.game_id}|${r.team}`, r]));
  const gameBy = new Map(inp.games.map((g) => [g.id, g]));
  for (const t of tg) {
    const a = advBy.get(`${t.gameId}|${t.team}`);
    const g = gameBy.get(t.gameId);
    const pts = g && g.completed ? (g.home === t.team ? g.homePts : g.away === t.team ? g.awayPts : null) : null;
    const drives = a?.off_drives == null ? null : Number(a.off_drives);
    const plays = a?.off_plays == null ? null : Number(a.off_plays);
    t.v.drives = drives != null && drives >= 5 ? drives : null;
    t.v.plays = plays != null && plays >= 30 ? plays : null;
    // Points are capped so one 70-point blowout doesn't define an offense.
    t.v.pts = pts == null ? null : Math.min(56, pts);
    t.v.ppd = pts != null && drives != null && drives >= 5 ? Math.min(7, pts / drives) : null;
  }
  return tg;
}

/** Walk-forward ratings for every metric. `weeklyFrom` = first season that needs week-by-week snapshots. */
export function buildT2Ratings(inp: T2Inputs, cfg: T2Config = DEFAULT_T2_CONFIG, weeklyFrom?: number): T2Ratings {
  const tg = teamGames(inp);
  const pre = buildPreseasonMap(inp.preseason);
  const retZ = (season: number, team: string) => pre.get(`${season}|${team}`)?.[1] ?? 0;
  const teamOpts = {
    weeklyFrom,
    lambdaMult: (s: number, t: string) => clamp(Math.exp(cfg.retLambdaK * retZ(s, t)), 0.3, 3),
    rhoFor: (s: number, t: string) => clamp(cfg.rho + cfg.retRhoK * retZ(s, t), 0.2, 0.97),
  };
  const eff = {} as Record<T2Metric, Map<string, EffSnapshot>>;
  for (const m of T2_METRICS) eff[m] = buildEffSnapshots(inp.games, tg, m, { lambda: cfg.lambda, rho: cfg.rho }, undefined, teamOpts);

  const stBy = new Map<string, number>();
  const kavg = kickAverages(inp.plays);
  for (const p of inp.plays) {
    const v = stValue(p, kavg);
    if (v != null) stBy.set(`${p.game_id}|${p.team}`, v);
  }
  const st = buildMarginSnapshots(inp.games, ST_CONFIG, {
    fcsPrior: 0,
    target: (g) => {
      const h = stBy.get(`${g.id}|${g.home}`);
      const a = stBy.get(`${g.id}|${g.away}`);
      return h == null || a == null ? null : h - a;
    },
  });
  return { eff, st, pre };
}

// A week past the last solved snapshot (e.g. two weeks ahead) uses the newest one there is.
function snapAt<T>(snaps: Map<string, T>, season: number, week: number): T | undefined {
  for (let w = week; w >= 1; w--) {
    const s = snaps.get(`${season}|${w}`);
    if (s) return s;
  }
  return undefined;
}

// ------------------------------------------------------------------ team-side rows
export const L1_FEATURES = [...T2_METRICS.filter((m) => m !== "drives" && m !== "plays"), "paceDrives", "pacePlays", "st", "home", "talentOff", "talentOpp"] as const;

export interface SideRow {
  g: DGame;
  side: "home" | "away";
  team: string;
  opp: string;
  late: boolean; // week >= 4
  x1: number[]; // layer-1 features, L1_FEATURES order
  wx: Record<WeatherFeature, number>;
  pts: number | null; // actual points (null until played)
  mkt: Market | undefined;
}

export function buildSideRows(games: DGame[], r: T2Ratings, markets: Map<string, Market>, weather: Map<string, GameWeatherInputs>): SideRow[] {
  const out: SideRow[] = [];
  for (const g of games) {
    if (!g.homeFbs || !g.awayFbs) continue;
    const effAt = {} as Record<T2Metric, EffSnapshot | undefined>;
    for (const m of T2_METRICS) effAt[m] = snapAt(r.eff[m], g.season, g.week);
    if (!effAt.ppa) continue;
    const st = snapAt(r.st, g.season, g.week);
    const ew = earlyWeight(g.week);
    const wx = weatherFeatureVector(weather.get(g.id));
    const pace = (m: T2Metric) => {
      const s = effAt[m];
      if (!s) return 0;
      const o = (t: string) => s.off.get(t) ?? 0;
      const d = (t: string) => s.def.get(t) ?? 0;
      return (o(g.home) + d(g.away) + o(g.away) + d(g.home)) / 2;
    };
    const paceDrives = pace("drives");
    const pacePlays = pace("plays");
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? g.home : g.away;
      const opp = side === "home" ? g.away : g.home;
      const x: number[] = [];
      for (const f of L1_FEATURES) {
        if ((T2_METRICS as readonly string[]).includes(f)) {
          const s = effAt[f as T2Metric];
          x.push(s ? (s.off.get(team) ?? 0) + (s.def.get(opp) ?? 0) : 0);
        } else if (f === "paceDrives") x.push(paceDrives);
        else if (f === "pacePlays") x.push(pacePlays);
        else if (f === "st") x.push(st ? (st.ratings.get(team) ?? 0) - (st.ratings.get(opp) ?? 0) : 0);
        else if (f === "home") x.push(g.neutral ? 0 : side === "home" ? 1 : -1);
        else if (f === "talentOff") x.push((r.pre.get(`${g.season}|${team}`)?.[0] ?? 0) * ew);
        else if (f === "talentOpp") x.push((r.pre.get(`${g.season}|${opp}`)?.[0] ?? 0) * ew);
      }
      const pts = g.completed ? (side === "home" ? g.homePts : g.awayPts) : null;
      out.push({ g, side, team, opp, late: g.week >= 4, x1: x, wx, pts, mkt: markets.get(g.id) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ layers
export interface Layer1Fit {
  features: string[];
  mean: number[];
  sd: number[];
  intercept: number;
  coef: number[];
}

export function fitLayer1(rows: SideRow[], alpha: number): Layer1Fit | null {
  const train = rows.filter((r) => r.pts != null);
  if (train.length < 400) return null;
  const p = L1_FEATURES.length;
  const mean = Array.from({ length: p }, (_, j) => train.reduce((a, r) => a + r.x1[j], 0) / train.length);
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(train.reduce((a, r) => a + (r.x1[j] - mean[j]) ** 2, 0) / train.length) || 1);
  const f = fitDenseRidge(
    train.map((r) => r.x1.map((v, j) => (v - mean[j]) / sd[j])),
    train.map((r) => r.pts!),
    alpha
  );
  return { features: [...L1_FEATURES], mean, sd, intercept: f.intercept, coef: f.coef };
}

export const predictLayer1 = (m: Layer1Fit, r: SideRow) => m.intercept + r.x1.reduce((a, v, j) => a + ((v - m.mean[j]) / m.sd[j]) * m.coef[j], 0);

export type LineKind = "open" | "close";
export const L2_FEATURES = ["edgeLate", "edgeEarly", ...WEATHER_FEATURES, "marketLevel"] as const;
// The market's implied team points are centered here so "marketLevel" reads as "points above an average team total".
export const MARKET_CENTER = 28;

export interface Layer2Fit {
  line: LineKind;
  features: string[];
  intercept: number;
  coef: number[];
  edgeCap: number;
}

export function lineOf(m: Market | undefined, line: LineKind): { total: number; spread: number } | null {
  if (!m) return null;
  const total = line === "open" ? m.openTotal : m.closeTotal;
  const spread = line === "open" ? m.openSpread : m.closeSpread;
  return total == null || spread == null ? null : { total, spread };
}

export function sideImplied(r: SideRow, line: LineKind): number | null {
  const l = lineOf(r.mkt, line);
  return l ? impliedPoints(l.total, l.spread, r.side) : null;
}

// The market sets the LEVEL, the model only the relative read: each side's disagreement is measured against that
// week's slate-average disagreement (known before kickoff — it only uses ratings and posted lines). Without this,
// layer 1's scoring level, learned from earlier seasons, leaks a season-wide over/under lean into every edge.
export type SlateMeans = Map<string, number>;
const slateKey = (season: number, week: number, line: LineKind) => `${season}|${week}|${line}`;

export function slateMeans(rows: SideRow[], l1Of: (r: SideRow) => number | undefined): SlateMeans {
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const p = l1Of(r);
    if (p == null) continue;
    for (const line of ["open", "close"] as const) {
      const imp = sideImplied(r, line);
      if (imp == null) continue;
      const k = slateKey(r.g.season, r.g.week, line);
      const a = acc.get(k) ?? { s: 0, n: 0 };
      a.s += p - imp;
      a.n++;
      acc.set(k, a);
    }
  }
  const out: SlateMeans = new Map();
  for (const [k, a] of acc) out.set(k, a.n >= 6 ? a.s / a.n : 0);
  return out;
}

// Weather only enters the CLOSING-line model. The training data is observed game-time weather; at the open nobody
// (us included) knows it yet, so giving it to the open model would credit it with information it could not have had.
function l2Row(r: SideRow, l1Pred: number, implied: number, cap: number, slate: number, line: LineKind): number[] {
  const e = clamp(l1Pred - implied - slate, -cap, cap);
  const w = WEATHER_FEATURES.map((k) => (line === "close" ? r.wx[k] / 2 : 0)); // game-level: each side carries half
  return [r.late ? e : 0, r.late ? 0 : e, ...w, implied - MARKET_CENTER];
}

export function fitLayer2(rows: SideRow[], l1Pred: Map<SideRow, number>, line: LineKind, alpha: number, cap: number, slates: SlateMeans): Layer2Fit | null {
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    if (r.pts == null) continue;
    const p = l1Pred.get(r);
    const imp = sideImplied(r, line);
    if (p == null || imp == null) continue;
    X.push(l2Row(r, p, imp, cap, slates.get(slateKey(r.g.season, r.g.week, line)) ?? 0, line));
    y.push(r.pts - imp);
  }
  if (X.length < 400) return null;
  // No free intercept: a fitted constant would just learn whether earlier seasons happened to run over or under the
  // market, which does not carry from one season to the next (2023-24 ran under, 2025 over).
  const p = X[0].length;
  const theta = solveRidge(
    X.map((x, i) => ({ idx: Array.from({ length: p }, (_, j) => j), val: x, y: y[i] })),
    new Array(p).fill(alpha),
    new Array(p).fill(0)
  );
  return { line, features: [...L2_FEATURES], intercept: 0, coef: theta, edgeCap: cap };
}

/** Expected points this side scores above the market's implied number. */
export function predictLayer2(m: Layer2Fit, r: SideRow, l1PredValue: number, slates: SlateMeans): number | null {
  const imp = sideImplied(r, m.line);
  if (imp == null) return null;
  const x = l2Row(r, l1PredValue, imp, m.edgeCap, slates.get(slateKey(r.g.season, r.g.week, m.line)) ?? 0, m.line);
  return m.intercept + x.reduce((a, v, j) => a + v * m.coef[j], 0);
}

// ------------------------------------------------------------------ walk-forward
export interface SidePred {
  row: SideRow;
  l1: number; // market-blind team points
  resid: Record<LineKind, number | null>; // expected points over the market's implied number, per line
}

export interface WalkForward {
  preds: SidePred[];
  l1Fits: Map<number, Layer1Fit>; // per predicted season
  l2Fits: Map<number, Record<LineKind, Layer2Fit | null>>;
  slates: SlateMeans;
}

/** Each season S: layer 1 fit on seasons < S, layer 2 fit on layer 1's own walk-forward predictions for seasons < S. */
export function walkForward(rows: SideRow[], cfg: T2Config, firstL1Train = 2021): WalkForward {
  const seasons = Array.from(new Set(rows.map((r) => r.g.season))).sort((a, b) => a - b);
  const l1Pred = new Map<SideRow, number>();
  const l1Fits = new Map<number, Layer1Fit>();
  for (const S of seasons) {
    const fit = fitLayer1(rows.filter((r) => r.g.season < S && r.g.season >= firstL1Train), cfg.alpha1);
    if (!fit) continue;
    l1Fits.set(S, fit);
    for (const r of rows) if (r.g.season === S) l1Pred.set(r, predictLayer1(fit, r));
  }
  const preds: SidePred[] = [];
  const l2Fits = new Map<number, Record<LineKind, Layer2Fit | null>>();
  const slates = slateMeans(rows, (r) => l1Pred.get(r));
  for (const S of seasons) {
    const train = rows.filter((r) => r.g.season < S && l1Pred.has(r));
    const fits = {
      close: fitLayer2(train, l1Pred, "close", cfg.alpha2, cfg.edgeCap, slates),
      open: fitLayer2(train, l1Pred, "open", cfg.alpha2, cfg.edgeCap, slates),
    };
    if (!fits.close && !fits.open) continue;
    l2Fits.set(S, fits);
    for (const r of rows) {
      if (r.g.season !== S) continue;
      const l1 = l1Pred.get(r);
      if (l1 == null) continue;
      preds.push({
        row: r,
        l1,
        resid: { close: fits.close ? predictLayer2(fits.close, r, l1, slates) : null, open: fits.open ? predictLayer2(fits.open, r, l1, slates) : null },
      });
    }
  }
  return { preds, l1Fits, l2Fits, slates };
}

// ------------------------------------------------------------------ game level
export interface GamePred {
  g: DGame;
  mkt: Market;
  home: SidePred;
  away: SidePred;
}

export function pairGames(preds: SidePred[]): GamePred[] {
  const by = new Map<string, { home?: SidePred; away?: SidePred }>();
  for (const p of preds) {
    const e = by.get(p.row.g.id) ?? {};
    e[p.row.side] = p;
    by.set(p.row.g.id, e);
  }
  const out: GamePred[] = [];
  for (const e of by.values()) if (e.home && e.away && e.home.row.mkt) out.push({ g: e.home.row.g, mkt: e.home.row.mkt, home: e.home, away: e.away });
  return out;
}

/** Projected game total against a line = that line's total + both sides' expected residuals. */
export function projectedTotal(gp: GamePred, line: LineKind): number | null {
  const l = lineOf(gp.mkt, line);
  const h = gp.home.resid[line];
  const a = gp.away.resid[line];
  return l == null || h == null || a == null ? null : l.total + h + a;
}
