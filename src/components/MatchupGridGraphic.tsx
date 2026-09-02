import type { CSSProperties } from "react";
import TeamLogo from "./TeamLogo";
import { spreadColor } from "../lib/odds";
import type { SlateGameRow } from "../lib/matchupSlate";

// Card-grid alternative to MatchupSlateGraphic for the Weekly Image Dump.
// Rewritten from a wide multi-column table to a fixed 2-column grid of
// compact game cards — the table version scaled column COUNT with game
// count (5+ columns for a full Saturday), which read fine on desktop but
// was unusable on mobile and only showed My Line/Win%, no Vegas
// comparison, no totals, no bet signal, and no clear completed-game
// indication (the header still said "Line"/"Win" over a score row).
//
// Deliberately a separate component rather than a MatchupSlateGraphic
// rewrite — MatchupSlateGraphic is still used by the live Weekly
// Matchups page's own Export/Tweet buttons and shouldn't change shape
// out from under that.
//
// Visual language matches CompactPowerRatingsGraphic (same background,
// eyebrow/header, footer bar) so it doesn't look out of place next to the
// rest of this tool's images.

const SITE_URL = "ycpr.vercel.app";
const TWITTER_HANDLE = "@YCtheflea";
const CARD_WIDTH = 330;

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

function fmtTotal(v: number | null): string {
  return v == null ? "–" : v.toFixed(1);
}

function fmtPct(v: number | null): string {
  return v == null ? "–" : `${Math.round(v * 100)}%`;
}

// Always exactly 2 columns, however many games are in the set — column
// COUNT no longer scales with game count (that's what made the table
// version unusably wide); rows-per-column grows instead. Sorted by
// kickoff, filled top-to-bottom left column then right, matching how a
// reader would scan a printed slate.
function chunkIntoTwoColumns(rows: SlateGameRow[]): SlateGameRow[][] {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.kickoffIso ? new Date(a.kickoffIso).getTime() : Infinity;
    const tb = b.kickoffIso ? new Date(b.kickoffIso).getTime() : Infinity;
    return ta - tb;
  });
  if (sorted.length === 0) return [];
  const perCol = Math.ceil(sorted.length / 2);
  const columns = [sorted.slice(0, perCol), sorted.slice(perCol)];
  return columns.filter((c) => c.length > 0);
}

const LABEL: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "rgba(255,255,255,0.4)",
  textTransform: "uppercase",
};

function GameCard({ row }: { row: SlateGameRow }) {
  const actualWinner = row.actualWinner;
  const betTeam = row.spreadBetTeam;
  const betHit = row.completed && betTeam != null && row.actCoverTeam != null ? betTeam === row.actCoverTeam : null;

  return (
    <div
      style={{
        width: CARD_WIDTH,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "8px 10px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>{fmtTimeET(row.kickoffIso)} ET</span>
        {row.completed && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", color: "var(--gold, #d9a441)" }}>FINAL</span>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <TeamLogo team={row.awayTeam} size={16} />
          <span style={{ color: "#fff", fontWeight: actualWinner === "away" ? 800 : 400, fontSize: 12.5, whiteSpace: "nowrap" }}>{row.awayTeam}</span>
        </span>
        {row.completed ? (
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }}>
            {row.awayScore}-{row.homeScore}
          </span>
        ) : (
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>@</span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, flexDirection: "row-reverse" }}>
          <TeamLogo team={row.homeTeam} size={16} />
          <span style={{ color: "#fff", fontWeight: actualWinner === "home" ? 800 : 400, fontSize: 12.5, whiteSpace: "nowrap" }}>{row.homeTeam}</span>
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: betTeam != null || !row.completed ? 4 : 0 }}>
        <span>
          <span style={LABEL}>Vegas </span>
          <span style={{ color: "rgba(255,255,255,0.85)" }}>
            {fmtSpread(row.vegasAwaySpread)} · {fmtTotal(row.vegasTotal)}
          </span>
        </span>
        <span>
          <span style={LABEL}>Mine </span>
          <span style={{ color: row.myAwaySpread != null ? spreadColor(row.myAwaySpread) : "rgba(255,255,255,0.85)", fontWeight: 700 }}>
            {fmtSpread(row.myAwaySpread)} · {fmtTotal(row.myTotal)}
          </span>
        </span>
      </div>

      {(betTeam != null || !row.completed) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5 }}>
          {!row.completed ? (
            <span>
              <span style={LABEL}>Win </span>
              <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>{fmtPct(row.myAwayWinPct)}</span>
            </span>
          ) : (
            <span />
          )}
          {betTeam != null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={LABEL}>Bet </span>
              <TeamLogo team={betTeam === "away" ? row.awayTeam : row.homeTeam} size={13} />
              {betHit != null && <span style={{ fontSize: 11 }}>{betHit ? "✅" : "❌"}</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function MatchupGridGraphic({
  eyebrow,
  header,
  rows,
}: {
  eyebrow: string;
  header: string;
  rows: SlateGameRow[];
}) {
  const columns = chunkIntoTwoColumns(rows);

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
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "center" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {col.map((row) => (
                <GameCard key={row.gameId} row={row} />
              ))}
            </div>
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
