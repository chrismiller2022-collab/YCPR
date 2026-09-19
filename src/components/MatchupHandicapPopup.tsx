import TeamLogo from "./TeamLogo";
import { useMatchupHandicap, type RecordSplit, type TeamHandicap, type SpreadCallCategoryInfo, type QuadrantInfo } from "../lib/handicapping";
import { CATEGORY_LABELS, winPctOf, type CategoryTally } from "../lib/spreadCategoryStats";

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

function fmtPct(rec: CategoryTally): string {
  const pct = winPctOf(rec);
  return pct == null ? "–" : `${(pct * 100).toFixed(0)}%`;
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

function fmtTotal(v: number | null): string {
  return v == null ? "–" : v.toFixed(1);
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

// One line per category this game's spread call qualifies for (Filtered/
// WFB/NWFB) — for whichever team the call is actually ON, shows that
// category's real win%; for the OTHER team, shows the complement
// (betting the other side of the exact same call is definitionally the
// inverse record, not a second stat to compute — see spreadCategoryStats.ts).
function CategoryCallRows({ team, categories }: { team: string; categories: SpreadCallCategoryInfo[] }) {
  if (categories.length === 0) return null;
  return (
    <div style={{ marginTop: "0.3rem" }}>
      {categories.map((c) => {
        const isOwner = c.team === team;
        const allTime = isOwner ? c.allTime : c.allTimeInverse;
        const thisSeason = isOwner ? c.thisSeason : c.thisSeasonInverse;
        return (
          <div
            key={c.category}
            title={`All-time ${fmtRecord(allTime)}, this season ${fmtRecord(thisSeason)}${isOwner ? "" : " — inverse of the other team's same call, not separately tracked"}`}
            style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "0.2rem 0" }}
          >
            <span style={{ color: "var(--chalk-dim)" }}>
              {CATEGORY_LABELS[c.category]}
              {!isOwner && " (opposite side)"}
            </span>
            <span>
              {fmtPct(allTime)} ({fmtRecord(allTime)})
            </span>
          </div>
        );
      })}
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

function TeamColumn({
  hc,
  roleLabel,
  favLabel,
  categories,
}: {
  hc: TeamHandicap;
  roleLabel: "Home" | "Road";
  favLabel: "Favorite" | "Underdog" | null;
  categories: SpreadCallCategoryInfo[];
}) {
  const comboLabel = favLabel ? `${roleLabel === "Home" ? "Home" : "Away"} ${favLabel}` : null;

  return (
    <div style={{ flex: 1, minWidth: 240 }}>
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

      {hc.nextGame ? (
        <div style={{ fontSize: "0.78rem", padding: "0.15rem 0" }}>
          <span style={{ color: "var(--chalk-dim)" }}>Next week: </span>
          {hc.nextGame.opponent} (my line {fmtSpread(hc.nextGame.myProjSpreadForTeam)})
        </div>
      ) : hc.rest.nextWeekIsBye ? (
        <div style={{ fontSize: "0.78rem", padding: "0.15rem 0", color: "var(--chalk-dim)" }}>Next week: Bye</div>
      ) : null}

      <div style={{ borderTop: "1px solid var(--hash)", paddingTop: "0.3rem", marginTop: "0.4rem" }}>
        <SplitRow label={roleLabel === "Home" ? "As home team" : "As road team"} split={hc.homeAway} />
        {hc.favoriteDog && favLabel && <SplitRow label={`As ${favLabel.toLowerCase()}`} split={hc.favoriteDog} />}
        {hc.homeAwayFavDog && comboLabel && <SplitRow label={comboLabel} split={hc.homeAwayFavDog} />}
        <CategoryCallRows team={hc.team} categories={categories} />
      </div>
    </div>
  );
}

// "Score format" per Chris — team logo + rounded score either side, same
// visual shape as ProjScoreCell elsewhere on the site.
function ScoreLine({
  awayTeam,
  homeTeam,
  awayScore,
  homeScore,
}: {
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
}) {
  if (awayScore == null || homeScore == null) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={awayTeam} size={14} />
      {Math.round(awayScore)} – {Math.round(homeScore)}
      <TeamLogo team={homeTeam} size={14} />
    </span>
  );
}

function BetFlag({ isBet }: { isBet: boolean }) {
  return (
    <span style={{ fontWeight: 700, color: isBet ? "var(--pos-green, #8fd39a)" : "var(--chalk-dim)" }}>{isBet ? "Bet" : "No bet"}</span>
  );
}

const QUADRANT_COPY: Record<QuadrantInfo["verdict"], { label: string; color: string }> = {
  good: { label: "Consistent signal", color: "var(--pos-green, #8fd39a)" },
  hesitate: { label: "Conflicting signal — hesitate", color: "#e0a951" },
};

function QuadrantNote({ quadrant }: { quadrant: QuadrantInfo | null }) {
  if (!quadrant) return null;
  const meta = QUADRANT_COPY[quadrant.verdict];
  return (
    <div
      style={{
        marginTop: "0.5rem",
        fontSize: "0.78rem",
        padding: "0.4rem 0.6rem",
        borderRadius: 6,
        background: `${meta.color}1a`,
        border: `1px solid ${meta.color}55`,
        color: meta.color,
      }}
    >
      {meta.label}: {quadrant.betTeam} ({quadrant.betRole}) + {quadrant.totalCall}
    </div>
  );
}

function TotalsSection({
  awayTeam,
  homeTeam,
  totals,
}: {
  awayTeam: string;
  homeTeam: string;
  totals: ReturnType<typeof useMatchupHandicap>["totals"];
}) {
  const anyBet = totals.isTotalBet || totals.isAwayTeamTotalBet || totals.isHomeTeamTotalBet;
  return (
    <div style={{ borderTop: "1px solid var(--hash)", marginTop: "1rem", paddingTop: "0.75rem" }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--chalk-dim)", marginBottom: "0.4rem" }}>
        Totals
      </div>
      <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ color: "var(--chalk-dim)", padding: "0.15rem 0" }}>Vegas total / My total</td>
            <td style={{ textAlign: "right" }}>
              {fmtTotal(totals.vegasTotal)} / <strong>{fmtTotal(totals.myTotal)}</strong>{" "}
              {totals.totalCall && <span style={{ color: "var(--chalk-dim)" }}>({totals.totalCall})</span>} <BetFlag isBet={totals.isTotalBet} />
            </td>
          </tr>
          <tr>
            <td style={{ color: "var(--chalk-dim)", padding: "0.15rem 0" }}>My team totals (score)</td>
            <td style={{ textAlign: "right" }}>
              <ScoreLine awayTeam={awayTeam} homeTeam={homeTeam} awayScore={totals.myAwayTeamTotal} homeScore={totals.myHomeTeamTotal} />
            </td>
          </tr>
          <tr>
            <td style={{ color: "var(--chalk-dim)", padding: "0.15rem 0" }}>Vegas team totals (score, derived)</td>
            <td style={{ textAlign: "right" }}>
              <ScoreLine awayTeam={awayTeam} homeTeam={homeTeam} awayScore={totals.vegasAwayTeamTotal} homeScore={totals.vegasHomeTeamTotal} />
            </td>
          </tr>
          <tr>
            <td style={{ color: "var(--chalk-dim)", padding: "0.15rem 0" }}>Team total bets</td>
            <td style={{ textAlign: "right" }}>
              {awayTeam} <BetFlag isBet={totals.isAwayTeamTotalBet} /> · {homeTeam} <BetFlag isBet={totals.isHomeTeamTotalBet} />
            </td>
          </tr>
        </tbody>
      </table>
      {!anyBet && <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "0.3rem", marginBottom: 0 }}>No totals bets on this game.</p>}
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
          width: 620,
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
          <>
            <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
              <TeamColumn
                hc={hc.away}
                roleLabel="Road"
                favLabel={hc.favoriteTeam == null ? null : hc.favoriteTeam === awayTeam ? "Favorite" : "Underdog"}
                categories={hc.spreadCallCategories}
              />
              <TeamColumn
                hc={hc.home}
                roleLabel="Home"
                favLabel={hc.favoriteTeam == null ? null : hc.favoriteTeam === homeTeam ? "Favorite" : "Underdog"}
                categories={hc.spreadCallCategories}
              />
            </div>
            <TotalsSection awayTeam={awayTeam} homeTeam={homeTeam} totals={hc.totals} />
            <QuadrantNote quadrant={hc.quadrant} />
          </>
        )}

        <p style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginTop: "1rem", marginBottom: 0 }}>
          Records are entering this week (games before Week {week} only). SU/ATS margins graded against the synced
          Vegas line; Lookahead/Sandwich/Letdown compare our own power ratings and projected spreads. Category win
          rates (Filtered/WFB/NWFB) are site-wide, not team-specific — the non-favored side of the same call is
          shown as that same record's inverse, not a separately tracked stat.
        </p>
      </div>
    </div>
  );
}
