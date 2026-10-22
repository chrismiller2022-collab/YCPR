import { RATING_SYSTEMS } from "./ratingSystems";
import type { MultiSystemGameRow } from "./multiRatingMatchups";

// Sort metrics for the Rating Systems spread chart. Every system counts
// (YC and Consensus included). Distances are measured from the Vegas line,
// or from the systems' median when a game has no line. Spreads are
// away-perspective, so a system below the reference likes the away team
// more than Vegas does.

export type SpreadChartSortKey = "longTail" | "oneSide" | "packVsVegas" | "outlier";

export const SPREAD_CHART_SORTS: { key: SpreadChartSortKey; label: string }[] = [
  { key: "longTail", label: "Long tails" },
  { key: "oneSide", label: "Most on one side" },
  { key: "packVsVegas", label: "Pack vs Vegas" },
  { key: "outlier", label: "Biggest outlier" },
];

const MIN_SYSTEMS = 5;
const SIDE_DEADZONE = 0.5;
const FAR_OFF = 3;

export interface SpreadChartSortResult {
  score: number | null;
  label: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function systemValues(row: MultiSystemGameRow): { key: string; label: string; v: number }[] {
  const out: { key: string; label: string; v: number }[] = [];
  for (const s of RATING_SYSTEMS) {
    const v = row.systems[s.key]?.projAwaySpread;
    if (v != null && Number.isFinite(v)) out.push({ key: s.key, label: s.label, v });
  }
  return out;
}

const fmt = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

export function spreadChartSort(row: MultiSystemGameRow, key: SpreadChartSortKey): SpreadChartSortResult {
  const vals = systemValues(row);
  const n = vals.length;
  if (n < MIN_SYSTEMS) return { score: null, label: `${n} systems` };
  const vegas = row.vegasAwaySpread;
  const ref = vegas ?? median(vals.map((x) => x.v));

  const away = vals.filter((x) => x.v < ref - SIDE_DEADZONE);
  const home = vals.filter((x) => x.v > ref + SIDE_DEADZONE);
  const dom = away.length >= home.length ? away : home;
  const domTeam = dom === away ? row.game.away_team : row.game.home_team;
  const dists = dom.map((x) => Math.abs(x.v - ref));

  if (key === "oneSide") {
    const avg = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
    // Share first; average distance only breaks ties.
    return { score: dom.length / n + avg / 1000, label: `${dom.length}/${n} on ${domTeam} side` };
  }

  if (key === "longTail") {
    if (dom.length / n < 2 / 3) return { score: null, label: `${dom.length}/${n} on one side` };
    const sum = dists.reduce((a, b) => a + b, 0);
    const lo = Math.min(...dists);
    const hi = Math.max(...dists);
    const far = dists.filter((d) => d >= FAR_OFF).length;
    // Many systems far past the line, spread out rather than bunched.
    return {
      score: sum * (hi - lo),
      label: `${dom.length}/${n} ${domTeam} side · ${far} ≥${FAR_OFF} pts off · ${lo.toFixed(1)}–${hi.toFixed(1)}`,
    };
  }

  if (key === "packVsVegas") {
    if (vegas == null) return { score: null, label: "no Vegas line" };
    const med = median(vals.map((x) => x.v));
    return { score: Math.abs(med - vegas), label: `pack ${fmt(med)} vs Vegas ${fmt(vegas)}` };
  }

  // outlier: the system farthest from the median of the others
  let best = { label: "", d: -1 };
  for (const x of vals) {
    const others = vals.filter((y) => y !== x).map((y) => y.v);
    const d = Math.abs(x.v - median(others));
    if (d > best.d) best = { label: x.label, d };
  }
  return { score: best.d, label: `${best.label} ${best.d.toFixed(1)} off the pack` };
}
