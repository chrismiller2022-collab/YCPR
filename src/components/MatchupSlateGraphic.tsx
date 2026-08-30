import type { CSSProperties } from "react";
import TeamLogo from "./TeamLogo";
import { spreadColor } from "../lib/odds";
import type { SlateGameRow } from "../lib/matchupSlate";

// Mobile-first alternative to rasterizing the desktop Weekly Matchups
// table (which is a dozen-plus columns wide and unreadable without
// zooming once shrunk to a phone screen). Rendered off-screen at a fixed
// portrait width — same "not display:none, just parked off the visible
// page" pattern as CompactPowerRatingsGraphic — and pointed at by
// ExportPngButton/TweetButton on MatchupsPage instead of the live table.
//
// One row per game, stacked, each showing: kickoff (ET), the matchup with
// the projected straight-up winner bolded/gold, then a compact stat line
// (Line/Total/ML, Vegas vs. mine, plus my win%) — all away-team-
// perspective, same sign convention as the rest of the site. A game that's
// gone final adds the actual score and check/x grading for ML, ATS, and
// Total instead of (not alongside) the pregame projection line.

const GRAPHIC_WIDTH = 460;

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

function fmtML(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}

function fmtPct(v: number | null): string {
  return v == null ? "–" : `${Math.round(v * 100)}%`;
}

const CHIP: CSSProperties = {
  fontSize: 10.5,
  color: "rgba(255,255,255,0.8)",
  whiteSpace: "nowrap",
};
const CHIP_LABEL: CSSProperties = {
  color: "rgba(255,255,255,0.45)",
  fontWeight: 700,
  marginRight: 3,
};

function StatChip({ label, vegas, mine }: { label: string; vegas: string; mine: string }) {
  return (
    <span style={CHIP}>
      <span style={CHIP_LABEL}>{label}</span>
      {vegas} <span style={{ color: "rgba(255,255,255,0.35)" }}>/</span> <span style={{ fontWeight: 700 }}>{mine}</span>
    </span>
  );
}

function ResultMark({ hit }: { hit: boolean | null }) {
  if (hit == null) return <span style={{ color: "rgba(255,255,255,0.35)" }}>–</span>;
  return <span style={{ color: hit ? "#8fd39a" : "#c45c52", fontWeight: 700 }}>{hit ? "✓" : "✗"}</span>;
}

function GameRow({ row }: { row: SlateGameRow }) {
  const awayWinner = row.projWinner === "away";
  const homeWinner = row.projWinner === "home";
  const betTeamName = row.spreadBetTeam === "away" ? row.awayTeam : row.spreadBetTeam === "home" ? row.homeTeam : null;

  const mlHit = row.completed && row.actualWinner != null && row.projWinner != null ? row.actualWinner === row.projWinner : null;
  const atsHit =
    row.completed && row.actCoverTeam != null && row.projCoverTeam != null
      ? row.actCoverTeam === "push"
        ? null
        : row.actCoverTeam === row.projCoverTeam
      : null;
  const totalHit =
    row.completed && row.totalResult != null && row.projTotalResult != null
      ? row.totalResult === "Push"
        ? null
        : row.totalResult === row.projTotalResult
      : null;

  return (
    <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 46, flexShrink: 0, fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>
          {fmtTimeET(row.kickoffIso)}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 5, fontSize: 13, minWidth: 0 }}>
          <TeamLogo team={row.awayTeam} size={16} />
          <span style={{ fontWeight: awayWinner ? 800 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.awayTeam}
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>@</span>
          <TeamLogo team={row.homeTeam} size={16} />
          <span style={{ fontWeight: homeWinner ? 800 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.homeTeam}
          </span>
        </div>
        {row.completed && (
          <div style={{ fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {row.awayScore}-{row.homeScore}
          </div>
        )}
      </div>

      {!row.completed ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4, paddingLeft: 54 }}>
          <StatChip label="LN" vegas={fmtSpread(row.vegasAwaySpread)} mine={fmtSpread(row.myAwaySpread)} />
          <StatChip label="TOT" vegas={fmtTotal(row.vegasTotal)} mine={fmtTotal(row.myTotal)} />
          <StatChip label="ML" vegas={fmtML(row.vegasAwayMoneyline)} mine={fmtML(row.myAwayMoneyline)} />
          <span style={CHIP}>
            <span style={CHIP_LABEL}>WIN%</span>
            <span style={{ fontWeight: 700, color: spreadColor(row.myAwaySpread ?? 0) }}>{fmtPct(row.myAwayWinPct)}</span>
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4, paddingLeft: 54, fontSize: 10.5 }}>
          <span style={CHIP}>
            <span style={CHIP_LABEL}>ML</span>
            <ResultMark hit={mlHit} />
          </span>
          <span style={CHIP}>
            <span style={CHIP_LABEL}>ATS</span>
            <ResultMark hit={atsHit} />
          </span>
          <span style={CHIP}>
            <span style={CHIP_LABEL}>TOT</span>
            <ResultMark hit={totalHit} />
          </span>
        </div>
      )}

      {!row.completed && betTeamName && (
        <div style={{ marginTop: 3, paddingLeft: 54, fontSize: 10.5, fontWeight: 800, color: "var(--gold, #d9a441)" }}>
          BET: {betTeamName.toUpperCase()}
        </div>
      )}
    </div>
  );
}

export default function MatchupSlateGraphic({ rows, title, subtitle }: { rows: SlateGameRow[]; title: string; subtitle?: string }) {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.kickoffIso ? new Date(a.kickoffIso).getTime() : Infinity;
    const tb = b.kickoffIso ? new Date(b.kickoffIso).getTime() : Infinity;
    return ta - tb;
  });

  return (
    <div style={{ width: GRAPHIC_WIDTH, background: "#1f2041", color: "#fff", fontFamily: "inherit" }}>
      <div style={{ padding: "12px 12px 8px", borderBottom: "2px solid var(--gold, #d9a441)" }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.03em" }}>{title}</div>
        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
          {subtitle ?? "All times ET · Line/Total/ML shown Vegas / mine · bold = projected winner"}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>No games in this slate.</div>
      ) : (
        sorted.map((row) => <GameRow key={row.gameId} row={row} />)
      )}
    </div>
  );
}
