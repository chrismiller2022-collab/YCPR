import { useEffect, useMemo, useState } from "react";
import { fetchGamesWithLines, type GameWithLines } from "./api/gamesLines";
import { computeRow } from "./matchupsCompute";
import { useWeekAccurateRatings } from "./weekAccurateRatings";
import { useGameProjectionLocks } from "./api/gameProjectionLocks";
import { DEFAULT_CUSTOM_PARAMS } from "./betHistory";

// ---------------------------------------------------------------------
// Shared handicapping data for a matchup popup — situational spots
// (lookahead/sandwich/letdown), rest, and home/away + favorite/dog
// splits for both teams. Built once here so any page that shows a
// matchup (pool tools, Matchups, Team Page, ...) can pop the same
// popup with just {season, week, awayTeam, homeTeam}.
//
// Conventions carried over from the rest of the site:
// - Power ratings: lower/more negative = better team.
// - "Team's own-perspective spread": negative = that team favored,
//   positive = that team an underdog getting that many points. Vegas
//   spreads come from BettingLineRow.spread, which is raw/home-
//   perspective (negative = home favored) — see matchupsCompute.ts's
//   own doc comment for why the site-wide away-perspective flip is
//   `-line.spread`.
// - "Cover margin" = actualMargin(team) + teamSpread(team); positive
//   means that team covered, negative means the opponent covered, 0 is
//   a push — same formula used by actualCoverSide() throughout the
//   pool libraries.
// ---------------------------------------------------------------------

export interface TeamGameLogRow {
  gameId: string;
  week: number;
  startDate: string | null;
  opponent: string;
  isHome: boolean;
  completed: boolean;
  teamPoints: number | null;
  oppPoints: number | null;
  vegasSpreadForTeam: number | null; // this team's own-perspective Vegas spread; null if no line synced
  myProjSpreadForTeam: number | null; // this team's own-perspective model spread (locked value preferred for past weeks)
  oppRating: number | null; // opponent's power rating for that week (lower = better)
  suResult: "win" | "loss" | null;
  atsResult: "win" | "loss" | "push" | null; // graded against vegasSpreadForTeam
  atsMargin: number | null; // cover margin, signed — positive means covered by that many points
}

export interface RecordSplit {
  su: { w: number; l: number };
  ats: { w: number; l: number; p: number };
  avgAtsMargin: number | null;
}

export interface RestInfo {
  byeLastWeek: boolean;
  daysOfRest: number | null;
}

export interface SituationalSpots {
  lookahead: boolean;
  sandwich: boolean;
  letdown: boolean;
  letdownBadBeat: boolean; // true when the letdown is specifically the "bad beat last week" trigger, not just a tougher-previous-opponent
  nextOpponent: string | null;
  prevOpponent: string | null;
}

export interface TeamHandicap {
  team: string;
  log: TeamGameLogRow[];
  rest: RestInfo;
  homeAway: RecordSplit; // this team's record in the role (home/away) it has in the current game
  favoriteDog: RecordSplit | null; // this team's record in the role (favorite/dog) it has in the current game, null if the current game has no favorite/dog side (pick'em or no line/projection at all)
  spots: SituationalSpots;
}

export interface MatchupHandicap {
  season: number;
  week: number;
  awayTeam: string;
  homeTeam: string;
  away: TeamHandicap;
  home: TeamHandicap;
  favoriteTeam: string | null; // by Vegas line if one exists, else by our own projection
  loading: boolean;
  error: string | null;
}

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];
function pickLine(lines: GameWithLines["lines"]) {
  if (lines.length === 0) return null;
  for (const p of PREFERRED_PROVIDERS) {
    const m = lines.find((l) => l.provider === p);
    if (m) return m;
  }
  return lines[0];
}

function teamSpreadFrom(rawHomeSpread: number | null, isHome: boolean): number | null {
  if (rawHomeSpread == null) return null;
  return isHome ? rawHomeSpread : -rawHomeSpread;
}

function gradeAts(teamMargin: number | null, teamSpread: number | null): { result: "win" | "loss" | "push" | null; margin: number | null } {
  if (teamMargin == null || teamSpread == null) return { result: null, margin: null };
  const coverMargin = teamMargin + teamSpread;
  if (coverMargin > 0) return { result: "win", margin: coverMargin };
  if (coverMargin < 0) return { result: "loss", margin: coverMargin };
  return { result: "push", margin: 0 };
}

