import type { CSSProperties } from "react";
import TeamLogo from "./TeamLogo";
import { spreadColor } from "../lib/odds";
import { formatProjectedScore } from "../lib/gameTotals";
import type { SlateGameRow } from "../lib/matchupSlate";

// Card-grid alternative to MatchupSlateGraphic for the Weekly Image Dump.
// Layout follows Chris's own spec exactly (see chat): a two-column inner
// grid per card — spread info on the left, total info on the right —
// with Vegas above YCPR above the projected-cover/total call above an
// optional bet line, and a projected score spanning the bottom. Fixed 3
// columns of cards, however many games are in the set.
//
// Deliberately a separate component rather than a MatchupSlateGraphic
// rewrite — MatchupSlateGraphic is still used by the live Weekly
// Matchups page's own Export/Tweet buttons and shouldn't change shape
// out from under that.
//
// Visual language matches CompactPowerRatingsGraphic (same background,
// eyebrow/header, footer bar) so it doesn't look out of place next to the
// rest of this tool's images.
//
// NOTE: the "Bet: Over/Under (if meets criteria)" line from Chris's spec
// is not implemented — there's no existing "does this total qualify as
// a bet" signal anywhere on the site (unlike spreads, which have
// spreadBetTeam/WFB), and guessing at a threshold risks being wrong on
// something Chris has been precise about everywhere else. The spread
// bet line (spreadBetTeam, already computed) is implemented and follows
// the same "skip the row entirely if no bet" rule.

const SITE_URL = "ycpr.vercel.app";
const TWITTER_HANDLE = "@YCtheflea";
const CARD_WIDTH = 300;

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

// Always exactly 3 columns, however many games are in the set — column
// COUNT no longer scales with game count (that's what made the old
// table version unusably wide); rows-per-column grows instead. Sorted
// by kickoff, filled top-to-bottom left column first, then the next.
function chunkIntoThreeColumns(rows: SlateGameRow[]): SlateGameRow[][] {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.kickoffIso ? new Date(a.kickoffIso).getTime() : Infinity;
    const tb = b.kickoffIso ? new Date(b.kickoffIso).getTime() : Infinity;
    return ta - tb;
  });
  if (sorted.length === 0) return [];
  const perCol = Math.ceil(sorted.length / 3);
  const columns = [sorted.slice(0, perCol), sorted.slice(perCol, perCol * 2), sorted.slice(perCol * 2)];
  return columns.filter((c) => c.length > 0);
}

const ROW_LABEL: CSSProperties = {
  fontSize: 9.5,
  color: "rgba(255,255,255,0.5)",
};

const CHECK = "✅";
const CROSS = "❌";

function GameCard({ row }: { row: SlateGameRow }) {
  const actualWinner = row.actualWinner;
  const betTeam = row.spreadBetTeam;
  const showBetRow = betTeam != null;
  const coverHit = row.completed && row.projCoverTeam != null && row.actCoverTeam != null ? row.projCoverTeam === row.actCoverTeam : null;
  const betHit = row.completed && betTeam != null && row.actCoverTeam != null ? betTeam === row.actCoverTeam : null;
  const totalHit = row.completed && row.projTotalResult != null && row.totalResult != null ? row.projTotalResult === row.totalResult : null;
  const projScore = formatProjectedScore(row.myTotal, row.myAwaySpread != null ? -row.myAwaySpread : null, row.awayTeam, row.homeTeam);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>{fmtTimeET(row.kickoffIso)} ET</span>
        {row.completed && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", color: "var(--gold, #d9a441)" }}>FINAL</span>}
      </div>

      {/* Away @ Home, or Away [score] Home once final */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <TeamLogo team={row.awayTeam} size={16} />
          <span style={{ color: "#fff", fontWeight: actualWinner === "away" ? 800 : 400, fontSize: 12, whiteSpace: "nowrap" }}>{row.awayTeam}</span>
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
          <span style={{ color: "#fff", fontWeight: actualWinner === "home" ? 800 : 400, fontSize: 12, whiteSpace: "nowrap" }}>{row.homeTeam}</span>
        </span>
      </div>

      {/* Two-column inner grid: spread info left, total info right —
          Vegas / YCPR / Proj call / (optional) Bet, top to bottom. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 8, rowGap: 3, fontSize: 10.5 }}>
        <div>
          <span style={ROW_LABEL}>Vegas </span>
          <span style={{ color: "rgba(255,255,255,0.85)" }}>{fmtSpread(row.vegasAwaySpread)}</span>
        </div>
        <div>
          <span style={ROW_LABEL}>Vegas Total </span>
          <span style={{ color: "rgba(255,255,255,0.85)" }}>{fmtTotal(row.vegasTotal)}</span>
        </div>

        <div>
          <span style={ROW_LABEL}>YCPR </span>
          <span style={{ color: row.myAwaySpread != null ? spreadColor(row.myAwaySpread) : "rgba(255,255,255,0.85)", fontWeight: 700 }}>
            {fmtSpread(row.myAwaySpread)}
          </span>
        </div>
        <div>
          <span style={ROW_LABEL}>YCPR Total </span>
          <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>{fmtTotal(row.myTotal)}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={ROW_LABEL}>Proj Cover </span>
          {row.projCoverTeam ? <TeamLogo team={row.projCoverTeam === "away" ? row.awayTeam : row.homeTeam} size={13} /> : <span style={{ color: "rgba(255,255,255,0.5)" }}>–</span>}
          {coverHit != null && <span style={{ fontSize: 10 }}>{coverHit ? CHECK : CROSS}</span>}
        </div>
        <div>
          <span style={ROW_LABEL}>Proj </span>
          <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>{row.projTotalResult ?? "–"}</span>
          {totalHit != null && <span style={{ fontSize: 10, marginLeft: 3 }}>{totalHit ? CHECK : CROSS}</span>}
        </div>

        {showBetRow && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={ROW_LABEL}>Bet </span>
              <TeamLogo team={betTeam === "away" ? row.awayTeam : row.homeTeam} size={13} />
              <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>
                {fmtSpread(betTeam === "away" ? row.vegasAwaySpread : row.vegasAwaySpread != null ? -row.vegasAwaySpread : null)}
              </span>
              {betHit != null && <span style={{ fontSize: 10 }}>{betHit ? CHECK : CROSS}</span>}
            </div>
            <div />
          </>
        )}
      </div>

      {projScore && (
        <div style={{ marginTop: 5, fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
          <span style={ROW_LABEL}>Proj score </span>
          {projScore}
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
  const columns = chunkIntoThreeColumns(rows);

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
