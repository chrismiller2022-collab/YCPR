import { T2_MOVE_CUT_TOP10 } from "../lib/totals2/frozen";
import { betsForGame, bucketStatsFor, obsFromStored, plainLabel, type BetObs, type BucketRow } from "../lib/totals2/buckets";
import { consensusLines, gradeItems, type GradeItem, type GradedBet, type PeriodLineRowLite } from "../lib/periodGrading";
import { buildPeriodDistribution, summarize } from "../lib/periodSim";
import { supabase } from "../lib/supabaseClient";
import type { Totals2ProjectionRow } from "../lib/api/totals2Projections";
import { fetchPlacedBets, type PlacedBetRow } from "../lib/api/placedBets";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { ALL_TIME_CATEGORY_STATS, computeSeasonCategoryStats, pctLabelOf } from "../lib/spreadCategoryStats";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import {
  useGameTotalsEngine,
  poolStdDevForTotal,
  buildTeamSplitBetRows,
  applyLockedTotals,
  applyLockedSpreadToRows,
  computeTeamPerformanceBreakdown,
  TOTAL_BET_THRESHOLD_STDDEV,
  type TeamSplitBetRow,
  type PerformanceSegment, teamSplitSpread } from "../lib/gameTotalsEngine";
import { filterRowsByDivision } from "./GameTotalsAdminPanel";
import { splitTeamTotal, gradeActualTotal, gradeBetCall, type BetGrade } from "../lib/gameTotals";
import { buildMlRowsFromLiveRatingsBillR, type MlGameRow } from "../lib/moneylineBetHistory";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import { unitsRiskedToWinOne } from "../lib/odds";
import ExportPngButton from "../components/ExportPngButton";
import ExportPdfButton from "../components/ExportPdfButton";
import MatchupHandicapPopup from "../components/MatchupHandicapPopup";

// ---------------------------------------------------------------------
// Weekly Betting Report — "what bets do I need to make and watch out
// for this week," in one page. Pure aggregation of signals already
// computed elsewhere on the site — every threshold here is read
// directly from existing code (DEFAULT_CUSTOM_PARAMS for spreads,
// computeRow's own filteredBetTeam/weightedFilteredBetTeam/nwfbTeam) or
// Chris's own explicitly-stated number (1.5 std dev for totals/team
// totals, 8% EV for moneyline — via Bill R).
// ---------------------------------------------------------------------

const FILTER_THRESHOLD = DEFAULT_CUSTOM_PARAMS.filterThreshold; // 6 points
const SIGMA_THRESHOLD = DEFAULT_CUSTOM_PARAMS.sigmaThreshold; // 0.4
const SIGMA_DIVISOR = DEFAULT_CUSTOM_PARAMS.sigmaDivisor; // 15.7
const NWFB_POINTS_THRESHOLD = SIGMA_THRESHOLD * SIGMA_DIVISOR; // ~6.28 points
const SPREAD_WATCH_MARGIN_POINTS = 2;
const SPREAD_WATCH_MARGIN_SIGMA = 0.1;
// TOTAL_BET_THRESHOLD_STDDEV itself now lives in gameTotalsEngine.ts —
// Totals History uses the same constant so "filtered bets" means the
// same thing in both places.
const TOTAL_WATCH_MARGIN_STDDEV = 0.5;
// The std-dev margin above alone let a wide-pool-std-dev game clear the
// bar while still needing an unrealistic double-digit point move to
// actually hit the bet threshold — Chris's "way too many totals/team
// totals" complaint. This caps it to a move that's actually plausible.
const TOTAL_WATCH_MAX_MOVEMENT_POINTS = 2.5;
const MONEYLINE_EV_THRESHOLD = 8; // percent — per Chris, only flag a moneyline bet once EV clears this bar
const MONEYLINE_WATCH_MARGIN = 4; // percent — "to watch" = EV within this much below the bar
// Totals v2 "to watch": games whose expected line move is just under the ★ cutoff (at least this share of it).
const V2_WATCH_SHARE = 0.75;
// Period bets (1H / 2H spread and total): at least this many points off the period line — the Period Projections page's
// own "Filtered" default.
const PERIOD_BET_MIN_OFF = 1.5;
const LEVEL_SHORT: Record<number, string> = { 0.1: "★ top 10%", 0.25: "top 25%", 0.5: "top 50%", 1: "every bet" };

// Bucket record for a Totals v2 bet (game or team): its own bucket at the amount-off level it reaches, the same bucket
// at every bet, and every bet of its kind at that level — each as 2023-26 backtest · this season (stored pre-kickoff
// numbers, so always current).
function ReportBucketCell({ o, seasonObs }: { o: BetObs; seasonObs: BetObs[] }) {
  const st = bucketStatsFor(o, seasonObs);
  const fmt = (r: BucketRow | null) => (r && r.w + r.l ? `${r.w}-${r.l} (${Math.round((100 * r.w) / (r.w + r.l))}%)` : "–");
  const line = (label: string, b: { backtest: BucketRow | null; season: BucketRow | null }, strong = false) => (
    <div style={{ color: strong ? undefined : "var(--chalk-dim)", whiteSpace: "nowrap" }}>
      {strong ? <strong>{label}</strong> : label}: {fmt(b.backtest)} 2023–26 · {fmt(b.season)} {CURRENT_SEASON}
    </div>
  );
  return (
    <div style={{ fontSize: "0.7rem", lineHeight: 1.45, textAlign: "left" }}>
      {line(`${plainLabel(o)}, ${LEVEL_SHORT[st.own.level]}`, st.own, true)}
      {st.own.level !== 1 && line(`${plainLabel(o)}, every bet`, st.ownAll)}
      {line(`all ${o.kind} totals, ${LEVEL_SHORT[st.main.level]}`, st.main)}
    </div>
  );
}
const CURRENT_SEASON = new Date().getFullYear();

type Division = "FBS" | "FCS" | "Cross";

function classOf(g: GameWithLines, side: "home" | "away"): "fbs" | "fcs" | "other" {
  const v = (side === "home" ? g.home_classification : g.away_classification)?.toLowerCase();
  return v === "fbs" ? "fbs" : v === "fcs" ? "fcs" : "other";
}

function isCompleted(g: GameWithLines): boolean {
  return g.completed === true || (g.away_points != null && g.home_points != null);
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  if (v === 0) return "PK";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmtTotal(v: number | null): string {
  return v == null ? "–" : v.toFixed(1);
}

function fmtMoneyline(v: number | null): string {
  if (v == null) return "–";
  return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}

// Real lines only exist at 0.5 increments — rounds to the nearest one
// that STILL clears the threshold (away from the model's own number),
// not just the nearest neighbor: needing +15.6 means +15.5 wouldn't
// actually clear it, so this rounds up to +16, not down to +15.5.
function roundToHalfCrossing(raw: number, myReference: number): number {
  const goingUp = raw >= myReference;
  return goingUp ? Math.ceil(raw * 2) / 2 : Math.floor(raw * 2) / 2;
}

// When both the Filtered and NWFB thresholds are within range, only one
// "watch for" line is shown — whichever requires the smaller move
// (closer to zero movement needed), since that's the more immediately
// actionable one to actually watch.
function closerToZero(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.abs(a) <= Math.abs(b) ? a : b;
}

const cellStyle: CSSProperties = { padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)" };
const centerCellStyle: CSSProperties = { ...cellStyle, textAlign: "center" };
const CHECK = "✓";
const CROSS = "✗";
const NEUTRAL_ICON_COLOR = "rgba(255,255,255,0.75)"; // deliberately not green/red — see chat, "just informational," a green check reads as "good" when it isn't necessarily

// Shared everywhere a projected score needs to show — logo, "score-score",
// logo, centered. Was previously a plain formatProjectedScore() text
// string on every table except Spread Bets; now the same treatment
// applies uniformly across Spread/Total/Team Total/Moneyline bets and
// all three Watch tables.
function ProjScoreCell({ awayTeam, homeTeam, awayScore, homeScore }: { awayTeam: string; homeTeam: string; awayScore: number | null; homeScore: number | null }) {
  if (awayScore == null || homeScore == null) return <span>–</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={awayTeam} size={14} />
      {Math.round(awayScore)} – {Math.round(homeScore)}
      <TeamLogo team={homeTeam} size={14} />
    </span>
  );
}

function projScoreSplit(myTotal: number | null, myAwaySpread: number | null): { awayScore: number | null; homeScore: number | null } {
  const split = splitTeamTotal(myTotal, myAwaySpread != null ? -myAwaySpread : null);
  return { awayScore: split.away, homeScore: split.home };
}

// Historical category win rates (Filtered / WFB / NWFB), all-time and
// current season — the actual computation lives in spreadCategoryStats.ts
// now, shared with MatchupHandicapPopup's own bucket section, so the two
// can never quietly disagree with each other.
const pctOf = pctLabelOf;

