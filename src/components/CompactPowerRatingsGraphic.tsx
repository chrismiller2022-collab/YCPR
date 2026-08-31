import type { CSSProperties } from "react";
import { chunkForCompactGrid, type CompactRatingRow } from "../lib/compactPowerRatings";
import { TEAM_LOGOS } from "../data/logos";

// Dense, spreadsheet-style power ratings display — the compact alternative
// to the full sortable table, built specifically to be captured as a PNG.
// Ranked teams are chunked into several short columns instead of one long
// list, so the whole division fits in a single glance instead of a scroll.
// Used by the Weekly Image Dump admin tool (Admin > Weekly Image Dump) for
// every Power Ratings image — Full List (targetRowsPerColumn=34, its
// original use), and also Top 25/G6/Gainers/Losers (targetRowsPerColumn=5,
// giving a 5-columns-of-5 grid for a 25-team list) after the "reg table"
// replica (RankedTeamsTableGraphic) turned out to be too fragile to
// capture reliably off-screen — this component's layout doesn't depend on
// any page-width-relative CSS, so it doesn't have that problem.
//
// Rendered off-screen (not display:none — html-to-image needs real layout)
// and pointed at by the Weekly Image Dump's capture refs; never shown in
// the normal page flow. Bakes in its own header (eyebrow + title) and
// footer (brand / site URL / handle) rather than relying on exportPng.ts's
// generic branding bar — the caller should pass includeBranding:false to
// exportNodeAsPngBlob/exportNodeAsPng to avoid getting both.

const SITE_URL = "ycpr.vercel.app";
const TWITTER_HANDLE = "@YCtheflea";

const HEAD_CELL: CSSProperties = {
  padding: "3px 8px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "rgba(255,255,255,0.55)",
  borderBottom: "1px solid rgba(255,255,255,0.25)",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const CELL: CSSProperties = {
  padding: "2.5px 8px",
  fontSize: 11,
  textAlign: "right",
  whiteSpace: "nowrap",
};

// Site convention: negative = better team (green), positive = worse (red)
// — true for Power Rating and SOS, but Resume Rating runs the opposite
// direction (a higher number is the better team). Rather than duplicate
// the color/threshold logic, higherIsBetter just flips the sign before
// applying the same thresholds, so "green" still means "good" for
// whichever metric this grid is showing.
function ratingColor(value: number, higherIsBetter: boolean) {
  const v = higherIsBetter ? -value : value;
  if (v < -10) return "#5aa869";
  if (v < 0) return "#8fc79a";
  if (v < 10) return "#e0a95f";
  return "#c45c52";
}

function CompactSection({
  title,
  rows,
  targetRowsPerColumn,
  valueLabel,
  higherIsBetter,
}: {
  title: string;
  rows: CompactRatingRow[];
  targetRowsPerColumn: number;
  valueLabel: string;
  higherIsBetter: boolean;
}) {
  const columns = chunkForCompactGrid(rows, targetRowsPerColumn);
  if (columns.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      {title && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: "var(--gold, #d9a441)",
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {columns.map((col, ci) => (
          <table key={ci} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...HEAD_CELL, textAlign: "right" }}>#</th>
                <th style={{ ...HEAD_CELL, textAlign: "left" }} colSpan={2}>
                  Team
                </th>
                <th style={{ ...HEAD_CELL, textAlign: "right" }}>{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {col.map((r, ri) => {
                const logo = TEAM_LOGOS[r.team];
                return (
                  <tr key={r.team} style={{ background: ri % 2 === 1 ? "rgba(255,255,255,0.04)" : "transparent" }}>
                    <td style={{ ...CELL, color: "rgba(255,255,255,0.6)" }}>{r.rank}</td>
                    <td style={{ ...CELL, textAlign: "left", padding: "2.5px 0 2.5px 8px", width: 16 }}>
                      {logo && <img src={logo} alt="" width={14} height={14} style={{ display: "block" }} />}
                    </td>
                    <td style={{ ...CELL, textAlign: "left", color: "#fff", fontWeight: 600, padding: "2.5px 8px 2.5px 4px" }}>
                      {r.team}
                    </td>
                    <td style={{ ...CELL, color: ratingColor(r.rating, higherIsBetter), fontWeight: 700 }}>
                      {r.rating > 0 ? "+" : ""}
                      {r.rating.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

export default function CompactPowerRatingsGraphic({
  eyebrow,
  header,
  sections,
  targetRowsPerColumn = 34,
  valueLabel = "YCPR",
  higherIsBetter = false,
  sideBySide = false,
}: {
  /** Small uppercase label above the title, e.g. "WEEK 1 · FBS". */
  eyebrow: string;
  /** Bold title describing what this graphic is, e.g. "POWER RATINGS — FULL LIST". */
  header: string;
  sections: { title: string; rows: CompactRatingRow[] }[];
  targetRowsPerColumn?: number;
  /** Column header for the value column — "YCPR" for a ratings list,
   * "CHANGE" for a gainers/losers list where the value shown is the
   * week-over-week move rather than the rating itself. */
  valueLabel?: string;
  /** True for metrics where a higher number is the better team (Resume
   * Rating). False (default) for Power Rating and SOS, where a lower/more
   * negative number is better. Flips the value-column color coding —
   * for a gainers/losers grid it also flips which direction of "change"
   * reads as green/improved vs. red/declined. */
  higherIsBetter?: boolean;
  /** Lays multiple sections out left-to-right instead of stacked — for
   * SOS's Hardest/Easiest and Got Harder/Got Easier splits, which are two
   * independent ranked lists shown side by side rather than one list
   * chunked into columns. Each section still gets its own multi-column
   * chunking internally if it's longer than targetRowsPerColumn; the
   * caller should pass a targetRowsPerColumn at least as large as the
   * longer section's row count to keep each side a single column. */
  sideBySide?: boolean;
}) {
  return (
    <div
      style={{
        background: "#1f2041",
        padding: "22px 26px",
        width: "fit-content",
        fontFamily: "inherit",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.12em",
            color: "var(--gold, #d9a441)",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.03em",
            color: "#fff",
            textTransform: "uppercase",
          }}
        >
          {header}
        </div>
      </div>

      <div style={sideBySide ? { display: "flex", gap: 24, alignItems: "flex-start" } : undefined}>
        {sections.map((s, i) => (
          <CompactSection
            key={s.title || i}
            title={s.title}
            rows={s.rows}
            targetRowsPerColumn={targetRowsPerColumn}
            valueLabel={valueLabel}
            higherIsBetter={higherIsBetter}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          paddingTop: 10,
          marginTop: 6,
          borderTop: "1px solid rgba(255,255,255,0.15)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.55)" }}>YC POWER RATINGS</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>{SITE_URL}</span>
        <span style={{ color: "var(--gold, #d9a441)" }}>{TWITTER_HANDLE}</span>
      </div>
    </div>
  );
}
