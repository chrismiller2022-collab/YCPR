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
  /** mine - line (signed): the number whose spread across a segment gives that segment's "std dev off". */
  diff: number;
  /** Spreads only: which team the pick is on, and whether that team is the underdog on the market line (null = pick'em / not a spread). */
  pickIsHome: boolean | null;
  pickIsDog: boolean | null;
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
        let pickIsHome: boolean | null = null;
        let pickIsDog: boolean | null = null;
        if (market === "spread") {
          pick = mineVal < l.line ? "away" : "home";
          pickIsHome = pick === "home";
          const pickLine = pickIsHome ? -l.line : l.line; // the picked team's own line: positive = getting points
          pickIsDog = pickLine > 0 ? true : pickLine < 0 ? false : null;
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
        out.push({ gameId: it.gameId, label: it.label, period, market, line: l.line, mine: mineVal, off, pick, result, books: l.books, diff: mineVal - l.line, pickIsHome, pickIsDog });
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

// ---------------------------------------------------------------------
// Segments for the amount-off charts.
// ---------------------------------------------------------------------
export type PeriodFilter = "all" | GradePeriod;

export interface SegmentDef {
  key: string;
  label: string;
  test: (b: GradedBet) => boolean;
}

export const TOTAL_SEGMENTS: SegmentDef[] = [
  { key: "all", label: "All", test: () => true },
  { key: "over", label: "Overs", test: (b) => b.pick === "over" },
  { key: "under", label: "Unders", test: (b) => b.pick === "under" },
];

export const SPREAD_SEGMENTS: SegmentDef[] = [
  { key: "all", label: "All", test: () => true },
  { key: "dog", label: "Dogs", test: (b) => b.pickIsDog === true },
  { key: "fav", label: "Favorites", test: (b) => b.pickIsDog === false },
  { key: "home", label: "Home", test: (b) => b.pickIsHome === true },
  { key: "away", label: "Away", test: (b) => b.pickIsHome === false },
  { key: "homeDog", label: "Home dog", test: (b) => b.pickIsHome === true && b.pickIsDog === true },
  { key: "homeFav", label: "Home fav", test: (b) => b.pickIsHome === true && b.pickIsDog === false },
  { key: "awayDog", label: "Away dog", test: (b) => b.pickIsHome === false && b.pickIsDog === true },
  { key: "awayFav", label: "Away fav", test: (b) => b.pickIsHome === false && b.pickIsDog === false },
];

/** Sample standard deviation of (my number - market line) over a set of bets; null with fewer than 3. */
export function diffStdDev(bets: GradedBet[]): number | null {
  const n = bets.length;
  if (n < 3) return null;
  const mean = bets.reduce((s, b) => s + b.diff, 0) / n;
  const variance = bets.reduce((s, b) => s + (b.diff - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/**
 * The bets in one (market, period, segment) cell, as rows for the amount-off
 * chart. Std dev off = |amount off| / the std dev of (mine - line) within THAT
 * same cell, so each segment and period is measured against its own spread of
 * disagreement with the market. Pending bets are left out; pushes are kept as
 * "push" (the chart excludes them from win %).
 */
export function chartRowsFor(
  bets: GradedBet[],
  market: GradeMarket,
  period: PeriodFilter,
  segment: SegmentDef,
  minOff: number,
  filteredOnly: boolean
): { rows: { amountOff: number; stdDevOff: number | null; grade: "win" | "loss" | "push" | null }[]; stdDev: number | null; total: number } {
  const cell = bets.filter((b) => b.market === market && (period === "all" || b.period === period) && segment.test(b));
  const sd = diffStdDev(cell);
  const rows = cell
    .filter((b) => b.result !== "pending" && (!filteredOnly || b.off >= minOff))
    .map((b) => ({ amountOff: b.off, stdDevOff: sd != null && sd > 0 ? b.off / sd : null, grade: b.result === "pending" ? null : (b.result as "win" | "loss" | "push") }));
  return { rows, stdDev: sd, total: cell.length };
}
