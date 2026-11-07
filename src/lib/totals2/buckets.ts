// Breakdowns ("buckets") of Totals v2 bets — shared by the backtest export (scripts/totals_v2/train.ts) and the page's
// Track record, so both slice bets the same way.
//   Game totals: over / under × where the line sits relative to key numbers (on one, a half point off one, or away).
//   Team totals: home / away × favorite / underdog × over / under — every single, pair and triple.
// Every breakdown can be cut by amount off: keep only the strongest share of bets (by |edge|).
import { TOTALS_KEY_TIERS } from "../keyNumberCross";
import { T2_BUCKETS } from "./frozen";
import { impliedPoints, lineOf, predictedMove, projectedTotal, type GamePred, type SidePred } from "./model";

export interface BetObs {
  kind: "game" | "team";
  dir: 1 | -1; // +1 over, −1 under
  edge: number; // amount off, points (signed)
  res: number; // actual − line (points)
  line: number;
  clv: number | null; // line move toward the bet, open → close (opening-line approaches only)
  home?: boolean; // team totals
  fav?: boolean | null; // team totals: null = pick'em
}

export type Approach = "move" | "open" | "close";
export const APPROACH_LABEL: Record<Approach, string> = {
  move: "★ Bet the opener, direction the line should move",
  open: "Bet the opener, score projection",
  close: "Bet near kickoff, score projection",
};

// Key numbers for totals = the site's top two tiers (keyNumberCross.ts).
const KEYS = TOTALS_KEY_TIERS.slice(0, 2).flatMap((t) => t.keys);
export type KeyZone = "on" | "half" | "away";
export const KEY_ZONE_LABEL: Record<KeyZone, string> = { on: "Line on a key number", half: "Line a half point off a key number", away: "Line away from key numbers" };
export function keyZone(line: number): KeyZone {
  const d = Math.min(...KEYS.map((k) => Math.abs(line - k)));
  return d === 0 ? "on" : d <= 0.5 ? "half" : "away";
}
export const KEY_NUMBERS_USED = KEYS;

/** Bets from walk-forward (or live) predictions, for one approach. Only played games with the needed lines. */
export function betObsFrom(gps: GamePred[], approach: Approach): { game: BetObs[]; team: BetObs[] } {
  const game: BetObs[] = [];
  const team: BetObs[] = [];
  for (const gp of gps) {
    const g = gp.g;
    if (!g.completed || g.homePts == null || g.awayPts == null) continue;
    const lineKind = approach === "close" ? "close" : "open";
    const l = lineOf(gp.mkt, lineKind);
    if (!l) continue;
    const closeT = gp.mkt.closeTotal;
    const closeS = gp.mkt.closeSpread;
    // game
    const gEdge = approach === "move" ? predictedMove(gp) : (projectedTotal(gp, lineKind) ?? NaN) - l.total;
    if (gEdge != null && Number.isFinite(gEdge) && gEdge !== 0) {
      const dir = gEdge > 0 ? 1 : -1;
      game.push({ kind: "game", dir, edge: gEdge, res: g.homePts + g.awayPts - l.total, line: l.total, clv: lineKind === "open" && closeT != null ? dir * (closeT - l.total) : null });
    }
    // team sides
    for (const side of ["home", "away"] as const) {
      const p: SidePred = side === "home" ? gp.home : gp.away;
      const edge = approach === "move" ? p.move : p.resid[lineKind];
      if (edge == null || edge === 0) continue;
      const imp = impliedPoints(l.total, l.spread, side);
      const dir = edge > 0 ? 1 : -1;
      const sideSpread = side === "home" ? l.spread : -l.spread;
      const closeImp = closeT != null && closeS != null ? impliedPoints(closeT, closeS, side) : null;
      team.push({
        kind: "team",
        dir,
        edge,
        res: (side === "home" ? g.homePts : g.awayPts) - imp,
        line: imp,
        clv: lineKind === "open" && closeImp != null ? dir * (closeImp - imp) : null,
        home: side === "home",
        fav: sideSpread === 0 ? null : sideSpread < 0,
      });
    }
  }
  return { game, team };
}

/** Keep the strongest share of bets by |amount off| (frac = 1 keeps all). Returns the cutoff in points too. */
export function strongest(obs: BetObs[], frac: number): { obs: BetObs[]; minEdge: number } {
  if (frac >= 1) return { obs, minEdge: 0 };
  const sorted = [...obs].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  const kept = sorted.slice(0, Math.max(1, Math.round(sorted.length * frac)));
  return { obs: kept, minEdge: Math.abs(kept[kept.length - 1]?.edge ?? 0) };
}

