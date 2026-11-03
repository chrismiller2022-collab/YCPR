// "Std Study" tab on Rating Systems Matchups: every system's season graded
// on its raw saved ratings vs standardized (z × multiplier) ratings, on the
// same games, plus a multiplier sweep and per-system diagnostics. All math
// lives in src/lib/standardizedStudy.ts (shared with the offline report).

import { useMemo, useState } from "react";
import type { GameWithLines } from "../lib/api/gamesLines";
import { winPct, type SystemRecord } from "../lib/multiRatingMatchups";
import { runStandardizedStudy } from "../lib/standardizedStudy";
import type { ScaleStat } from "../lib/ratingStandardize";
import { ATS_BREAKEVEN_PCT } from "../lib/matchupsCompute";

const CP: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  fontSize: "0.76rem",
  borderBottom: "1px solid var(--a-tint-2)",
  whiteSpace: "nowrap",
};

type Bucket = "everyBet" | "filteredBet" | "nwfb";
const BUCKETS: [Bucket, string][] = [
  ["everyBet", "Every Bet"],
  ["filteredBet", "Filtered"],
  ["nwfb", "NWFB"],
];

function fmtRec(r: SystemRecord) {
  const d = r.w + r.l;
  return d === 0 ? "–" : `${r.w}-${r.l}${r.push ? `-${r.push}` : ""} (${winPct(r).toFixed(1)}%)`;
}
function color(r: SystemRecord) {
  if (r.w + r.l === 0) return undefined;
  return winPct(r) >= ATS_BREAKEVEN_PCT * 100 ? "var(--c-ok)" : "var(--c-err)";
}
function delta(a: SystemRecord, b: SystemRecord) {
  if (a.w + a.l === 0 || b.w + b.l === 0) return "–";
  const d = winPct(b) - winPct(a);
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}`;
}
const n1 = (v: number | null) => (v == null ? "–" : v.toFixed(1));
const n2 = (v: number | null) => (v == null ? "–" : v.toFixed(2));

export default function StandardizedStudyTab({
  games,
  ratingsByWeek,
  liveByTeam,
  weights,
  multiplier,
  scaleStat,
  include,
}: {
  games: GameWithLines[];
  ratingsByWeek: Map<number, Record<string, Record<string, number>>>;
  liveByTeam: Record<string, any>;
  weights: Record<string, number> | null;
  multiplier: number;
  scaleStat: ScaleStat;
  include: (g: GameWithLines) => boolean;
}) {
  const [bucket, setBucket] = useState<Bucket>("everyBet");
  const study = useMemo(
    () => runStandardizedStudy({ games, ratingsByWeek, liveByTeam, weights, multiplier, scaleStat, include }),
    [games, ratingsByWeek, liveByTeam, weights, multiplier, scaleStat, include]
  );

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: 0, maxWidth: 900 }}>
        Season-wide (the week dropdown doesn't apply here; division and conference filters do). Each system's saved value for a week is converted to standard deviations from the FBS average for that system and week (
        {scaleStat === "sd" ? "standard deviation" : "robust: median absolute deviation × 1.4826"}), then multiplied by{" "}
        <b>{multiplier}</b>. No unscaling is needed: the min-max and sheet rescales are linear, and a z-score ignores linear rescales. YC and
        Consensus are rebuilt from the standardized inputs with the current weights, then re-standardized. Raw and Standardized are graded on
        the same {study.gamesGraded} completed games (a system-week with no usable FBS spread, such as a column saved as all zeros, is left out of
        both). With ~600 games, one standard error on a win % is about ±2 points — judge a change by the <i>Flipped</i> column (only the games
        whose pick changed decide the difference).
      </p>

      <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.6rem" }}>
        {BUCKETS.map(([k, l]) => (
          <button key={k} className={`mode-btn ${bucket === k ? "mode-btn-active" : ""}`} onClick={() => setBucket(k)}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginBottom: "1.2rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th className="th" style={CP}>System</th>
              <th className="th th-right" style={CP}>Raw</th>
              <th className="th th-right" style={CP}>Standardized</th>
              <th className="th th-right" style={CP}>Δ win %</th>
              <th className="th th-right" style={CP} title="Every Bet: games where the standardized pick is the other side, and the standardized record on just those">
                Flipped (Std rec.)
              </th>
              <th className="th th-right" style={CP} title="Mean absolute error of the projected spread vs the final margin">MAE raw / std</th>
              <th className="th th-right" style={CP} title="The system's own FBS SD in its stored units, averaged over saved weeks (min–max)">Current pts / SD</th>
              <th className="th th-right" style={CP} title="Least-squares multiplier fitting standardized difference to the final margin / to the closing line">Best ×: margin / market</th>
            </tr>
          </thead>
          <tbody>
            {study.rows.map((r) => {
              const a = r.raw[bucket];
              const b = r.std[bucket];
              const control = r.id.includes("~") || r.id.endsWith("_stored");
              return (
                <tr key={r.id} style={control ? { fontStyle: "italic" } : undefined}>
                  <td style={{ ...CP, fontWeight: 700 }}>
                    {r.label}
                    {r.deadWeeks.length > 0 && (
                      <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }} title="Weeks left out: no usable FBS spread that week">
                        {" "}
                        (skips wk {r.deadWeeks.join(", ")})
                      </span>
                    )}
                  </td>
                  <td style={{ ...CP, textAlign: "right", color: color(a) }}>{fmtRec(a)}</td>
                  <td style={{ ...CP, textAlign: "right", color: color(b), fontWeight: 700 }}>{fmtRec(b)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>{delta(a, b)}</td>
                  <td style={{ ...CP, textAlign: "right" }}>
                    {r.flipped} ({r.flippedStd.w}-{r.flippedStd.l})
                  </td>
                  <td style={{ ...CP, textAlign: "right" }}>
                    {n2(r.maeRaw)} / {n2(r.maeStd)}
                  </td>
                  <td style={{ ...CP, textAlign: "right" }}>
                    {n1(r.avgPointsPerSd)} ({n1(r.minPointsPerSd)}–{n1(r.maxPointsPerSd)})
                  </td>
                  <td style={{ ...CP, textAlign: "right" }}>
                    {n1(r.bestKMargin)} / {n1(r.bestKMarket)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: "0 0 0.4rem" }}>Multiplier sweep — standardized {BUCKETS.find(([k]) => k === bucket)?.[1]} win %</h3>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: 0 }}>
        Same games, multiplier varied. A single peak is a weak signal; a broad plateau is a stronger one. Bold = that system's best.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th className="th" style={CP}>System</th>
              {study.sweep.map((m) => (
                <th key={m} className="th th-right" style={{ ...CP, color: m === multiplier ? "var(--gold)" : undefined }}>
                  ×{m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {study.rows.map((r) => {
              const perfs = study.sweepPerf[r.id].map((p) => p[bucket]);
              const pcts = perfs.map((p) => (p.w + p.l ? winPct(p) : null));
              const best = Math.max(...pcts.filter((v): v is number => v != null));
              return (
                <tr key={r.id}>
                  <td style={{ ...CP, fontWeight: 700 }}>{r.label}</td>
                  {pcts.map((v, i) => (
                    <td
                      key={i}
                      style={{ ...CP, textAlign: "right", fontWeight: v === best ? 700 : 400, color: v == null ? undefined : v >= ATS_BREAKEVEN_PCT * 100 ? "var(--c-ok)" : "var(--c-err)" }}
                      title={fmtRec(perfs[i])}
                    >
                      {v == null ? "–" : v.toFixed(1)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
