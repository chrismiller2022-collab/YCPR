// Teaser study: how often does a teased leg cover? A teased favorite at −L moves to −(L − points); a teased underdog at +L
// moves to +(L + points). Lines are the closing or opening spread (Bovada close / the open the model uses), FBS vs FBS,
// regular season. Pushes are counted as pushes, never as wins or losses.
import { margin, type DGame } from "./dataset";
import { fitLayer1, predictLayer1, type GameSignals } from "./model";
import { gameTier, type Tier } from "./tiers";

export type LineSource = "close" | "open";
export type Role = "fav" | "dog";

export interface TeaserGame {
  id: string;
  season: number;
  week: number;
  tier: Tier;
  line: number; // |spread|, the favorite's number
  total: number | null;
  favMargin: number; // points the favorite won by (negative = lost)
  ycFav: number | null; // YC's projected favorite margin
  dFav: number | null; // DROGBA's projected favorite margin
}

// YC / DROGBA projections are given as HOME spreads (negative = home favored) / model home margins, and are re-expressed
// from the favorite's side here. `yc`: game id -> YC home spread; `dm`: game id -> DROGBA projected home margin.
export function buildTeaserGames(games: DGame[], source: LineSource, yc: Map<string, number>, dm: Map<string, number>): TeaserGame[] {
  const out: TeaserGame[] = [];
  for (const g of games) {
    if (!g.homeFbs || !g.awayFbs || !g.completed) continue;
    const spread = source === "close" ? g.close : g.open;
    if (spread == null || spread === 0) continue;
    const favSign = spread < 0 ? 1 : -1; // +1 when the home team is the favorite
    const y = yc.get(g.id);
    const d = dm.get(g.id);
    out.push({
      id: g.id,
      season: g.season,
      week: g.week,
      tier: gameTier(g),
      line: Math.abs(spread),
      total: source === "close" ? g.closeTotal ?? g.openTotal : g.openTotal,
      favMargin: favSign * margin(g),
      ycFav: y == null ? null : favSign * -y,
      dFav: d == null ? null : favSign * d,
    });
  }
  return out;
}

// DROGBA's projected home margin per game, walk-forward: each season is predicted by a model fit on earlier seasons only.
export function drogbaMargins(signals: GameSignals[], seasons: number[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const S of seasons) {
    const l1 = fitLayer1(signals.filter((s) => s.g.season < S && s.g.completed));
    if (!l1) continue;
    for (const s of signals) {
      if (s.g.season !== S) continue;
      const m = predictLayer1(l1, s);
      if (m != null) out.set(s.g.id, m);
    }
  }
  return out;
}

export interface LegStat {
  n: number;
  w: number;
  l: number;
  p: number;
  pct: number | null; // wins / (wins + losses)
}
const stat = (w: number, l: number, p: number): LegStat => ({ n: w + l + p, w, l, p, pct: w + l ? (100 * w) / (w + l) : null });

export function legResult(g: TeaserGame, role: Role, points: number): "W" | "L" | "P" {
  const r = role === "fav" ? g.favMargin - (g.line - points) : g.line + points - g.favMargin;
  return r > 0 ? "W" : r < 0 ? "L" : "P";
}

export type TotalBand = "any" | "low" | "mid" | "high";
export const TOTAL_BAND_LABELS: Record<TotalBand, string> = { any: "Any total", low: "Low total (under 50)", mid: "Mid total (50–56)", high: "High total (over 56)" };
export const inTotalBand = (total: number | null, band: TotalBand) => band === "any" || (total != null && (band === "low" ? total < 50 : band === "mid" ? total >= 50 && total <= 56 : total > 56));

// Which projection must already have the ORIGINAL side covering before the teased leg is counted.
export type Condition = "none" | "yc" | "drogba" | "both";
export const CONDITION_LABELS: Record<Condition, string> = {
  none: "No condition",
  yc: "YC projects the original side to cover",
  drogba: "DROGBA projects the original side to cover",
  both: "Both project the original side to cover",
};
export function passesCondition(g: TeaserGame, role: Role, cond: Condition): boolean {
  if (cond === "none") return true;
  // original side covers: favorite wins by more than the line; underdog loses by less than the line (or wins)
  const covers = (proj: number | null) => proj != null && (role === "fav" ? proj > g.line : proj < g.line);
  if (cond === "yc") return covers(g.ycFav);
  if (cond === "drogba") return covers(g.dFav);
  return covers(g.ycFav) && covers(g.dFav);
}

export interface LegFilter {
  tier: Tier | "all";
  band: TotalBand;
  cond: Condition;
  points: number;
}

export function legStat(games: TeaserGame[], role: Role, line: number, f: LegFilter, seasons?: number[]): LegStat {
  let w = 0, l = 0, p = 0;
  for (const g of games) {
    if (g.line !== line) continue;
    if (seasons && !seasons.includes(g.season)) continue;
    if (f.tier !== "all" && g.tier !== f.tier) continue;
    if (!inTotalBand(g.total, f.band)) continue;
    if (!passesCondition(g, role, f.cond)) continue;
    const r = legResult(g, role, f.points);
    if (r === "W") w++;
    else if (r === "L") l++;
    else p++;
  }
  return stat(w, l, p);
}

// Every game whose line sits in [lo, hi] (a band of numbers rather than one exact line).
export function bandStat(games: TeaserGame[], role: Role, lo: number, hi: number, f: LegFilter, seasons?: number[]): LegStat {
  let w = 0, l = 0, p = 0;
  for (const g of games) {
    if (g.line < lo || g.line > hi) continue;
    if (seasons && !seasons.includes(g.season)) continue;
    if (f.tier !== "all" && g.tier !== f.tier) continue;
    if (!inTotalBand(g.total, f.band)) continue;
    if (!passesCondition(g, role, f.cond)) continue;
    const r = legResult(g, role, f.points);
    if (r === "W") w++;
    else if (r === "L") l++;
    else p++;
  }
  return stat(w, l, p);
}

// ---------------------------------------------------------------- pricing
export interface TeaserPrice {
  legs: number;
  risk: number;
  toWin: number;
}
// Break-even win rate per leg when every leg must hit: (risk / (risk + toWin)) ^ (1 / legs), legs treated as independent.
export function breakEvenPerLeg(price: TeaserPrice): number | null {
  if (!(price.risk > 0) || !(price.toWin > 0) || price.legs < 1) return null;
  return Math.pow(price.risk / (price.risk + price.toWin), 1 / price.legs);
}
// American odds for the whole ticket -> to-win per 100 risked.
export const toWinFromAmerican = (odds: number) => (odds > 0 ? odds : 10000 / Math.abs(odds));
// Expected profit per 1 risked on a ticket of legs with these win rates (independent): p·(toWin/risk) − (1 − p).
export function ticketEv(pcts: number[], price: TeaserPrice): number | null {
  if (!(price.risk > 0) || !(price.toWin > 0) || pcts.some((x) => x == null || Number.isNaN(x))) return null;
  const p = pcts.reduce((a, x) => a * (x / 100), 1);
  return p * (price.toWin / price.risk) - (1 - p);
}
