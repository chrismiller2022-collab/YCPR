// Everything the totals popups show for one game: the live model run, the locked projection if the game is
// frozen, Vegas open and current, std dev off, team totals, key-number context and bets already placed.
import { useEffect, useMemo, useState } from "react";
import {
  TOTALS_KEY_NUMBER_TIERS,
  TOTAL_BET_THRESHOLD_STDDEV,
  applyLockedTotals,
  computeRestDaysByGame,
  computeTotalsKeyNumberStudy,
  poolStdDevForTotal,
  useGameTotalsEngine,
  type EnrichedGameRow,
  type TotalsKeyNumberTally,
} from "./gameTotalsEngine";
import { isFilteredBet, splitTeamTotal } from "./gameTotals";
import { fetchGamesForTotals, type GameForTotals } from "./api/gameTotalsData";
import { fetchGamesWithLines, type GameWithLines } from "./api/gamesLines";
import { useGameProjectionLocks } from "./api/gameProjectionLocks";
import { fetchPlacedBets, type PlacedBetRow } from "./api/placedBets";
import { filterRowsByDivision } from "../pages/GameTotalsAdminPanel";
import { useTotalBreakdown, topDrivers, type TotalBreakdownResult } from "./totalBreakdown";
import type { LeagueAverages } from "./gameTotals";
import type { RidgeFeatureStep } from "./totalModelRidge";

export interface KeyNumberHit {
  key: number;
  tier: number;
  tierLabel: string;
  side: "Under" | "Over"; // which bet the straddle supports (my total on the other side of the key from Vegas)
  thisSeason: TotalsKeyNumberTally | null; // 2026+ live-only study; null when not available
}
export interface NearKey {
  key: number;
  tier: number;
  tierLabel: string;
  distance: number; // the key minus the total (positive = key is above)
}
export interface KeyNumberInfo {
  nearVegas: NearKey[]; // key numbers within 2 points of the Vegas total, nearest first
  nearMine: NearKey[];
  crossed: KeyNumberHit[]; // keys sitting between my total and Vegas's (the study's definition of a straddle)
}

const ALL_KEYS = TOTALS_KEY_NUMBER_TIERS.flatMap((t, i) => t.keys.map((key) => ({ key, tier: i + 1, tierLabel: t.label })));

function nearKeys(total: number | null): NearKey[] {
  if (total == null) return [];
  return ALL_KEYS.filter((k) => Math.abs(k.key - total) <= 2)
    .map((k) => ({ ...k, distance: k.key - total }))
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
}

export function keyNumberInfo(
  myTotal: number | null,
  vegasTotal: number | null,
  study: ReturnType<typeof computeTotalsKeyNumberStudy> | null
): KeyNumberInfo {
  const crossed: KeyNumberHit[] = [];
  if (myTotal != null && vegasTotal != null) {
    for (const k of ALL_KEYS) {
      let side: "Under" | "Over" | null = null;
      if (myTotal <= k.key && vegasTotal > k.key) side = "Under";
      else if (myTotal >= k.key && vegasTotal < k.key) side = "Over";
      if (!side) continue;
      const row = study?.byKey.find((r) => r.key === k.key);
      crossed.push({ ...k, side, thisSeason: row ? (side === "Under" ? row.under : row.over) : null });
    }
  }
  return { nearVegas: nearKeys(vegasTotal), nearMine: nearKeys(myTotal), crossed: crossed.sort((a, b) => a.tier - b.tier) };
}

export interface TotalsPopupData {
  loading: boolean;
  error: string | null;
  row: EnrichedGameRow | null; // engine row for this game (live model; null when it isn't in the synced data)
  game: GameForTotals | null;
  completed: boolean;
  locked: boolean;
  lockedTotal: number | null;
  liveTotal: number | null; // what the model projects today (differs from lockedTotal once inputs move)
  myTotal: number | null; // locked if locked, else live
  myHomeSpread: number | null; // locked spread if locked, else live
  vegasOpen: number | null;
  vegasCurrent: number | null; // the latest synced total (the close once the game has started)
  vegasUsed: number | null; // current if there is one, else the open — what every other page grades against
  amountOff: number | null;
  stdDevOff: number | null;
  poolStd: number;
  call: "Over" | "Under" | null;
  isFiltered: boolean;
  actualTotal: number | null;
  myAwayTT: number | null;
  myHomeTT: number | null;
  vegasAwayTT: number | null;
  vegasHomeTT: number | null;
  homeRest: number;
  awayRest: number;
  breakdown: TotalBreakdownResult | null;
  league: LeagueAverages | null;
  drivers: RidgeFeatureStep[];
  keys: KeyNumberInfo;
  bets: PlacedBetRow[];
}

