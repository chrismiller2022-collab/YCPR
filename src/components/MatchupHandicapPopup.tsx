import TeamLogo from "./TeamLogo";
import { useMatchupHandicap, type RecordSplit, type TeamHandicap } from "../lib/handicapping";

function fmtRecord(su: { w: number; l: number }): string {
  return `${su.w}-${su.l}`;
}

function fmtAts(ats: { w: number; l: number; p: number }): string {
  return ats.p > 0 ? `${ats.w}-${ats.l}-${ats.p}` : `${ats.w}-${ats.l}`;
}

function fmtMargin(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmtRating(v: number | null): string {
  return v == null ? "–" : v.toFixed(2);
}

// Lower rating = better team (site-wide convention) — a negative change
// (rating went down) is an improvement, shown green with a down arrow;
// a positive change (rating went up) is a decline, shown red with an
// up arrow.
function RatingChange({ v }: { v: number | null }) {
  if (v == null) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  if (Math.abs(v) < 0.005) return <span style={{ color: "var(--chalk-dim)" }}>flat</span>;
  const improved = v < 0;
  return (
    <span style={{ color: improved ? "#8fd39a" : "#c45c52" }}>
      {improved ? "▼" : "▲"} {Math.abs(v).toFixed(2)}
    </span>
  );
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function SplitRow({ label, split }: { label: string; split: RecordSplit | null }) {
  if (!split) return null;
  const decided = split.su.w + split.su.l;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "0.2rem 0" }}>
      <span style={{ color: "var(--chalk-dim)" }}>{label}</span>
      <span>
        {decided === 0 ? (
          "–"
        ) : (
          <>
            {fmtRecord(split.su)} SU · {fmtAts(split.ats)} ATS · {fmtMargin(split.avgAtsMargin)} avg
          </>
        )}
      </span>
    </div>
  );
}

const SPOT_META: Record<"lookahead" | "sandwich" | "letdown", { label: string; color: string }> = {
  lookahead: { label: "Lookahead", color: "#e0a951" },
  sandwich: { label: "Sandwich", color: "#c45c52" },
  letdown: { label: "Letdown", color: "#8babe4" },
};

function SpotBadges({ hc }: { hc: TeamHandicap }) {
  const active: ("lookahead" | "sandwich" | "letdown")[] = [];
  if (hc.spots.sandwich) active.push("sandwich");
  else if (hc.spots.lookahead) active.push("lookahead");
  if (hc.spots.letdown) active.push("letdown");

  if (active.length === 0) return <span style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>No situational spots</span>;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
      {active.map((key) => (
        <span
          key={key}
          title={
            key === "lookahead"
              ? `Tougher game likely coming vs ${hc.spots.nextOpponent} next week`
              : key === "sandwich"
                ? `Tougher games both last week (${hc.spots.prevOpponent}) and next week (${hc.spots.nextOpponent})`
                : hc.spots.letdownBadBeat
                  ? `Emotional letdown risk — bad-beat result last week vs ${hc.spots.prevOpponent}`
                  : `Tougher game last week vs ${hc.spots.prevOpponent}`
          }
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            padding: "0.15rem 0.5rem",
            borderRadius: 999,
            background: `${SPOT_META[key].color}33`,
            color: SPOT_META[key].color,
            border: `1px solid ${SPOT_META[key].color}66`,
          }}
        >
          {SPOT_META[key].label}
        </span>
      ))}
    </div>
  );
}

function TeamColumn({ hc, roleLabel, favLabel }: { hc: TeamHandicap; roleLabel: string; favLabel: string | null }) {
  const showNextGame = (hc.spots.lookahead || hc.spots.sandwich) && hc.nextGame;

  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
        <TeamLogo team={hc.team} size={22} />
        <span style={{ fontWeight: 700 }}>{hc.team}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "0.15rem 0" }}>
        <span style={{ color: "var(--chalk-dim)" }}>Power rating</span>
        <span>
          {fmtRating(hc.currentRating)} (<RatingChange v={hc.ratingChangeFromLastWeek} /> vs last wk)
        </span>
      </div>

      <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", margin: "0.3rem 0 0.5rem" }}>
        {hc.rest.byeLastWeek ? "Off a bye" : hc.rest.daysOfRest != null ? `${hc.rest.daysOfRest} days rest` : "Season opener"}
      </div>

      <div style={{ marginBottom: "0.6rem" }}>
        <SpotBadges hc={hc} />
      </div>

      {hc.lastGame && (
        <div style={{ fontSize: "0.78rem", padding: "0.15rem 0" }}>
          <span style={{ color: "var(--chalk-dim)" }}>Last week: </span>
          {hc.lastGame.isHome ? "vs" : "@"} {hc.lastGame.opponent} ({fmtSpread(hc.lastGame.vegasSpreadForTeam)}) —{" "}
          {hc.lastGame.teamPoints != null && hc.lastGame.oppPoints != null
            ? `${hc.lastGame.teamPoints}-${hc.lastGame.oppPoints}`
            : "not final"}
        </div>
      )}

      {showNextGame && hc.nextGame && (
        <div style={{ fontSize: "0.78rem", padding: "0.15rem 0" }}>
          <span style={{ color: "var(--chalk-dim)" }}>Next week: </span>
          {hc.nextGame.opponent} (my line {fmtSpread(hc.nextGame.myProjSpreadForTeam)})
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--hash)", paddingTop: "0.3rem", marginTop: "0.4rem" }}>
        <SplitRow label={roleLabel} split={hc.homeAway} />
        {hc.favoriteDog && favLabel && <SplitRow label={favLabel} split={hc.favoriteDog} />}
      </div>
    </div>
  );
}

export default function MatchupHandicapPopup({
  season,
  week,
  awayTeam,
  homeTeam,
  onClose,
}: {
  season: number;
  week: number;
  awayTeam: string;
  homeTeam: string;
  onClose: () => void;
}) {
  const hc = useMatchupHandicap(season, week, awayTeam, homeTeam);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 10,
          padding: "1.25rem",
          width: 560,
          maxWidth: "95vw",
          maxHeight: "90vh",
          overflowY: "auto",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: "0.75rem",
            right: "0.75rem",
            background: "none",
            border: "none",
            color: "var(--chalk-dim)",
            fontSize: "1.2rem",
            lineHeight: 1,
            cursor: "pointer",
            padding: "0.25rem",
          }}
        >
          ✕
        </button>

        <div style={{ fontWeight: 700, marginBottom: "0.15rem", paddingRight: "1.5rem" }}>
          {awayTeam} @ {homeTeam}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginBottom: "1rem" }}>
          {season} · Week {week}
        </div>

        {hc.loading ? (
          <p style={{ color: "var(--chalk-dim)" }}>Loading…</p>
        ) : hc.error ? (
          <p style={{ color: "crimson" }}>{hc.error}</p>
        ) : (
          <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
            <TeamColumn
              hc={hc.away}
              roleLabel="As road team"
              favLabel={hc.favoriteTeam == null ? null : hc.favoriteTeam === awayTeam ? "As favorite" : "As underdog"}
            />
            <TeamColumn
              hc={hc.home}
              roleLabel="As home team"
              favLabel={hc.favoriteTeam == null ? null : hc.favoriteTeam === homeTeam ? "As favorite" : "As underdog"}
            />
          </div>
        )}

        <p style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginTop: "1rem", marginBottom: 0 }}>
          Records are entering this week (games before Week {week} only). SU/ATS margins graded against the synced
          Vegas line; Lookahead/Sandwich/Letdown compare our own power ratings and projected spreads.
        </p>
      </div>
    </div>
  );
}
