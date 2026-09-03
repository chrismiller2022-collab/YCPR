import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine, poolStdDevForTotal, buildTeamSplitBetRows, type TeamSplitBetRow } from "../lib/gameTotalsEngine";
import { filterRowsByDivision } from "./GameTotalsAdminPanel";
import { formatProjectedScore, splitTeamTotal } from "../lib/gameTotals";
import { buildMlRowsFromLiveRatingsBillR, type MlGameRow } from "../lib/moneylineBetHistory";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";
import { BET_HISTORY } from "../data/betHistory.data";

// ---------------------------------------------------------------------
// Weekly Betting Report — admin-only consolidation of every bet signal
// already computed elsewhere on the site (Matchups' spread bets, the
// Totals page's own std-dev flagging, Bill R moneyline EV) into one
// page: "here's everything I actually have a bet on this week," plus a
// "To Watch" list of games close enough to a threshold that a small
// line move would trigger one. This is a pure aggregation layer, not a
// new bet-detection system — every threshold here is either read
// directly from existing code (DEFAULT_CUSTOM_PARAMS for spreads,
// computeRow's own filteredBetTeam/weightedFilteredBetTeam/nwfbTeam) or
// Chris's own explicitly-stated number (1.0 std dev for totals/team
// totals).
//
// Moneyline bets use computeMlRow's "Every Game" rule (any positive EV
// side, via Bill R) since that's the only moneyline bet definition that
// exists anywhere in this codebase.
// ---------------------------------------------------------------------

const FILTER_THRESHOLD = DEFAULT_CUSTOM_PARAMS.filterThreshold; // 6 points
const SIGMA_THRESHOLD = DEFAULT_CUSTOM_PARAMS.sigmaThreshold; // 0.4
const SIGMA_DIVISOR = DEFAULT_CUSTOM_PARAMS.sigmaDivisor; // 15.7
const NWFB_POINTS_THRESHOLD = SIGMA_THRESHOLD * SIGMA_DIVISOR; // ~6.28 points, for display/reverse-math
const SPREAD_WATCH_MARGIN_POINTS = 2; // "within 2 points of being 6 off"
const SPREAD_WATCH_MARGIN_SIGMA = 0.1; // "within 0.1 of being above 0.4 sigma"
const TOTAL_BET_THRESHOLD_STDDEV = 1.0; // Chris's explicit number
const TOTAL_WATCH_MARGIN_STDDEV = 0.5; // "within 0.5 of being 1 std dev off"
const CURRENT_SEASON = new Date().getFullYear();

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

// Real spread/total lines only exist at 0.5 increments — the exact
// "line needed to cross the threshold" is almost never one of those.
// Rounds to the nearest half-point that STILL clears the threshold
// (away from myLine/myTotal), not just the nearest neighbor: needing
// +15.6 means +15.5 wouldn't actually clear it, so this rounds up to
// +16, not down to +15.5. Direction is inferred from which side of
// myLine/myTotal the raw target sits on.
function roundToHalfCrossing(raw: number, myReference: number): number {
  const goingUp = raw >= myReference;
  return goingUp ? Math.ceil(raw * 2) / 2 : Math.floor(raw * 2) / 2;
}

const cellStyle: CSSProperties = { padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)" };
const centerCellStyle: CSSProperties = { ...cellStyle, textAlign: "center" };

// --- Historical category win rates (Filtered / WFB / NWFB), all-time and current season ---
// BET_HISTORY doesn't track NWFB directly (it predates that signal) —
// derived here from the same absAmountOff/team-pick fields it does
// track. NWFB's raw threshold (absAmountOff > ~6.28) is strictly
// higher than Filtered's (> 6), so any game clearing NWFB necessarily
// also clears Filtered and picks the identical side — filteredBetTeam/
// filteredBetResult are safe to reuse for the NWFB derivation rather
// than needing a separate historical field.
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

