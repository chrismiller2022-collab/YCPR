import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine, poolStdDevForTotal, buildTeamSplitBetRows, type TeamSplitBetRow } from "../lib/gameTotalsEngine";
import { filterRowsByDivision } from "./GameTotalsAdminPanel";
import { splitTeamTotal } from "../lib/gameTotals";
import { buildMlRowsFromLiveRatingsBillR, type MlGameRow } from "../lib/moneylineBetHistory";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";
import { BET_HISTORY } from "../data/betHistory.data";

// ---------------------------------------------------------------------
// Weekly Betting Report — "what bets do I need to make and watch out
// for this week," in one page. Pure aggregation of signals already
// computed elsewhere on the site — every threshold here is read
// directly from existing code (DEFAULT_CUSTOM_PARAMS for spreads,
// computeRow's own filteredBetTeam/weightedFilteredBetTeam/nwfbTeam) or
// Chris's own explicitly-stated number (1.0 std dev for totals/team
// totals). Moneyline bets use computeMlRow's "Every Game" rule (any
// positive EV side, via Bill R).
// ---------------------------------------------------------------------

const FILTER_THRESHOLD = DEFAULT_CUSTOM_PARAMS.filterThreshold; // 6 points
const SIGMA_THRESHOLD = DEFAULT_CUSTOM_PARAMS.sigmaThreshold; // 0.4
const SIGMA_DIVISOR = DEFAULT_CUSTOM_PARAMS.sigmaDivisor; // 15.7
const NWFB_POINTS_THRESHOLD = SIGMA_THRESHOLD * SIGMA_DIVISOR; // ~6.28 points
const SPREAD_WATCH_MARGIN_POINTS = 2;
const SPREAD_WATCH_MARGIN_SIGMA = 0.1;
const TOTAL_BET_THRESHOLD_STDDEV = 1.0;
const TOTAL_WATCH_MARGIN_STDDEV = 0.5;
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

const CATEGORY_STATS = {
  filtered: { allTime: categoryRecord("filtered"), thisSeason: categoryRecord("filtered", CURRENT_SEASON) },
  wfb: { allTime: categoryRecord("wfb"), thisSeason: categoryRecord("wfb", CURRENT_SEASON) },
  nwfb: { allTime: categoryRecord("nwfb"), thisSeason: categoryRecord("nwfb", CURRENT_SEASON) },
};

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
  const direction = betTeam === "away" ? 1 : -1;
  const favorable = direction * diff > 0;
  return (
    <span>
      {diff > 0 ? "+" : ""}
      {diff.toFixed(1)}{" "}
      <span style={{ color: NEUTRAL_ICON_COLOR }} title={favorable ? "Moved in your favor (smaller edge now)" : "Moved against you (bigger edge now)"}>
        {favorable ? CHECK : CROSS}
      </span>
    </span>
  );
}

export default function WeeklyBettingReportPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [division, setDivision] = useState<Division>("FBS");
  const [hideCompleted, setHideCompleted] = useState(true);
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

  const { rows: totalsEngineRows } = useGameTotalsEngine(season);
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
      if (hideCompleted && isCompleted(g)) return false;
      const homeC = classOf(g, "home");
      const awayC = classOf(g, "away");
      if (division === "FBS") return homeC === "fbs" && awayC === "fbs";
      if (division === "FCS") return homeC === "fcs" && awayC === "fcs";
      return (homeC === "fbs" && awayC === "fcs") || (homeC === "fcs" && awayC === "fbs");
    });
  }, [games, division, hideCompleted]);

  const showTotals = division === "FBS" || division === "Cross";

  // --- Spreads ---
  const computedGames = useMemo(
    () => divisionFilteredGames.map((g) => ({ game: g, computed: computeRow(g, ratings) })).filter((r) => r.computed.vegasAwaySpread != null),
    [divisionFilteredGames, ratings]
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
        .filter((r) => r.isFiltered && (hideCompleted ? !r.row.game.completed : true))
        .map((r) => {
          const spread = computedGames.find((c) => c.game.away_team === r.row.game.awayTeam && c.game.home_team === r.row.game.homeTeam)?.computed
            .projAwaySpread;
          const split = projScoreSplit(r.myTeamTotal, spread ?? null);
          return { ...r, awayScore: split.awayScore, homeScore: split.homeScore };
        }),
    [teamTotalRowsInDivision, hideCompleted, computedGames]
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
          (hideCompleted ? !r.row.game.completed : true) &&
          r.stdDevOff != null &&
          Math.abs(r.stdDevOff) >= TOTAL_WATCH_MARGIN_STDDEV &&
          Math.abs(r.stdDevOff) < TOTAL_BET_THRESHOLD_STDDEV
      )
      .map((r) => {
        const spread = computedGames.find((c) => c.game.away_team === r.row.game.awayTeam && c.game.home_team === r.row.game.homeTeam)?.computed
          .projAwaySpread;
        const dir = Math.sign(r.stdDevOff ?? 0) || 1;
        const poolStd = r.amountOff != null && r.stdDevOff ? r.amountOff / r.stdDevOff : null;
        const vegasTtNeeded = poolStd != null ? r.myTeamTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * poolStd : null;
        const split = projScoreSplit(r.myTeamTotal, spread ?? null);
        return { row: r, awayScore: split.awayScore, homeScore: split.homeScore, vegasTtNeeded };
      });
  }, [teamTotalRowsInDivision, hideCompleted, computedGames]);

  // --- Moneyline ---
  const moneylineBets: MoneylineBetRow[] = useMemo(() => {
    const mlRows = buildMlRowsFromLiveRatingsBillR(divisionFilteredGames, ratingsByWeek);
    return mlRows
      .filter((r) => r.betSide != null)
      .map((r) => {
        const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
        const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
        const split = projScoreSplit(myTotal, spread);
        return { row: r, awayScore: split.awayScore, homeScore: split.homeScore };
      })
      .sort((a, b) => (b.row.betEv ?? -Infinity) - (a.row.betEv ?? -Infinity));
  }, [divisionFilteredGames, ratingsByWeek, projTotalByGame, week, computedGames]);

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
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed games
        </label>
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
                  <th className="th" style={{ textAlign: "center" }}>{categoryHeaderLabel("Filtered", CATEGORY_STATS.filtered)}</th>
                  <th className="th" style={{ textAlign: "center" }}>{categoryHeaderLabel("WFB", CATEGORY_STATS.wfb)}</th>
                  <th className="th" style={{ textAlign: "center" }}>{categoryHeaderLabel("NWFB", CATEGORY_STATS.nwfb)}</th>
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