function useLiveSeasonCategoryStats(season: number) {
  const [games, setGames] = useState<GameWithLines[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season)
      .then((rows) => {
        if (!cancelled) setGames(rows);
      })
      .catch(() => {
        if (!cancelled) setGames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const fbsGames = useMemo(() => games.filter((g) => classOf(g, "home") === "fbs" && classOf(g, "away") === "fbs"), [games]);
  const weekNumbers = useMemo(() => Array.from(new Set(fbsGames.map((g) => g.week))), [fbsGames]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbers, season);
  const { locks } = useGameProjectionLocks(season, weekNumbers);

  return useMemo(() => {
    const rows = fbsGames
      .map((g) => {
        const lock = locks[g.id];
        return computeRow(
          g,
          ratingsByWeek[g.week] ?? {},
          "team",
          DEFAULT_CUSTOM_PARAMS,
          lock ? { myAwaySpread: lock.my_away_spread, myAwayWinPct: lock.my_away_win_pct } : null
        );
      })
      .filter((c) => c.vegasAwaySpread != null);
    return computeSeasonCategoryStats(rows);
  }, [fbsGames, ratingsByWeek, locks]);
}

function categoryHeaderLabel(label: string, stats: { allTime: { w: number; l: number }; thisSeason: { w: number; l: number } }): string {
  return `${label} (All-time ${pctOf(stats.allTime)}, ${CURRENT_SEASON} ${pctOf(stats.thisSeason)})`;
}

interface SpreadBetRow {
  game: GameWithLines;
  vegasAwaySpread: number;
  openingAwaySpread: number | null;
  myAwaySpread: number;
  awayScore: number | null;
  homeScore: number | null;
  betTeam: "away" | "home";
  betSizePct: number | null;
  isFiltered: boolean;
  isWfb: boolean;
  isNwfb: boolean;
  amountOff: number;
  kickoffIso: string | null;
}

interface SpreadWatchRow {
  game: GameWithLines;
  vegasAwaySpread: number;
  myAwaySpread: number;
  awayScore: number | null;
  homeScore: number | null;
  nearLabel: string;
  vegasLineNeeded: number;
}

interface TotalBetRow {
  game: GameWithLines;
  vegasTotal: number;
  myTotal: number;
  awayScore: number | null;
  homeScore: number | null;
  stdDevOff: number;
  call: "Over" | "Under";
  // Totals v2: the bet is a ★ line-move bet — take the OPENING total in the direction the line should move. v2Move is
  // that expected move (points); vegasTotal is then the opening total. Null for a game with no stored v2 number (the
  // archived v1 std-dev rule applies).
  v2Move?: number | null;
  v2Row?: Totals2ProjectionRow | null;
}

// Sort weight: v2 ★ edges (points of expected line move) and v1 std devs on one scale — a ★ at the cutoff ≈ the 1.5 SD bar.
const totalBetStrength = (r: { v2Move?: number | null; stdDevOff: number }) =>
  r.v2Move != null ? (Math.abs(r.v2Move) / T2_MOVE_CUT_TOP10) * TOTAL_BET_THRESHOLD_STDDEV : Math.abs(r.stdDevOff);

interface TotalWatchRow {
  game: GameWithLines;
  vegasTotal: number;
  myTotal: number;
  awayScore: number | null;
  homeScore: number | null;
  stdDevOff: number;
  vegasTotalNeeded: number;
}

interface MoneylineBetRow {
  row: MlGameRow;
  awayScore: number | null;
  homeScore: number | null;
}

// A cell showing "team logo + team name + spread" — used for the
// Spread Bets "Bet" column.
function TeamSpreadCell({ team, spread }: { team: string; spread: number | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={team} size={16} /> {team} <span style={{ fontWeight: 700 }}>{fmtSpread(spread)}</span>
    </span>
  );
}

// "Logo Michigan Under 38.5" — for Team Totals' Bet column.
function TeamTotalCell({ team, call, total }: { team: string; call: string | null; total: number | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={team} size={16} /> {team} <span style={{ fontWeight: 700 }}>{call} {fmtTotal(total)}</span>
    </span>
  );
}

// Season-to-date record for this bet's Home/Away x Favorite/Underdog x
// Over/Under bucket (e.g. "Away Underdog Under") — filtered-bets pool
// only, since that's the population this week's bet actually belongs to.
// Colored green/red only once there's enough of a sample to mean
// anything (n >= 8) — a 1-for-1 bucket isn't a real signal either way.
function TeamTotalSegmentBadge({ segment }: { segment: PerformanceSegment | undefined }) {
  if (!segment) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  if (segment.fb.n === 0) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3 }}>
        <span style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>{segment.label}</span>
        <span style={{ color: "var(--chalk-dim)" }}>–</span>
      </span>
    );
  }
  const { wins, losses, n, winPct } = segment.fb;
  const color = n < 8 ? "var(--chalk-dim)" : winPct != null && winPct >= 0.55 ? "var(--pos-green)" : winPct != null && winPct <= 0.45 ? "var(--neg-red)" : undefined;
  return (
    <span
      title={`${segment.label} — filtered bets ${wins}-${losses}${n < 8 ? " (small sample)" : ""}`}
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3 }}
    >
      <span style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>{segment.label}</span>
      <span style={{ color, fontWeight: n >= 8 ? 700 : undefined }}>
        {winPct != null ? `${(winPct * 100).toFixed(0)}%` : "–"} ({wins}-{losses})
      </span>
    </span>
  );
}

function OpponentCell({ team }: { team: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={team} size={16} /> {team}
    </span>
  );
}

function MoneylineBetCell({ team, ml }: { team: string; ml: number | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={team} size={16} /> {team} <span style={{ fontWeight: 700 }}>{fmtMoneyline(ml)}</span>
    </span>
  );
}