function CategoryBadge({ label, stats }: { label: string; stats: { allTime: { w: number; l: number }; thisSeason: { w: number; l: number } } }) {
  return (
    <div style={{ fontSize: "0.7rem", lineHeight: 1.3 }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <br />
      <span style={{ color: "var(--chalk-dim)" }}>
        All-time {pctOf(stats.allTime)} ({stats.allTime.w}-{stats.allTime.l}) · {CURRENT_SEASON} {pctOf(stats.thisSeason)} (
        {stats.thisSeason.w}-{stats.thisSeason.l})
      </span>
    </div>
  );
}

interface SpreadBetRow {
  game: GameWithLines;
  vegasAwaySpread: number;
  openingAwaySpread: number | null;
  myAwaySpread: number;
  myProjScore: string | null;
  myAwayScore: number | null;
  myHomeScore: number | null;
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
  myProjScore: string | null;
  nearFiltered: boolean;
  nearNwfb: boolean;
  vegasLineNeededFiltered: number | null;
  vegasLineNeededNwfb: number | null;
}

interface TotalBetRow {
  game: GameWithLines;
  vegasTotal: number;
  myTotal: number;
  myProjScore: string | null;
  stdDevOff: number;
  call: "Over" | "Under";
}

interface TotalWatchRow {
  game: GameWithLines;
  vegasTotal: number;
  myTotal: number;
  myProjScore: string | null;
  stdDevOff: number;
  vegasTotalNeeded: number;
}

interface MoneylineBetRow {
  row: MlGameRow;
  myProjScore: string | null;
}

type Division = "FBSvFBS" | "FCSvFCS";
type OverUnderView = "all" | "over" | "under";

// A cell showing "team logo + team name + spread", replacing separate
// Bet/Line columns that used to just show a bare logo.
function TeamSpreadCell({ team, spread }: { team: string; spread: number | null }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <TeamLogo team={team} size={16} /> {team} <span style={{ fontWeight: 700 }}>{fmtSpread(spread)}</span>
    </span>
  );
}

// Opening -> current line movement indicator. Favorable price movement
// for the bet side always exactly corresponds to a shrinking model
// edge (the market itself closing the gap), so there's only one real
// condition to compute — see chat for the full derivation. "Just
// informational," per Chris, not tied to any other logic.
function MovementIcon({ betTeam, openingLine, currentLine }: { betTeam: "away" | "home"; openingLine: number | null; currentLine: number }) {
  if (openingLine == null || openingLine === currentLine) return null;
  const direction = betTeam === "away" ? 1 : -1;
  const favorable = direction * (currentLine - openingLine) > 0;
  return (
    <span title={favorable ? "Moved in your favor (smaller edge now)" : "Moved against you (bigger edge now)"} style={{ marginLeft: "0.3rem" }}>
      {favorable ? "✅" : "❗"}
    </span>
  );
}

