import { TEAMS, TEAMS_BY_NAME } from "../../data/teams";
import { hfaFor } from "../odds";

export interface SimGame {
  week: number;
  home_team: string;
  away_team: string;
  neutral_site: boolean;
  conference_game: boolean;
  completed: boolean;
  home_points: number | null;
  away_points: number | null;
}

export interface TeamSimResult {
  team: string;
  conf: string;
  currentWins: number;
  currentLosses: number;
  totalGames: number;
  meanWins: number;
  winDistribution: number[]; // index = win count (0..15), value = trial count
  madeConfChampPct: number; // odds to MAKE the conference championship game
  confTitlePct: number; // odds to WIN the conference championship
  playoffPct: number;
  avgSeed: number | null;
  nattyPct: number;
}

export interface SimulationResult {
  teamResults: TeamSimResult[];
  unmatchedTeams: string[];
}

export interface ScheduleRow {
  week: number;
  awayTeam: string;
  homeTeam: string;
  mySpread: number | null;
  randomValue: number | null; // null for already-completed (actual) games
  finalResult: number | null; // away-perspective: negative = away wins by |value|
  winner: string | null;
  loser: string | null;
  margin: number | null; // always positive — the winner's margin
  status: "actual" | "simulated";
}

const MAX_WINS_BUCKET = 15;
const MARGIN_STDDEV = 15.7;
const MARGIN_CLIP = 25;

