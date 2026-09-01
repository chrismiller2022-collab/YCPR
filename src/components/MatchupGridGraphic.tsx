import type { CSSProperties } from "react";
import TeamLogo from "./TeamLogo";
import { spreadColor } from "../lib/odds";
import type { SlateGameRow } from "../lib/matchupSlate";

// Compact multi-column alternative to MatchupSlateGraphic for the Weekly
// Image Dump — MatchupSlateGraphic (one full-width row per game, stacked)
// reads fine for a handful of games but gets very tall for a full Saturday
// slate. This lays games out in several short columns instead, closer to
// a sportsbook-style "slate card" (inspired by reference images Chris
// shared: a compact ET/Matchup/Line/Win grid, several games per column).
// Deliberately a separate component rather than a MatchupSlateGraphic
// rewrite — MatchupSlateGraphic is still used by the live Weekly Matchups
// page's own Export/Tweet buttons and shouldn't change shape out from
// under that.
//
// Visual language matches CompactPowerRatingsGraphic (same background,
// eyebrow/header, footer bar) so it doesn't look out of place next to the
// rest of this tool's images.

const SITE_URL = "ycpr.vercel.app";
const TWITTER_HANDLE = "@YCtheflea";

function fmtTimeET(iso: string | null): string {
  if (!iso) return "TBD";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const ampm = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  return minute === "00" ? `${hour}${ampm}` : `${hour}:${minute}${ampm}`;
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  if (v === 0) return "PK";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmtPct(v: number | null): string {
  return v == null ? "–" : `${Math.round(v * 100)}%`;
}

// Same numColumns-from-targetRowsPerColumn derivation as
// chunkForCompactGrid (compactPowerRatings.ts), just sorted by kickoff
// time instead of rank — that helper is typed specifically to
// CompactRatingRow's {rank} shape, and games don't have a rank.
function chunkGamesForGrid(rows: SlateGameRow[], targetRowsPerColumn: number): SlateGameRow[][] {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.kickoffIso ? new Date(a.kickoffIso).getTime() : Infinity;
    const tb = b.kickoffIso ? new Date(b.kickoffIso).getTime() : Infinity;
    return ta - tb;
  });
  if (sorted.length === 0) return [];
  const numColumns = Math.max(1, Math.ceil(sorted.length / targetRowsPerColumn));
  const rowsPerColumn = Math.ceil(sorted.length / numColumns);
  const columns: SlateGameRow[][] = [];
  for (let i = 0; i < numColumns; i++) {
    const slice = sorted.slice(i * rowsPerColumn, (i + 1) * rowsPerColumn);
    if (slice.length > 0) columns.push(slice);
  }
  return columns;
}

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
  padding: "4px 8px",
  fontSize: 11,
  textAlign: "right",
  whiteSpace: "nowrap",
};

function GameRow({ row, zebra }: { row: SlateGameRow; zebra: boolean }) {
  const awayWinner = row.projWinner === "away";
  const homeWinner = row.projWinner === "home";

  return (
    <tr style={{ background: zebra ? "rgba(255,255,255,0.04)" : "transparent" }}>
      <td style={{ ...CELL, textAlign: "left", color: "rgba(255,255,255,0.6)" }}>{fmtTimeET(row.kickoffIso)}</td>
      <td style={{ ...CELL, textAlign: "left" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <TeamLogo team={row.awayTeam} size={15} />
          <span style={{ color: "#fff", fontWeight: awayWinner ? 800 : 400 }}>{row.awayTeam}</span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10.5 }}>@</span>
          <TeamLogo team={row.homeTeam} size={15} />
          <span style={{ color: "#fff", fontWeight: homeWinner ? 800 : 400 }}>{row.homeTeam}</span>
        </span>
      </td>
      {row.completed ? (
        <td colSpan={2} style={{ ...CELL, fontWeight: 700 }}>
          {row.awayScore}-{row.homeScore}
        </td>
      ) : (
        <>
          <td style={{ ...CELL, color: spreadColor(row.myAwaySpread ?? 0), fontWeight: 700 }}>{fmtSpread(row.myAwaySpread)}</td>
          <td style={{ ...CELL, color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>{fmtPct(row.myAwayWinPct)}</td>
        </>
      )}
    </tr>
  );
}

export default function MatchupGridGraphic({
  eyebrow,
  header,
  rows,
  targetRowsPerColumn = 7,
}: {
  eyebrow: string;
  header: string;
  rows: SlateGameRow[];
  /** Games per column before wrapping to a new one — column count is
   * derived from this, not fixed, so a short Midweek slate stays one
   * column while a full Saturday card spreads into two or three. */
  targetRowsPerColumn?: number;
}) {
  const columns = chunkGamesForGrid(rows, targetRowsPerColumn);

  return (
    <div style={{ background: "#1f2041", padding: "22px 26px", width: "fit-content", fontFamily: "inherit" }}>
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
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.03em", color: "#fff", textTransform: "uppercase" }}>{header}</div>
      </div>

      {columns.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>No games in this slate.</div>
      ) : (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", justifyContent: "center" }}>
          {columns.map((col, ci) => (
            <table key={ci} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...HEAD_CELL, textAlign: "left" }}>ET</th>
                  <th style={{ ...HEAD_CELL, textAlign: "left" }}>Matchup</th>
                  <th style={HEAD_CELL}>Line</th>
                  <th style={HEAD_CELL}>Win</th>
                </tr>
              </thead>
              <tbody>
                {col.map((row, ri) => (
                  <GameRow key={row.gameId} row={row} zebra={ri % 2 === 1} />
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          paddingTop: 10,
          marginTop: 14,
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
