import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow, computeMatchupStats } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import {
  useGameTotalsEngine,
  poolStdDevForTotal,
  buildTeamSplitBetRows,
  applyLockedTotals,
  applyLockedSpreadToRows,
  type TeamSplitBetRow,
} from "../lib/gameTotalsEngine";
import { filterRowsByDivision } from "./GameTotalsAdminPanel";
import { splitTeamTotal, gradeActualTotal, gradeBetCall, type BetGrade } from "../lib/gameTotals";
import { buildMlRowsFromLiveRatingsBillR, type MlGameRow } from "../lib/moneylineBetHistory";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";
import { BET_HISTORY } from "../data/betHistory.data";
import { useDefaultToCurrentWeek } from "../lib/currentWeek";
import { unitsRiskedToWinOne } from "../lib/odds";

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
const TOTAL_BET_THRESHOLD_STDDEV = 1.5;
const TOTAL_WATCH_MARGIN_STDDEV = 0.5;
const MONEYLINE_EV_THRESHOLD = 8; // percent — per Chris, only flag a moneyline bet once EV clears this bar
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

// --- Historical category win rates (Filtered / WFB / NWFB), all-time and current season ---
function categoryRecord(category: "filtered" | "wfb" | "nwfb", season?: number): { w: number; l: number } {
  let w = 0;
  let l = 0;
  for (const r of BET_HISTORY) {
    if (season != null && r.season !== season) continue;
    let result: "win" | "loss" | "push" | null = null;
    if (category === "filtered") result = r.filteredBetResult;
    else if (category === "wfb") result = r.weightedFilteredBetResult;
    else if (category === "nwfb") result = r.absAmountOff > NWFB_POINTS_THRESHOLD ? r.filteredBetResult : null;
    if (result === "win") w++;
    else if (result === "loss") l++;
  }
  return { w, l };
}

function pctOf(rec: { w: number; l: number }): string {
  const decided = rec.w + rec.l;
  return decided === 0 ? "–" : `${((rec.w / decided) * 100).toFixed(0)}%`;
}

// All-time (2024/2025) never changes — BET_HISTORY is a frozen dataset —
// but CURRENT_SEASON (2026+) has no BET_HISTORY rows at all, so that half
// used to always show "–". Computed live instead, below, from the exact
// same computeRow()/computeMatchupStats() pipeline Admin Matchups uses.
const ALL_TIME_CATEGORY_STATS = {
  filtered: categoryRecord("filtered"),
  wfb: categoryRecord("wfb"),
  nwfb: categoryRecord("nwfb"),
};

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
    return computeMatchupStats(rows);
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
}

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
          color: bucket.units > 0 ? "#8fd39a" : bucket.units < 0 ? "#c45c52" : undefined,
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
    </div>
  );
}

