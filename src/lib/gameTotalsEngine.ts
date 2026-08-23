import { useEffect, useMemo, useState } from "react";
import { hfaFor } from "./odds";
import { useWeeklyStats } from "./api/weeklyStats";
import {
  fetchTeamSeasonInputs,
  fetchGamesForTotals,
  fetchGameTotalsSettings,
  DEFAULT_GAME_TOTALS_SETTINGS,
  type GameForTotals,
  type GameTotalsSettings,
} from "./api/gameTotalsData";
import {
  computeGameProjection,
  computeEfficiencyInputs,
  computeLeagueAverages,
  resolveGameOdds,
  stdDev,
  determineBetCall,
  isFilteredBet,
  gradeActualTotal,
  gradeBetCall,
  splitTeamTotal,
  DEFAULT_SYSTEM_WEIGHTS,
  type TeamSeasonInputs,
  type EfficiencyInputs,
  type LeagueAverages,
  type GameProjection,
  type GameOdds,
} from "./gameTotals";

export interface EnrichedGameRow {
  game: GameForTotals;
  home: TeamSeasonInputs | null;
  away: TeamSeasonInputs | null;
  homeEfficiencyInputs: EfficiencyInputs | null;
  awayEfficiencyInputs: EfficiencyInputs | null;
  projection: GameProjection | null;
  odds: GameOdds;
  actualTotal: number | null;
  myHomeSpread: number | null;
}

// A saved settings row from before the ground-up rewrite would have
// weights as a [n,n,n,n] tuple (the old 4-system shape) instead of the
// new Record<SystemKey, number> — guard against that so a stale save
// doesn't silently zero out every new system's weight. Weights are no
// longer read by computeGameProjection (single Ridge model now, nothing
// to weight) but the field is kept in saved settings rows for backward
// compatibility rather than migrating every existing row.
function normalizeWeights(weights: unknown): typeof DEFAULT_SYSTEM_WEIGHTS {
  if (!weights || Array.isArray(weights) || typeof weights !== "object") return { ...DEFAULT_SYSTEM_WEIGHTS };
  return { ...DEFAULT_SYSTEM_WEIGHTS, ...(weights as object) };
}

// Rest days before each team's game in this game list — mirrors the
// training pipeline's SQL (LAG(start_date) per team/season), imputing 7
// for a team's first tracked game of the season (no prior game to diff
// against). Keyed by "<team>|<gameId>" since a team's rest before Game A
// isn't the same number as its rest before Game B.
function computeRestDaysByGame(games: GameForTotals[]): Map<string, number> {
  const byTeam = new Map<string, GameForTotals[]>();
  for (const g of games) {
    if (!g.startDate) continue;
    for (const team of [g.homeTeam, g.awayTeam]) {
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team)!.push(g);
    }
  }
  const result = new Map<string, number>();
  for (const [team, teamGames] of byTeam) {
    const sorted = [...teamGames].sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
      const g = sorted[i];
      if (i === 0) {
        result.set(`${team}|${g.id}`, 7);
        continue;
      }
      const days = Math.round((new Date(g.startDate!).getTime() - new Date(sorted[i - 1].startDate!).getTime()) / 86400000);
      result.set(`${team}|${g.id}`, days > 0 ? days : 7);
    }
  }
  return result;
}

export function useGameTotalsEngine(season: number) {
  const [rawRows, setRawRows] = useState<{ teamInputs: Record<string, TeamSeasonInputs>; games: GameForTotals[] } | null>(null);
  const [settings, setSettingsState] = useState<GameTotalsSettings>(DEFAULT_GAME_TOTALS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchTeamSeasonInputs(season), fetchGamesForTotals(season), fetchGameTotalsSettings(season)])
      .then(([teamInputs, games, savedSettings]) => {
        setRawRows({ teamInputs, games });
        if (savedSettings) {
          setSettingsState({ ...DEFAULT_GAME_TOTALS_SETTINGS, ...savedSettings, weights: normalizeWeights(savedSettings.weights) });
        }
      })
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [season]);

  const league: LeagueAverages | null = useMemo(() => {
    if (!rawRows) return null;
    return computeLeagueAverages(Object.values(rawRows.teamInputs));
  }, [rawRows]);

  const restDaysByGame = useMemo(() => (rawRows ? computeRestDaysByGame(rawRows.games) : new Map<string, number>()), [rawRows]);

  const rows: EnrichedGameRow[] = useMemo(() => {
    if (!rawRows || !league) return [];
    return rawRows.games.map((game) => {
      const home = rawRows.teamInputs[game.homeTeam] ?? null;
      const away = rawRows.teamInputs[game.awayTeam] ?? null;
      const odds = resolveGameOdds(game.overUnder, game.openingOverUnder);
      const actualTotal =
        game.completed && game.homePoints != null && game.awayPoints != null ? game.homePoints + game.awayPoints : null;

      const homeRating = liveByTeam[game.homeTeam]?.rating;
      const awayRating = liveByTeam[game.awayTeam]?.rating;
      const myHomeSpread =
        homeRating != null && awayRating != null ? homeRating - awayRating - hfaFor(game.homeTeam, liveByTeam) : null;

      if (!home || !away) {
        return { game, home, away, homeEfficiencyInputs: null, awayEfficiencyInputs: null, projection: null, odds, actualTotal, myHomeSpread };
      }

      const context = {
        homeFlag: game.neutralSite ? 0.5 : 1.0,
        homeRestDays: restDaysByGame.get(`${game.homeTeam}|${game.id}`) ?? 7,
        awayRestDays: restDaysByGame.get(`${game.awayTeam}|${game.id}`) ?? 7,
      };
      const projection = computeGameProjection(home, away, league, odds, context);

      return {
        game,
        home,
        away,
        homeEfficiencyInputs: computeEfficiencyInputs(home, away, league),
        awayEfficiencyInputs: computeEfficiencyInputs(away, home, league),
        projection,
        odds,
        actualTotal,
        myHomeSpread,
      };
    });
  }, [rawRows, league, liveByTeam, settings, restDaysByGame]);

  return { rows, settings, setSettings: setSettingsState, loading, error };
}

