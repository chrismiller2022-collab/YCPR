// Honest scoring for Totals v2 predictions — shared by the training script and the admin page.
// The headline number is the RESIDUAL R²: how much of (actual − market line) the model explains. 0 = no better than the
// line itself; negative = worse than just using the line. Closing-line value (CLV) is scored for the opening-line model:
// did the line move toward the side the model took?
import { impliedPoints, lineOf, projectedTotal, sideImplied, type GamePred, type LineKind, type SidePred } from "./model";

export const BREAK_EVEN = 52.38; // -110 both ways
export const EDGE_THRESHOLDS = [0, 1, 2, 3, 4, 5];

export interface Bucket {
  minEdge: number;
  n: number;
  w: number;
  l: number;
  p: number;
  winPct: number | null;
  clv: number | null; // average points the line moved toward our side, open → close (open-line model only)
}

export interface ScoreSummary {
  n: number;
  r2: number | null; // residual R²
  corr: number | null; // corr(model − line, actual − line)
  mae: number | null; // model's average miss
  lineMae: number | null; // the line's average miss
  bias: number | null; // avg (model − actual)
  buckets: Bucket[];
}

interface Obs {
  line: number; // the market number graded against
  model: number; // the model's number
  actual: number;
  move: number | null; // close − open for this market (team or game), when grading the open
}

function summarize(obs: Obs[], thresholds = EDGE_THRESHOLDS): ScoreSummary {
  const n = obs.length;
  if (n === 0) return { n, r2: null, corr: null, mae: null, lineMae: null, bias: null, buckets: [] };
  let sseM = 0, sseL = 0, aeM = 0, aeL = 0, bias = 0;
  const e: number[] = [], r: number[] = [];
  for (const o of obs) {
    sseM += (o.actual - o.model) ** 2;
    sseL += (o.actual - o.line) ** 2;
    aeM += Math.abs(o.actual - o.model);
    aeL += Math.abs(o.actual - o.line);
    bias += o.model - o.actual;
    e.push(o.model - o.line);
    r.push(o.actual - o.line);
  }
  const me = e.reduce((a, b) => a + b, 0) / n;
  const mr = r.reduce((a, b) => a + b, 0) / n;
  let cov = 0, ve = 0, vr = 0;
  for (let i = 0; i < n; i++) {
    cov += (e[i] - me) * (r[i] - mr);
    ve += (e[i] - me) ** 2;
    vr += (r[i] - mr) ** 2;
  }
  const buckets = thresholds.map((t) => {
    let w = 0, l = 0, p = 0, mv = 0, mvn = 0;
    for (const o of obs) {
      const edge = o.model - o.line;
      if (edge === 0 || Math.abs(edge) < t) continue;
      const res = Math.sign(edge) * (o.actual - o.line);
      if (res > 0) w++;
      else if (res < 0) l++;
      else p++;
      if (o.move != null) {
        mv += Math.sign(edge) * o.move;
        mvn++;
      }
    }
    return { minEdge: t, n: w + l + p, w, l, p, winPct: w + l ? (100 * w) / (w + l) : null, clv: mvn ? mv / mvn : null };
  });
  return {
    n,
    r2: sseL > 0 ? 1 - sseM / sseL : null,
    corr: ve > 0 && vr > 0 ? cov / Math.sqrt(ve * vr) : null,
    mae: aeM / n,
    lineMae: aeL / n,
    bias: bias / n,
    buckets,
  };
}

/** Game totals graded against `line` (open or close). */
export function scoreGames(gps: GamePred[], line: LineKind, thresholds?: number[]): ScoreSummary {
  const obs: Obs[] = [];
  for (const gp of gps) {
    if (!gp.g.completed) continue;
    const l = lineOf(gp.mkt, line);
    const m = projectedTotal(gp, line);
    if (!l || m == null) continue;
    const move = line === "open" && gp.mkt.closeTotal != null ? gp.mkt.closeTotal - l.total : null;
    obs.push({ line: l.total, model: m, actual: (gp.g.homePts ?? 0) + (gp.g.awayPts ?? 0), move });
  }
  return summarize(obs, thresholds);
}

/** Team totals (each side of each game) graded against the market's implied team points from `line`. */
export function scoreTeams(preds: SidePred[], line: LineKind, thresholds?: number[]): ScoreSummary {
  const obs: Obs[] = [];
  for (const p of preds) {
    if (p.row.pts == null) continue;
    const imp = sideImplied(p.row, line);
    const res = p.resid[line];
    if (imp == null || res == null) continue;
    const m = p.row.mkt;
    const move =
      line === "open" && m?.closeTotal != null && m.closeSpread != null ? impliedPoints(m.closeTotal, m.closeSpread, p.row.side) - imp : null;
    obs.push({ line: imp, model: imp + res, actual: p.row.pts, move });
  }
  return summarize(obs, thresholds);
}

export const fmtPct = (v: number | null, d = 1) => (v == null ? "–" : `${v.toFixed(d)}%`);
export const fmtNum = (v: number | null, d = 2) => (v == null ? "–" : v.toFixed(d));
