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

// Site convention: negative = better team (green), positive = worse (red).
// These absolute thresholds (±10) are calibrated for Power Rating and SOS,
// which both run roughly -30..+30 and straddle zero — a natural fit for
// fixed bands. Used only when higherIsBetter is false.
function absoluteRatingColor(value: number) {
  if (value < -10) return "#5aa869";
  if (value < 0) return "#8fc79a";
  if (value < 10) return "#e0a95f";
  return "#c45c52";
}

// Metrics whose raw values don't share Power Rating/SOS's roughly -30..+30,
// zero-centered range — Resume Rating (0..90, always positive) and Win
// Totals/Wins Left/Losses Left (0..13ish, always positive) both break the
// ±10 absolute thresholds: everything lands in the same one or two bands
// regardless of how good or bad the team actually is. Coloring by rank
// percentile instead sidesteps the whole "what's the right absolute
// threshold for this metric's scale" question — the best quarter of the
// list is always green, the worst quarter always red, no matter what units
// or range the value is in. `rank1IsBest` says which end of the list (rank
// 1, always the numerically highest raw value per this file's row
// builders) should read as green — true for Resume Rating/Win Totals/Wins
// Left (a high value is good), false for Losses Left (a high value is bad).
function rankPercentileColor(rank: number, totalRows: number, rank1IsBest: boolean) {
  const pct = totalRows > 0 ? rank / totalRows : 0;
  const effectivePct = rank1IsBest ? pct : 1 - pct;
  if (effectivePct <= 0.25) return "#5aa869";
  if (effectivePct <= 0.5) return "#8fc79a";
  if (effectivePct <= 0.75) return "#e0a95f";
  return "#c45c52";
}

function ratingColor(
  value: number,
  higherIsBetter: boolean,
  rank: number,
  totalRows: number,
  isChangeValue: boolean,
  colorScale: "threshold" | "percentile"
) {
  if (isChangeValue) {
    // Week-over-week deltas are naturally small and roughly zero-centered
    // no matter which metric they're measuring (a team's rating rarely
    // swings more than a handful of points in one week, whether that's
    // Power Rating, Resume Rating, or SOS) — so the same ±10 bands used
    // for Power Rating/SOS's raw values work fine here too. Only the sign
    // needs to flip so "improved" always reads green, regardless of
    // whether the underlying metric is higher-is-better or lower-is-better.
    return absoluteRatingColor(higherIsBetter ? -value : value);
  }
  if (colorScale === "percentile") {
    return rankPercentileColor(rank, totalRows, higherIsBetter);
  }
  return absoluteRatingColor(value);
}

function CompactSection({
  title,
  rows,
  targetRowsPerColumn,
  valueLabel,
  higherIsBetter,
  colorScale,
  signed,
}: {
  title: string;
  rows: CompactRatingRow[];
  targetRowsPerColumn: number;
  valueLabel: string;
  higherIsBetter: boolean;
  colorScale: "threshold" | "percentile";
  signed: boolean;
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
                    <td style={{ ...CELL, color: ratingColor(r.rating, higherIsBetter, r.rank, rows.length, valueLabel === "CHANGE", colorScale), fontWeight: 700 }}>
                      {/* CHANGE columns are deltas and always want the sign
                          (+3.2 vs -3.2 reads as "improved"/"worsened"); raw
                          columns only get a leading "+" when `signed` says
                          the metric is actually signed (Power Rating, SOS) —
                          a plain count like Win Totals ("+8 wins") read like
                          a week-over-week change and was misleading. */}
                      {(valueLabel === "CHANGE" || signed) && r.rating > 0 ? "+" : ""}
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
  colorScale = "threshold",
  signed = true,
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
  /** For a raw-value column (ignored for a "CHANGE" column, which always
   * uses the sign-flipped threshold approach — see ratingColor): true for
   * metrics where a higher number is the better team (Resume Rating, Win
   * Totals, Wins Left) or, for Losses Left specifically, where a higher
   * number is worse but the list is still ranked highest-value-first.
   * False (default) for Power Rating and SOS, where a lower/more negative
   * number is better. Also flips a "CHANGE" column's sign so "improved"
   * always reads green. */
  higherIsBetter?: boolean;
  /** Lays multiple sections out left-to-right instead of stacked — for
   * SOS's Hardest/Easiest and Got Harder/Got Easier splits, which are two
   * independent ranked lists shown side by side rather than one list
   * chunked into columns. Each section still gets its own multi-column
   * chunking internally if it's longer than targetRowsPerColumn; the
   * caller should pass a targetRowsPerColumn at least as large as the
   * longer section's row count to keep each side a single column. */
  sideBySide?: boolean;
  /** How the raw-value column is colored: "threshold" (default) applies
   * Power Rating/SOS's fixed ±10 green/red bands — only correct for
   * metrics in roughly that range. "percentile" colors by the row's rank
   * within the list instead (top quarter green, bottom quarter red) —
   * use this for any metric with a different scale (Resume Rating, Win
   * Totals, Wins Left, Losses Left). Doesn't affect "CHANGE" columns,
   * which always use the threshold approach (see ratingColor). */
  colorScale?: "threshold" | "percentile";
  /** Whether a positive raw value gets a leading "+" — true (default) for
   * signed metrics like Power Rating/SOS, where the sign is meaningful.
   * Pass false for plain non-negative counts (Win Totals, Wins Left,
   * Losses Left), where "+8" reads like a change rather than a total.
   * Doesn't affect CHANGE columns, which always show the sign. */
  signed?: boolean;
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

      {/* justifyContent:"center" matters whenever the header text is wider
          than the two side-by-side columns combined — the outer container
          is width:"fit-content", so it sizes to whichever is wider, and
          without this the (narrower) column pair would sit flush-left
          under a (wider) centered header instead of centered under it. */}
      <div style={sideBySide ? { display: "flex", gap: 24, alignItems: "flex-start", justifyContent: "center" } : undefined}>
        {sections.map((s, i) => (
          <CompactSection
            key={s.title || i}
            title={s.title}
            rows={s.rows}
            targetRowsPerColumn={targetRowsPerColumn}
            valueLabel={valueLabel}
            higherIsBetter={higherIsBetter}
            colorScale={colorScale}
            signed={signed}
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