/** Every game (played or scheduled) for one team, in a season, richest-known spread/rating context per game. */
function buildTeamGameLog(
  allGames: GameWithLines[],
  team: string,
  ratingsByWeek: Record<number, Record<string, any>>,
  locksByGameId: Record<string, { my_away_spread: number | null; my_away_win_pct: number | null } | undefined>
): TeamGameLogRow[] {
  const teamGames = allGames.filter((g) => g.home_team === team || g.away_team === team).sort((a, b) => a.week - b.week);

  return teamGames.map((g) => {
    const isHome = g.home_team === team;
    const opponent = isHome ? g.away_team : g.home_team;
    const teamPoints = isHome ? g.home_points : g.away_points;
    const oppPoints = isHome ? g.away_points : g.home_points;

    const bestLine = pickLine(g.lines);
    const vegasSpreadForTeam = teamSpreadFrom(bestLine?.spread ?? null, isHome);

    const lock = locksByGameId[g.id];
    const computed = computeRow(
      g,
      ratingsByWeek[g.week] ?? {},
      "team",
      DEFAULT_CUSTOM_PARAMS,
      lock ? { myAwaySpread: lock.my_away_spread, myAwayWinPct: lock.my_away_win_pct } : null
    );
    const myProjSpreadForTeam = computed.projAwaySpread != null ? (isHome ? -computed.projAwaySpread : computed.projAwaySpread) : null;

    const oppRating = ratingsByWeek[g.week]?.[opponent]?.rating ?? null;

    const teamMargin = teamPoints != null && oppPoints != null ? teamPoints - oppPoints : null;
    const suResult: "win" | "loss" | null = teamMargin == null ? null : teamMargin > 0 ? "win" : teamMargin < 0 ? "loss" : null;
    const { result: atsResult, margin: atsMargin } = g.completed ? gradeAts(teamMargin, vegasSpreadForTeam) : { result: null, margin: null };

    return {
      gameId: g.id,
      week: g.week,
      startDate: g.start_date,
      opponent,
      isHome,
      completed: g.completed === true,
      teamPoints,
      oppPoints,
      vegasSpreadForTeam,
      myProjSpreadForTeam,
      oppRating,
      suResult,
      atsResult,
      atsMargin,
    };
  });
}

function computeRecordSplit(log: TeamGameLogRow[], week: number, pred: (r: TeamGameLogRow) => boolean): RecordSplit {
  const rows = log.filter((r) => r.completed && r.week < week && pred(r));
  let suW = 0,
    suL = 0,
    atsW = 0,
    atsL = 0,
    atsP = 0,
    marginSum = 0,
    marginCount = 0;
  for (const r of rows) {
    if (r.suResult === "win") suW++;
    else if (r.suResult === "loss") suL++;
    if (r.atsResult === "win") atsW++;
    else if (r.atsResult === "loss") atsL++;
    else if (r.atsResult === "push") atsP++;
    if (r.atsMargin != null) {
      marginSum += r.atsMargin;
      marginCount++;
    }
  }
  return { su: { w: suW, l: suL }, ats: { w: atsW, l: atsL, p: atsP }, avgAtsMargin: marginCount > 0 ? marginSum / marginCount : null };
}

function computeRestInfo(log: TeamGameLogRow[], week: number): RestInfo {
  const current = log.find((r) => r.week === week);
  const priorGames = log.filter((r) => r.week < week && r.completed).sort((a, b) => b.week - a.week);
  const lastGame = priorGames[0] ?? null;
  const byeLastWeek = lastGame != null && lastGame.week < week - 1;
  let daysOfRest: number | null = null;
  if (lastGame?.startDate && current?.startDate) {
    daysOfRest = Math.round((new Date(current.startDate).getTime() - new Date(lastGame.startDate).getTime()) / 86400000);
  }
  return { byeLastWeek, daysOfRest };
}

// "Tougher than this week" — a better-rated opponent (lower rating) or a
// closer projected game (smaller absolute spread) than the current
// matchup, or both.
function isTougherThanCurrent(
  candidateOppRating: number | null,
  candidateAbsSpread: number | null,
  currentOppRating: number | null,
  currentAbsSpread: number | null
): boolean {
  const betterRated = candidateOppRating != null && currentOppRating != null && candidateOppRating < currentOppRating;
  const closerSpread = candidateAbsSpread != null && currentAbsSpread != null && candidateAbsSpread < currentAbsSpread;
  return betterRated || closerSpread;
}

// Per Chris: a "bad beat" letdown spot — last week they were either a
// 15+ underdog who covered but lost outright by 3 or less, or a 10+
// underdog who won outright. Either is exactly the kind of emotional,
// high-variance result that sets up a flat follow-up performance.
function isBadBeatLetdown(prevGame: TeamGameLogRow | undefined): boolean {
  if (!prevGame || !prevGame.completed || prevGame.vegasSpreadForTeam == null) return false;
  const dogPoints = prevGame.vegasSpreadForTeam;
  if (dogPoints <= 0) return false; // must have been an underdog
  const suMargin = prevGame.teamPoints != null && prevGame.oppPoints != null ? prevGame.teamPoints - prevGame.oppPoints : null;
  if (suMargin == null) return false;
  if (dogPoints >= 15 && prevGame.atsResult === "win" && suMargin < 0 && Math.abs(suMargin) <= 3) return true;
  if (dogPoints >= 10 && suMargin > 0) return true;
  return false;
}

