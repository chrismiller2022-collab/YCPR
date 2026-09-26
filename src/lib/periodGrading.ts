import type { PeriodKey } from "./periodSim";

// Grades period (1H/2H/quarter) spread and total projections against the
// market's period lines, using the real quarter scores CFBD reports.
// Everything is regulation-only, same as the markets themselves.

export type GradePeriod = Exclude<PeriodKey, "game">;
export const GRADE_PERIODS: GradePeriod[] = ["h1", "h2", "q1", "q2", "q3", "q4"];
export type GradeMarket = "spread" | "total";

export interface PeriodLineRowLite {
  game_id: string;
  period: string;
  market_type: string;
  provider: string | null;
  point: number | null;
}

/** Median across books per "<period>|<market>" for one game; spread is returned as the AWAY line (negative = away favored). */
export function consensusLines(rows: PeriodLineRowLite[]): Map<string, { line: number; books: number }> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.point == null) continue;
    if (r.market_type !== "spread" && r.market_type !== "total") continue;
    const key = `${r.period}|${r.market_type}`;
    const v = r.market_type === "spread" ? -r.point : r.point; // stored spread is the HOME line
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const out = new Map<string, { line: number; books: number }>();
  for (const [k, vs] of groups) {
    const s = [...vs].sort((a, b) => a - b);
    const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    out.set(k, { line: mid, books: s.length });
  }
  return out;
}

/** [away, home] points for a period from a line-score pair (first four entries = regulation). */
export function actualPeriodPoints(away: number[] | null | undefined, home: number[] | null | undefined, period: GradePeriod): [number, number] | null {
  if (!away || !home || away.length < 4 || home.length < 4) return null;
  const idx = period === "h1" ? [0, 1] : period === "h2" ? [2, 3] : [Number(period.slice(1)) - 1];
  const sum = (a: number[]) => idx.reduce((s, i) => s + (a[i] ?? 0), 0);
  return [sum(away), sum(home)];
}

export interface GradeItem {
  gameId: string;
  label: string;
  /** My mean away spread / total per period (periodSim summary or a period lock). */
  mine: Record<GradePeriod, { awaySpread: number | null; total: number | null }>;
  lines: Map<string, { line: number; books: number }>;
  awayLineScores: number[] | null | undefined;
  homeLineScores: number[] | null | undefined;
}

export interface GradedBet {
  gameId: string;
  label: string;
  period: GradePeriod;
  market: GradeMarket;
  line: number;
  mine: number;
  off: number;
  pick: string; // "away" | "home" | "over" | "under"
  result: "win" | "loss" | "push" | "pending";
  books: number;
}

export function gradeItems(items: GradeItem[]): GradedBet[] {
  const out: GradedBet[] = [];
  for (const it of items) {
    for (const period of GRADE_PERIODS) {
      const actual = actualPeriodPoints(it.awayLineScores, it.homeLineScores, period);
      for (const market of ["spread", "total"] as GradeMarket[]) {
        const l = it.lines.get(`${period}|${market}`);
        const mineVal = market === "spread" ? it.mine[period].awaySpread : it.mine[period].total;
        if (!l || mineVal == null) continue;
        const off = Math.abs(mineVal - l.line);
        if (off === 0) continue;
        let pick: string;
        let result: GradedBet["result"] = "pending";
        if (market === "spread") {
          pick = mineVal < l.line ? "away" : "home";
          if (actual) {
            const cover = actual[0] - actual[1] + l.line; // >0 away covers
            result = cover === 0 ? "push" : (cover > 0) === (pick === "away") ? "win" : "loss";
          }
        } else {
          pick = mineVal > l.line ? "over" : "under";
          if (actual) {
            const tot = actual[0] + actual[1];
            result = tot === l.line ? "push" : (tot > l.line) === (pick === "over") ? "win" : "loss";
          }
        }
        out.push({ gameId: it.gameId, label: it.label, period, market, line: l.line, mine: mineVal, off, pick, result, books: l.books });
      }
    }
  }
  return out;
}

export interface GradeSummaryRow {
  period: GradePeriod;
  market: GradeMarket;
  w: number;
  l: number;
  p: number;
  pending: number;
  /** Same tally restricted to bets at least `minOff` points off the line. */
  fw: number;
  fl: number;
  fp: number;
  fpending: number;
}

export function summarizeGrades(bets: GradedBet[], minOff: number): GradeSummaryRow[] {
  const rows: GradeSummaryRow[] = [];
  for (const period of GRADE_PERIODS) {
    for (const market of ["spread", "total"] as GradeMarket[]) {
      const r: GradeSummaryRow = { period, market, w: 0, l: 0, p: 0, pending: 0, fw: 0, fl: 0, fp: 0, fpending: 0 };
      for (const b of bets) {
        if (b.period !== period || b.market !== market) continue;
        const f = b.off >= minOff;
        if (b.result === "win") {
          r.w++;
          if (f) r.fw++;
        } else if (b.result === "loss") {
          r.l++;
          if (f) r.fl++;
        } else if (b.result === "push") {
          r.p++;
          if (f) r.fp++;
        } else {
          r.pending++;
          if (f) r.fpending++;
        }
      }
      if (r.w + r.l + r.p + r.pending > 0) rows.push(r);
    }
  }
  return rows;
}
