import { useMemo, useState } from "react";
import WindowCompareTable, { fmtWL, pctOf, type CompareRow } from "./WindowCompare";
import { aggregateCustom, computeErrorStatsFromBetHistory, type CustomParams, type RecordTally } from "../lib/betHistory";
import type { BetHistoryRecord } from "../data/betHistory.data";

const tallyRow = (label: string, a: RecordTally, b: RecordTally): CompareRow => ({
  label,
  a: fmtWL(a.w, a.l, a.push),
  b: fmtWL(b.w, b.l, b.push),
  aPct: pctOf(a.w, a.l),
  bPct: pctOf(b.w, b.l),
  aN: a.w + a.l,
  bN: b.w + b.l,
});

/**
 * Season performance before vs after a cutoff week — everything on the Custom tab
 * (Every Game / Filtered / WFB / NWFB / Any Bet and the error vs Vegas), split into
 * weeks before the cutoff and the cutoff week onward within each selected season.
 * Respects the filters above (seasons, conference, team, division) and the Custom
 * parameters.
 */
export default function BetHistoryWindowCompare({ records, params }: { records: BetHistoryRecord[]; params: CustomParams }) {
  const [cutoff, setCutoff] = useState(6);
  const { early, late } = useMemo(() => {
    const early = records.filter((r) => r.week < cutoff);
    const late = records.filter((r) => r.week >= cutoff);
    return { early, late };
  }, [records, cutoff]);
  const aggA = useMemo(() => aggregateCustom(early, params).overall, [early, params]);
  const aggB = useMemo(() => aggregateCustom(late, params).overall, [late, params]);
  const errA = useMemo(() => computeErrorStatsFromBetHistory(early), [early]);
  const errB = useMemo(() => computeErrorStatsFromBetHistory(late), [late]);

  const rows: CompareRow[] = [
    { label: "Games graded", a: String(early.length), b: String(late.length) },
    { label: "Spread bets (model's cover pick vs the line)", section: true },
    tallyRow("Every game", aggA.everyBet, aggB.everyBet),
    tallyRow("Any bet", aggA.anyBet, aggB.anyBet),
    tallyRow("Filtered bet", aggA.filteredBet, aggB.filteredBet),
    tallyRow("Weighted filtered (WFB)", aggA.weightedFilteredBet, aggB.weightedFilteredBet),
    tallyRow("NWFB", aggA.nwfb, aggB.nwfb),
    { label: "Accuracy vs Vegas (points of error — lower is better)", section: true },
    { label: "My avg abs error", a: errA.yc.absError?.toFixed(2) ?? "–", b: errB.yc.absError?.toFixed(2) ?? "–", aVal: errA.yc.absError, bVal: errB.yc.absError, higherIsBetter: false },
    { label: "Vegas avg abs error", a: errA.vegas.absError?.toFixed(2) ?? "–", b: errB.vegas.absError?.toFixed(2) ?? "–", aVal: errA.vegas.absError, bVal: errB.vegas.absError },
    {
      label: "Mine minus Vegas (negative = I'm closer)",
      a: errA.absErrorOverVegasYc?.toFixed(2) ?? "–",
      b: errB.absErrorOverVegasYc?.toFixed(2) ?? "–",
      aVal: errA.absErrorOverVegasYc,
      bVal: errB.absErrorOverVegasYc,
      higherIsBetter: false,
    },
    { label: "My median abs error", a: errA.yc.medianAbsError?.toFixed(2) ?? "–", b: errB.yc.medianAbsError?.toFixed(2) ?? "–", aVal: errA.yc.medianAbsError, bVal: errB.yc.medianAbsError, higherIsBetter: false },
  ];

  return (
    <div>
      <p style={{ fontSize: "0.82rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        Weeks before the cutoff vs the cutoff week onward, within each selected season, using the filters above and the Custom parameters. Built to see what a mid-season change
        (a new consensus power rating, say) did to results. Win % is colored against the 52.4% break-even (yellow); faded italic = fewer than 30 decided bets.
      </p>
      <label style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.75rem" }}>
        Cutoff: weeks 1–
        <input type="number" min={2} max={16} value={cutoff - 1} onChange={(e) => setCutoff((parseInt(e.target.value, 10) || 5) + 1)} style={{ width: 54 }} />
        vs week {cutoff} on
      </label>
      <WindowCompareTable labelA={`Weeks 1–${cutoff - 1}`} labelB={`Week ${cutoff}+`} rows={rows} />
    </div>
  );
}
