import type { CSSProperties } from "react";
import type { LeagueAverages, TeamSeasonInputs } from "../lib/gameTotals";
import { Z_CLIP, type RidgeTotalBreakdown } from "../lib/totalModelRidge";
import type { TotalBreakdownResult } from "../lib/totalBreakdown";

const CELL: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const NUM: CSSProperties = { ...CELL, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const P: CSSProperties = { fontSize: "0.85rem", lineHeight: 1.55, color: "var(--chalk)", margin: "0.4rem 0" };

function f(v: number | null | undefined, d = 2): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(d);
}
function sgn(v: number, d = 2): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
}

// Step-by-step table: every input the regression sees, how it was converted, and its points.
// compact drops the training mean / SD columns so the Points column fits in a popup.
export function BreakdownTable({ b, withStats, compact = false }: { b: RidgeTotalBreakdown; withStats: boolean; compact?: boolean }) {
  const lead = 6 - (compact ? 2 : 0);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={CELL}>Input</th>
            <th style={NUM}>{compact ? "Given" : "Value given"}</th>
            <th style={NUM} title="After re-standardizing against this season's pool and clipping">{compact ? "Used" : `Value used${withStats ? " (re-standardized)" : ""}`}</th>
            {!compact && <th style={NUM}>Training mean</th>}
            {!compact && <th style={NUM}>Training SD</th>}
            <th style={NUM}>{compact ? "z" : "z-score"}</th>
            <th style={NUM}>{compact ? "Pts/SD" : "Coefficient (pts / SD)"}</th>
            <th style={NUM}>Points</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={CELL}>Intercept</td>
            <td style={NUM} colSpan={lead} />
            <td style={NUM}>{f(b.intercept)}</td>
          </tr>
          {b.steps.map((s) => (
            <tr key={s.key}>
              <td style={CELL}>
                {s.label}
                {s.given == null && <span style={{ color: "var(--chalk-dim)" }}> (missing → training mean)</span>}
                {s.clipped && <span style={{ color: "var(--chalk-dim)" }}> (clipped at ±{Z_CLIP} SD)</span>}
              </td>
              <td style={NUM}>{f(s.given, s.key.includes("ppa") || s.key.includes("expl") ? 3 : 2)}</td>
              <td style={NUM}>{f(s.used, s.key.includes("ppa") || s.key.includes("expl") ? 3 : 2)}</td>
              {!compact && <td style={NUM}>{f(s.trainingMean, 3)}</td>}
              {!compact && <td style={NUM}>{f(s.trainingScale, 3)}</td>}
              <td style={NUM}>{sgn(s.zScore)}</td>
              <td style={NUM}>{sgn(s.coef)}</td>
              <td style={NUM}>{sgn(s.contribution)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...CELL, fontWeight: 600 }}>Raw model total (intercept + all points)</td>
            <td style={NUM} colSpan={lead} />
            <td style={{ ...NUM, fontWeight: 600 }}>{f(b.rawTotal)}</td>
          </tr>
          <tr>
            <td style={CELL}>Calibration offset (slight Under lean)</td>
            <td style={NUM} colSpan={lead} />
            <td style={NUM}>{sgn(b.biasOffset)}</td>
          </tr>
          <tr>
            <td style={{ ...CELL, fontWeight: 700 }}>Projected total</td>
            <td style={NUM} colSpan={lead} />
            <td style={{ ...NUM, fontWeight: 700 }}>{f(b.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function TeamStatsLine({ label, t }: { label: string; t: TeamSeasonInputs }) {
  return (
    <span style={{ marginRight: "1.2rem" }}>
      <strong>{label}</strong> ({t.games} G): off PPA {f(t.offPpa, 3)}, def PPA {f(t.defPpa, 3)}, off expl {f(t.offExplosiveness, 3)}, def expl{" "}
      {f(t.defExplosiveness, 3)}
    </span>
  );
}

export function LeaguePoolNote({ league }: { league: LeagueAverages }) {
  return (
    <p style={{ ...P, color: "var(--chalk-dim)" }}>
      This season's pool (used for re-standardizing): off PPA mean {f(league.offPpa, 3)} / SD {f(league.offPpaSd, 3)}; def PPA mean{" "}
      {f(league.defPpaAllowed, 3)} / SD {f(league.defPpaSd, 3)}; off explosiveness mean {f(league.offExplosiveness, 3)} / SD{" "}
      {f(league.offExplosivenessSd, 3)}; def explosiveness mean {f(league.defExplosivenessAllowed, 3)} / SD {f(league.defExplosivenessSd, 3)}.
    </p>
  );
}

// The full "how the model got there" view: both teams' stat lines, the stats-only total, the step-by-step table
// and the season pool the stats were re-standardized against.
export function TotalBreakdownView({ result, league, awayTeam, homeTeam, compact = false }: { result: TotalBreakdownResult; league: LeagueAverages | null; awayTeam: string; homeTeam: string; compact?: boolean }) {
  return (
    <div>
      <p style={{ ...P, color: "var(--chalk-dim)" }}>
        <TeamStatsLine label={homeTeam} t={result.home} />
        <TeamStatsLine label={awayTeam} t={result.away} />
      </p>
      <BreakdownTable b={result.breakdown} withStats compact={compact} />
      {league && <LeaguePoolNote league={league} />}
    </div>
  );
}