// Line-movement column: the numeric change from opening to current,
// plus a neutral (not green/red) check/cross — "just informational,"
// not a signal that the move is objectively good or bad.
function MovementCell({ betTeam, openingLine, currentLine }: { betTeam: "away" | "home"; openingLine: number | null; currentLine: number }) {
  if (openingLine == null) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  const diff = currentLine - openingLine;
  if (diff === 0) return <span style={{ color: "var(--chalk-dim)" }}>{fmtSpread(0).replace("PK", "0.0")}</span>;
  // awaySpread rising means MORE points to away / a bigger margin for home
  // to cover — good closing-line value for an away bet (diff < 0 is what's
  // actually favorable there), bad for a home bet (favorable needs diff >
  // 0). This was inverted before — direction must be -1 for away, +1 for
  // home, not the other way around.
  const direction = betTeam === "away" ? -1 : 1;
  const favorable = direction * diff > 0;
  return (
    <span>
      {diff > 0 ? "+" : ""}
      {diff.toFixed(1)}{" "}
      <span style={{ color: NEUTRAL_ICON_COLOR }} title={favorable ? "Moved with me (smaller edge)" : "Moved against me (bigger edge)"}>
        {favorable ? CHECK : CROSS}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------
// Performance view — "how'd every bet that would have qualified this
// week actually do." Spread/Totals/Team Totals are always assumed at
// standard -110 (this app doesn't track a specific price per spread/
// total bet); Moneyline already carries its own real price via
// buildMlRowsFromLiveRatingsBillR's toWin1 field, so that's reused
// as-is rather than re-derived. Every category uses the same "bet X to
// win 1 unit" convention Chris specified — a win is always +1 unit, a
// loss costs whatever it took to risk winning that 1 unit.
// ---------------------------------------------------------------------

// The tiles above only ever showed the aggregate record — Chris's ask:
// "It just shows performance on bets but I want to see each bet." One
// small table per category, reusing the same bet-description cells
// (TeamSpreadCell/TeamTotalCell/MoneylineBetCell) the regular report's
// own tables already use, so a bet reads identically in both places.
// margin is "how many points/units the bet won or lost by," signed from
// the bet's own perspective (positive = covered/won by that much,
// negative = missed by that much) — not a statistical margin of error,
// which isn't a meaningful per-bet quantity.
function PerfGamesTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; cell: ReactNode; projection: ReactNode; actual: ReactNode; margin: number | null; result: BetGrade }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>
        {title} ({rows.length})
      </div>
      <table style={{ borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr>
            <th className="th">Bet</th>
            <th className="th">Projection</th>
            <th className="th">Actual Result</th>
            <th className="th th-right">Margin</th>
            <th className="th th-right">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.cell}</td>
              <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.projection}</td>
              <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.actual}</td>
              <td
                style={{
                  padding: "0.3rem 0.6rem",
                  borderBottom: "1px solid var(--hash)",
                  textAlign: "right",
                  color: r.margin == null ? "var(--chalk-dim)" : r.margin > 0 ? "var(--pos-green)" : r.margin < 0 ? "var(--neg-red)" : undefined,
                }}
              >
                {r.margin == null ? "–" : `${r.margin > 0 ? "+" : ""}${r.margin.toFixed(1)}`}
              </td>
              <td
                style={{
                  padding: "0.3rem 0.6rem",
                  borderBottom: "1px solid var(--hash)",
                  textAlign: "right",
                  fontWeight: 700,
                  color: r.result === "win" ? "var(--pos-green)" : r.result === "loss" ? "var(--neg-red)" : undefined,
                }}
              >
                {r.result ?? "pending"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const STANDARD_VIG_UNITS = unitsRiskedToWinOne(-110) ?? 1.1;

function gradeSpreadBetRow(r: SpreadBetRow): BetGrade {
  if (!r.game.completed || r.game.away_points == null || r.game.home_points == null) return null;
  const actualAwayMargin = r.game.away_points - r.game.home_points;
  const coverMargin = actualAwayMargin + r.vegasAwaySpread;
  if (coverMargin === 0) return "push";
  const actCoverTeam: "away" | "home" = coverMargin > 0 ? "away" : "home";
  return r.betTeam === actCoverTeam ? "win" : "loss";
}

function gradeTotalBetRow(r: TotalBetRow): BetGrade {
  if (!r.game.completed || r.game.away_points == null || r.game.home_points == null) return null;
  const actualTotal = r.game.away_points + r.game.home_points;
  return gradeBetCall(r.call, gradeActualTotal(actualTotal, r.vegasTotal));
}

interface PerfBucket {
  label: string;
  w: number;
  l: number;
  p: number;
  pending: number;
  units: number;
}

function summarizeStandardVig(grades: BetGrade[]): PerfBucket {
  let w = 0,
    l = 0,
    p = 0,
    pending = 0,
    units = 0;
  for (const g of grades) {
    if (g === "win") {
      w++;
      units += 1;
    } else if (g === "loss") {
      l++;
      units -= STANDARD_VIG_UNITS;
    } else if (g === "push") {
      p++;
    } else {
      pending++;
    }
  }
  return { label: "", w, l, p, pending, units };
}

function PerfRow({ bucket, bold }: { bucket: PerfBucket; bold?: boolean }) {
  const decided = bucket.w + bucket.l;
  const winPct = decided > 0 ? (bucket.w / decided) * 100 : null;
  const cellStyle: CSSProperties = { padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)", fontWeight: bold ? 800 : undefined };
  return (
    <tr>
      <td style={cellStyle}>{bucket.label}</td>
      <td style={{ ...cellStyle, textAlign: "right" }}>
        {bucket.w}-{bucket.l}
        {bucket.p > 0 ? `-${bucket.p}` : ""}
        {bucket.pending > 0 ? ` (${bucket.pending} pending)` : ""}
      </td>
      <td style={{ ...cellStyle, textAlign: "right" }}>{winPct != null ? `${winPct.toFixed(1)}%` : "–"}</td>
      <td
        style={{
          ...cellStyle,
          textAlign: "right",
          color: bucket.units > 0 ? "var(--c-ok)" : bucket.units < 0 ? "var(--c-err)" : undefined,
        }}
      >
        {bucket.units > 0 ? "+" : ""}
        {bucket.units.toFixed(2)}u
      </td>
    </tr>
  );
}

function PerformanceSummarySection({
  week,
  spreadBets,
  totalBets,
  teamTotalBets,
  moneylineBets,
  showTotals,
}: {
  week: number;
  spreadBets: SpreadBetRow[];
  totalBets: TotalBetRow[];
  teamTotalBets: TeamSplitBetRow[];
  moneylineBets: MoneylineBetRow[];
  showTotals: boolean;
}) {
  const spreadBucket = useMemo(() => {
    const b = summarizeStandardVig(spreadBets.map(gradeSpreadBetRow));
    return { ...b, label: "Spread" };
  }, [spreadBets]);
  const totalBucket = useMemo(() => {
    const b = summarizeStandardVig(totalBets.map(gradeTotalBetRow));
    return { ...b, label: "Totals" };
  }, [totalBets]);
  const teamTotalBucket = useMemo(() => {
    const b = summarizeStandardVig(teamTotalBets.map((r) => r.grade));
    return { ...b, label: "Team Totals" };
  }, [teamTotalBets]);
  const moneylineBucket = useMemo(() => {
    let w = 0,
      l = 0,
      pending = 0,
      units = 0;
    for (const { row: r } of moneylineBets) {
      if (r.result === "win") {
        w++;
        units += r.toWin1?.profit ?? 1;
      } else if (r.result === "loss") {
        l++;
        units += r.toWin1?.profit ?? 0;
      } else {
        pending++;
      }
    }
    return { label: "Moneyline", w, l, p: 0, pending, units };
  }, [moneylineBets]);

  const buckets = showTotals ? [spreadBucket, totalBucket, teamTotalBucket, moneylineBucket] : [spreadBucket, moneylineBucket];
  const combined = useMemo(() => {
    let w = 0,
      l = 0,
      p = 0,
      pending = 0,
      units = 0;
    for (const b of buckets) {
      w += b.w;
      l += b.l;
      p += b.p;
      pending += b.pending;
      units += b.units;
    }
    return { label: "All Bets", w, l, p, pending, units };
  }, [buckets]);

  return (
    <div>
      <div className="section-label" style={{ marginBottom: "0.5rem" }}>
        Week {week} Performance
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        Every bet that would have qualified this week, graded against final scores. Spread/Totals/Team Totals assumed
        at standard -110; Moneyline uses its own actual price. All bets sized "bet X to win 1 unit."
      </p>
      <div className="table-scroll">
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)" }}>Category</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)" }}>Win %</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.7rem", borderBottom: "1px solid var(--hash)" }}>Units</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <PerfRow key={b.label} bucket={b} />
            ))}
            <PerfRow bucket={combined} bold />
          </tbody>
        </table>
      </div>

      <PerfGamesTable
        title="Spread"
        rows={spreadBets.map((r) => {
          // Cover margin from the BET's own perspective — positive means
          // it covered by that many points, negative means it missed by
          // that many. actualAwayMargin/coverMargin mirror gradeSpreadBetRow
          // exactly, just kept (not collapsed to win/loss) here.
          const actualAwayMargin = r.game.away_points != null && r.game.home_points != null ? r.game.away_points - r.game.home_points : null;
          const coverMargin = actualAwayMargin != null ? actualAwayMargin + r.vegasAwaySpread : null;
          const margin = coverMargin == null ? null : r.betTeam === "away" ? coverMargin : -coverMargin;
          return {
            key: r.game.id,
            cell: (
              <TeamSpreadCell team={r.betTeam === "away" ? r.game.away_team : r.game.home_team} spread={r.betTeam === "away" ? r.vegasAwaySpread : -r.vegasAwaySpread} />
            ),
            projection: <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />,
            actual: <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.game.away_points} homeScore={r.game.home_points} />,
            margin,
            result: gradeSpreadBetRow(r),
          };
        })}
      />
      {showTotals && (
        <>
          <PerfGamesTable
            title="Totals"
            rows={totalBets.map((r) => {
              const actualTotal = r.game.away_points != null && r.game.home_points != null ? r.game.away_points + r.game.home_points : null;
              const margin = actualTotal == null ? null : r.call === "Over" ? actualTotal - r.vegasTotal : r.vegasTotal - actualTotal;
              return {
                key: r.game.id,
                cell: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                    <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}{" "}
                    <span style={{ fontWeight: 700 }}>{r.call} {fmtTotal(r.vegasTotal)}</span>
                  </span>
                ),
                projection: fmtTotal(r.myTotal),
                actual: actualTotal == null ? "–" : fmtTotal(actualTotal),
                margin,
                result: gradeTotalBetRow(r),
              };
            })}
          />
          <PerfGamesTable
            title="Team Totals"
            rows={teamTotalBets.map((r) => {
              const gradingLine = r.actualVegasTeamTotal ?? r.vegasTeamTotal;
              const margin =
                r.actualTeamPoints == null || gradingLine == null || r.call == null
                  ? null
                  : r.call === "Over"
                  ? r.actualTeamPoints - gradingLine
                  : gradingLine - r.actualTeamPoints;
              return {
                key: `${r.row.game.id}-${r.team}`,
                cell: <TeamTotalCell team={r.team} call={r.call} total={r.vegasTeamTotal} />,
                projection: fmtTotal(r.myTeamTotal),
                actual: r.actualTeamPoints == null ? "–" : fmtTotal(r.actualTeamPoints),
                margin,
                result: r.grade,
              };
            })}
          />
        </>
      )}
      <PerfGamesTable
        title="Moneyline"
        rows={moneylineBets.map(({ row: r, awayScore, homeScore }) => {
          const betSideActualMargin =
            r.game.away_points == null || r.game.home_points == null
              ? null
              : r.betSide === "away"
              ? r.game.away_points - r.game.home_points
              : r.game.home_points - r.game.away_points;
          return {
            key: r.game.id,
            cell: (
              <MoneylineBetCell
                team={r.betSide === "away" ? r.game.away_team : r.game.home_team}
                ml={r.betSide === "away" ? r.vegasAwayMoneyline : r.vegasHomeMoneyline}
              />
            ),
            projection: <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={awayScore} homeScore={homeScore} />,
            actual: <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.game.away_points} homeScore={r.game.home_points} />,
            margin: betSideActualMargin,
            result: r.result,
          };
        })}
      />
    </div>
  );
}

