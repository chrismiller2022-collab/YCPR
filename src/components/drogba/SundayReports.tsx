import { useMemo, useState } from "react";
import type { DrogbaPickRow } from "../../lib/api/drogbaData";
import { atsColor, clvColor } from "../../lib/drogba/colors";
import { gradePicks, summarizePicks, type GradedPick } from "../../lib/drogba/picksGrading";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import { buildPickRows, fitForWeek, projectWeek, type WeekSplit } from "../../lib/drogba/weekPlan";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, f1, pct, sgn, spreadLabel } from "./shared";

const HEAD = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };

function SummaryTable({ rows, rowsLabel }: { rows: { label: string; graded: GradedPick[] }[]; rowsLabel: string }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={CELL}>{rowsLabel}</th>
            <th style={HEAD}>Picks</th>
            <th style={HEAD}>vs open</th>
            <th style={HEAD}>ATS</th>
            <th style={HEAD}>vs close</th>
            <th style={HEAD}>Line moved to us</th>
            <th style={HEAD}>Closing-line value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, graded }) => {
            const t = summarizePicks(graded);
            return (
              <tr key={label}>
                <td style={CELL}>{label}</td>
                <td style={NUM}>{t.n}</td>
                <td style={NUM}>{t.open.w}–{t.open.l}</td>
                <td style={{ ...NUM, color: atsColor(t.open.n ? t.open.pct : null), fontWeight: 700 }}>{t.open.n ? pct(t.open.pct) : "–"}</td>
                <td style={NUM}>{t.close.w}–{t.close.l}</td>
                <td style={NUM}>{t.movedOur} of {t.movedOur + t.movedAgainst}</td>
                <td style={{ ...NUM, color: clvColor(t.clv), fontWeight: 700 }}>{t.clv == null ? "–" : sgn(t.clv, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const byTier = (g: GradedPick[]) => [
  { label: TIER_LABELS.power + " (primary)", graded: g.filter((r) => r.p.tier === "power") },
  { label: TIER_LABELS.other + " (tracked)", graded: g.filter((r) => r.p.tier !== "power") },
  { label: "All picks", graded: g },
];

// Last week's report and the season so far. Uses the picks that were logged while the lines were open; for a week that
// was never logged it recomputes what the model says with the same walk-forward fit, and says so.
export default function SundayReports({ state, split, picks, minEdge }: { state: DrogbaState; split: WeekSplit; picks: DrogbaPickRow[]; minEdge: number }) {
  const [showAll, setShowAll] = useState(false);
  const gameById = useMemo(() => new Map(state.games.map((g) => [g.id, g])), [state.games]);

  // Logged picks for a week, or a recomputed stand-in with the flag saying which.
  const weekPicks = useMemo(() => {
    const out = new Map<number, { rows: DrogbaPickRow[]; logged: boolean }>();
    if (!state.engine) return out;
    for (let w = 1; w <= split.last; w++) {
      const logged = picks.filter((p) => p.season === split.season && p.week === w);
      if (logged.length) {
        out.set(w, { rows: logged, logged: true });
        continue;
      }
      const fit = fitForWeek(state.engine, split.season, w);
      const rows = projectWeek(state.engine, fit, split.season, w, true).filter((r) => r.g.completed);
      out.set(w, { rows: buildPickRows(rows, minEdge).map((p) => ({ ...p, created_at: "" })), logged: false });
    }
    return out;
  }, [state.engine, picks, split.season, split.last, minEdge]);

  if (split.last < 1) return null;
  const lastWeek = weekPicks.get(split.last);
  const lastGraded = lastWeek ? gradePicks(lastWeek.rows, gameById, !showAll) : [];
  const seasonGraded = Array.from(weekPicks.values()).flatMap((w) => gradePicks(w.rows, gameById, !showAll));
  const weeks = Array.from(weekPicks.entries()).sort((a, b) => a[0] - b[0]);
  const unlogged = weeks.filter(([, v]) => !v.logged).map(([w]) => w);

  return (
    <div>
      <h3 style={H3}>Week {split.last} report</h3>
      <label style={{ fontSize: "0.82rem" }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include picks below the {minEdge}-point filter
      </label>
      {lastWeek && !lastWeek.logged && (
        <p style={DIM}>No picks were logged for week {split.last}, so this is recomputed now with the same walk-forward fit (what the model says with every earlier week's data). It is not a record of what was shown at the time.</p>
      )}
      <SummaryTable rows={byTier(lastGraded)} rowsLabel="Group" />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Group</th>
              <th style={CELL}>Matchup</th>
              <th style={CELL}>Pick</th>
              <th style={HEAD}>Open</th>
              <th style={HEAD}>Close</th>
              <th style={HEAD}>Final</th>
              <th style={HEAD}>Edge</th>
              <th style={HEAD}>Moved to us</th>
              <th style={CELL}>vs open</th>
            </tr>
          </thead>
          <tbody>
            {lastGraded
              .slice()
              .sort((a, b) => (a.p.tier === b.p.tier ? Math.abs(b.p.edge ?? 0) - Math.abs(a.p.edge ?? 0) : a.p.tier === "power" ? -1 : 1))
              .map(({ p, g, result, clv }) => (
                <tr key={p.game_id}>
                  <td style={{ ...CELL, color: p.tier === "power" ? undefined : "var(--chalk-dim)" }}>{p.tier === "power" ? "Power" : "Other"}</td>
                  <td style={CELL}>{p.away_team} @ {p.home_team}</td>
                  <td style={CELL}>{p.side === "home" ? spreadLabel(p.home_team, p.open_spread!) : spreadLabel(p.away_team, -p.open_spread!)}</td>
                  <td style={NUM}>{f1(p.open_spread)}</td>
                  <td style={NUM}>{f1(g?.close)}</td>
                  <td style={NUM}>{g?.completed ? `${g.awayPts}–${g.homePts}` : "–"}</td>
                  <td style={NUM}>{sgn(p.edge, 1)}</td>
                  <td style={{ ...NUM, color: clvColor(clv) }}>{sgn(clv, 1)}</td>
                  <td style={{ ...CELL, color: result === "W" ? "#8fd39a" : result === "L" ? "#e07a7a" : undefined, fontWeight: 700 }}>{result ?? "–"}</td>
                </tr>
              ))}
            {lastGraded.length === 0 && (
              <tr>
                <td style={CELL} colSpan={9}>No picks at this filter for week {split.last}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 style={H3}>{split.season} season so far</h3>
      {unlogged.length > 0 && (
        <p style={DIM}>
          Weeks {unlogged.join(", ")} were not logged, so they are recomputed with the same walk-forward fit (marked "recomputed"); logged weeks use what was saved at the time.
        </p>
      )}
      <SummaryTable rows={byTier(seasonGraded)} rowsLabel="Group" />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Week</th>
              <th style={CELL}>Source</th>
              <th style={HEAD}>Power vs power</th>
              <th style={HEAD}>CLV</th>
              <th style={HEAD}>Other games</th>
              <th style={HEAD}>CLV</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(([w, v]) => {
              const g = gradePicks(v.rows, gameById, !showAll);
              const p = summarizePicks(g.filter((r) => r.p.tier === "power"));
              const o = summarizePicks(g.filter((r) => r.p.tier !== "power"));
              const cell = (t: ReturnType<typeof summarizePicks>) => (
                <td style={{ ...NUM, color: atsColor(t.open.n ? t.open.pct : null) }}>{t.open.n ? `${t.open.w}–${t.open.l} (${t.open.pct.toFixed(0)}%)` : "–"}</td>
              );
              return (
                <tr key={w}>
                  <td style={CELL}>{w}</td>
                  <td style={{ ...CELL, color: v.logged ? undefined : "var(--chalk-dim)" }}>{v.logged ? "logged" : "recomputed"}</td>
                  {cell(p)}
                  <td style={{ ...NUM, color: clvColor(p.clv) }}>{p.clv == null ? "–" : sgn(p.clv, 2)}</td>
                  {cell(o)}
                  <td style={{ ...NUM, color: clvColor(o.clv) }}>{o.clv == null ? "–" : sgn(o.clv, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