export function useTotalsPopupData(season: number, week: number, awayTeam: string, homeTeam: string): TotalsPopupData {
  const { rows, loading: engineLoading } = useGameTotalsEngine(season);
  const [lineGames, setLineGames] = useState<GameWithLines[]>([]);
  const [allGames, setAllGames] = useState<GameForTotals[]>([]);
  const [bets, setBets] = useState<PlacedBetRow[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingExtra(true);
    Promise.all([fetchGamesWithLines(season), fetchGamesForTotals(season), fetchPlacedBets(season).catch(() => [] as PlacedBetRow[])])
      .then(([g, gt, b]) => {
        if (cancelled) return;
        setLineGames(g);
        setAllGames(gt);
        setBets(b);
      })
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load"))
      .finally(() => !cancelled && setLoadingExtra(false));
    return () => {
      cancelled = true;
    };
  }, [season]);

  const weekNumbers = useMemo(() => Array.from(new Set(lineGames.map((g) => g.week))), [lineGames]);
  const { locks, loading: locksLoading } = useGameProjectionLocks(season, weekNumbers);

  const lockedTotalByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of lineGames) {
      const v = locks[g.id]?.my_total;
      if (v != null) m.set(`${g.week}|${g.home_team}|${g.away_team}`, v);
    }
    return m;
  }, [lineGames, locks]);

  const restByGame = useMemo(() => computeRestDaysByGame(allGames), [allGames]);
  const rowsWithLocks = useMemo(() => applyLockedTotals(rows, lockedTotalByKey), [rows, lockedTotalByKey]);
  const poolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(rows, "FBS")), [rows]);
  const study = useMemo(() => (season >= 2026 ? computeTotalsKeyNumberStudy(rowsWithLocks) : null), [rowsWithLocks, season]);

  const row = useMemo(() => rows.find((r) => r.game.week === week && r.game.awayTeam === awayTeam && r.game.homeTeam === homeTeam) ?? null, [rows, week, awayTeam, homeTeam]);
  const lineGame = lineGames.find((g) => g.week === week && g.away_team === awayTeam && g.home_team === homeTeam) ?? null;
  const lock = lineGame ? locks[lineGame.id] : undefined;

  const homeRest = row ? restByGame.get(`${row.game.homeTeam}|${row.game.id}`) ?? 7 : 7;
  const awayRest = row ? restByGame.get(`${row.game.awayTeam}|${row.game.id}`) ?? 7 : 7;
  const vegasUsed = row?.odds.vegasTotal ?? null;

  const bd = useTotalBreakdown(
    season,
    useMemo(
      () => (row ? { home: homeTeam, away: awayTeam, marketTotal: vegasUsed, neutral: row.game.neutralSite, homeRest, awayRest } : null),
      [row, homeTeam, awayTeam, vegasUsed, homeRest, awayRest]
    )
  );

  const liveTotal = row?.projection?.projectedTotal ?? null;
  const lockedTotal = lock?.my_total ?? null;
  const locked = lockedTotal != null;
  const myTotal = locked ? lockedTotal : liveTotal;
  const myHomeSpread = lock?.my_away_spread != null ? -lock.my_away_spread : row?.myHomeSpread ?? null;
  const amountOff = myTotal != null && vegasUsed != null ? myTotal - vegasUsed : null;
  const stdDevOff = amountOff != null && poolStd > 0 ? amountOff / poolStd : null;
  const call: "Over" | "Under" | null = amountOff == null || amountOff === 0 ? null : amountOff > 0 ? "Over" : "Under";
  const mySplit = splitTeamTotal(myTotal, myHomeSpread);
  const vegasSplit = splitTeamTotal(vegasUsed, row?.game.homeSpread ?? null);

  const gameBets = useMemo(
    () => bets.filter((b) => b.week === week && b.away_team === awayTeam && b.home_team === homeTeam && (b.bet_type === "total" || b.bet_type === "team_total")),
    [bets, week, awayTeam, homeTeam]
  );

  return {
    loading: engineLoading || loadingExtra || locksLoading || bd.loading,
    error,
    row,
    game: row?.game ?? null,
    completed: !!row?.game.completed,
    locked,
    lockedTotal,
    liveTotal,
    myTotal,
    myHomeSpread,
    vegasOpen: row?.odds.openingTotal ?? null,
    vegasCurrent: row?.odds.closingTotal ?? null,
    vegasUsed,
    amountOff,
    stdDevOff,
    poolStd,
    call,
    isFiltered: isFilteredBet(amountOff, poolStd, TOTAL_BET_THRESHOLD_STDDEV),
    actualTotal: row?.actualTotal ?? null,
    myAwayTT: mySplit.away,
    myHomeTT: mySplit.home,
    vegasAwayTT: vegasSplit.away,
    vegasHomeTT: vegasSplit.home,
    homeRest,
    awayRest,
    breakdown: bd.result,
    league: bd.league,
    drivers: bd.result ? topDrivers(bd.result.breakdown, 3) : [],
    keys: keyNumberInfo(myTotal, vegasUsed, study),
    bets: gameBets,
  };
}