function computeSituationalSpots(log: TeamGameLogRow[], week: number): SituationalSpots {
  const current = log.find((r) => r.week === week);
  const prevGame = log.find((r) => r.week === week - 1);
  const nextGame = log.find((r) => r.week === week + 1);

  const currentOppRating = current?.oppRating ?? null;
  const currentAbsSpread = current?.myProjSpreadForTeam != null ? Math.abs(current.myProjSpreadForTeam) : null;

  const nextAbsSpread = nextGame?.myProjSpreadForTeam != null ? Math.abs(nextGame.myProjSpreadForTeam) : null;
  const prevAbsSpread = prevGame?.myProjSpreadForTeam != null ? Math.abs(prevGame.myProjSpreadForTeam) : null;

  const lookahead = nextGame != null && isTougherThanCurrent(nextGame.oppRating, nextAbsSpread, currentOppRating, currentAbsSpread);
  const letdownBackward = prevGame != null && isTougherThanCurrent(prevGame.oppRating, prevAbsSpread, currentOppRating, currentAbsSpread);
  const letdownBadBeat = isBadBeatLetdown(prevGame);

  return {
    lookahead,
    sandwich: lookahead && letdownBackward,
    letdown: letdownBackward || letdownBadBeat,
    letdownBadBeat,
    nextOpponent: nextGame?.opponent ?? null,
    prevOpponent: prevGame?.opponent ?? null,
  };
}

function buildTeamHandicap(
  team: string,
  isHomeInCurrentGame: boolean,
  isFavoriteInCurrentGame: boolean | null,
  log: TeamGameLogRow[],
  week: number
): TeamHandicap {
  return {
    team,
    log,
    rest: computeRestInfo(log, week),
    homeAway: computeRecordSplit(log, week, (r) => r.isHome === isHomeInCurrentGame),
    favoriteDog:
      isFavoriteInCurrentGame == null
        ? null
        : computeRecordSplit(log, week, (r) =>
            isFavoriteInCurrentGame ? (r.vegasSpreadForTeam ?? 0) < 0 : (r.vegasSpreadForTeam ?? 0) > 0
          ),
    spots: computeSituationalSpots(log, week),
  };
}

export function useMatchupHandicap(season: number, week: number, awayTeam: string, homeTeam: string): MatchupHandicap {
  const [allGames, setAllGames] = useState<GameWithLines[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingGames(true);
    setError(null);
    fetchGamesWithLines(season)
      .then((rows) => {
        if (!cancelled) setAllGames(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load games");
      })
      .finally(() => {
        if (!cancelled) setLoadingGames(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const weekNumbers = useMemo(() => Array.from(new Set(allGames.map((g) => g.week))), [allGames]);
  const { byWeek: ratingsByWeek, loading: ratingsLoading } = useWeekAccurateRatings(season, weekNumbers, season);
  const { locks, loading: locksLoading } = useGameProjectionLocks(season, weekNumbers);

  return useMemo(() => {
    const loading = loadingGames || ratingsLoading || locksLoading;
    if (loading || allGames.length === 0) {
      const empty: TeamHandicap = {
        team: "",
        log: [],
        rest: { byeLastWeek: false, daysOfRest: null },
        homeAway: { su: { w: 0, l: 0 }, ats: { w: 0, l: 0, p: 0 }, avgAtsMargin: null },
        favoriteDog: null,
        spots: { lookahead: false, sandwich: false, letdown: false, letdownBadBeat: false, nextOpponent: null, prevOpponent: null },
      };
      return {
        season,
        week,
        awayTeam,
        homeTeam,
        away: { ...empty, team: awayTeam },
        home: { ...empty, team: homeTeam },
        favoriteTeam: null,
        loading,
        error,
      };
    }

    const awayLog = buildTeamGameLog(allGames, awayTeam, ratingsByWeek, locks);
    const homeLog = buildTeamGameLog(allGames, homeTeam, ratingsByWeek, locks);

    const currentAwayRow = awayLog.find((r) => r.week === week);
    // Favorite/dog for THIS game — Vegas line first, our own projection if no line has synced yet.
    let favoriteTeam: string | null = null;
    if (currentAwayRow?.vegasSpreadForTeam != null && currentAwayRow.vegasSpreadForTeam !== 0) {
      favoriteTeam = currentAwayRow.vegasSpreadForTeam < 0 ? awayTeam : homeTeam;
    } else if (currentAwayRow?.myProjSpreadForTeam != null && currentAwayRow.myProjSpreadForTeam !== 0) {
      favoriteTeam = currentAwayRow.myProjSpreadForTeam < 0 ? awayTeam : homeTeam;
    }
    const awayIsFavorite = favoriteTeam == null ? null : favoriteTeam === awayTeam;
    const homeIsFavorite = favoriteTeam == null ? null : favoriteTeam === homeTeam;

    return {
      season,
      week,
      awayTeam,
      homeTeam,
      away: buildTeamHandicap(awayTeam, false, awayIsFavorite, awayLog, week),
      home: buildTeamHandicap(homeTeam, true, homeIsFavorite, homeLog, week),
      favoriteTeam,
      loading: false,
      error,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames, ratingsByWeek, locks, loadingGames, ratingsLoading, locksLoading, season, week, awayTeam, homeTeam, error]);
}
