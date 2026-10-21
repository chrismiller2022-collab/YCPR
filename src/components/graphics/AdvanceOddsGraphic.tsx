import type { CSSProperties } from "react";
import GraphicFrame, { fmtRating, GOLD, Logo } from "./GraphicFrame";
import type { AdvanceOddsRow } from "../../lib/playoffGraphics";

// Exact round-by-round advance odds for a 12-team field (computeAdvanceOdds
// in lib/playoffGraphics.ts). Rows sorted by WIN desc; bye seeds show ✓ in
// the QF column; % cells get a green heat fill scaled to the probability.

const HEAD: CSSProperties = {
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.6)",
  borderBottom: "1px solid rgba(255,255,255,0.25)",
  textAlign: "center",
  whiteSpace: "nowrap",
};
const CELL: CSSProperties = { padding: "6px 10px", fontSize: 14, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.06)" };

export function fmtPct(p: number): string {
  if (p >= 0.995 && p < 1) return ">99%";
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

function heat(p: number): CSSProperties {
  const a = Math.min(0.85, 0.06 + 0.8 * p);
  return { background: `rgba(52,168,83,${a.toFixed(3)})`, color: p > 0.55 ? "#fff" : "rgba(255,255,255,0.92)" };
}

export default function AdvanceOddsGraphic({
  eyebrow,
  header,
  subtitle,
  rows,
  flipRating = true,
}: {
  eyebrow: string;
  header: string;
  subtitle?: string;
  /** computeAdvanceOdds(field, { liveByTeam }) output. */
  rows: AdvanceOddsRow[];
  /** Show power rating as -rating (higher = better, like the reference). Default true. */
  flipRating?: boolean;
}) {
  const sorted = [...rows].sort((a, b) => b.win - a.win || a.seed - b.seed);
  const vals = sorted.map((r) => -r.rating);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const ratingBg = (r: number) => {
    const t = hi > lo ? (-r - lo) / (hi - lo) : 0.5;
    return `rgba(217,164,65,${(0.1 + 0.35 * t).toFixed(3)})`;
  };
  return (
    <GraphicFrame eyebrow={eyebrow} header={header} subtitle={subtitle}>
      <table style={{ borderCollapse: "collapse", margin: "0 auto" }}>
        <thead>
          <tr>
            <th style={HEAD}>SEED</th>
            <th style={{ ...HEAD, textAlign: "left" }}>TEAM</th>
            <th style={HEAD}>RATING</th>
            <th style={HEAD}>QF</th>
            <th style={HEAD}>SF</th>
            <th style={HEAD}>NCG</th>
            <th style={{ ...HEAD, color: GOLD }}>WIN</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.team}>
              <td style={{ ...CELL, background: "rgba(255,255,255,0.08)", color: r.seed <= 4 ? GOLD : "#fff", width: 34 }}>{r.seed}</td>
              <td style={{ ...CELL, textAlign: "left", minWidth: 190 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Logo team={r.team} size={22} />
                  <span style={{ textTransform: "uppercase", letterSpacing: "0.02em" }}>{r.team}</span>
                </span>
              </td>
              <td style={{ ...CELL, background: ratingBg(r.rating), width: 60 }}>{fmtRating(r.rating, flipRating)}</td>
              {r.bye ? (
                <td style={{ ...CELL, ...heat(1), width: 56, fontSize: 16 }}>✓</td>
              ) : (
                <td style={{ ...CELL, ...heat(r.qf), width: 56 }}>{fmtPct(r.qf)}</td>
              )}
              <td style={{ ...CELL, ...heat(r.sf), width: 56 }}>{fmtPct(r.sf)}</td>
              <td style={{ ...CELL, ...heat(r.ncg), width: 56 }}>{fmtPct(r.ncg)}</td>
              <td style={{ ...CELL, ...heat(r.win), width: 56 }}>{fmtPct(r.win)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 10, fontWeight: 600 }}>
        Exact odds from YC power ratings · First round at higher seed · QF, SF and title at neutral sites · ✓ = first-round bye
      </div>
    </GraphicFrame>
  );
}