// projectedTotal() used to take a CompositeKey and pick from 6 stored
// variants (unweighted/weighted 6-system averages, regressed-toward-
// market, open/close blends). Retired per Chris — one Ridge model, one
// number, nothing to pick between.
function projectedTotal(row: EnrichedGameRow): number | null {
  return row.projection?.projectedTotal ?? null;
}

export function poolStdDevForTotal(rows: EnrichedGameRow[]): number {
  const diffs: number[] = [];
  for (const r of rows) {
    const pv = projectedTotal(r);
    const vegas = r.odds.vegasTotal;
    if (pv != null && vegas != null) diffs.push(pv - vegas);
  }
  return stdDev(diffs);
}

export interface BetRow {
  row: EnrichedGameRow;
  projectedTotal: number | null;
  vegasTotal: number | null;
  amountOff: number | null;
  call: "Over" | "Under" | null;
  isFiltered: boolean;
  actualResult: ReturnType<typeof gradeActualTotal>;
  grade: ReturnType<typeof gradeBetCall>;
}

export function buildBetRows(rows: EnrichedGameRow[], filterThresholdMultiplier: number): BetRow[] {
  const poolStd = poolStdDevForTotal(rows);
  return rows.map((row) => {
    const pv = projectedTotal(row);
    const vegasTotal = row.odds.vegasTotal;
    const { amountOff, call } = determineBetCall(pv, vegasTotal);
    const isFiltered = isFilteredBet(amountOff, poolStd, filterThresholdMultiplier);
    const actualResult = gradeActualTotal(row.actualTotal, vegasTotal);
    const grade = gradeBetCall(call, actualResult);
    return { row, projectedTotal: pv, vegasTotal, amountOff, call, isFiltered, actualResult, grade };
  });
}

export interface TeamSplitBetRow {
  row: EnrichedGameRow;
  team: string;
  isHome: boolean;
  myTeamTotal: number | null; // my model's game total, split via MY projected spread (myHomeSpread)
  vegasTeamTotal: number | null; // Vegas's game total, split via Vegas's own spread — a DERIVED number, since there's no real market team-total line synced
  amountOff: number | null;
  call: "Over" | "Under" | null;
  isFiltered: boolean;
  actualResult: ReturnType<typeof gradeActualTotal>;
  grade: ReturnType<typeof gradeBetCall>;
}

// Per Chris's spec: my team total = my game total split by MY spread
// (myHomeSpread); "Vegas" team total = Vegas's game total split by
// Vegas's own spread (a derived proxy — Vegas doesn't publish real
// per-team totals on this site, so this is what we compare my number
// against). Both spreads are fixed to their own source now — no more
// configurable spreadSource, since there's exactly one correct spread
// for each of the two numbers.
export function buildTeamSplitBetRows(rows: EnrichedGameRow[], filterThresholdMultiplier: number): TeamSplitBetRow[] {
  const perTeamRows: { row: EnrichedGameRow; team: string; isHome: boolean; myTeamTotal: number | null; vegasTeamTotal: number | null }[] =
    [];
  for (const row of rows) {
    const mySplit = splitTeamTotal(projectedTotal(row), row.myHomeSpread ?? 0);
    const vegasSplit = splitTeamTotal(row.odds.vegasTotal, row.game.homeSpread);
    perTeamRows.push({ row, team: row.game.homeTeam, isHome: true, myTeamTotal: mySplit.home, vegasTeamTotal: vegasSplit.home });
    perTeamRows.push({ row, team: row.game.awayTeam, isHome: false, myTeamTotal: mySplit.away, vegasTeamTotal: vegasSplit.away });
  }

  const diffs: number[] = [];
  for (const r of perTeamRows) {
    if (r.myTeamTotal != null && r.vegasTeamTotal != null) diffs.push(r.myTeamTotal - r.vegasTeamTotal);
  }
  const poolStd = stdDev(diffs);

  return perTeamRows.map((r) => {
    const { amountOff, call } = determineBetCall(r.myTeamTotal, r.vegasTeamTotal);
    const isFiltered = isFilteredBet(amountOff, poolStd, filterThresholdMultiplier);
    const actualTeamPoints = r.isHome ? r.row.game.homePoints : r.row.game.awayPoints;
    const actualResult = gradeActualTotal(actualTeamPoints, r.vegasTeamTotal);
    const grade = gradeBetCall(call, actualResult);
    return {
      row: r.row,
      team: r.team,
      isHome: r.isHome,
      myTeamTotal: r.myTeamTotal,
      vegasTeamTotal: r.vegasTeamTotal,
      amountOff,
      call,
      isFiltered,
      actualResult,
      grade,
    };
  });
}