export interface BucketRow {
  group: string; // e.g. "Single", "Pair", "All three"
  label: string;
  w: number;
  l: number;
  p: number;
  units: number; // flat 1u at −110
  clv: number | null;
}

function tally(group: string, label: string, xs: BetObs[]): BucketRow {
  let w = 0, l = 0, p = 0, c = 0, cn = 0;
  for (const x of xs) {
    const r = x.dir * x.res;
    if (r > 0) w++;
    else if (r < 0) l++;
    else p++;
    if (x.clv != null) {
      c += x.clv;
      cn++;
    }
  }
  return { group, label, w, l, p, units: Math.round((w - 1.1 * l) * 10) / 10, clv: cn ? Math.round((c / cn) * 100) / 100 : null };
}

const OU = [
  ["Overs", (x: BetObs) => x.dir === 1],
  ["Unders", (x: BetObs) => x.dir === -1],
] as const;

export function gameBuckets(obs: BetObs[]): BucketRow[] {
  const out: BucketRow[] = [tally("All", "Every game-total bet", obs)];
  for (const [l, f] of OU) out.push(tally("Over / under", l, obs.filter(f)));
  for (const z of ["on", "half", "away"] as KeyZone[]) out.push(tally("Key numbers", KEY_ZONE_LABEL[z], obs.filter((x) => keyZone(x.line) === z)));
  for (const [l, f] of OU) for (const z of ["on", "half", "away"] as KeyZone[]) out.push(tally("Key numbers × over / under", `${l} — ${KEY_ZONE_LABEL[z].replace("Line ", "line ")}`, obs.filter((x) => f(x) && keyZone(x.line) === z)));
  return out;
}

export function teamBuckets(obs: BetObs[]): BucketRow[] {
  const HA = [
    ["Home", (x: BetObs) => x.home === true],
    ["Away", (x: BetObs) => x.home === false],
  ] as const;
  const FD = [
    ["Favorites", (x: BetObs) => x.fav === true],
    ["Underdogs", (x: BetObs) => x.fav === false],
  ] as const;
  const out: BucketRow[] = [tally("All", "Every team-total bet", obs)];
  for (const [l, f] of [...HA, ...FD, ...OU]) out.push(tally("Single", l, obs.filter(f)));
  for (const [a, fa] of HA) for (const [b, fb] of FD) out.push(tally("Pair", `${a} ${b.toLowerCase()}`, obs.filter((x) => fa(x) && fb(x))));
  for (const [a, fa] of HA) for (const [b, fb] of OU) out.push(tally("Pair", `${a} — ${b.toLowerCase()}`, obs.filter((x) => fa(x) && fb(x))));
  for (const [a, fa] of FD) for (const [b, fb] of OU) out.push(tally("Pair", `${a} — ${b.toLowerCase()}`, obs.filter((x) => fa(x) && fb(x))));
  for (const [a, fa] of HA) for (const [b, fb] of FD) for (const [c, fc] of OU) out.push(tally("All three", `${a} ${b.toLowerCase()} — ${c.toLowerCase()}`, obs.filter((x) => fa(x) && fb(x) && fc(x))));
  return out;
}

export const BUCKET_FRACTIONS = [1, 0.5, 0.25, 0.1];
export const BUCKET_FRACTION_LABEL: Record<number, string> = { 1: "Every bet", 0.5: "Strongest 50%", 0.25: "Strongest 25%", 0.1: "Strongest 10% (★)" };

// ------------------------------------------------------------------ which bucket a bet is in, and its stats
// Used inline on the Totals page and in the Weekly Betting Report: for one bet, its most specific bucket (game:
// over/under × key zone; team: home/away × fav/dog × over/under), the amount-off level it reaches, and that bucket's
// record — in the 2023-26 backtest and in this season's stored (pre-kickoff) numbers.

export function specificLabel(o: BetObs): string {
  const ou = o.dir === 1 ? "Overs" : "Unders";
  if (o.kind === "game") return `${ou} — ${KEY_ZONE_LABEL[keyZone(o.line)].replace("Line ", "line ")}`;
  const ha = o.home ? "Home" : "Away";
  if (o.fav == null) return `${ha} — ${ou.toLowerCase()}`;
  return `${ha} ${o.fav ? "favorites" : "underdogs"} — ${ou.toLowerCase()}`;
}
export function plainLabel(o: BetObs): string {
  const ou = o.dir === 1 ? "over" : "under";
  if (o.kind === "game") return `${ou}, ${KEY_ZONE_LABEL[keyZone(o.line)].toLowerCase()}`;
  return `${o.home ? "home" : "away"}${o.fav == null ? "" : o.fav ? " favorite" : " underdog"} ${ou}`;
}