// ---------------------------------------------------------------------
// Random margin generator — ported directly from the provided script.
// Acklam's algorithm for the inverse of the standard normal CDF, then
// scaled by MARGIN_STDDEV (mean 0) and clipped to +/-MARGIN_CLIP.
// ---------------------------------------------------------------------
function invNorm(p: number): number {
  const a1 = -39.6968302866538,
    a2 = 220.946098424521,
    a3 = -275.928510446969,
    a4 = 138.357751867269,
    a5 = -30.6647980661472,
    a6 = 2.50662827745924;
  const b1 = -54.4760987982241,
    b2 = 161.585836858041,
    b3 = -155.698979859887,
    b4 = 66.8013118877197,
    b5 = -13.2806815528857;
  const c1 = -0.00778489400243029,
    c2 = -0.322396458041136,
    c3 = -2.40075827716184,
    c4 = -2.54973253934373,
    c5 = 4.37466414146497,
    c6 = 2.93816398269878;
  const d1 = 0.00778469570904146,
    d2 = 0.32246712907004,
    d3 = 2.44513413714299,
    d4 = 3.75440866190742;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
      (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
}

export function drawMarginNoise(): number {
  const raw = MARGIN_STDDEV * invNorm(Math.random());
  return Math.max(-MARGIN_CLIP, Math.min(MARGIN_CLIP, raw));
}

// ---------------------------------------------------------------------
// Rating lookup - prefers this week's live upload (weekly_team_stats),
// falls back to the static data/teams.ts snapshot, same pattern already
// used elsewhere on the site (e.g. StrengthOfSchedulePage's sosFor).
// Previously the engine only ever read the static file, which meant it
// never reflected whatever you'd actually uploaded that week.
// ---------------------------------------------------------------------
function ratingFor(teamName: string, liveByTeam: Record<string, any>): number | null {
  const live = liveByTeam?.[teamName]?.rating;
  if (live != null) return live;
  return TEAMS_BY_NAME[teamName]?.rating ?? null;
}

function computeFcsMedianRating(liveByTeam: Record<string, any>): number {
  const ratings = TEAMS.filter((t) => t.div === "FCS")
    .map((t) => ratingFor(t.team, liveByTeam))
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  if (ratings.length === 0) return 0;
  const mid = Math.floor(ratings.length / 2);
  return ratings.length % 2 === 1 ? ratings[mid] : (ratings[mid - 1] + ratings[mid]) / 2;
}

/** Exposed so the UI can show the actual numbers behind the "sub-FCS opponent" fallback. */
export function getSubFcsRatingInfo(liveByTeam: Record<string, any>): { medianFcsRating: number; syntheticRating: number } {
  const medianFcsRating = computeFcsMedianRating(liveByTeam);
  return { medianFcsRating, syntheticRating: medianFcsRating + 28 };
}

/**
 * My Spread for a game, away-perspective (negative = away favored/wins),
 * same convention as the rest of the site. Falls back to a synthetic
 * rating (median FCS rating + 28, i.e. clearly worse) for a side with no
 * rating at all - sub-FCS buy-game opponents - so those games still
 * produce a realistic near-certain-win projection instead of a coin flip
 * or a missing value. Returns null only if NEITHER side has any rating,
 * real or synthetic (shouldn't happen given the sync's division filter).
 */
function computeMySpread(
  game: { home_team: string; away_team: string; neutral_site: boolean },
  liveByTeam: Record<string, any>,
  syntheticSubFcsRating: number
): number | null {
  const homeReal = ratingFor(game.home_team, liveByTeam);
  const awayReal = ratingFor(game.away_team, liveByTeam);
  const homeRating = homeReal ?? (awayReal != null ? syntheticSubFcsRating : null);
  const awayRating = awayReal ?? (homeReal != null ? syntheticSubFcsRating : null);
  if (homeRating == null || awayRating == null) return null;
  return game.neutral_site ? awayRating - homeRating : awayRating - homeRating + hfaFor(game.home_team, liveByTeam);
}

// ---------------------------------------------------------------------
// Single-season schedule generator (for the SRS tab). One realization,
// not an average - every remaining game gets one fresh random draw.
// Already-completed games use the actual result, not a simulated one.
// ---------------------------------------------------------------------
export function simulateSingleSeason(games: SimGame[], liveByTeam: Record<string, any>): ScheduleRow[] {
  const syntheticSubFcsRating = computeFcsMedianRating(liveByTeam) + 28;

  return games.map((g) => {
    if (g.completed && g.home_points != null && g.away_points != null) {
      const finalResult = g.home_points - g.away_points; // negative = away won by that much
      const winner = finalResult < 0 ? g.away_team : g.home_team;
      const loser = finalResult < 0 ? g.home_team : g.away_team;
      const margin = Math.abs(finalResult);
      return {
        week: g.week,
        awayTeam: g.away_team,
        homeTeam: g.home_team,
        mySpread: computeMySpread(g, liveByTeam, syntheticSubFcsRating),
        randomValue: null,
        finalResult,
        winner,
        loser,
        margin,
        status: "actual" as const,
      };
    }

    const mySpread = computeMySpread(g, liveByTeam, syntheticSubFcsRating);
    const randomValue = drawMarginNoise();
    const finalResult = (mySpread ?? 0) + randomValue;
    const winner = finalResult < 0 ? g.away_team : g.home_team;
    const loser = finalResult < 0 ? g.home_team : g.away_team;
    const margin = Math.abs(finalResult);

    return {
      week: g.week,
      awayTeam: g.away_team,
      homeTeam: g.home_team,
      mySpread,
      randomValue,
      finalResult,
      winner,
      loser,
      margin,
      status: "simulated" as const,
    };
  });
}

// ---------------------------------------------------------------------
// Aggregate Monte Carlo - thousands of full-season realizations, tallied.
// ---------------------------------------------------------------------
interface RemainingGame {
  homeIdx: number | null;
  awayIdx: number | null;
  isConf: boolean;
  mySpread: number; // 0 if truly no rating on either side (rare fallback)
}

/**
 * v1 simplifications (by design, not oversight):
 * - Conference tiebreakers (regular season ranking) are straight win% with
 *   a random coin-flip on ties - not each conference's real tiebreaker
 *   rules.
 * - The conference championship game itself IS simulated (top 2 teams by
 *   conference win%, one extra game between them, neutral site) - so the
 *   "win conference" team can differ from the regular-season record
 *   leader, same as real life.
 * - Playoff seeding uses each team's current rating as a stand-in for a
 *   committee ranking - ratings don't evolve mid-simulation based on
 *   simulated results.
 * - Playoff bracket structure (5 auto-bids + 7 at-large, byes to the top
 *   4 conference champions) mirrors the real 12-team CFP format and
 *   reuses this site's existing 12-team bracket shape from BracketPage.tsx.
 */
export function runMonteCarlo(
  games: SimGame[],
  liveByTeam: Record<string, any>,
  numTrials: number
): SimulationResult {
  // Resolved once so every downstream lookup (conference title games,
  // bracket seeding/simulation) uses each team's live weekly rating
  // instead of the frozen preseason snapshot, matching computeMySpread's
  // per-game use of ratingFor below.
  const fbsTeams = TEAMS.filter((t) => t.div === "FBS").map((t) => ({
    ...t,
    rating: ratingFor(t.team, liveByTeam) ?? t.rating,
  }));
  const indexByName = new Map(fbsTeams.map((t, i) => [t.team, i]));
  const n = fbsTeams.length;
  const syntheticSubFcsRating = computeFcsMedianRating(liveByTeam) + 28;

  const baseWins = new Array(n).fill(0);
  const baseLosses = new Array(n).fill(0);
  const baseConfWins = new Array(n).fill(0);
  const baseConfLosses = new Array(n).fill(0);

  const unmatchedTeams = new Set<string>();
  const remaining: RemainingGame[] = [];

  for (const g of games) {
    const homeIdx = indexByName.get(g.home_team) ?? null;
    const awayIdx = indexByName.get(g.away_team) ?? null;
    if (ratingFor(g.home_team, liveByTeam) == null) unmatchedTeams.add(g.home_team);
    if (ratingFor(g.away_team, liveByTeam) == null) unmatchedTeams.add(g.away_team);

    const isConf =
      g.conference_game && homeIdx != null && awayIdx != null && fbsTeams[homeIdx].conf === fbsTeams[awayIdx].conf;

    if (g.completed && g.home_points != null && g.away_points != null) {
      const homeWon = g.home_points > g.away_points;
      if (homeIdx != null) {
        if (homeWon) baseWins[homeIdx]++;
        else baseLosses[homeIdx]++;
        if (isConf) {
          if (homeWon) baseConfWins[homeIdx]++;
          else baseConfLosses[homeIdx]++;
        }
      }
      if (awayIdx != null) {
        if (!homeWon) baseWins[awayIdx]++;
        else baseLosses[awayIdx]++;
        if (isConf) {
          if (!homeWon) baseConfWins[awayIdx]++;
          else baseConfLosses[awayIdx]++;
        }
      }
      continue;
    }

    remaining.push({
      homeIdx,
      awayIdx,
      isConf,
      mySpread: computeMySpread(g, liveByTeam, syntheticSubFcsRating) ?? 0,
    });
  }

  const totalGames = fbsTeams.map(
    (_, i) => baseWins[i] + baseLosses[i] + remaining.filter((g) => g.homeIdx === i || g.awayIdx === i).length
  );

  const confGroups = new Map<string, number[]>();
  fbsTeams.forEach((t, i) => {
    if (t.conf === "FBS Independents") return;
    const list = confGroups.get(t.conf) ?? [];
    list.push(i);
    confGroups.set(t.conf, list);
  });

  const winDistribution: number[][] = Array.from({ length: n }, () => new Array(MAX_WINS_BUCKET + 1).fill(0));
  const madeConfChampCount = new Array(n).fill(0);
  const confTitleCount = new Array(n).fill(0);
  const playoffCount = new Array(n).fill(0);
  const seedSum = new Array(n).fill(0);
  const nattyCount = new Array(n).fill(0);

  for (let trial = 0; trial < numTrials; trial++) {
    const wins = baseWins.slice();
    const losses = baseLosses.slice();
    const confWins = baseConfWins.slice();
    const confLosses = baseConfLosses.slice();

    for (const g of remaining) {
      const finalResult = g.mySpread + drawMarginNoise();
      const awayWins = finalResult < 0;
      if (g.homeIdx != null) {
        if (awayWins) losses[g.homeIdx]++;
        else wins[g.homeIdx]++;
        if (g.isConf) {
          if (awayWins) confLosses[g.homeIdx]++;
          else confWins[g.homeIdx]++;
        }
      }
      if (g.awayIdx != null) {
        if (awayWins) wins[g.awayIdx]++;
        else losses[g.awayIdx]++;
        if (g.isConf) {
          if (awayWins) confWins[g.awayIdx]++;
          else confLosses[g.awayIdx]++;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const bucket = Math.min(wins[i], MAX_WINS_BUCKET);
      winDistribution[i][bucket]++;
    }

    // Conference championship: rank by conf win%, top 2 make the game,
    // then simulate one more (neutral site) game between them.
    const champions: number[] = [];
    for (const [, teamIdxs] of confGroups) {
      const ranked = teamIdxs
        .map((i) => {
          const total = confWins[i] + confLosses[i];
          return { i, pct: total > 0 ? confWins[i] / total : -1 };
        })
        .filter((r) => r.pct >= 0)
        .sort((a, b) => b.pct - a.pct || Math.random() - 0.5);

      if (ranked.length === 0) continue;

      if (ranked.length === 1) {
        madeConfChampCount[ranked[0].i]++;
        confTitleCount[ranked[0].i]++;
        champions.push(ranked[0].i);
        continue;
      }

      const a = ranked[0].i;
      const b = ranked[1].i;
      madeConfChampCount[a]++;
      madeConfChampCount[b]++;

      const champGameSpread = fbsTeams[b].rating - fbsTeams[a].rating; // neutral site
      const champResult = champGameSpread + drawMarginNoise();
      const champ = champResult < 0 ? b : a;
      confTitleCount[champ]++;
      champions.push(champ);
    }

    const byRating = (a: number, b: number) => fbsTeams[a].rating - fbsTeams[b].rating;
    const sortedChamps = [...champions].sort(byRating);
    const autoBids = sortedChamps.slice(0, 5);
    const champSet = new Set(autoBids);

    const atLargePool = fbsTeams
      .map((_, i) => i)
      .filter((i) => !champSet.has(i))
      .sort(byRating)
      .slice(0, 7);

    const byeSeeds = autoBids.slice(0, 4);
    const fifthChamp = autoBids[4];
    const seed5to12 = [...(fifthChamp != null ? [fifthChamp] : []), ...atLargePool].sort(byRating);

    const field = [...byeSeeds, ...seed5to12];
    field.forEach((teamIdx, i) => {
      playoffCount[teamIdx]++;
      seedSum[teamIdx] += i + 1;
    });

    if (field.length === 12) {
      const champIdx = simulateBracket(field, fbsTeams, liveByTeam);
      if (champIdx != null) nattyCount[champIdx]++;
    }
  }

  const teamResults: TeamSimResult[] = fbsTeams.map((t, i) => {
    const winsSum = winDistribution[i].reduce((sum, count, wins) => sum + count * wins, 0);
    return {
      team: t.team,
      conf: t.conf,
      currentWins: baseWins[i],
      currentLosses: baseLosses[i],
      totalGames: totalGames[i],
      meanWins: winsSum / numTrials,
      winDistribution: winDistribution[i],
      madeConfChampPct: (madeConfChampCount[i] / numTrials) * 100,
      confTitlePct: (confTitleCount[i] / numTrials) * 100,
      playoffPct: (playoffCount[i] / numTrials) * 100,
      avgSeed: playoffCount[i] > 0 ? seedSum[i] / playoffCount[i] : null,
      nattyPct: (nattyCount[i] / numTrials) * 100,
    };
  });

  return { teamResults, unmatchedTeams: Array.from(unmatchedTeams) };
}

// Mirrors BracketPage.tsx's fixed 12-team CFP bracket shape: round 1 is
// seeds 5-8 hosting 9-12; quarterfinals are neutral-site, each top-4 seed
// facing the corresponding round-1 winner; semis and championship are
// also neutral. Uses the same margin-simulation method as everything else.
function simulateBracket(field: number[], fbsTeams: any[], liveByTeam: Record<string, any>): number | null {
  function playGame(aIdx: number, bIdx: number, hostIdx: number | null): number {
    const a = fbsTeams[aIdx];
    const b = fbsTeams[bIdx];
    const awayIsB = hostIdx === aIdx || hostIdx == null;
    const spread =
      hostIdx === aIdx
        ? b.rating - a.rating + hfaFor(a.team, liveByTeam)
        : hostIdx === bIdx
        ? a.rating - b.rating + hfaFor(b.team, liveByTeam)
        : b.rating - a.rating;
    const finalResult = spread + drawMarginNoise();
    const awayWins = finalResult < 0;
    if (awayIsB) return awayWins ? bIdx : aIdx;
    return awayWins ? aIdx : bIdx;
  }

  const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12] = field;

  const r1_8v9 = playGame(s8, s9, s8);
  const r1_5v12 = playGame(s5, s12, s5);
  const r1_6v11 = playGame(s6, s11, s6);
  const r1_7v10 = playGame(s7, s10, s7);

  const qf1 = playGame(s1, r1_8v9, null);
  const qf2 = playGame(s2, r1_5v12, null);
  const qf3 = playGame(s3, r1_6v11, null);
  const qf4 = playGame(s4, r1_7v10, null);

  const sf1 = playGame(qf1, qf4, null);
  const sf2 = playGame(qf2, qf3, null);

  return playGame(sf1, sf2, null);
}