export default function WeeklyBettingReportPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToCurrentWeek(season, week, setWeek);
  const [division, setDivision] = useState<Division>("FBS");
  const [reportMode, setReportMode] = useState<"regular" | "performance">("regular");
  const [hideCompleted, setHideCompleted] = useState(true);
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
  const [spreadSort, setSpreadSort] = useState<"betSize" | "kickoff">("betSize");
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
        const myTotal = projTotalByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
        const stdDevOff = myTotal != null && vegasTotal != null && fbsTotalPoolStd !== 0 ? (myTotal - vegasTotal) / fbsTotalPoolStd : null;
        return { game: g, vegasTotal: vegasTotal ?? null, myTotal, stdDevOff };
      })
      .filter((r) => r.vegasTotal != null && r.myTotal != null && r.stdDevOff != null);
  }, [divisionFilteredGames, totalsEngineRows, projTotalByGame, week, fbsTotalPoolStd, showTotals]);

  const totalBetsAll: TotalBetRow[] = useMemo(
    () =>
      totalGames
        .filter((r) => Math.abs(r.stdDevOff!) >= TOTAL_BET_THRESHOLD_STDDEV)
        .map((r) => {
          const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
          const split = projScoreSplit(r.myTotal, spread);
          return {
            game: r.game,
            vegasTotal: r.vegasTotal!,
            myTotal: r.myTotal!,
            awayScore: split.awayScore,
            homeScore: split.homeScore,
            stdDevOff: r.stdDevOff!,
            call: r.stdDevOff! > 0 ? ("Over" as const) : ("Under" as const),
          };
        }),
    [totalGames, computedGames]
  );
  const totalBetsOver = useMemo(() => totalBetsAll.filter((r) => r.call === "Over").sort((a, b) => Math.abs(b.stdDevOff) - Math.abs(a.stdDevOff)), [totalBetsAll]);
  const totalBetsUnder = useMemo(() => totalBetsAll.filter((r) => r.call === "Under").sort((a, b) => Math.abs(b.stdDevOff) - Math.abs(a.stdDevOff)), [totalBetsAll]);

  const totalWatch: TotalWatchRow[] = useMemo(
    () =>
      totalGames
        .filter((r) => Math.abs(r.stdDevOff!) >= TOTAL_WATCH_MARGIN_STDDEV && Math.abs(r.stdDevOff!) < TOTAL_BET_THRESHOLD_STDDEV)
        .map((r) => {
          const dir = Math.sign(r.stdDevOff!) || 1;
          const raw = r.myTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * fbsTotalPoolStd;
          const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
          const split = projScoreSplit(r.myTotal, spread);
          return {
            game: r.game,
            vegasTotal: r.vegasTotal!,
            myTotal: r.myTotal!,
            awayScore: split.awayScore,
            homeScore: split.homeScore,
            stdDevOff: r.stdDevOff!,
            vegasTotalNeeded: roundToHalfCrossing(raw, r.myTotal!),
          };
        }),
    [totalGames, fbsTotalPoolStd, computedGames]
  );

  // --- Team Totals — must respect the division tab; previously pulled
  // from a division-unaware combined list, which is why FBS games were
  // showing up while viewing FCS. ---
  const teamTotalPoolRows = useMemo(() => {
    if (!showTotals) return [];
    return buildTeamSplitBetRows(filterRowsByDivision(totalsEngineRows, "FBS"), TOTAL_BET_THRESHOLD_STDDEV);
  }, [totalsEngineRows, showTotals]);

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
        .filter((r) => r.isFiltered && (effectiveHideCompleted ? !r.row.game.completed : true))
        .map((r) => {
          // Split the GAME total (not this team's own total — that was
          // the bug: re-splitting a single team's ~34-point total as if
          // it were a whole game's total produced a nonsense score like
          // "7-27"). r.myTeamTotal is already one side of this exact
          // split; deriving both sides from the same game total/spread
          // keeps them consistent with each other and with the Totals
          // section's own proj score for this same game.
          const split = splitTeamTotal(r.row.projection?.projectedTotal ?? null, r.row.myHomeSpread);
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

  const teamTotalWatch = useMemo(() => {
    return teamTotalRowsInDivision
      .filter(
        (r) =>
          (effectiveHideCompleted ? !r.row.game.completed : true) &&
          r.stdDevOff != null &&
          Math.abs(r.stdDevOff) >= TOTAL_WATCH_MARGIN_STDDEV &&
          Math.abs(r.stdDevOff) < TOTAL_BET_THRESHOLD_STDDEV
      )
      .map((r) => {
        const dir = Math.sign(r.stdDevOff ?? 0) || 1;
        const poolStd = r.amountOff != null && r.stdDevOff ? r.amountOff / r.stdDevOff : null;
        const vegasTtNeeded = poolStd != null ? r.myTeamTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * poolStd : null;
        // Same fix as teamTotalBetsAllRaw above — split the game total,
        // not this team's own total.
        const split = splitTeamTotal(r.row.projection?.projectedTotal ?? null, r.row.myHomeSpread);
        return { row: r, awayScore: split.away, homeScore: split.home, vegasTtNeeded };
      });
  }, [teamTotalRowsInDivision, effectiveHideCompleted]);

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

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Weekly Betting Report</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Run this after syncing this week's games/lines and pushing live ratings.
      </p>

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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="section-label">Spread Bets ({spreadBets.length})</div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort:</span>
              <button className={`mode-btn ${spreadSort === "betSize" ? "mode-btn-active" : ""}`} onClick={() => setSpreadSort("betSize")}>
                Bet Size
              </button>
              <button className={`mode-btn ${spreadSort === "kickoff" ? "mode-btn-active" : ""}`} onClick={() => setSpreadSort("kickoff")}>
                Kickoff
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
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
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

          {showTotals && (
            <>
              <div className="section-label">Total Bets ({totalBetsAll.length})</div>
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
                                <th className="th th-right">Std Dev Off</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.game.id}>
                                  <td style={cellStyle}>
                                    <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTotal)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTotal)}</td>
                                  <td style={centerCellStyle}>
                                    <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />
                                  </td>
                                  <td style={{ ...cellStyle, fontWeight: 700 }}>{r.call} {fmtTotal(r.vegasTotal)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                  )}
                </>
              )}

              <div className="section-label">Team Total Bets ({teamTotalBetsAllRaw.length})</div>
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
                                <th className="th th-right">Vegas TT</th>
                                <th className="th th-right">My TT</th>
                                <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                                <th className="th th-right">Std Dev Off</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={`${r.row.game.id}-${r.team}`}>
                                  <td style={cellStyle}>
                                    <TeamTotalCell team={r.team} call={r.call} total={r.vegasTeamTotal} />
                                  </td>
                                  <td style={cellStyle}>
                                    <OpponentCell team={r.isHome ? r.row.game.awayTeam : r.row.game.homeTeam} />
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTeamTotal)}</td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTeamTotal)}</td>
                                  <td style={centerCellStyle}>
                                    <ProjScoreCell awayTeam={r.row.game.awayTeam} homeTeam={r.row.game.homeTeam} awayScore={r.awayScore} homeScore={r.homeScore} />
                                  </td>
                                  <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff?.toFixed(2) ?? "–"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                  )}
                </>
              )}
            </>
          )}

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
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
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
                  <th className="th" style={{ textAlign: "center" }}>My Proj Score</th>
                  <th className="th">Near</th>
                  <th className="th th-right">Watch For</th>
                </tr>
              </thead>
              <tbody>
                {spreadWatch.map((r) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.vegasAwaySpread)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.myAwaySpread)}</td>
                    <td style={centerCellStyle}>
                      <ProjScoreCell awayTeam={r.game.away_team} homeTeam={r.game.home_team} awayScore={r.awayScore} homeScore={r.homeScore} />
                    </td>
                    <td style={cellStyle}>{r.nearLabel}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.vegasLineNeeded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {showTotals && (
            <>
              <div className="section-label">To Watch — Totals ({totalWatch.length})</div>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
                Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold, rounded to the nearest real half-point that still clears it.
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
                    </tr>
                  </thead>
                  <tbody>
                    {totalWatch.map((r) => (
                      <tr key={r.game.id}>
                        <td style={cellStyle}>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="section-label">To Watch — Team Totals ({teamTotalWatch.length})</div>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
                Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold. Not
                rounded — "Vegas TT" is your own estimate, not a real quoted line.
              </p>
              {teamTotalWatch.length === 0 ? (
                <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
              ) : (
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
                    </tr>
                  </thead>
                  <tbody>
                    {teamTotalWatch.map(({ row: r, awayScore, homeScore, vegasTtNeeded }) => (
                      <tr key={`${r.row.game.id}-${r.team}`}>
                        <td style={cellStyle}>
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
                        <td style={{ ...cellStyle, textAlign: "right" }}>
                          {fmtTotal(vegasTtNeeded)} ({(r.stdDevOff ?? 0) > 0 ? "Over" : "Under"})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
