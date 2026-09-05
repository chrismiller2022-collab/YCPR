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

// Pulled out of useGameTotalsEngine so useMultiSeasonGameTotalsEngine
// (Totals History's multi-season selector) can build the same enriched
// rows per season and concatenate, without duplicating this logic.
function computeEnrichedRows(
  games: GameForTotals[],
  teamInputs: Record<string, TeamSeasonInputs>,
  league: LeagueAverages,
  liveByTeam: Record<string, any>,
  restDaysByGame: Map<string, number>
): EnrichedGameRow[] {
  return games.map((game) => {
    const home = teamInputs[game.homeTeam] ?? null;
    const away = teamInputs[game.awayTeam] ?? null;
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
    return computeEnrichedRows(rawRows.games, rawRows.teamInputs, league, liveByTeam, restDaysByGame);
  }, [rawRows, league, liveByTeam, settings, restDaysByGame]);

  return { rows, settings, setSettings: setSettingsState, loading, error };
}

// Totals History's multi-season selector — same shape as
// useGameTotalsEngine ({rows, settings, loading, error}) so consumers
// don't need two code paths, but fetches/computes each season
// independently (league averages and rest-days are season-relative, so
// they can't be computed over a pooled multi-season team-input set) and
// concatenates. Settings come from the first selected season only —
// Totals History doesn't let you edit settings, it just needs SOME
// filterThresholdMultiplier for the isFiltered/performance math, and
// picking one consistent season for that beats an undefined blend.
export function useMultiSeasonGameTotalsEngine(seasons: number[]) {
  // Raw per-season fetch results only — liveByTeam is deliberately NOT a
  // dependency of the fetch effect below. useWeeklyStats's byTeam is a
  // plain object rebuilt every render (not memoized), so making it an
  // effect dependency here would refetch every season's data on every
  // unrelated re-render of whatever renders this hook. It only needs to
  // affect the (cheap, client-side) enrichment step, same as
  // useGameTotalsEngine's own rows useMemo does.
  const [perSeasonRaw, setPerSeasonRaw] = useState<
    { season: number; teamInputs: Record<string, TeamSeasonInputs>; games: GameForTotals[] }[]
  >([]);
  const [settings, setSettings] = useState<GameTotalsSettings>(DEFAULT_GAME_TOTALS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const seasonsKey = Array.from(new Set(seasons)).sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (!seasonsKey) {
      setPerSeasonRaw([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const seasonList = seasonsKey.split(",").map(Number);
    Promise.all(
      seasonList.map((season) =>
        Promise.all([fetchTeamSeasonInputs(season), fetchGamesForTotals(season), fetchGameTotalsSettings(season)]).then(
          ([teamInputs, games, savedSettings]) => ({ season, teamInputs, games, savedSettings })
        )
      )
    )
      .then((perSeason) => {
        if (cancelled) return;
        setPerSeasonRaw(perSeason.map(({ season, teamInputs, games }) => ({ season, teamInputs, games })));
        const savedSettings = perSeason[0]?.savedSettings;
        setSettings(
          savedSettings
            ? { ...DEFAULT_GAME_TOTALS_SETTINGS, ...savedSettings, weights: normalizeWeights(savedSettings.weights) }
            : DEFAULT_GAME_TOTALS_SETTINGS
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonsKey]);

  const rows: EnrichedGameRow[] = useMemo(() => {
    const allRows: EnrichedGameRow[] = [];
    for (const { teamInputs, games } of perSeasonRaw) {
      const league = computeLeagueAverages(Object.values(teamInputs));
      const restDaysByGame = computeRestDaysByGame(games);
      allRows.push(...computeEnrichedRows(games, teamInputs, league, liveByTeam, restDaysByGame));
    }
    return allRows;
  }, [perSeasonRaw, liveByTeam]);

  return { rows, settings, loading, error };
}

// projectedTotal() used to take a CompositeKey and pick from 6 stored
// variants (unweighted/weighted 6-system averages, regressed-toward-
// market, open/close blends). Retired per Chris — one Ridge model, one
// number, nothing to pick between.
function projectedTotal(row: EnrichedGameRow): number | null {
  return row.projection?.projectedTotal ?? null;
}

// Overrides each row's projected total with its locked snapshot value
// (game_projection_locks.my_total), once one exists. Without this the
// model keeps recomputing "My Total" live even for games that have
// already kicked off, unlike spread/win% which computeRow already
// freezes via the same lock table — same integrity guarantee, applied
// to the one number that was missing it. Keyed by week+team names since
// this engine's own game ids are CFBD ids, a different id space than
// game_projection_locks' Vegas-lines game id (see MatchupsPage.tsx for
// the same id-bridging note).
export function applyLockedTotals(rows: EnrichedGameRow[], lockedTotalByKey: Map<string, number>): EnrichedGameRow[] {
  if (lockedTotalByKey.size === 0) return rows;
  return rows.map((row) => {
    if (!row.projection) return row;
    const locked = lockedTotalByKey.get(`${row.game.week}|${row.game.homeTeam}|${row.game.awayTeam}`);
    if (locked == null) return row;
    return { ...row, projection: { ...row.projection, projectedTotal: locked } };
  });
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

// amountOff expressed in standard deviations of the pool's own amount-off
// distribution — the actual number now, not just the isFiltered boolean
// (isFiltered is still derived from this the same way, just exposed as a
// number too since Chris wants "std dev off" on display, not just a
// checkmark).
function stdDevOff(amountOff: number | null, poolStd: number): number | null {
  if (amountOff == null || poolStd === 0) return null;
  return amountOff / poolStd;
}

export interface BetRow {
  row: EnrichedGameRow;
  projectedTotal: number | null;
  vegasTotal: number | null;
  amountOff: number | null;
  stdDevOff: number | null;
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
    return { row, projectedTotal: pv, vegasTotal, amountOff, stdDevOff: stdDevOff(amountOff, poolStd), call, isFiltered, actualResult, grade };
  });
}

export interface TeamSplitBetRow {
  row: EnrichedGameRow;
  team: string;
  isHome: boolean;
  isFavorite: boolean | null; // by MY spread (myHomeSpread) — null if no rating available for either side
  myTeamTotal: number | null; // my model's game total, split via MY projected spread (myHomeSpread)
  vegasTeamTotal: number | null; // "Projected" Vegas team total — Vegas's game total split by Vegas's own spread. Always computed, since it never depends on a real line existing.
  actualVegasTeamTotal: number | null; // Real market team-total line (team_total_lines / The Odds API's team_totals market), when one was synced for this game+team — not every game/season has one.
  amountOff: number | null; // myTeamTotal vs. the grading line (actualVegasTeamTotal when present, else vegasTeamTotal — see gradingLineFor below)
  stdDevOff: number | null;
  call: "Over" | "Under" | null;
  isFiltered: boolean;
  actualTeamPoints: number | null;
  actualResult: ReturnType<typeof gradeActualTotal>;
  grade: ReturnType<typeof gradeBetCall>;
}

// Which line "the" grading (amountOff/call/isFiltered/grade) is actually
// measured against — real market line first, falling back to the
// synthetic split when none was synced. This is the "still see the old
// grading" behavior per Chris: nothing changes for a game/season with no
// real team_totals line (2024/2025, or any game the book doesn't carry
// it for), it only upgrades to the real line where one exists.
function gradingLineFor(vegasTeamTotal: number | null, actualVegasTeamTotal: number | null): number | null {
  return actualVegasTeamTotal ?? vegasTeamTotal;
}

// Per Chris's spec: my team total = my game total split by MY spread
// (myHomeSpread); "Vegas" team total = Vegas's game total split by
// Vegas's own spread (a derived proxy — Vegas doesn't publish real
// per-team totals on this site, so this is what we compare my number
// against, unless a real line was synced — see gradingLineFor). Both
// spreads are fixed to their own source now — no more configurable
// spreadSource, since there's exactly one correct spread for each number.
export function buildTeamSplitBetRows(
  rows: EnrichedGameRow[],
  filterThresholdMultiplier: number,
  actualVegasTTByKey?: Map<string, number>
): TeamSplitBetRow[] {
  const perTeamRows: {
    row: EnrichedGameRow;
    team: string;
    isHome: boolean;
    isFavorite: boolean | null;
    myTeamTotal: number | null;
    vegasTeamTotal: number | null;
    actualVegasTeamTotal: number | null;
  }[] = [];
  for (const row of rows) {
    const mySplit = splitTeamTotal(projectedTotal(row), row.myHomeSpread ?? 0);
    const vegasSplit = splitTeamTotal(row.odds.vegasTotal, row.game.homeSpread);
    const homeIsFavorite = row.myHomeSpread == null ? null : row.myHomeSpread < 0;
    perTeamRows.push({
      row,
      team: row.game.homeTeam,
      isHome: true,
      isFavorite: homeIsFavorite,
      myTeamTotal: mySplit.home,
      vegasTeamTotal: vegasSplit.home,
      actualVegasTeamTotal: actualVegasTTByKey?.get(`${row.game.week}|${row.game.homeTeam}`) ?? null,
    });
    perTeamRows.push({
      row,
      team: row.game.awayTeam,
      isHome: false,
      isFavorite: homeIsFavorite == null ? null : !homeIsFavorite,
      myTeamTotal: mySplit.away,
      vegasTeamTotal: vegasSplit.away,
      actualVegasTeamTotal: actualVegasTTByKey?.get(`${row.game.week}|${row.game.awayTeam}`) ?? null,
    });
  }

  const diffs: number[] = [];
  for (const r of perTeamRows) {
    const gradingLine = gradingLineFor(r.vegasTeamTotal, r.actualVegasTeamTotal);
    if (r.myTeamTotal != null && gradingLine != null) diffs.push(r.myTeamTotal - gradingLine);
  }
  const poolStd = stdDev(diffs);

  return perTeamRows.map((r) => {
    const gradingLine = gradingLineFor(r.vegasTeamTotal, r.actualVegasTeamTotal);
    const { amountOff, call } = determineBetCall(r.myTeamTotal, gradingLine);
    const isFiltered = isFilteredBet(amountOff, poolStd, filterThresholdMultiplier);
    const actualTeamPoints = r.isHome ? r.row.game.homePoints : r.row.game.awayPoints;
    const actualResult = gradeActualTotal(actualTeamPoints, gradingLine);
    const grade = gradeBetCall(call, actualResult);
    return {
      row: r.row,
      team: r.team,
      isHome: r.isHome,
      isFavorite: r.isFavorite,
      myTeamTotal: r.myTeamTotal,
      vegasTeamTotal: r.vegasTeamTotal,
      actualVegasTeamTotal: r.actualVegasTeamTotal,
      amountOff,
      stdDevOff: stdDevOff(amountOff, poolStd),
      call,
      isFiltered,
      actualTeamPoints,
      actualResult,
      grade,
    };
  });
}

// ---------------------------------------------------------------------
// Performance breakdown — win/loss/push + win% + margin of error (95%
// normal-approx CI half-width), computed separately for the "every bet"
// (EB) pool and the "filtered bets" (FB) pool, for a named segment of
// rows (e.g. "Home", "Favorite Over", "All").
// ---------------------------------------------------------------------
export interface PerfStats {
  wins: number;
  losses: number;
  pushes: number;
  n: number; // wins+losses, excludes pushes — the denominator winPct/moe use
  winPct: number | null;
  marginOfError: number | null; // +/- fraction, e.g. 0.08 = +/-8 pts
}

function computePerfStats(graded: { grade: ReturnType<typeof gradeBetCall> }[]): PerfStats {
  const wins = graded.filter((g) => g.grade === "win").length;
  const losses = graded.filter((g) => g.grade === "loss").length;
  const pushes = graded.filter((g) => g.grade === "push").length;
  const n = wins + losses;
  const winPct = n > 0 ? wins / n : null;
  const marginOfError = n > 0 && winPct != null ? 1.96 * Math.sqrt((winPct * (1 - winPct)) / n) : null;
  return { wins, losses, pushes, n, winPct, marginOfError };
}

export interface PerformanceSegment {
  key: string;
  label: string;
  eb: PerfStats; // every bet — every graded row in this segment
  fb: PerfStats; // filtered bets only — rows where isFiltered is true
}

function segmentStats(rows: { grade: ReturnType<typeof gradeBetCall>; isFiltered: boolean }[], key: string, label: string): PerformanceSegment {
  const graded = rows.filter((r) => r.grade != null);
  return {
    key,
    label,
    eb: computePerfStats(graded),
    fb: computePerfStats(graded.filter((r) => r.isFiltered)),
  };
}

// Game Totals: just Over/Under (a game total isn't home/away or fav/dog
// specific) + All.
export function computeGamePerformanceBreakdown(betRows: BetRow[]): PerformanceSegment[] {
  return [
    segmentStats(betRows, "all", "All"),
    segmentStats(
      betRows.filter((r) => r.call === "Over"),
      "over",
      "Over"
    ),
    segmentStats(
      betRows.filter((r) => r.call === "Under"),
      "under",
      "Under"
    ),
  ];
}

// Team Totals: 6 marginal segments (Home/Away/Favorite/Underdog/Over/
// Under) plus every 3-way combination of Home-or-Away x Favorite-or-
// Underdog x Over-or-Under (8 cells) — "all combinations of those 6" per
// Chris. Rows missing isFavorite (no rating available) are excluded from
// every favorite/underdog-related segment but still count in Home/Away/
// Over/Under/All.
export function computeTeamPerformanceBreakdown(betRows: TeamSplitBetRow[]): PerformanceSegment[] {
  const home = betRows.filter((r) => r.isHome);
  const away = betRows.filter((r) => !r.isHome);
  const fav = betRows.filter((r) => r.isFavorite === true);
  const dog = betRows.filter((r) => r.isFavorite === false);
  const over = betRows.filter((r) => r.call === "Over");
  const under = betRows.filter((r) => r.call === "Under");

  const segments: PerformanceSegment[] = [
    segmentStats(betRows, "all", "All"),
    segmentStats(home, "home", "Home"),
    segmentStats(away, "away", "Away"),
    segmentStats(fav, "favorite", "Favorite"),
    segmentStats(dog, "underdog", "Underdog"),
    segmentStats(over, "over", "Over"),
    segmentStats(under, "under", "Under"),
  ];

  const sidePreds: [(r: TeamSplitBetRow) => boolean, string, string][] = [
    [(r) => r.isHome, "home", "Home"],
    [(r) => !r.isHome, "away", "Away"],
  ];
  const fdPreds: [(r: TeamSplitBetRow) => boolean, string, string][] = [
    [(r) => r.isFavorite === true, "fav", "Favorite"],
    [(r) => r.isFavorite === false, "dog", "Underdog"],
  ];
  const ouPreds: [(r: TeamSplitBetRow) => boolean, string, string][] = [
    [(r) => r.call === "Over", "over", "Over"],
    [(r) => r.call === "Under", "under", "Under"],
  ];

  for (const [sidePred, sideKey, sideLabel] of sidePreds) {
    for (const [fdPred, fdKey, fdLabel] of fdPreds) {
      for (const [ouPred, ouKey, ouLabel] of ouPreds) {
        const combo = betRows.filter((r) => sidePred(r) && fdPred(r) && ouPred(r));
        segments.push(segmentStats(combo, `${sideKey}-${fdKey}-${ouKey}`, `${sideLabel} ${fdLabel} ${ouLabel}`));
      }
    }
  }

  return segments;
}

// ---------------------------------------------------------------------
// Amount-off distribution — buckets |amountOff| into 0.5-point bins from
// 0 up to the largest amount-off actually present in the data, showing
// win% per bucket. Point of this: does a bigger edge (amount off) really
// correlate with a better hit rate, and where's the real cutoff?
// ---------------------------------------------------------------------
export interface AmountOffBucket {
  lo: number;
  hi: number;
  label: string;
  wins: number;
  losses: number;
  n: number;
  winPct: number | null;
}

export type AmountOffMetric = "stdDevOff" | "amountOff";

// stdDevOff is the default per Chris — it normalizes for how spread out
// a given pool's misses typically are, so "0.5 off" means something
// comparable across pools/seasons; raw amountOff (points) stays
// available as the second view since it's still the more literal number
// (and the only one that means anything before there's a pool to derive
// a std dev from).
export function computeAmountOffDistribution(
  rows: { amountOff: number | null; stdDevOff: number | null; grade: ReturnType<typeof gradeBetCall> }[],
  metric: AmountOffMetric = "stdDevOff",
  bucketSize?: number
): AmountOffBucket[] {
  const size = bucketSize ?? (metric === "stdDevOff" ? 0.25 : 0.5);
  const valueOf = (r: (typeof rows)[number]) => (metric === "stdDevOff" ? r.stdDevOff : r.amountOff);
  const graded = rows.filter((r) => valueOf(r) != null && r.grade != null && r.grade !== "push");
  if (graded.length === 0) return [];
  const maxAbs = Math.max(...graded.map((r) => Math.abs(valueOf(r)!)));
  const bucketCount = Math.max(1, Math.ceil(maxAbs / size));
  const digits = metric === "stdDevOff" ? 2 : 1;
  const buckets: AmountOffBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    lo: i * size,
    hi: (i + 1) * size,
    label: `${(i * size).toFixed(digits)}-${((i + 1) * size).toFixed(digits)}`,
    wins: 0,
    losses: 0,
    n: 0,
    winPct: null,
  }));
  for (const r of graded) {
    const abs = Math.abs(valueOf(r)!);
    const idx = Math.min(bucketCount - 1, Math.floor(abs / size));
    const b = buckets[idx];
    b.n++;
    if (r.grade === "win") b.wins++;
    else if (r.grade === "loss") b.losses++;
  }
  for (const b of buckets) {
    b.winPct = b.n > 0 ? b.wins / b.n : null;
  }
  return buckets;
}
