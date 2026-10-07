import { useMemo, useState } from "react";
import WindowCompareTable, { fmtWL, type CompareRow } from "./WindowCompare";
import {
  buildBetRows,
  buildTeamSplitBetRows,
  computeGamePerformanceBreakdown,
  computeTeamPerformanceBreakdown,
  type EnrichedGameRow,
  type PerformanceSegment,
} from "../lib/gameTotalsEngine";

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const fmt = (v: number | null, d = 2) => (v == null ? "–" : `${v > 0 && d >= 0 ? "" : ""}${v.toFixed(d)}`);

function segmentRows(label: string, a: PerformanceSegment | undefined, b: PerformanceSegment | undefined): CompareRow[] {
  const out: CompareRow[] = [];
  const mk = (suffix: string, sa: PerformanceSegment["eb"] | undefined, sb: PerformanceSegment["eb"] | undefined): CompareRow => ({
    label: `${label} — ${suffix}`,
    a: sa ? fmtWL(sa.wins, sa.losses, sa.pushes) : "–",
    b: sb ? fmtWL(sb.wins, sb.losses, sb.pushes) : "–",
    aPct: sa?.winPct ?? null,
    bPct: sb?.winPct ?? null,
    aN: sa?.n ?? 0,
    bN: sb?.n ?? 0,
  });
  out.push(mk("every bet", a?.eb, b?.eb));
  out.push(mk("filtered", a?.fb, b?.fb));
  return out;
}

/**
 * Game totals and team totals before vs after a cutoff week, within each selected
 * season: every-bet and filtered records (All / Over / Under, plus Home / Away /
 * Favorite / Underdog for team totals) and the model's error against the actual
 * total and against Vegas. Filtered uses the same 1.5 std-dev bar as everywhere
 * else, with the std dev measured over the whole pool so both windows share it.
 */
export default function TotalsWindowCompare({ rows, filterMultiplier }: { rows: EnrichedGameRow[]; filterMultiplier: number }) {
  const [cutoff, setCutoff] = useState(6);
  const early = useMemo(() => rows.filter((r) => r.game.week < cutoff), [rows, cutoff]);
  const late = useMemo(() => rows.filter((r) => r.game.week >= cutoff), [rows, cutoff]);

  const gameA = useMemo(() => buildBetRows(early, filterMultiplier, rows), [early, filterMultiplier, rows]);
  const gameB = useMemo(() => buildBetRows(late, filterMultiplier, rows), [late, filterMultiplier, rows]);
  const teamA = useMemo(() => buildTeamSplitBetRows(early, filterMultiplier, undefined, rows), [early, filterMultiplier, rows]);
  const teamB = useMemo(() => buildTeamSplitBetRows(late, filterMultiplier, undefined, rows), [late, filterMultiplier, rows]);
  const segGameA = useMemo(() => computeGamePerformanceBreakdown(gameA), [gameA]);
  const segGameB = useMemo(() => computeGamePerformanceBreakdown(gameB), [gameB]);
  const segTeamA = useMemo(() => computeTeamPerformanceBreakdown(teamA), [teamA]);
  const segTeamB = useMemo(() => computeTeamPerformanceBreakdown(teamB), [teamB]);

  function errors(bets: ReturnType<typeof buildBetRows>) {
    const withAll = bets.filter((b) => b.projectedTotal != null && b.vegasTotal != null && b.row.actualTotal != null);
    return {
      n: withAll.length,
      mineMinusVegas: mean(withAll.map((b) => (b.projectedTotal as number) - (b.vegasTotal as number))),
      actualMinusVegas: mean(withAll.map((b) => (b.row.actualTotal as number) - (b.vegasTotal as number))),
      mineMinusActual: mean(withAll.map((b) => (b.projectedTotal as number) - (b.row.actualTotal as number))),
      myMae: mean(withAll.map((b) => Math.abs((b.projectedTotal as number) - (b.row.actualTotal as number)))),
      vegasMae: mean(withAll.map((b) => Math.abs((b.vegasTotal as number) - (b.row.actualTotal as number)))),
    };
  }
  const eA = useMemo(() => errors(gameA), [gameA]);
  const eB = useMemo(() => errors(gameB), [gameB]);

  const pick = (segs: PerformanceSegment[], key: string) => segs.find((s) => s.key === key);
  const numRow = (label: string, a: number | null, b: number | null, higherIsBetter?: boolean, digits = 2): CompareRow => ({
    label,
    a: fmt(a, digits),
    b: fmt(b, digits),
    aVal: a,
    bVal: b,
    digits,
    higherIsBetter,
  });

  const rowsOut: CompareRow[] = [
    { label: "Games with a total", a: String(early.length), b: String(late.length) },
    { label: "Game totals", section: true },
    ...segmentRows("All", pick(segGameA, "all"), pick(segGameB, "all")),
    ...segmentRows("Overs", pick(segGameA, "over"), pick(segGameB, "over")),
    ...segmentRows("Unders", pick(segGameA, "under"), pick(segGameB, "under")),
    { label: "Game-total accuracy (completed games)", section: true },
    numRow("Mine minus Vegas (avg)", eA.mineMinusVegas, eB.mineMinusVegas),
    numRow("Actual minus Vegas (avg)", eA.actualMinusVegas, eB.actualMinusVegas),
    numRow("Mine minus actual (avg bias)", eA.mineMinusActual, eB.mineMinusActual),
    numRow("My avg abs error", eA.myMae, eB.myMae, false),
    numRow("Vegas avg abs error", eA.vegasMae, eB.vegasMae),
    { label: "Team totals", section: true },
    ...segmentRows("All", pick(segTeamA, "all"), pick(segTeamB, "all")),
    ...segmentRows("Overs", pick(segTeamA, "over"), pick(segTeamB, "over")),
    ...segmentRows("Unders", pick(segTeamA, "under"), pick(segTeamB, "under")),
    ...segmentRows("Home", pick(segTeamA, "home"), pick(segTeamB, "home")),
    ...segmentRows("Away", pick(segTeamA, "away"), pick(segTeamB, "away")),
    ...segmentRows("Favorites", pick(segTeamA, "favorite"), pick(segTeamB, "favorite")),
    ...segmentRows("Underdogs", pick(segTeamA, "underdog"), pick(segTeamB, "underdog")),
  ];

  return (
    <div>
      <p style={{ fontSize: "0.82rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        Game totals and team totals before vs after a cutoff week, within each selected season (division and closing/opening-line choices above apply). Built to see what a
        mid-season change — a new consensus power rating, or the re-centered totals model — did to results. Filtered = the 1.5 std-dev bar, with the std dev taken over the whole
        pool so both windows use the same one. Win % is colored against the 52.4% break-even (yellow); faded italic = fewer than 30 decided bets.
      </p>
      <label style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.75rem" }}>
        Cutoff: weeks 1–
        <input type="number" min={2} max={16} value={cutoff - 1} onChange={(e) => setCutoff((parseInt(e.target.value, 10) || 5) + 1)} style={{ width: 54 }} />
        vs week {cutoff} on
      </label>
      <WindowCompareTable labelA={`Weeks 1–${cutoff - 1}`} labelB={`Week ${cutoff}+`} rows={rowsOut} />
    </div>
  );
}
