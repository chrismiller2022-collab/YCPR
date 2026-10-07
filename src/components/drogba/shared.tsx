import type { CSSProperties } from "react";

export const CELL: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
export const NUM: CSSProperties = { ...CELL, textAlign: "right", fontVariantNumeric: "tabular-nums" };
export const P: CSSProperties = { fontSize: "0.85rem", lineHeight: 1.55, color: "var(--chalk)", margin: "0.4rem 0" };
export const DIM: CSSProperties = { ...P, color: "var(--chalk-dim)", fontSize: "0.8rem" };
export const H3: CSSProperties = { margin: "1.4rem 0 0.3rem", fontSize: "1rem" };

export const f1 = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));
export const sgn = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);
export const pct = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "–" : `${v.toFixed(d)}%`);

// Spread in the usual way a bettor reads it: "Ohio State -7.5".
export function spreadLabel(team: string, spread: number): string {
  return `${team} ${spread > 0 ? "+" : ""}${spread.toFixed(1)}`;
}

// P(standard normal < z) — used to turn an expected cover margin into a rough win probability.
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
// Spread results (actual margin minus the line) have a standard deviation of about 13 points.
export const COVER_SD = 13;
export const winProb = (expectedCover: number) => normCdf(Math.abs(expectedCover) / COVER_SD);
// Profit per 1 unit risked at -110 for a win probability p.
export const evAtMinus110 = (p: number) => p * (100 / 110) - (1 - p);