const ALL_SEASONS = "2023+2024+2025+2026";
function backtest(scope: "game" | "team", frac: number) {
  return T2_BUCKETS.find((b) => b.seasons === ALL_SEASONS && b.approach === "move" && b.scope === scope && b.frac === frac);
}

/** The strongest amount-off level this bet reaches (by the 2023-26 backtest cutoffs for the line-move approach). */
export function levelFor(o: BetObs): number {
  for (const f of [0.1, 0.25, 0.5]) {
    const b = backtest(o.kind, f);
    if (b && Math.abs(o.edge) >= b.minEdge) return f;
  }
  return 1;
}

export interface BucketStat {
  label: string; // bucket shown
  level: number; // amount-off level (fraction kept)
  backtest: BucketRow | null; // 2023-26 walk-forward
  season: BucketRow | null; // this season, from stored pre-kickoff numbers
}

/** This bet's own bucket at its level, plus the broader "main" bucket (every bet of its kind at that level). */
export function bucketStatsFor(o: BetObs, seasonObs: BetObs[]): { own: BucketStat; ownAll: BucketStat; main: BucketStat } {
  const level = levelFor(o);
  const label = specificLabel(o);
  const mainLabel = o.kind === "game" ? "Every game-total bet" : "Every team-total bet";
  const cut = (f: number) => backtest(o.kind, f)?.minEdge ?? 0;
  const seasonRows = (f: number) => {
    const kept = seasonObs.filter((x) => x.kind === o.kind && Math.abs(x.edge) >= cut(f));
    return o.kind === "game" ? gameBuckets(kept) : teamBuckets(kept);
  };
  const find = (rows: BucketRow[] | undefined, l: string) => rows?.find((r) => r.label === l) ?? null;
  const at = (f: number, l: string): BucketStat => ({ label: l, level: f, backtest: find(backtest(o.kind, f)?.rows, l), season: find(seasonRows(f), l) });
  return { own: at(level, label), ownAll: at(1, label), main: at(level, mainLabel) };
}

/** Line-move bets from stored numbers (totals2_projections rows) for played games — this season's bucket records. */
export interface StoredForBuckets {
  move: number | null;
  open_total: number | null;
  open_spread: number | null;
  line_total: number | null; // last pre-kickoff line (≈ the close)
  line_spread: number | null;
}
export function obsFromStored(rows: { v2: StoredForBuckets; homePts: number | null; awayPts: number | null }[]): BetObs[] {
  const out: BetObs[] = [];
  for (const { v2, homePts, awayPts } of rows) {
    if (homePts == null || awayPts == null || v2.move == null || v2.move === 0 || v2.open_total == null) continue;
    const dir: 1 | -1 = v2.move > 0 ? 1 : -1;
    const open = v2.open_total;
    out.push({ kind: "game", dir, edge: v2.move, res: homePts + awayPts - open, line: open, clv: v2.line_total != null ? dir * (v2.line_total - open) : null });
    const spread = v2.open_spread ?? v2.line_spread;
    if (spread == null) continue;
    for (const side of ["home", "away"] as const) {
      const line = impliedPoints(open, spread, side);
      const close = v2.line_total != null && v2.line_spread != null ? impliedPoints(v2.line_total, v2.line_spread, side) : null;
      const sideSpread = side === "home" ? spread : -spread;
      out.push({
        kind: "team",
        dir,
        edge: v2.move / 2,
        res: (side === "home" ? homePts : awayPts) - line,
        line,
        clv: close != null ? dir * (close - line) : null,
        home: side === "home",
        fav: sideSpread === 0 ? null : sideSpread < 0,
      });
    }
  }
  return out;
}

/** The bet(s) an upcoming game makes under the line-move rule: the game total and each team's share. */
export function betsForGame(v2: StoredForBuckets): { game: BetObs | null; home: BetObs | null; away: BetObs | null } {
  if (v2.move == null || v2.move === 0 || v2.open_total == null) return { game: null, home: null, away: null };
  const dir: 1 | -1 = v2.move > 0 ? 1 : -1;
  const game: BetObs = { kind: "game", dir, edge: v2.move, res: 0, line: v2.open_total, clv: null };
  const spread = v2.open_spread ?? v2.line_spread;
  const team = (side: "home" | "away"): BetObs | null => {
    if (spread == null) return null;
    const sideSpread = side === "home" ? spread : -spread;
    return { kind: "team", dir, edge: v2.move! / 2, res: 0, line: impliedPoints(v2.open_total!, spread, side), clv: null, home: side === "home", fav: sideSpread === 0 ? null : sideSpread < 0 };
  };
  return { game, home: team("home"), away: team("away") };
}
