import type { CSSProperties } from "react";
import { winPctColor, isSmallSample } from "../lib/winPctColor";

// Side-by-side "before vs after" table used by the Bet History and Totals History
// tabs that compare weeks 1-(cutoff-1) with the cutoff week onward — built to
// track how a big mid-season change (e.g. a new consensus power rating) moved
// performance. A row with win percentages gets break-even coloring (yellow =
// 52.4%) and a faded/italic cell when its sample is under 30 decided bets.

export interface CompareRow {
  label: string;
  /** Section heading row (no values). */
  section?: boolean;
  a?: string;
  b?: string;
  /** Win fractions + decided-bet counts, when the row is a win rate. */
  aPct?: number | null;
  bPct?: number | null;
  aN?: number;
  bN?: number;
  /** Numeric values for non-win-rate rows (delta = b - a), with digits to show. */
  aVal?: number | null;
  bVal?: number | null;
  digits?: number;
  /** For numeric rows: is a higher value better (colors the change)? Omit for neutral. */
  higherIsBetter?: boolean;
}

const cell: CSSProperties = { padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)", fontSize: "0.8rem", whiteSpace: "nowrap" };

export function fmtWL(w: number, l: number, p = 0): string {
  return `${w}-${l}${p ? `-${p}` : ""}`;
}
export function pctOf(w: number, l: number): number | null {
  return w + l > 0 ? w / (w + l) : null;
}
export function fmtPct(p: number | null | undefined): string {
  return p == null ? "–" : `${(p * 100).toFixed(1)}%`;
}

function Pct({ pct, n }: { pct: number | null | undefined; n: number | undefined }) {
  const small = n != null && n > 0 && isSmallSample(n);
  return (
    <span style={{ color: winPctColor(pct), fontWeight: 700, opacity: small ? 0.55 : 1, fontStyle: small ? "italic" : undefined }} title={small ? `Small sample (${n} decided bets)` : undefined}>
      {fmtPct(pct)}
    </span>
  );
}

export default function WindowCompareTable({ labelA, labelB, rows }: { labelA: string; labelB: string; rows: CompareRow[] }) {
  return (
    <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left", color: "var(--chalk-dim)" }}></th>
            <th style={{ ...cell, textAlign: "right", color: "var(--chalk-dim)" }}>{labelA}</th>
            <th style={{ ...cell, textAlign: "right", color: "var(--chalk-dim)" }}>{labelB}</th>
            <th style={{ ...cell, textAlign: "right", color: "var(--chalk-dim)" }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.section) {
              return (
                <tr key={i}>
                  <td colSpan={4} style={{ ...cell, fontSize: "0.72rem", fontWeight: 700, color: "var(--gold)", paddingTop: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {r.label}
                  </td>
                </tr>
              );
            }
            const isPct = r.aPct !== undefined || r.bPct !== undefined;
            let change = "–";
            let changeColor: string | undefined;
            if (isPct) {
              if (r.aPct != null && r.bPct != null) {
                const d = (r.bPct - r.aPct) * 100;
                change = `${d > 0 ? "+" : ""}${d.toFixed(1)} pts`;
                changeColor = Math.abs(d) < 0.05 ? undefined : d > 0 ? "#8fd39a" : "#e07a7a";
              }
            } else if (r.aVal != null && r.bVal != null) {
              const d = r.bVal - r.aVal;
              const digits = r.digits ?? 2;
              change = `${d > 0 ? "+" : ""}${d.toFixed(digits)}`;
              if (r.higherIsBetter != null && Math.abs(d) >= 0.5 * 10 ** -digits) changeColor = (d > 0) === r.higherIsBetter ? "#8fd39a" : "#e07a7a";
            }
            return (
              <tr key={i}>
                <td style={{ ...cell, textAlign: "left" }}>{r.label}</td>
                <td style={{ ...cell, textAlign: "right" }}>
                  {r.a ?? ""} {isPct && <Pct pct={r.aPct} n={r.aN} />}
                </td>
                <td style={{ ...cell, textAlign: "right" }}>
                  {r.b ?? ""} {isPct && <Pct pct={r.bPct} n={r.bN} />}
                </td>
                <td style={{ ...cell, textAlign: "right", color: changeColor, fontWeight: 600 }}>{change}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
