// Team totals, several ways — for specializing in the team-total market. Every arm produces a number for each team in
// each game; each is graded against (a) the market's own team number derived from the closing total and spread, and
// (b) a REAL team-total line wherever one was pulled. Same games, same results — only the projection differs.
import { splitTeamTotal } from "../gameTotals";
import { impliedPoints, projectedTotal, type GamePred } from "./model";
import type { TeamTotalLineLite } from "../api/totals2Data";
import type { GameProjectionLockRow } from "../api/gameProjectionLocks";

export const TT_ARMS = ["v2team", "v2mkt", "v2yc", "v1yc", "v1mkt", "stats"] as const;
export type TTArmV2 = (typeof TT_ARMS)[number];
export const TT_ARM_LABEL: Record<TTArmV2, string> = {
  v2team: "v2 team model (its own team numbers)",
  v2mkt: "v2 game total ÷ market spread",
  v2yc: "v2 game total ÷ YCPR spread",
  v1yc: "Current site: v1 total ÷ YCPR spread",
  v1mkt: "v1 total ÷ market spread",
  stats: "Stats only (layer 1, no market)",
};

export interface TTSide {
  gameId: string;
  week: number;
  team: string;
  side: "home" | "away";
  actual: number;
  derived: number; // market's implied team points from the closing total + spread
  real: number | null; // a real team-total line, when one is on file
  arms: Partial<Record<TTArmV2, number>>;
}

/** The latest pull per game+team (a pull is one moment's line; the newest is the closest to kickoff we have). */
export function latestTeamLines(rows: TeamTotalLineLite[]): Map<string, number> {
  const best = new Map<string, { t: string; p: number }>();
  for (const r of rows) {
    if (r.point == null) continue;
    const k = `${r.game_id}|${r.team}`;
    const t = r.pulled_at ?? "";
    const cur = best.get(k);
    if (!cur || t > cur.t) best.set(k, { t, p: Number(r.point) });
  }
  return new Map(Array.from(best, ([k, v]) => [k, v.p]));
}

export function buildTTSides(gps: GamePred[], locks: Record<string, GameProjectionLockRow>, realLines: Map<string, number>): TTSide[] {
  const out: TTSide[] = [];
  for (const gp of gps) {
    const g = gp.g;
    if (!g.completed || gp.mkt.closeTotal == null || gp.mkt.closeSpread == null) continue;
    const T = gp.mkt.closeTotal;
    const S = gp.mkt.closeSpread;
    const v2 = projectedTotal(gp, "close");
    const lock = locks[g.id];
    const ycHome = lock?.my_away_spread != null ? -Number(lock.my_away_spread) : null;
    const v1 = lock?.my_total != null ? Number(lock.my_total) : null;
    const split = (total: number | null, spread: number | null) => (total == null || spread == null ? null : splitTeamTotal(total, spread));
    const v2mkt = split(v2, S);
    const v2yc = split(v2, ycHome);
    const v1yc = split(v1, ycHome);
    const v1mkt = split(v1, S);
    for (const side of ["home", "away"] as const) {
      const p = side === "home" ? gp.home : gp.away;
      const team = side === "home" ? g.home : g.away;
      const derived = impliedPoints(T, S, side);
      const arms: Partial<Record<TTArmV2, number>> = { stats: p.l1 };
      if (p.resid.close != null) arms.v2team = derived + p.resid.close;
      const pick = (sp: { home: number | null; away: number | null } | null) => (sp ? (side === "home" ? sp.home : sp.away) : null);
      const put = (k: TTArmV2, v: number | null) => {
        if (v != null && Number.isFinite(v)) arms[k] = v;
      };
      put("v2mkt", pick(v2mkt));
      put("v2yc", pick(v2yc));
      put("v1yc", pick(v1yc));
      put("v1mkt", pick(v1mkt));
      out.push({ gameId: g.id, week: g.week, team, side, actual: (side === "home" ? g.homePts : g.awayPts) ?? 0, derived, real: realLines.get(`${g.id}|${team}`) ?? null, arms });
    }
  }
  return out;
}

export interface TTArmStat {
  n: number; // team-games with this arm and the grading line
  mae: number | null;
  lineMae: number | null;
  bets: { minDiff: number; w: number; l: number; p: number; pct: number | null }[];
}

export const TT_DIFFS = [0.5, 1, 2, 3];

export function ttArmStat(sides: TTSide[], arm: TTArmV2, grade: "derived" | "real", diffs = TT_DIFFS): TTArmStat {
  let n = 0, ae = 0, le = 0;
  const bets = diffs.map((d) => ({ minDiff: d, w: 0, l: 0, p: 0, pct: null as number | null }));
  for (const s of sides) {
    const m = s.arms[arm];
    const line = grade === "derived" ? s.derived : s.real;
    if (m == null || line == null) continue;
    n++;
    ae += Math.abs(m - s.actual);
    le += Math.abs(line - s.actual);
    const diff = m - line;
    for (const b of bets) {
      if (Math.abs(diff) < b.minDiff || diff === 0) continue;
      const res = Math.sign(diff) * (s.actual - line);
      if (res > 0) b.w++;
      else if (res < 0) b.l++;
      else b.p++;
    }
  }
  for (const b of bets) b.pct = b.w + b.l ? (100 * b.w) / (b.w + b.l) : null;
  return { n, mae: n ? ae / n : null, lineMae: n ? le / n : null, bets };
}
