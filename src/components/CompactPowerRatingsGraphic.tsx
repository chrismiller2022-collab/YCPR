import type { CSSProperties } from "react";
import { chunkForCompactGrid, type CompactRatingRow } from "../lib/compactPowerRatings";

// Dense, spreadsheet-style power ratings display — the compact alternative
// to the full sortable table, built specifically to be captured as a PNG
// (Tweet button / Export) or laid out inside the Weekly Report PDF. Ranked
// teams are chunked into several short columns instead of one long list, so
// the whole division fits in a single glance instead of a scroll.
//
// Rendered off-screen (not display:none — html-to-image needs real layout)
// and pointed at by a Tweet/Export button's targetRef; never shown in the
// normal page flow.

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

function ratingColor(rating: number) {
  // Site convention: negative rating = better team (green), positive = worse (red).
  if (rating < -10) return "#5aa869";
  if (rating < 0) return "#8fc79a";
  if (rating < 10) return "#e0a95f";
  return "#c45c52";
}

function CompactSection({ title, rows, targetRowsPerColumn }: { title: string; rows: CompactRatingRow[]; targetRowsPerColumn: number }) {
  const columns = chunkForCompactGrid(rows, targetRowsPerColumn);
  if (columns.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
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
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {columns.map((col, ci) => (
          <table key={ci} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...HEAD_CELL, textAlign: "right" }}>#</th>
                <th style={{ ...HEAD_CELL, textAlign: "left" }}>Team</th>
                <th style={{ ...HEAD_CELL, textAlign: "right" }}>Rtg</th>
              </tr>
            </thead>
            <tbody>
              {col.map((r, ri) => (
                <tr key={r.team} style={{ background: ri % 2 === 1 ? "rgba(255,255,255,0.04)" : "transparent" }}>
                  <td style={{ ...CELL, color: "rgba(255,255,255,0.6)" }}>{r.rank}</td>
                  <td style={{ ...CELL, textAlign: "left", color: "#fff", fontWeight: 600 }}>{r.team}</td>
                  <td style={{ ...CELL, color: ratingColor(r.rating), fontWeight: 700 }}>
                    {r.rating > 0 ? "+" : ""}
                    {r.rating.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

export default function CompactPowerRatingsGraphic({
  title,
  sections,
  targetRowsPerColumn = 34,
}: {
  title: string;
  sections: { title: string; rows: CompactRatingRow[] }[];
  targetRowsPerColumn?: number;
}) {
  return (
    <div
      style={{
        background: "#1f2041",
        padding: "18px 22px",
        width: "fit-content",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          fontSize: 19,
          fontWeight: 800,
          letterSpacing: "0.04em",
          color: "#fff",
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {sections.map((s) => (
        <CompactSection key={s.title} title={s.title} rows={s.rows} targetRowsPerColumn={targetRowsPerColumn} />
      ))}
    </div>
  );
}