export default function WeeklyBettingReportPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [division, setDivision] = useState<Division>("FBSvFBS");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [spreadSort, setSpreadSort] = useState<"betSize" | "kickoff">("betSize");
  const [totalsView, setTotalsView] = useState<OverUnderView>("all");
  const [teamTotalsView, setTeamTotalsView] = useState<OverUnderView>("all");
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
  const fcsTotalPoolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(totalsEngineRows, "FCS")), [totalsEngineRows]);

  // Division filter: cross-divisional games fold into the FBS view,
  // matching the site-wide convention established for the Weekly Image
  // Dump/Matchups elsewhere — there's no third "cross" option here.
  const divisionFilteredGames = useMemo(() => {
    return games.filter((g) => {
      if (hideCompleted && isCompleted(g)) return false;
      const homeC = classOf(g, "home");
      const awayC = classOf(g, "away");
      if (division === "FCSvFCS") return homeC === "fcs" && awayC === "fcs";
      // FBSvFBS view: real FBS-vs-FBS plus any cross-divisional game.
      return homeC === "fbs" || awayC === "fbs";
    });
  }, [games, division, hideCompleted]);

  // --- Spreads (Filtered / WFB / NWFB — each shown independently) ---
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
          const split = splitTeamTotal(myTotal, r.computed.projAwaySpread != null ? -r.computed.projAwaySpread : null);
          return {
            game: r.game,
            vegasAwaySpread: r.computed.vegasAwaySpread!,
            openingAwaySpread: r.computed.line?.opening_spread != null ? -r.computed.line.opening_spread : null,
            myAwaySpread: r.computed.projAwaySpread!,
            myProjScore: formatProjectedScore(myTotal, r.computed.projAwaySpread != null ? -r.computed.projAwaySpread : null, r.game.away_team, r.game.home_team),
            myAwayScore: split.away,
            myHomeScore: split.home,
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
          const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
          const rawFiltered = nearFiltered ? myLine - dir * FILTER_THRESHOLD : null;
          const rawNwfb = nearNwfb ? myLine - dir * NWFB_POINTS_THRESHOLD : null;
          return {
            game: r.game,
            vegasAwaySpread: vegasLine,
            myAwaySpread: myLine,
            myProjScore: formatProjectedScore(myTotal, -myLine, r.game.away_team, r.game.home_team),
            nearFiltered,
            nearNwfb,
            vegasLineNeededFiltered: rawFiltered != null ? roundToHalfCrossing(rawFiltered, myLine) : null,
            vegasLineNeededNwfb: rawNwfb != null ? roundToHalfCrossing(rawNwfb, myLine) : null,
          };
        })
        .filter((r): r is SpreadWatchRow => r != null),
    [computedGames, projTotalByGame, week]
  );

  // --- Totals (1+ std dev off Vegas, per-division pool) ---
  const totalGames = useMemo(() => {
    return divisionFilteredGames
      .map((g) => {
        const vegasTotal = totalsEngineRows.find((r) => r.game.week === week && r.game.homeTeam === g.home_team && r.game.awayTeam === g.away_team)?.odds
          .vegasTotal;
        const myTotal = projTotalByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
        const isFcs = classOf(g, "home") === "fcs" && classOf(g, "away") === "fcs";
        const poolStd = isFcs ? fcsTotalPoolStd : fbsTotalPoolStd; // cross-divisional uses the FBS pool
        const stdDevOff = myTotal != null && vegasTotal != null && poolStd !== 0 ? (myTotal - vegasTotal) / poolStd : null;
        return { game: g, vegasTotal: vegasTotal ?? null, myTotal, stdDevOff, isFcs };
      })
      .filter((r) => r.vegasTotal != null && r.myTotal != null && r.stdDevOff != null);
  }, [divisionFilteredGames, totalsEngineRows, projTotalByGame, week, fbsTotalPoolStd, fcsTotalPoolStd]);

  const totalBetsUnsorted: TotalBetRow[] = useMemo(
    () =>
      totalGames
        .filter((r) => Math.abs(r.stdDevOff!) >= TOTAL_BET_THRESHOLD_STDDEV)
        .map((r) => ({
          game: r.game,
          vegasTotal: r.vegasTotal!,
          myTotal: r.myTotal!,
          myProjScore: formatProjectedScore(
            r.myTotal,
            computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread != null
              ? -computedGames.find((c) => c.game.id === r.game.id)!.computed.projAwaySpread!
              : null,
            r.game.away_team,
            r.game.home_team
          ),
          stdDevOff: r.stdDevOff!,
          call: r.stdDevOff! > 0 ? ("Over" as const) : ("Under" as const),
        })),
    [totalGames, computedGames]
  );

  const totalBets = useMemo(() => {
    const filtered = totalsView === "all" ? totalBetsUnsorted : totalBetsUnsorted.filter((r) => r.call.toLowerCase() === totalsView);
    return [...filtered].sort((a, b) => Math.abs(b.stdDevOff) - Math.abs(a.stdDevOff));
  }, [totalBetsUnsorted, totalsView]);

  const totalWatch: TotalWatchRow[] = useMemo(
    () =>
      totalGames
        .filter((r) => Math.abs(r.stdDevOff!) >= TOTAL_WATCH_MARGIN_STDDEV && Math.abs(r.stdDevOff!) < TOTAL_BET_THRESHOLD_STDDEV)
        .map((r) => {
          const poolStd = r.isFcs ? fcsTotalPoolStd : fbsTotalPoolStd;
          const dir = Math.sign(r.stdDevOff!) || 1;
          const raw = r.myTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * poolStd;
          return {
            game: r.game,
            vegasTotal: r.vegasTotal!,
            myTotal: r.myTotal!,
            myProjScore: formatProjectedScore(
              r.myTotal,
              computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread != null
                ? -computedGames.find((c) => c.game.id === r.game.id)!.computed.projAwaySpread!
                : null,
              r.game.away_team,
              r.game.home_team
            ),
            stdDevOff: r.stdDevOff!,
            vegasTotalNeeded: roundToHalfCrossing(raw, r.myTotal!),
          };
        }),
    [totalGames, fbsTotalPoolStd, fcsTotalPoolStd, computedGames]
  );

  // --- Team Totals (1+ std dev off Vegas, per-team split) ---
  const fbsTeamTotalBetRows = useMemo(() => buildTeamSplitBetRows(filterRowsByDivision(totalsEngineRows, "FBS"), TOTAL_BET_THRESHOLD_STDDEV), [totalsEngineRows]);
  const fcsTeamTotalBetRows = useMemo(() => buildTeamSplitBetRows(filterRowsByDivision(totalsEngineRows, "FCS"), TOTAL_BET_THRESHOLD_STDDEV), [totalsEngineRows]);
  const allTeamTotalBetRows = useMemo(() => [...fbsTeamTotalBetRows, ...fcsTeamTotalBetRows], [fbsTeamTotalBetRows, fcsTeamTotalBetRows]);

  const teamTotalBetsUnsorted: (TeamSplitBetRow & { myProjScore: string | null })[] = useMemo(() => {
    return allTeamTotalBetRows
      .filter((r) => r.row.game.week === week && r.isFiltered && (hideCompleted ? !r.row.game.completed : true))
      .map((r) => {
        const spread = computedGames.find((c) => c.game.away_team === r.row.game.awayTeam && c.game.home_team === r.row.game.homeTeam)?.computed
          .projAwaySpread;
        return {
          ...r,
          myProjScore: formatProjectedScore(r.myTeamTotal, spread != null ? -spread : null, r.row.game.awayTeam, r.row.game.homeTeam),
        };
      });
  }, [allTeamTotalBetRows, week, hideCompleted, computedGames]);

  const teamTotalBets = useMemo(() => {
    const filtered = teamTotalsView === "all" ? teamTotalBetsUnsorted : teamTotalBetsUnsorted.filter((r) => r.call?.toLowerCase() === teamTotalsView);
    return [...filtered].sort((a, b) => Math.abs(b.stdDevOff ?? 0) - Math.abs(a.stdDevOff ?? 0));
  }, [teamTotalBetsUnsorted, teamTotalsView]);

  // To Watch — Team Totals: same 0.5-margin band as game Totals, but no
  // rounding on "watch for" (Chris estimates his own Vegas TT — there's
  // no real market number to round to).
  const teamTotalWatch = useMemo(() => {
    return allTeamTotalBetRows
      .filter(
        (r) =>
          r.row.game.week === week &&
          (hideCompleted ? !r.row.game.completed : true) &&
          r.stdDevOff != null &&
          Math.abs(r.stdDevOff) >= TOTAL_WATCH_MARGIN_STDDEV &&
          Math.abs(r.stdDevOff) < TOTAL_BET_THRESHOLD_STDDEV
      )
      .map((r) => {
        const spread = computedGames.find((c) => c.game.away_team === r.row.game.awayTeam && c.game.home_team === r.row.game.homeTeam)?.computed
          .projAwaySpread;
        const dir = Math.sign(r.stdDevOff ?? 0) || 1;
        // buildTeamSplitBetRows' own pool std dev, recovered from amountOff/stdDevOff since it isn't returned directly.
        const poolStd = r.amountOff != null && r.stdDevOff ? r.amountOff / r.stdDevOff : null;
        const vegasTtNeeded = poolStd != null ? r.myTeamTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * poolStd : null;
        return {
          row: r,
          myProjScore: formatProjectedScore(r.myTeamTotal, spread != null ? -spread : null, r.row.game.awayTeam, r.row.game.homeTeam),
          vegasTtNeeded,
        };
      });
  }, [allTeamTotalBetRows, week, hideCompleted, computedGames]);

  // --- Moneyline (Bill R Method, any positive-EV side — see file header) ---
  const moneylineBets: MoneylineBetRow[] = useMemo(() => {
    const mlRows = buildMlRowsFromLiveRatingsBillR(divisionFilteredGames, ratingsByWeek);
    return mlRows
      .filter((r) => r.betSide != null)
      .map((r) => {
        const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
        const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
        return { row: r, myProjScore: formatProjectedScore(myTotal, spread != null ? -spread : null, r.game.away_team, r.game.home_team) };
      });
  }, [divisionFilteredGames, ratingsByWeek, projTotalByGame, week, computedGames]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Weekly Betting Report</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Run this after syncing this week's games/lines and pushing live ratings. Pulls together every bet already
        flagged elsewhere on the site (Spreads, Totals, Team Totals, Moneyline) plus games close enough to a
        threshold to watch as lines move.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10))} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10))} style={{ width: 60 }} min={0} />
        </label>
        <button className={`mode-btn ${division === "FBSvFBS" ? "mode-btn-active" : ""}`} onClick={() => setDivision("FBSvFBS")}>
          FBS
        </button>
        <button className={`mode-btn ${division === "FCSvFCS" ? "mode-btn-active" : ""}`} onClick={() => setDivision("FCSvFCS")}>
          FCS
        </button>
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed games
        </label>
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
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Opening</th>
                  <th className="th th-right">Vegas Line</th>
                  <th className="th th-right">Amt Off</th>
                  <th className="th th-right">My Line</th>
                  <th className="th" style={{ textAlign: "center" }}>
                    My Proj Score
                  </th>
                  <th className="th">Bet</th>
                  <th className="th">Signals hitting</th>
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
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtSpread(r.vegasAwaySpread)}
                      <MovementIcon betTeam={r.betTeam} openingLine={r.openingAwaySpread} currentLine={r.vegasAwaySpread} />
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.amountOff.toFixed(1)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.myAwaySpread)}</td>
                    <td style={centerCellStyle}>
                      {r.myAwayScore != null && r.myHomeScore != null ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                          <TeamLogo team={r.game.away_team} size={14} />
                          {Math.round(r.myAwayScore)} – {Math.round(r.myHomeScore)}
                          <TeamLogo team={r.game.home_team} size={14} />
                        </span>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td style={cellStyle}>
                      <TeamSpreadCell
                        team={r.betTeam === "away" ? r.game.away_team : r.game.home_team}
                        spread={r.betTeam === "away" ? r.vegasAwaySpread : -r.vegasAwaySpread}
                      />
                    </td>
                    <td style={cellStyle}>
                      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                        {r.isFiltered && <CategoryBadge label="Filtered" stats={CATEGORY_STATS.filtered} />}
                        {r.isWfb && <CategoryBadge label="WFB" stats={CATEGORY_STATS.wfb} />}
                        {r.isNwfb && <CategoryBadge label="NWFB" stats={CATEGORY_STATS.nwfb} />}
                      </div>
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.betSizePct != null ? `${(r.betSizePct * 100).toFixed(1)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="section-label">Total Bets ({totalBets.length})</div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button className={`mode-btn ${totalsView === "all" ? "mode-btn-active" : ""}`} onClick={() => setTotalsView("all")}>
                All
              </button>
              <button className={`mode-btn ${totalsView === "over" ? "mode-btn-active" : ""}`} onClick={() => setTotalsView("over")}>
                Overs
              </button>
              <button className={`mode-btn ${totalsView === "under" ? "mode-btn-active" : ""}`} onClick={() => setTotalsView("under")}>
                Unders
              </button>
            </div>
          </div>
          {totalBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No total bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Total</th>
                  <th className="th th-right">My Total</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th th-right">Std Dev Off</th>
                </tr>
              </thead>
              <tbody>
                {totalBets.map((r) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTotal)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTotal)}</td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={{ ...cellStyle, fontWeight: 700 }}>
                      {r.call} {fmtTotal(r.vegasTotal)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
            <div className="section-label">Team Total Bets ({teamTotalBets.length})</div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button className={`mode-btn ${teamTotalsView === "all" ? "mode-btn-active" : ""}`} onClick={() => setTeamTotalsView("all")}>
                All
              </button>
              <button className={`mode-btn ${teamTotalsView === "over" ? "mode-btn-active" : ""}`} onClick={() => setTeamTotalsView("over")}>
                Overs
              </button>
              <button className={`mode-btn ${teamTotalsView === "under" ? "mode-btn-active" : ""}`} onClick={() => setTeamTotalsView("under")}>
                Unders
              </button>
            </div>
          </div>
          {teamTotalBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No team total bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th">Opponent</th>
                  <th className="th th-right">Vegas TT</th>
                  <th className="th th-right">My TT</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th th-right">Std Dev Off</th>
                </tr>
              </thead>
              <tbody>
                {teamTotalBets.map((r) => (
                  <tr key={`${r.row.game.id}-${r.team}`}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.team} size={16} /> {r.team}
                    </td>
                    <td style={cellStyle}>{r.isHome ? r.row.game.awayTeam : r.row.game.homeTeam}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTeamTotal)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTeamTotal)}</td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={{ ...cellStyle, fontWeight: 700 }}>
                      {r.call} {fmtTotal(r.vegasTeamTotal)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff?.toFixed(2) ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">Moneyline Bets ({moneylineBets.length})</div>
          {moneylineBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No moneyline bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas ML</th>
                  <th className="th th-right">My ML</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th th-right">EV</th>
                </tr>
              </thead>
              <tbody>
                {moneylineBets.map(({ row: r, myProjScore }) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtMoneyline(r.vegasAwayMoneyline)} / {fmtMoneyline(r.vegasHomeMoneyline)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtMoneyline(r.myAwayMoneyline)} / {fmtMoneyline(r.myHomeMoneyline)}
                    </td>
                    <td style={cellStyle}>{myProjScore ?? "–"}</td>
                    <td style={cellStyle}>
                      <TeamLogo team={r.betSide === "away" ? r.game.away_team : r.game.home_team} size={16} />
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
            {SPREAD_WATCH_MARGIN_SIGMA} sigma of the {SIGMA_THRESHOLD}-sigma NWFB threshold. "Watch for" is rounded to
            the nearest real half-point line that would still clear the threshold, holding your own line fixed.
          </p>
          {spreadWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Line</th>
                  <th className="th th-right">My Line</th>
                  <th className="th">My Proj Score</th>
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
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={cellStyle}>
                      {r.nearFiltered && "Filtered"} {r.nearFiltered && r.nearNwfb && "/"} {r.nearNwfb && "NWFB"}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.nearFiltered && `${fmtSpread(r.vegasLineNeededFiltered)}+ (Filtered)`}
                      {r.nearFiltered && r.nearNwfb && <br />}
                      {r.nearNwfb && `${fmtSpread(r.vegasLineNeededNwfb)}+ (NWFB)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">To Watch — Totals ({totalWatch.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold. "Watch
            for" rounded to the nearest real half-point total that would still clear it.
          </p>
          {totalWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Total</th>
                  <th className="th th-right">My Total</th>
                  <th className="th">My Proj Score</th>
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
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff.toFixed(2)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.stdDevOff > 0 ? `${fmtTotal(r.vegasTotalNeeded)}+ (Over)` : `${fmtTotal(r.vegasTotalNeeded)}- (Under)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">To Watch — Team Totals ({teamTotalWatch.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold. Not
            rounded — "Vegas TT" is your own estimate (Vegas's game total split by Vegas's spread), not a real
            quoted line.
          </p>
          {teamTotalWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th">Opponent</th>
                  <th className="th th-right">Vegas TT</th>
                  <th className="th th-right">My TT</th>
                  <th className="th">My Proj Score</th>
                  <th className="th th-right">Std Dev Off</th>
                  <th className="th th-right">Watch For</th>
                </tr>
              </thead>
              <tbody>
                {teamTotalWatch.map(({ row: r, myProjScore, vegasTtNeeded }) => (
                  <tr key={`${r.row.game.id}-${r.team}`}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.team} size={16} /> {r.team}
                    </td>
                    <td style={cellStyle}>{r.isHome ? r.row.game.awayTeam : r.row.game.homeTeam}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTeamTotal)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTeamTotal)}</td>
                    <td style={cellStyle}>{myProjScore ?? "–"}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff?.toFixed(2) ?? "–"}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {(r.stdDevOff ?? 0) > 0 ? `${fmtTotal(vegasTtNeeded)}+ (Over)` : `${fmtTotal(vegasTtNeeded)}- (Under)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
