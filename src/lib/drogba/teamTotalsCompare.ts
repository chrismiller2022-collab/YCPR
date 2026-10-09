// Team totals: does splitting a game total by DROGBA's spread work better or worse than splitting it by YC's? The game
// total is held fixed (Bovada's opening total) so only the split differs, and a team-total "bet" is graded against the
// same split by the opening spread (the site's derived stand-in for a team-total line; real team-total lines are only on
// file for a few 2026 weeks). Nothing here replaces YC: it is a side-by-side.
import { fitLayer1, predictLayer1, type GameSignals } from "./model";
import { gameTier, type Tier } from "./tiers";
import { splitTeamTotal } from "../gameTotals";

export interface TTRow {
  season: number;
  week: number;
  tier: Tier;
  total: number; // Bovada's opening game total
  open: number; // opening spread, home-relation
  sYc: number; // YC's projected home spread
  sD: number; // DROGBA's projected home spread
  homePts: number;
  awayPts: number;
}

export function buildTeamTotalRows(signals: GameSignals[], yc: Map<string, number>, seasons: number[]): TTRow[] {
  const rows: TTRow[] = [];
  for (const S of seasons) {
    const l1 = fitLayer1(signals.filter((s) => s.g.season < S && s.g.completed));
    if (!l1) continue;
    for (const s of signals) {
      const g = s.g;
      if (g.season !== S || !g.completed || g.open == null || g.openTotal == null) continue;
      const y = yc.get(g.id);
      if (y == null) continue;
      const m = predictLayer1(l1, s);
      if (m == null) continue;
      rows.push({ season: S, week: g.week, tier: gameTier(g), total: g.openTotal, open: g.open, sYc: y, sD: -m, homePts: g.homePts ?? 0, awayPts: g.awayPts ?? 0 });
    }
  }
  return rows;
}

export type TTArm = "vegas" | "yc" | "drogba" | "blend";
export const TT_ARM_LABELS: Record<TTArm, string> = { vegas: "Opening spread (the market)", yc: "YC", drogba: "DROGBA", blend: "50/50 YC + DROGBA" };
const spreadOf = (r: TTRow, arm: TTArm) => (arm === "vegas" ? r.open : arm === "yc" ? r.sYc : arm === "drogba" ? r.sD : (r.sYc + r.sD) / 2);

export function teamPointsMae(rows: TTRow[], arm: TTArm): number | null {
  if (!rows.length) return null;
  let e = 0;
  for (const r of rows) {
    const sp = splitTeamTotal(r.total, spreadOf(r, arm));
    e += Math.abs(sp.home! - r.homePts) + Math.abs(sp.away! - r.awayPts);
  }
  return e / (2 * rows.length);
}

export interface TTBetStat {
  n: number;
  w: number;
  l: number;
  p: number;
  atsPct: number | null;
}

// A team-total bet on each side whose number differs from the market split by at least `minDiff` points: over when the
// arm's number is higher, under when lower; pushes count as pushes.
export function teamTotalBets(rows: TTRow[], arm: Exclude<TTArm, "vegas">, minDiff: number): TTBetStat {
  let w = 0, l = 0, p = 0;
  for (const r of rows) {
    const mine = splitTeamTotal(r.total, spreadOf(r, arm));
    const line = splitTeamTotal(r.total, r.open);
    for (const [m, v, a] of [[mine.home!, line.home!, r.homePts], [mine.away!, line.away!, r.awayPts]] as const) {
      const d = m - v;
      if (Math.abs(d) < minDiff) continue;
      const res = (a - v) * Math.sign(d);
      if (res > 0) w++;
      else if (res < 0) l++;
      else p++;
    }
  }
  return { n: w + l + p, w, l, p, atsPct: w + l ? (100 * w) / (w + l) : null };
}