export default function WeeklyBettingReportPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const exportRef = useRef<HTMLDivElement>(null);
  const [division, setDivision] = useState<Division>("FBS");
  const [reportMode, setReportMode] = useState<"regular" | "performance">("regular");
  // Defaults to showing everything, kickoff or no — this is the record of
  // what was bet-worthy THIS week, not a "still biddable right now" live
  // odds board. Checking it Saturday at 4pm shouldn't make the noon games
  // disappear just because they've started. The checkbox stays for
  // anyone who does want the live-only view.
  const [hideCompleted, setHideCompleted] = useState(false);
  // Greys out and strikes through report bets that are already in Placed Bets (matched on game, bet type and side).
  const [strikeMade, setStrikeMade] = useState(true);
  const [placed, setPlaced] = useState<PlacedBetRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchPlacedBets(season)
      .then((rows) => !cancelled && setPlaced(rows.filter((b) => b.week === week || b.week == null)))
      .catch(() => !cancelled && setPlaced([]));
    return () => {
      cancelled = true;
    };
  }, [season, week]);
  const isMade = (g: { id: string; away_team?: string; home_team?: string; awayTeam?: string; homeTeam?: string }, type: PlacedBetRow["bet_type"], side: string | null): boolean => {
    if (!strikeMade) return false;
    const want = side?.toLowerCase() ?? null;
    return placed.some(
      (b) =>
        b.bet_type === type &&
        (b.game_id === g.id || (b.away_team === (g.away_team ?? g.awayTeam) && b.home_team === (g.home_team ?? g.homeTeam))) &&
        (want == null || b.side.toLowerCase() === want)
    );
  };
  const madeStyle = { opacity: 0.45, textDecoration: "line-through" } as const;
  const [handicapGame, setHandicapGame] = useState<{ awayTeam: string; homeTeam: string } | null>(null);
  // Performance mode is "how'd every bet that would have qualified this
  // week actually do" — it needs completed games only, the opposite of
  // the regular view's "hide completed" toggle, so it overrides that
  // toggle entirely rather than fighting it.
  const effectiveHideCompleted = reportMode === "performance" ? false : hideCompleted;
  const liveSeasonStats = useLiveSeasonCategoryStats(CURRENT_SEASON);
  const categoryStats = useMemo(
    () => ({
      filtered: { allTime: ALL_TIME_CATEGORY_STATS.filtered, thisSeason: liveSeasonStats.filtered },
      wfb: { allTime: ALL_TIME_CATEGORY_STATS.wfb, thisSeason: liveSeasonStats.wfb },
      nwfb: { allTime: ALL_TIME_CATEGORY_STATS.nwfb, thisSeason: liveSeasonStats.nwfb },
    }),
    [liveSeasonStats]
  );
  const [spreadSort, setSpreadSort] = useState<"betSize" | "kickoff" | "amountOff" | "wfbAbs">("betSize");
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGamesWithLines(season, week)
      .then((rows) => {
        if (!cancelled) setGames(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, [week], season);
  const ratings = ratingsByWeek[week] ?? {};
  const { locks } = useGameProjectionLocks(season, [week]);

  // Once a week is frozen (see LockGamesPanel), its spread/win%/total win
  // unconditionally over anything ratings say right now — same guarantee
  // Admin/Public Matchups already have, extended to this page since it's
  // the one Chris actually places bets from.
  const lockedAwaySpreadByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of games) {
      const v = locks[g.id]?.my_away_spread;
      if (v != null) map.set(`${g.week}|${g.home_team}|${g.away_team}`, v);
    }
    return map;
  }, [games, locks]);
  const lockedTotalByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of games) {
      const v = locks[g.id]?.my_total;
      if (v != null) map.set(`${g.week}|${g.home_team}|${g.away_team}`, v);
    }
    return map;
  }, [games, locks]);
  const lockedWinPctByGameId = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const g of games) map[g.id] = locks[g.id]?.my_away_win_pct ?? null;
    return map;
  }, [games, locks]);

  const { rows: totalsEngineRowsRaw } = useGameTotalsEngine(season);
  const totalsEngineRows = useMemo(
    () => applyLockedSpreadToRows(applyLockedTotals(totalsEngineRowsRaw, lockedTotalByKey), lockedAwaySpreadByKey),
    [totalsEngineRowsRaw, lockedTotalByKey, lockedAwaySpreadByKey]
  );
  const projTotalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsEngineRows]);
  const fbsTotalPoolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(totalsEngineRows, "FBS")), [totalsEngineRows]);

  // Three real tabs — All FBS (FBS-vs-FBS only), All FCS (FCS-vs-FCS
  // only), Cross (FBS-vs-FCS only) — not a two-way toggle that folds
  // Cross into FBS. Totals/Team Totals only ever exist for FBS — no
  // totals model is run for FCS at all — so those sections (and their
  // Watch tables) are hidden entirely outside the FBS/Cross tabs, not
  // just filtered down to empty.
  const divisionFilteredGames = useMemo(() => {
    return games.filter((g) => {
      if (reportMode === "performance" && !isCompleted(g)) return false;
      if (effectiveHideCompleted && isCompleted(g)) return false;
      const homeC = classOf(g, "home");
      const awayC = classOf(g, "away");
      if (division === "FBS") return homeC === "fbs" && awayC === "fbs";
      if (division === "FCS") return homeC === "fcs" && awayC === "fcs";
      return (homeC === "fbs" && awayC === "fcs") || (homeC === "fcs" && awayC === "fbs");
    });
  }, [games, division, effectiveHideCompleted, reportMode]);

  const showTotals = division === "FBS" || division === "Cross";

  // --- Spreads ---
  const computedGames = useMemo(
    () =>
      divisionFilteredGames
        .map((g) => {
          const lock = locks[g.id];
          return {
            game: g,
            computed: computeRow(g, ratings, "team", DEFAULT_CUSTOM_PARAMS, lock ? { myAwaySpread: lock.my_away_spread, myAwayWinPct: lock.my_away_win_pct } : null),
          };
        })
        .filter((r) => r.computed.vegasAwaySpread != null),
    [divisionFilteredGames, ratings, locks]
  );

  const spreadBetsUnsorted: SpreadBetRow[] = useMemo(
    () =>
      computedGames
        .filter((r) => r.computed.betTeam != null)
        .map((r) => {
          const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
          const split = projScoreSplit(myTotal, r.computed.projAwaySpread);
          return {
            game: r.game,
            vegasAwaySpread: r.computed.vegasAwaySpread!,
            openingAwaySpread: r.computed.line?.opening_spread != null ? -r.computed.line.opening_spread : null,
            myAwaySpread: r.computed.projAwaySpread!,
            awayScore: split.awayScore,
            homeScore: split.homeScore,
            betTeam: r.computed.betTeam!,
            betSizePct: r.computed.betSizePct,
            isFiltered: r.computed.filteredBetTeam != null,
            isWfb: r.computed.weightedFilteredBetTeam != null,
            isNwfb: r.computed.nwfbTeam != null,
            amountOff: r.computed.amountOff ?? 0,
            kickoffIso: r.game.start_date,
          };
        }),
    [computedGames, projTotalByGame, week]
  );

  const spreadBets = useMemo(() => {
    const sorted = [...spreadBetsUnsorted];
    if (spreadSort === "betSize") sorted.sort((a, b) => (b.betSizePct ?? 0) - (a.betSizePct ?? 0));
    else if (spreadSort === "amountOff") sorted.sort((a, b) => b.amountOff - a.amountOff);
    else if (spreadSort === "wfbAbs") sorted.sort((a, b) => Math.abs(b.amountOff) - Math.abs(a.amountOff));
    else sorted.sort((a, b) => (a.kickoffIso ? new Date(a.kickoffIso).getTime() : Infinity) - (b.kickoffIso ? new Date(b.kickoffIso).getTime() : Infinity));
    return sorted;
  }, [spreadBetsUnsorted, spreadSort]);

  const spreadWatch: SpreadWatchRow[] = useMemo(
    () =>
      computedGames
        .filter((r) => r.computed.betTeam == null && r.computed.absAmountOff != null)
        .map((r) => {
          const absOff = r.computed.absAmountOff!;
          const sigmaOff = r.computed.sigmaOff;
          const nearFiltered = absOff >= FILTER_THRESHOLD - SPREAD_WATCH_MARGIN_POINTS && absOff < FILTER_THRESHOLD;
          const nearNwfb = sigmaOff != null && sigmaOff >= SIGMA_THRESHOLD - SPREAD_WATCH_MARGIN_SIGMA && sigmaOff < SIGMA_THRESHOLD;
          if (!nearFiltered && !nearNwfb) return null;
          const myLine = r.computed.projAwaySpread!;
          const vegasLine = r.computed.vegasAwaySpread!;
          const dir = Math.sign(myLine - vegasLine) || 1;
          const rawFiltered = nearFiltered ? myLine - dir * FILTER_THRESHOLD : null;
          const rawNwfb = nearNwfb ? myLine - dir * NWFB_POINTS_THRESHOLD : null;
          const roundedFiltered = rawFiltered != null ? roundToHalfCrossing(rawFiltered, myLine) : null;
          const roundedNwfb = rawNwfb != null ? roundToHalfCrossing(rawNwfb, myLine) : null;
          // Only one watch-for line, per Chris — whichever needs the smaller move.
          const chosen = closerToZero(roundedFiltered, roundedNwfb);
          const nearLabel = chosen === roundedFiltered && chosen === roundedNwfb ? "Filtered / NWFB" : chosen === roundedFiltered ? "Filtered" : "NWFB";
          const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
          const split = projScoreSplit(myTotal, myLine);
          return {
            game: r.game,
            vegasAwaySpread: vegasLine,
            myAwaySpread: myLine,
            awayScore: split.awayScore,
            homeScore: split.homeScore,
            nearLabel,
            vegasLineNeeded: chosen!,
          };
        })
        .filter((r): r is SpreadWatchRow => r != null),
    [computedGames, projTotalByGame, week]
  );

  // --- Totals ---
  const totalGames = useMemo(() => {
    if (!showTotals) return [];
    return divisionFilteredGames
      .map((g) => {
        const vegasTotal = totalsEngineRows.find((r) => r.game.week === week && r.game.homeTeam === g.home_team && r.game.awayTeam === g.away_team)?.odds
          .vegasTotal;
        const engineRow = totalsEngineRows.find((r) => r.game.week === week && r.game.homeTeam === g.home_team && r.game.awayTeam === g.away_team);
        const myTotal = projTotalByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
        const stdDevOff = myTotal != null && vegasTotal != null && fbsTotalPoolStd !== 0 ? (myTotal - vegasTotal) / fbsTotalPoolStd : null;
        return { game: g, vegasTotal: vegasTotal ?? null, myTotal, stdDevOff, v2: engineRow?.v2 ?? null };
      })
      .filter((r) => r.vegasTotal != null && r.myTotal != null && r.stdDevOff != null);
  }, [divisionFilteredGames, totalsEngineRows, projTotalByGame, week, fbsTotalPoolStd, showTotals]);

  const totalBetsAll: TotalBetRow[] = useMemo(
    () =>
      totalGames
        // Totals v2 games: a bet = a ★ (top-10% expected line move). Games without a v2 number keep the v1 std-dev bar.
        .filter((r) => (r.v2 ? !!r.v2.star && r.v2.move != null : Math.abs(r.stdDevOff!) >= TOTAL_BET_THRESHOLD_STDDEV))
        .map((r) => {
          const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
          const split = projScoreSplit(r.myTotal, spread);
          const v2Move = r.v2 ? r.v2.move : null;
          return {
            game: r.game,
            vegasTotal: v2Move != null ? (r.v2!.open_total ?? r.vegasTotal!) : r.vegasTotal!,
            myTotal: r.myTotal!,
            awayScore: split.awayScore,
            homeScore: split.homeScore,
            stdDevOff: r.stdDevOff!,
            call: (v2Move != null ? v2Move > 0 : r.stdDevOff! > 0) ? ("Over" as const) : ("Under" as const),
            v2Move,
            v2Row: r.v2,
          };
        }),
    [totalGames, computedGames]
  );
  const totalBetsOver = useMemo(() => totalBetsAll.filter((r) => r.call === "Over").sort((a, b) => totalBetStrength(b) - totalBetStrength(a)), [totalBetsAll]);
  const totalBetsUnder = useMemo(() => totalBetsAll.filter((r) => r.call === "Under").sort((a, b) => totalBetStrength(b) - totalBetStrength(a)), [totalBetsAll]);

  const totalWatch: TotalWatchRow[] = useMemo(
    () =>
      totalGames
        // "Within TOTAL_WATCH_MARGIN_STDDEV of the threshold" means the
        // floor is (threshold minus margin), not the margin itself — e.g.
        // "within 0.5 of 1.5" means 1.0 up to 1.5, not 0.5 up to 1.5. The
        // old floor here was the bare margin, so games as low as 0.5 std
        // dev off were showing up as "close" when they were nowhere near it.
        .filter(
          (r) =>
            // The watch list is the v1 std-dev rule; v2 games are either a ★ bet or not (see the Totals page for the full list).
            !r.v2 &&
            Math.abs(r.stdDevOff!) >= TOTAL_BET_THRESHOLD_STDDEV - TOTAL_WATCH_MARGIN_STDDEV && Math.abs(r.stdDevOff!) < TOTAL_BET_THRESHOLD_STDDEV
        )
        .map((r) => {
          const dir = Math.sign(r.stdDevOff!) || 1;
          const raw = r.myTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * fbsTotalPoolStd;
          const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
          const split = projScoreSplit(r.myTotal, spread);
          const vegasTotalNeeded = roundToHalfCrossing(raw, r.myTotal!);
          return {
            game: r.game,
            vegasTotal: r.vegasTotal!,
            myTotal: r.myTotal!,
            awayScore: split.awayScore,
            homeScore: split.homeScore,
            stdDevOff: r.stdDevOff!,
            vegasTotalNeeded,
          };
        })
        .filter((r) => Math.abs(r.vegasTotalNeeded - r.vegasTotal) < TOTAL_WATCH_MAX_MOVEMENT_POINTS)
        .sort((a, b) => Math.abs(b.stdDevOff) - Math.abs(a.stdDevOff)),
    [totalGames, fbsTotalPoolStd, computedGames]
  );

  // --- Team Totals — must respect the division tab; previously pulled
  // from a division-unaware combined list, which is why FBS games were
  // showing up while viewing FCS. ---
  const teamTotalPoolRows = useMemo(() => {
    if (!showTotals) return [];
    return buildTeamSplitBetRows(filterRowsByDivision(totalsEngineRows, "FBS"), TOTAL_BET_THRESHOLD_STDDEV);
  }, [totalsEngineRows, showTotals]);

  // Season-to-date track record for each Home/Away x Favorite/Underdog x
  // Over/Under bucket (same 8 cells as Totals History's Team Totals
  // Performance tab) — surfaced per Chris's request to flag which buckets
  // are actually worth sizing up (e.g. Away Underdog Under) vs. ones with
  // a poor track record (e.g. Away Favorite Over), right on each bet this
  // week rather than making him cross-reference Totals History by hand.
  const teamTotalSegmentByKey = useMemo(() => {
    const segments = computeTeamPerformanceBreakdown(teamTotalPoolRows);
    return new Map(segments.map((s) => [s.key, s]));
  }, [teamTotalPoolRows]);

  function teamTotalSegmentFor(r: { isHome: boolean; isFavorite: boolean | null; call: "Over" | "Under" | null }): PerformanceSegment | undefined {
    if (r.isFavorite == null || r.call == null) return undefined;
    const key = `${r.isHome ? "home" : "away"}-${r.isFavorite ? "fav" : "dog"}-${r.call === "Over" ? "over" : "under"}`;
    return teamTotalSegmentByKey.get(key);
  }

  const teamTotalGameIds = useMemo(() => new Set(divisionFilteredGames.map((g) => g.id)), [divisionFilteredGames]);
  // TeamSplitBetRow doesn't carry the game's CFBD id, only week+team
  // names — match the same way TeamPage/other totals consumers already
  // do, via week+home+away, against the division-filtered game set.
  const teamTotalRowsInDivision = useMemo(() => {
    const keySet = new Set(divisionFilteredGames.map((g) => `${g.week}|${g.home_team}|${g.away_team}`));
    return teamTotalPoolRows.filter((r) => keySet.has(`${r.row.game.week}|${r.row.game.homeTeam}|${r.row.game.awayTeam}`) && r.row.game.week === week);
  }, [teamTotalPoolRows, divisionFilteredGames, week]);

  const teamTotalBetsAllRaw = useMemo(
    () =>
      teamTotalRowsInDivision
        // Totals v2 games: team-total bets follow the ★ line-move signal (both teams, in the move direction); games without
        // a v2 number keep the v1 std-dev filter.
        .filter((r) => (r.row.v2 ? !!r.row.v2.star && r.row.v2.move != null : r.isFiltered) && (effectiveHideCompleted ? !r.row.game.completed : true))
        .map((r) => (r.row.v2?.move != null ? { ...r, call: r.row.v2.move > 0 ? ("Over" as const) : ("Under" as const) } : r))
        .map((r) => {
          // Split the GAME total (not this team's own total — that was
          // the bug: re-splitting a single team's ~34-point total as if
          // it were a whole game's total produced a nonsense score like
          // "7-27"). r.myTeamTotal is already one side of this exact
          // split; deriving both sides from the same game total/spread
          // keeps them consistent with each other and with the Totals
          // section's own proj score for this same game.
          const split = splitTeamTotal(r.row.projection?.projectedTotal ?? null, teamSplitSpread(r.row));
          return { ...r, awayScore: split.away, homeScore: split.home };
        }),
    [teamTotalRowsInDivision, effectiveHideCompleted]
  );
  const teamTotalBetsOver = useMemo(
    () => teamTotalBetsAllRaw.filter((r) => r.call === "Over").sort((a, b) => Math.abs(b.stdDevOff ?? 0) - Math.abs(a.stdDevOff ?? 0)),
    [teamTotalBetsAllRaw]
  );
  const teamTotalBetsUnder = useMemo(
    () => teamTotalBetsAllRaw.filter((r) => r.call === "Under").sort((a, b) => Math.abs(b.stdDevOff ?? 0) - Math.abs(a.stdDevOff ?? 0)),
    [teamTotalBetsAllRaw]
  );

  const teamTotalWatchAll = useMemo(() => {
    return teamTotalRowsInDivision
      .filter(
        (r) =>
          !r.row.v2 &&
          (effectiveHideCompleted ? !r.row.game.completed : true) &&
          r.stdDevOff != null &&
          // Same fix as the game-Totals watch filter above — the floor is
          // (threshold - margin), not the bare margin.
          Math.abs(r.stdDevOff) >= TOTAL_BET_THRESHOLD_STDDEV - TOTAL_WATCH_MARGIN_STDDEV &&
          Math.abs(r.stdDevOff) < TOTAL_BET_THRESHOLD_STDDEV
      )
      .map((r) => {
        const dir = Math.sign(r.stdDevOff ?? 0) || 1;
        const poolStd = r.amountOff != null && r.stdDevOff ? r.amountOff / r.stdDevOff : null;
        const vegasTtNeeded = poolStd != null ? r.myTeamTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * poolStd : null;
        // Same fix as teamTotalBetsAllRaw above — split the game total,
        // not this team's own total.
        const split = splitTeamTotal(r.row.projection?.projectedTotal ?? null, teamSplitSpread(r.row));
        // The line actually being graded against (myTeamTotal minus the
        // already-computed amountOff), not necessarily r.vegasTeamTotal —
        // team totals can grade against a real synced market line instead
        // of the synthetic split (see gradingLineFor in gameTotalsEngine.ts).
        const currentLine = r.myTeamTotal != null ? r.myTeamTotal - (r.amountOff ?? 0) : null;
        return { row: r, awayScore: split.away, homeScore: split.home, vegasTtNeeded, currentLine };
      })
      .filter((r) => r.vegasTtNeeded != null && r.currentLine != null && Math.abs(r.vegasTtNeeded - r.currentLine) < TOTAL_WATCH_MAX_MOVEMENT_POINTS);
  }, [teamTotalRowsInDivision, effectiveHideCompleted]);
  const teamTotalWatchOver = useMemo(
    () => teamTotalWatchAll.filter((r) => r.row.call === "Over").sort((a, b) => Math.abs(b.row.stdDevOff ?? 0) - Math.abs(a.row.stdDevOff ?? 0)),
    [teamTotalWatchAll]
  );
  const teamTotalWatchUnder = useMemo(
    () => teamTotalWatchAll.filter((r) => r.row.call === "Under").sort((a, b) => Math.abs(b.row.stdDevOff ?? 0) - Math.abs(a.row.stdDevOff ?? 0)),
    [teamTotalWatchAll]
  );

  // --- Moneyline ---
  const moneylineBets: MoneylineBetRow[] = useMemo(() => {
    const mlRows = buildMlRowsFromLiveRatingsBillR(divisionFilteredGames, ratingsByWeek, undefined, lockedWinPctByGameId);
    return mlRows
      .filter((r) => r.betSide != null && r.betEv != null && r.betEv > MONEYLINE_EV_THRESHOLD)
      .map((r) => {
        const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
        const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
        const split = projScoreSplit(myTotal, spread);
        return { row: r, awayScore: split.awayScore, homeScore: split.homeScore };
      })
      .sort((a, b) => (b.row.betEv ?? -Infinity) - (a.row.betEv ?? -Infinity));
  }, [divisionFilteredGames, ratingsByWeek, projTotalByGame, week, computedGames, lockedWinPctByGameId]);

  // Moneyline "to watch": EV just under the bar.
  const moneylineWatch: MoneylineBetRow[] = useMemo(() => {
    const mlRows = buildMlRowsFromLiveRatingsBillR(divisionFilteredGames, ratingsByWeek, undefined, lockedWinPctByGameId);
    return mlRows
      .filter((r) => r.betSide != null && r.betEv != null && r.betEv > MONEYLINE_EV_THRESHOLD - MONEYLINE_WATCH_MARGIN && r.betEv <= MONEYLINE_EV_THRESHOLD)
      .map((r) => {
        const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
        const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
        const split = projScoreSplit(myTotal, spread);
        return { row: r, awayScore: split.awayScore, homeScore: split.homeScore };
      })
      .sort((a, b) => (b.row.betEv ?? -Infinity) - (a.row.betEv ?? -Infinity));
  }, [divisionFilteredGames, ratingsByWeek, projTotalByGame, week, computedGames, lockedWinPctByGameId]);

  // Totals v2: this season's line-move bets on played games (stored pre-kickoff numbers) — the "2026" in bucket stats.
  const v2SeasonObs: BetObs[] = useMemo(
    () =>
      obsFromStored(
        totalsEngineRowsRaw.filter((r) => r.v2 && r.game.completed).map((r) => ({ v2: r.v2!, homePts: r.game.homePoints ?? null, awayPts: r.game.awayPoints ?? null }))
      ),
    [totalsEngineRowsRaw]
  );

  // Totals v2 "to watch": games (and their teams) just under the ★ bar.
  const v2WatchGames = useMemo(() => {
    if (!showTotals) return [];
    const keys = new Set(divisionFilteredGames.map((g) => `${g.week}|${g.home_team}|${g.away_team}`));
    return totalsEngineRows
      .filter(
        (r) =>
          r.game.week === week &&
          keys.has(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`) &&
          (effectiveHideCompleted ? !r.game.completed : true) &&
          r.v2?.move != null &&
          !r.v2.star &&
          Math.abs(r.v2.move) >= V2_WATCH_SHARE * T2_MOVE_CUT_TOP10
      )
      .sort((a, b) => Math.abs(b.v2!.move!) - Math.abs(a.v2!.move!));
  }, [totalsEngineRows, divisionFilteredGames, week, effectiveHideCompleted, showTotals]);

  // Period bets: 1H / 2H spread and total, from my spread + total through the period model, against the books' period lines.
  const [periodLines, setPeriodLines] = useState<Map<string, PeriodLineRowLite[]>>(new Map());
  const weekGameIds = useMemo(() => divisionFilteredGames.filter((g) => g.week === week).map((g) => g.id), [divisionFilteredGames, week]);
  useEffect(() => {
    let cancelled = false;
    if (weekGameIds.length === 0) {
      setPeriodLines(new Map());
      return;
    }
    (async () => {
      const out = new Map<string, PeriodLineRowLite[]>();
      for (let i = 0; i < weekGameIds.length; i += 100) {
        const { data } = await supabase
          .from("period_market_lines")
          .select("game_id, period, market_type, provider, point, pulled_at")
          .in("game_id", weekGameIds.slice(i, i + 100))
          .in("period", ["h1", "h2"]);
        for (const r of (data ?? []) as PeriodLineRowLite[]) out.set(r.game_id, [...(out.get(r.game_id) ?? []), r]);
      }
      if (!cancelled) setPeriodLines(out);
    })().catch(() => !cancelled && setPeriodLines(new Map()));
    return () => {
      cancelled = true;
    };
  }, [weekGameIds.join(",")]);
  const periodBets: (GradedBet & { game: GameWithLines })[] = useMemo(() => {
    const items: (GradeItem & { game: GameWithLines })[] = [];
    for (const g of divisionFilteredGames) {
      if (g.week !== week) continue;
      if (effectiveHideCompleted && g.completed) continue;
      const lines = periodLines.get(g.id);
      if (!lines?.length) continue;
      const total = projTotalByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
      const awaySpread = computedGames.find((c) => c.game.id === g.id)?.computed.projAwaySpread ?? null;
      if (total == null || awaySpread == null) continue;
      const dist = buildPeriodDistribution({ homeSpread: -awaySpread, total, neutralSite: !!g.neutral_site });
      const one = (k: "h1" | "h2") => {
        const sm = summarize(dist, k);
        return { awaySpread: sm.meanAwaySpread, total: sm.meanTotal };
      };
      const none = { awaySpread: null, total: null };
      items.push({
        game: g,
        gameId: g.id,
        label: `${g.away_team} @ ${g.home_team}`,
        mine: { h1: one("h1"), h2: one("h2"), q1: none, q2: none, q3: none, q4: none },
        lines: consensusLines(lines),
        awayLineScores: (g as any).away_line_scores,
        homeLineScores: (g as any).home_line_scores,
      });
    }
    const byId = new Map(items.map((it) => [it.gameId, it.game]));
    return gradeItems(items)
      .filter((b) => (b.period === "h1" || b.period === "h2") && b.off >= PERIOD_BET_MIN_OFF)
      .map((b) => ({ ...b, game: byId.get(b.gameId)! }))
      .sort((a, b) => a.period.localeCompare(b.period) || a.market.localeCompare(b.market) || b.off - a.off);
  }, [divisionFilteredGames, week, periodLines, projTotalByGame, computedGames, effectiveHideCompleted]);

  return (
    <div>
      <div ref={exportRef}>
      <h2 style={{ marginTop: 0 }}>Weekly Betting Report</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Run this after syncing this week's games/lines and pushing live ratings.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", justifyContent: "flex-end" }} data-export-exclude="true">
        <ExportPngButton
          targetRef={exportRef}
          filename={() => `weekly-betting-report-${season}-wk${week}`}
          showTweet={false}
          checkboxModes={[
            { label: "Spread Bets", sections: ["spread"] },
            { label: "Moneyline Bets", sections: ["moneyline"] },
            { label: "Totals", sections: ["total"] },
            { label: "Team Totals", sections: ["teamtotal"] },
            { label: "To Watch (All)", sections: ["watch-spread", "watch-moneyline", "watch-v2", "watch-total", "watch-teamtotal"] },
            { label: "Period Bets", sections: ["period"] },
          ]}
        />
        <ExportPdfButton targetRef={exportRef} filename={() => `weekly-betting-report-${season}-wk${week}`} />
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10))} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10))} style={{ width: 60 }} min={0} />
        </label>
        {reportMode === "regular" && (
          <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
            Hide completed games
          </label>
        )}
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={strikeMade} onChange={(e) => setStrikeMade(e.target.checked)} />
          Strike bets I've made
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <button className={`mode-btn ${reportMode === "regular" ? "mode-btn-active" : ""}`} onClick={() => setReportMode("regular")}>
          Regular
        </button>
        <button className={`mode-btn ${reportMode === "performance" ? "mode-btn-active" : ""}`} onClick={() => setReportMode("performance")}>
          Performance (how'd it do?)
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button className={`mode-btn ${division === "FBS" ? "mode-btn-active" : ""}`} onClick={() => setDivision("FBS")}>
          All FBS
        </button>
        <button className={`mode-btn ${division === "FCS" ? "mode-btn-active" : ""}`} onClick={() => setDivision("FCS")}>
          All FCS
        </button>
        <button className={`mode-btn ${division === "Cross" ? "mode-btn-active" : ""}`} onClick={() => setDivision("Cross")}>
          Cross (FBS vs FCS)
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : reportMode === "performance" ? (
        <PerformanceSummarySection
          week={week}
          spreadBets={spreadBetsUnsorted}
          totalBets={totalBetsAll}
          teamTotalBets={teamTotalBetsAllRaw}
          moneylineBets={moneylineBets}
          showTotals={showTotals}
        />
      ) : (
        <>
          <div data-report-section="spread">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="section-label">Spread Bets ({spreadBets.length})</div>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort:</span>
              <button className={`mode-btn ${spreadSort === "betSize" ? "mode-btn-active" : ""}`} onClick={() => setSpreadSort("betSize")}>
                Bet Size
              </button>
              <button className={`mode-btn ${spreadSort === "kickoff" ? "mode-btn-active" : ""}`} onClick={() => setSpreadSort("kickoff")}>
                Kickoff
              </button>
              <button className={`mode-btn ${spreadSort === "amountOff" ? "mode-btn-active" : ""}`} onClick={() => setSpreadSort("amountOff")}>
                Amount Off
              </button>
              <button className={`mode-btn ${spreadSort === "wfbAbs" ? "mode-btn-active" : ""}`} onClick={() => setSpreadSort("wfbAbs")}>
                WFB Abs
              </button>
            </div>
          </div>
          {spreadBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No spread bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Opening</th>
                  <th className="th th-right">Vegas Line</th>
                  <th className="th th-right">Movement</th>
                  <th className="th th-right">Amt Off</th>
                  <th className="th th-right">My Line</th>
                  <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th" style={{ textAlign: "center" }}>{categoryHeaderLabel("Filtered", categoryStats.filtered)}</th>
                  <th className="th" style={{ textAlign: "center" }}>{categoryHeaderLabel("WFB", categoryStats.wfb)}</th>
                  <th className="th" style={{ textAlign: "center" }}>{categoryHeaderLabel("NWFB", categoryStats.nwfb)}</th>
                  <th className="th th-right">Bet Size</th>
                </tr>
              </thead>
              <tbody>
                {spreadBets.map((r) => (
                  <tr key={r.game.id} style={isMade(r.game, "spread", r.betTeam === "away" ? r.game.away_team : r.game.home_team) ? madeStyle : undefined}>
                    <td
                      style={{ ...cellStyle, cursor: "pointer" }}
                      title="View handicapping preview"
                      onClick={() => setHandicapGame({ awayTeam: r.game.away_team, homeTeam: r.game.home_team })}
                    >
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.openingAwaySpread)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.vegasAwaySpread)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      <MovementCell betTeam={r.betTeam} openingLine={r.openingAwaySpread} currentLine={r.vegasAwaySpread} />
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.amountOff.toFixed(1)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.myAwaySpread)}</td>
                    <td style={centerCellStyle}>
                      <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />
                    </td>
                    <td style={cellStyle}>
                      <TeamSpreadCell
                        team={r.betTeam === "away" ? r.game.away_team : r.game.home_team}
                        spread={r.betTeam === "away" ? r.vegasAwaySpread : -r.vegasAwaySpread}
                      />
                    </td>
                    <td style={centerCellStyle}>{r.isFiltered ? <span style={{ color: NEUTRAL_ICON_COLOR }}>{CHECK}</span> : <span style={{ color: "var(--chalk-dim)" }}>–</span>}</td>
                    <td style={centerCellStyle}>{r.isWfb ? <span style={{ color: NEUTRAL_ICON_COLOR }}>{CHECK}</span> : <span style={{ color: "var(--chalk-dim)" }}>–</span>}</td>
                    <td style={centerCellStyle}>{r.isNwfb ? <span style={{ color: NEUTRAL_ICON_COLOR }}>{CHECK}</span> : <span style={{ color: "var(--chalk-dim)" }}>–</span>}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.betSizePct != null ? `${(r.betSizePct * 100).toFixed(1)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>

          <div data-report-section="moneyline">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="section-label">Moneyline Bets ({moneylineBets.length})</div>
          </div>
          {moneylineBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No moneyline bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th th-right">EV</th>
                </tr>
              </thead>
              <tbody>
                {moneylineBets.map(({ row: r, awayScore, homeScore }) => (
                  <tr key={r.game.id} style={isMade(r.game, "moneyline", r.betSide === "away" ? r.game.away_team : r.betSide === "home" ? r.game.home_team : null) ? madeStyle : undefined}>
                    <td
                      style={{ ...cellStyle, cursor: "pointer" }}
                      title="View handicapping preview"
                      onClick={() => setHandicapGame({ awayTeam: r.game.away_team, homeTeam: r.game.home_team })}
                    >
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={centerCellStyle}>
                      <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={awayScore} homeScore={homeScore} />
                    </td>
                    <td style={cellStyle}>
                      <MoneylineBetCell
                        team={r.betSide === "away" ? r.game.away_team : r.game.home_team}
                        ml={r.betSide === "away" ? r.vegasAwayMoneyline : r.vegasHomeMoneyline}
                      />
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.betEv != null ? `${r.betEv.toFixed(1)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>

          {showTotals && (
            <>
              <div data-report-section="total">
              <div className="section-label">Totals ({totalBetsAll.length})</div>
              {totalBetsAll.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>No total bets flagged this week.</p>
              ) : (
                <>
                  {[
                    { label: "Overs", rows: totalBetsOver },
                    { label: "Unders", rows: totalBetsUnder },
                  ].map(
                    ({ label, rows }) =>
                      rows.length > 0 && (
                        <div key={label} style={{ marginBottom: "1rem" }}>
                          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>{label}</div>
                          <table style={{ borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr>
                                <th className="th">Game</th>
                                <th className="th th-right">Vegas Total</th>
                                <th className="th th-right">My Total</th>
                                <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                                <th className="th">Bet</th>
                                <th className="th th-right" title="★ = Totals v2 line-move bet: expected points the total moves after it opens. Otherwise std devs off (v1).">
                                  Edge
                                </th>
                                <th className="th" title="This bet's bucket record: 2023-26 backtest · this season so far">Bucket record</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.game.id} style={isMade(r.game, "total", r.call) ? madeStyle : undefined}>
                                  <td
                                    style={{ ...cellStyle, cursor: "pointer" }}
                                    title="View handicapping preview"
                                    onClick={() => setHandicapGame({ awayTeam: r.game.away_team, homeTeam: r.game.home_team })}
                                  >
                                    <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTotal)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTotal)}</td>
                                  <td style={centerCellStyle}>
                                    <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />
                                  </td>
                                  <td style={{ ...cellStyle, fontWeight: 700 }}>
                                    {r.v2Move != null ? "★ " : ""}
                                    {r.call} {fmtTotal(r.vegasTotal)}
                                    {r.v2Move != null ? <span style={{ fontWeight: 400, color: "var(--chalk-dim)", fontSize: "0.72rem" }}> (open)</span> : null}
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{r.v2Move != null ? `${Math.abs(r.v2Move).toFixed(2)} pts` : `${r.stdDevOff.toFixed(2)} SD`}</td>
                                  <td style={cellStyle}>
                                    {(() => {
                                      const o = r.v2Row ? betsForGame(r.v2Row).game : null;
                                      return o ? <ReportBucketCell o={o} seasonObs={v2SeasonObs} /> : <span style={{ color: "var(--chalk-dim)" }}>–</span>;
                                    })()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                  )}
                </>
              )}
              </div>

              <div data-report-section="teamtotal">
              <div className="section-label">Team Totals ({teamTotalBetsAllRaw.length})</div>
              {teamTotalBetsAllRaw.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>No team total bets flagged this week.</p>
              ) : (
                <>
                  {[
                    { label: "Overs", rows: teamTotalBetsOver },
                    { label: "Unders", rows: teamTotalBetsUnder },
                  ].map(
                    ({ label, rows }) =>
                      rows.length > 0 && (
                        <div key={label} style={{ marginBottom: "1rem" }}>
                          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>{label}</div>
                          <table style={{ borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr>
                                <th className="th">Bet</th>
                                <th className="th">Opponent</th>
                                <th className="th th-right" title="The market's team number right now (the bet line is the team's share of the OPENING total)">Vegas TT now</th>
                                <th className="th th-right">My TT</th>
                                <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                                <th className="th th-right" title="★ Totals v2: expected move of this team's share of the total (points). Otherwise std devs off (v1).">Edge</th>
                                <th className="th" title="This bet's bucket record (home/away × favorite/underdog × over/under): 2023-26 backtest · this season so far">
                                  Bucket record
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => {
                                const o = r.row.v2 ? betsForGame(r.row.v2)[r.isHome ? "home" : "away"] : null;
                                return (
                                <tr key={`${r.row.game.id}-${r.team}`} style={isMade(r.row.game, "team_total", null) ? madeStyle : undefined}>
                                  <td
                                    style={{ ...cellStyle, cursor: "pointer" }}
                                    title="View handicapping preview"
                                    onClick={() => setHandicapGame({ awayTeam: r.row.game.awayTeam, homeTeam: r.row.game.homeTeam })}
                                  >
                                    <TeamTotalCell team={r.team} call={r.call} total={o ? o.line : r.vegasTeamTotal} />
                                    {o && <span style={{ fontSize: "0.68rem", color: "var(--chalk-dim)" }}> ★ open</span>}
                                  </td>
                                  <td style={cellStyle}>
                                    <OpponentCell team={r.isHome ? r.row.game.awayTeam : r.row.game.homeTeam} />
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTeamTotal)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTeamTotal)}</td>
                                  <td style={centerCellStyle}>
                                    <ProjScoreCell awayTeam={r.row.game.awayTeam} homeTeam={r.row.game.homeTeam} awayScore={r.awayScore} homeScore={r.homeScore} />
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{o ? `${Math.abs(o.edge).toFixed(2)} pts` : `${r.stdDevOff?.toFixed(2) ?? "–"} SD`}</td>
                                  <td style={cellStyle}>
                                    {o ? <ReportBucketCell o={o} seasonObs={v2SeasonObs} /> : <TeamTotalSegmentBadge segment={teamTotalSegmentFor(r)} />}
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                  )}
                </>
              )}
              </div>
            </>
          )}

          <div data-report-section="watch-spread">
          <div className="section-label">To Watch — Spreads ({spreadWatch.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            Within {SPREAD_WATCH_MARGIN_POINTS} points of the {FILTER_THRESHOLD}-point Filtered threshold, or within{" "}
            {SPREAD_WATCH_MARGIN_SIGMA} sigma of the {SIGMA_THRESHOLD}-sigma NWFB threshold. One watch-for line only —
            whichever needs the smaller move, rounded to the nearest real half-point that still clears it.
          </p>
          {spreadWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Line</th>
                  <th className="th th-right">My Line</th>
                  <th className="th th-right">Amount Off</th>
                  <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                  <th className="th">Near</th>
                  <th className="th th-right">Watch For</th>
                  <th className="th th-right">Movement Needed</th>
                </tr>
              </thead>
              <tbody>
                {spreadWatch.map((r) => (
                  <tr key={r.game.id}>
                    <td
                      style={{ ...cellStyle, cursor: "pointer" }}
                      title="View handicapping preview"
                      onClick={() => setHandicapGame({ awayTeam: r.game.away_team, homeTeam: r.game.home_team })}
                    >
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.vegasAwaySpread)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.myAwaySpread)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{Math.abs(r.myAwaySpread - r.vegasAwaySpread).toFixed(1)}</td>
                    <td style={centerCellStyle}>
                      <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />
                    </td>
                    <td style={cellStyle}>{r.nearLabel}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.vegasLineNeeded)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{Math.abs(r.vegasLineNeeded - r.vegasAwaySpread).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>

          <div data-report-section="watch-moneyline">
          <div className="section-label">To Watch — Moneylines ({moneylineWatch.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            EV between {MONEYLINE_EV_THRESHOLD - MONEYLINE_WATCH_MARGIN}% and {MONEYLINE_EV_THRESHOLD}% — a better price would make it a bet.
          </p>
          {moneylineWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th">Side</th>
                  <th className="th th-right">EV</th>
                </tr>
              </thead>
              <tbody>
                {moneylineWatch.map(({ row: r }) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={cellStyle}>
                      <MoneylineBetCell team={r.betSide === "away" ? r.game.away_team : r.game.home_team} ml={r.betSide === "away" ? r.vegasAwayMoneyline : r.vegasHomeMoneyline} />
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.betEv != null ? `${r.betEv.toFixed(1)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>

          {showTotals && (
            <>
              <div data-report-section="watch-v2">
              <div className="section-label">To Watch — Totals & Team Totals ({v2WatchGames.length} games)</div>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
                Expected line move just under the ★ bar ({(V2_WATCH_SHARE * T2_MOVE_CUT_TOP10).toFixed(2)}–{T2_MOVE_CUT_TOP10} pts). The game total and both teams lean the
                same way; check the bucket records before acting on a team total.
              </p>
              {v2WatchGames.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
              ) : (
                <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
                  <thead>
                    <tr>
                      <th className="th">Game</th>
                      <th className="th">Lean (opening total)</th>
                      <th className="th th-right">Edge</th>
                      <th className="th">Team totals (share of the open)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v2WatchGames.map((r) => {
                      const b = betsForGame(r.v2!);
                      const tt = (o: BetObs | null, team: string) => (o ? `${team} ${o.dir === 1 ? "o" : "u"}${o.line.toFixed(1)} (${plainLabel(o)})` : null);
                      return (
                        <tr key={r.game.id}>
                          <td style={cellStyle}>
                            <TeamLogo team={r.game.awayTeam} size={16} /> {r.game.awayTeam} @ <TeamLogo team={r.game.homeTeam} size={16} /> {r.game.homeTeam}
                          </td>
                          <td style={{ ...cellStyle, fontWeight: 700 }}>
                            {r.v2!.move! > 0 ? "Over" : "Under"} {fmtTotal(r.v2!.open_total)}
                          </td>
                          <td style={{ ...cellStyle, textAlign: "right" }}>{Math.abs(r.v2!.move!).toFixed(2)} pts</td>
                          <td style={{ ...cellStyle, fontSize: "0.75rem" }}>
                            {[tt(b.away, r.game.awayTeam), tt(b.home, r.game.homeTeam)].filter(Boolean).join(" · ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              </div>

              <div data-report-section="watch-total" style={{ display: totalWatch.length ? undefined : "none" }}>
              <div className="section-label">To Watch — Totals ({totalWatch.length})</div>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
                Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold AND under{" "}
                {TOTAL_WATCH_MAX_MOVEMENT_POINTS} points from it — a wide-pool game can clear the std-dev bar while still
                needing an unrealistic point move, so both have to hold. Rounded to the nearest real half-point that
                still clears it.
              </p>
              {totalWatch.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
              ) : (
                <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
                  <thead>
                    <tr>
                      <th className="th">Game</th>
                      <th className="th th-right">Vegas Total</th>
                      <th className="th th-right">My Total</th>
                      <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                      <th className="th th-right">Std Dev Off</th>
                      <th className="th th-right">Watch For</th>
                      <th className="th th-right">Movement Needed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totalWatch.map((r) => (
                      <tr key={r.game.id}>
                        <td
                          style={{ ...cellStyle, cursor: "pointer" }}
                          title="View handicapping preview"
                          onClick={() => setHandicapGame({ awayTeam: r.game.away_team, homeTeam: r.game.home_team })}
                        >
                          <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                        </td>
                        <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTotal)}</td>
                        <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTotal)}</td>
                        <td style={centerCellStyle}>
                          <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />
                        </td>
                        <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff.toFixed(2)}</td>
                        <td style={{ ...cellStyle, textAlign: "right" }}>
                          {fmtTotal(r.vegasTotalNeeded)} ({r.stdDevOff > 0 ? "Over" : "Under"})
                        </td>
                        <td style={{ ...cellStyle, textAlign: "right" }}>{Math.abs(r.vegasTotalNeeded - r.vegasTotal).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              </div>

              <div data-report-section="watch-teamtotal" style={{ display: teamTotalWatchAll.length ? undefined : "none" }}>
              <div className="section-label">To Watch — Team Totals ({teamTotalWatchAll.length})</div>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
                Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold AND
                under {TOTAL_WATCH_MAX_MOVEMENT_POINTS} points from the bet threshold — a wide-pool game can clear the
                std-dev bar while still needing an unrealistic point move, so both have to hold. Not rounded — "Vegas TT"
                is your own estimate, not a real quoted line.
              </p>
              {teamTotalWatchAll.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
              ) : (
                <>
                  {[
                    { label: "Overs", rows: teamTotalWatchOver },
                    { label: "Unders", rows: teamTotalWatchUnder },
                  ].map(
                    ({ label, rows }) =>
                      rows.length > 0 && (
                        <div key={label} style={{ marginBottom: "1rem" }}>
                          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>{label}</div>
                          <table style={{ borderCollapse: "collapse", fontSize: "0.82rem" }}>
                            <thead>
                              <tr>
                                <th className="th">Team</th>
                                <th className="th">Opponent</th>
                                <th className="th th-right">Vegas TT</th>
                                <th className="th th-right">My TT</th>
                                <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                                <th className="th th-right">Std Dev Off</th>
                                <th className="th th-right">Watch For</th>
                                <th className="th th-right">Movement Needed</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(({ row: r, awayScore, homeScore, vegasTtNeeded, currentLine }) => (
                                <tr key={`${r.row.game.id}-${r.team}`}>
                                  <td
                                    style={{ ...cellStyle, cursor: "pointer" }}
                                    title="View handicapping preview"
                                    onClick={() => setHandicapGame({ awayTeam: r.row.game.awayTeam, homeTeam: r.row.game.homeTeam })}
                                  >
                                    <OpponentCell team={r.team} />
                                  </td>
                                  <td style={cellStyle}>
                                    <OpponentCell team={r.isHome ? r.row.game.awayTeam : r.row.game.homeTeam} />
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTeamTotal)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTeamTotal)}</td>
                                  <td style={centerCellStyle}>
                                    <ProjScoreCell awayTeam={r.row.game.awayTeam} homeTeam={r.row.game.homeTeam} awayScore={awayScore} homeScore={homeScore} />
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff?.toFixed(2) ?? "–"}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(vegasTtNeeded)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>
                                    {vegasTtNeeded != null && currentLine != null ? Math.abs(vegasTtNeeded - currentLine).toFixed(1) : "–"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                  )}
                </>
              )}
              </div>
            </>
          )}

          <div data-report-section="period">
          <div className="section-label">Period Bets — 1H / 2H Spreads & Totals ({periodBets.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            My spread and total run through the period model, against the books' period lines (median), at least {PERIOD_BET_MIN_OFF} points off. Lines appear once
            they're pulled on the Period Projections page.
          </p>
          {periodBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No period bets this week (or no period lines pulled yet).</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th">Period</th>
                  <th className="th">Bet</th>
                  <th className="th th-right">Mine</th>
                  <th className="th th-right">Line</th>
                  <th className="th th-right">Off</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody>
                {periodBets.map((b) => {
                  const team = b.pick === "away" ? b.game.away_team : b.pick === "home" ? b.game.home_team : null;
                  const betLine = b.market === "spread" ? (b.pick === "away" ? b.line : -b.line) : b.line;
                  return (
                    <tr key={`${b.gameId}-${b.period}-${b.market}`}>
                      <td style={cellStyle}>
                        <TeamLogo team={b.game.away_team} size={16} /> {b.game.away_team} @ <TeamLogo team={b.game.home_team} size={16} /> {b.game.home_team}
                      </td>
                      <td style={cellStyle}>{b.period === "h1" ? "1H" : "2H"} {b.market === "spread" ? "spread" : "total"}</td>
                      <td style={{ ...cellStyle, fontWeight: 700 }}>
                        {b.market === "spread" ? `${team} ${betLine > 0 ? "+" : ""}${betLine.toFixed(1)}` : `${b.pick === "over" ? "Over" : "Under"} ${b.line.toFixed(1)}`}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{b.mine.toFixed(1)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{b.line.toFixed(1)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{b.off.toFixed(1)}</td>
                      <td style={cellStyle}>{b.result === "pending" ? "" : b.result === "win" ? "W" : b.result === "loss" ? "L" : "P"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </>
      )}
      </div>

      {handicapGame && (
        <MatchupHandicapPopup
          season={season}
          week={week}
          awayTeam={handicapGame.awayTeam}
          homeTeam={handicapGame.homeTeam}
          onClose={() => setHandicapGame(null)}
        />
      )}
    </div>
  );
}
