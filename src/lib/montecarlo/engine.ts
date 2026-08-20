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
  // Regular-season win total only — the conference championship game is
  // NOT included here (by design, not oversight). It's tracked separately
  // via madeConfChampPct/confTitlePct below, since it's an extra 13th game
  // that only some teams even play, not a normal part of every team's win
  // total.
  ci95Low: number; // 95% confidence interval on regular-season win total
  ci95High: number;
  madeConfChampPct: number; // odds to MAKE the conference championship game
  confTitlePct: number; // odds to WIN the conference championship
  playoffPct: number;
  avgSeed: number | null;
  // seedPct[s] = % chance of landing seed (s+1), s = 0..11. Only meaningful
  // for teams with playoffPct > 0; sums to playoffPct across all 12 slots.
  // Optional because saved runs from before this field existed won't have
  // it — treat missing as "not available for this saved run."
  seedPct?: number[];
  quarterfinalPct?: number; // reached the CFP quarterfinals (bye seeds auto-qualify)
  semifinalPct?: number; // reached the CFP semifinals
  nattyGamePct?: number; // played IN the title game (win or lose) — broader than nattyPct
  nattyPct: number; // WON the title game
}

export interface SimulationResult {
  teamResults: TeamSimResult[];
  unmatchedTeams: string[];
}

// ---------------------------------------------------------------------
// Derived from winDistribution — no new simulation tracking needed, so
// these work for every already-saved run too, not just ones simulated
// after this was added. numTrials must be passed in (it's a run-level
// property, not stored per team).
// ---------------------------------------------------------------------

/** % of trials with at least `n` regular-season wins (e.g. n=6 for bowl eligibility). */
export function winsAtLeastPct(result: TeamSimResult, numTrials: number, n: number): number {
  if (numTrials <= 0) return 0;
  let count = 0;
  for (let w = n; w < result.winDistribution.length; w++) count += result.winDistribution[w] ?? 0;
  return (count / numTrials) * 100;
}

/** % of trials with zero regular-season losses (won every game on the schedule). */
export function undefeatedPct(result: TeamSimResult, numTrials: number): number {
  if (numTrials <= 0) return 0;
  const count = result.winDistribution[result.totalGames] ?? 0;
  return (count / numTrials) * 100;
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

// 95% confidence interval on a win-total distribution — the win count at
// the 2.5th percentile and at the 97.5th percentile of the trials, read
// straight off the same bucketed distribution already being tallied per
// trial (no separate pass needed).
function winTotalCI(winDistribution: number[], numTrials: number): { low: number; high: number } {
  if (numTrials === 0) return { low: 0, high: 0 };
  const lowerP = 0.025;
  const upperP = 0.975;
  let cum = 0;
  let low = 0;
  let high = winDistribution.length - 1;
  let lowSet = false;
  for (let w = 0; w < winDistribution.length; w++) {
    cum += winDistribution[w];
    const frac = cum / numTrials;
    if (!lowSet && frac >= lowerP) {
      low = w;
      lowSet = true;
    }
    if (frac >= upperP) {
      high = w;
      break;
    }
  }
  return { low, high };
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
  // seedCount[i][s] = number of trials team i landed seed (s+1) — a full
  // distribution, not just the average, for the "Playoff Seeds" PM market.
  const seedCount: number[][] = Array.from({ length: n }, () => new Array(12).fill(0));
  const nattyCount = new Array(n).fill(0);
  // Bracket-round tracking (Quarters/Semis/NCG PM markets) — quarterfinalCount
  // includes the 4 bye seeds (automatic quarterfinalists) plus the 4 first-
  // round winners; semifinalCount the 4 quarterfinal winners; ncgCount the 2
  // semifinal winners (i.e. played FOR the title, win or lose — nattyCount
  // above is the narrower "won it" count).
  const quarterfinalCount = new Array(n).fill(0);
  const semifinalCount = new Array(n).fill(0);
  const ncgCount = new Array(n).fill(0);

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
      seedCount[teamIdx][i]++;
    });

    if (field.length === 12) {
      const bracket = simulateBracket(field, fbsTeams, liveByTeam);
      for (const idx of bracket.quarterfinalists) quarterfinalCount[idx]++;
      for (const idx of bracket.semifinalists) semifinalCount[idx]++;
      for (const idx of bracket.ncgParticipants) ncgCount[idx]++;
      if (bracket.champion != null) nattyCount[bracket.champion]++;
    }
  }

  const teamResults: TeamSimResult[] = fbsTeams.map((t, i) => {
    const winsSum = winDistribution[i].reduce((sum, count, wins) => sum + count * wins, 0);
    const ci = winTotalCI(winDistribution[i], numTrials);
    return {
      team: t.team,
      conf: t.conf,
      currentWins: baseWins[i],
      currentLosses: baseLosses[i],
      totalGames: totalGames[i],
      meanWins: winsSum / numTrials,
      winDistribution: winDistribution[i],
      ci95Low: ci.low,
      ci95High: ci.high,
      madeConfChampPct: (madeConfChampCount[i] / numTrials) * 100,
      confTitlePct: (confTitleCount[i] / numTrials) * 100,
      playoffPct: (playoffCount[i] / numTrials) * 100,
      avgSeed: playoffCount[i] > 0 ? seedSum[i] / playoffCount[i] : null,
      seedPct: seedCount[i].map((c) => (c / numTrials) * 100),
      quarterfinalPct: (quarterfinalCount[i] / numTrials) * 100,
      semifinalPct: (semifinalCount[i] / numTrials) * 100,
      nattyGamePct: (ncgCount[i] / numTrials) * 100,
      nattyPct: (nattyCount[i] / numTrials) * 100,
    };
  });

  return { teamResults, unmatchedTeams: Array.from(unmatchedTeams) };
}

// ---------------------------------------------------------------------
// SRS (Simple Rating System) — the site owner's own spreadsheet method,
// built on top of a single simulated-season realization (simulateSingleSeason
// above). Unlike the power ratings elsewhere on this site, HIGHER is
// better here — that's the standard SRS convention, and matches the
// spreadsheet this was ported from.
//
// Computed in passes, each strictly using only values already finalized
// by an earlier pass — nothing here is circular:
//   Pass 1: per-team Wins/Losses/WinMOV/LoseMOV/Total MOV, straight off
//           that team's own simulated results.
//   Pass 2: per-team SOS — for each of a team's wins, add the *opponent's*
//           own LoseMOV (pass 1); for each loss, add the opponent's own
//           WinMOV (pass 1). SRS = SOS + Total MOV, minus 21 for FCS teams
//           (keeps FCS SRS on a comparable numeric scale to FBS).
//   Pass 3: rank every team by SRS, separately within FBS and within FCS.
// ---------------------------------------------------------------------
export interface SrsTeamRow {
  team: string;
  conf: string;
  div: "FBS" | "FCS";
  rating: number; // current power rating (live-preferred), for reference
  wins: number;
  losses: number;
  winMOV: number;
  loseMOV: number;
  totalMOV: number;
  sos: number;
  sosRank: number; // within division, 1 = best (highest SOS)
  srs: number;
  srsRank: number; // within division, 1 = best (highest SRS) — for display
  winBonus: number;
  lossPenalty: number;
  totalWinBonus: number;
  totalLossPenalty: number;
  victoryPoints: number;
  vsrs: number;
  vsrsRank: number; // within division, 1 = best (highest VSRS)
}

// Standard-normal inverse CDF, reusing the same Acklam's-algorithm port
// drawMarginNoise() uses above.
const WIN_BONUS_EPS = 1e-10;

export function computeSrsStats(rows: ScheduleRow[], liveByTeam: Record<string, any>): SrsTeamRow[] {
  interface GameEntry {
    opponent: string;
    isWin: boolean;
    margin: number;
  }
  const gamesByTeam = new Map<string, GameEntry[]>();
  function record(team: string, entry: GameEntry) {
    const list = gamesByTeam.get(team) ?? [];
    list.push(entry);
    gamesByTeam.set(team, list);
  }
  for (const r of rows) {
    if (r.winner == null || r.loser == null || r.margin == null) continue;
    record(r.winner, { opponent: r.loser, isWin: true, margin: r.margin });
    record(r.loser, { opponent: r.winner, isWin: false, margin: r.margin });
  }

  // Pass 1: MOV.
  interface MovAgg {
    wins: number;
    losses: number;
    winMOV: number;
    loseMOV: number;
    totalMOV: number;
  }
  const movByTeam = new Map<string, MovAgg>();
  for (const [team, games] of gamesByTeam) {
    let wins = 0,
      losses = 0,
      winMOV = 0,
      loseMOV = 0;
    for (const g of games) {
      if (g.isWin) {
        wins++;
        winMOV += g.margin;
      } else {
        losses++;
        loseMOV += g.margin;
      }
    }
    const totalMOV = wins + losses > 0 ? (winMOV - loseMOV) / (wins + losses) : 0;
    movByTeam.set(team, { wins, losses, winMOV, loseMOV, totalMOV });
  }

  // Pass 2: SOS + SRS, only for teams tracked on the site (skips
  // untracked buy-game opponents as output rows, but their MOV values
  // above still get used as inputs to real teams' SOS, same as the
  // spreadsheet).
  const results: SrsTeamRow[] = [];
  for (const [team, games] of gamesByTeam) {
    const staticTeam = TEAMS_BY_NAME[team];
    if (!staticTeam) continue;
    const agg = movByTeam.get(team)!;

    // Uses each opponent's own already-averaged Total MOV (not their raw
    // multi-game summed WinMOV/LoseMOV) — summing a RAW sum from every one
    // of ~12 opponents (each already a sum across ~5-9 of their own games)
    // compounds into a number roughly games-squared in scale, which swamps
    // Total MOV entirely once added together for SRS. Total MOV is already
    // a single per-team scalar on the same scale as one game's margin, so
    // summing 12 of those and dividing by 12 below keeps SOS and Total MOV
    // on comparable scales, the way an additive SRS = SOS + Total MOV is
    // meant to work.
    let sumLoserMOVforSOS = 0;
    let sumWinnerMOVforSOS = 0;
    for (const g of games) {
      const oppAgg = movByTeam.get(g.opponent);
      if (!oppAgg) continue;
      if (g.isWin) sumLoserMOVforSOS += oppAgg.totalMOV;
      else sumWinnerMOVforSOS += oppAgg.totalMOV;
    }
    const denom = agg.wins + agg.losses;
    const sos = denom > 0 ? (sumLoserMOVforSOS + sumWinnerMOVforSOS) / denom : 0;
    const srs = sos + agg.totalMOV - (staticTeam.div === "FCS" ? 21 : 0);

    results.push({
      team,
      conf: staticTeam.conf,
      div: staticTeam.div,
      rating: ratingFor(team, liveByTeam) ?? staticTeam.rating,
      wins: agg.wins,
      losses: agg.losses,
      winMOV: agg.winMOV,
      loseMOV: agg.loseMOV,
      totalMOV: agg.totalMOV,
      sos,
      sosRank: 0,
      srs,
      srsRank: 0,
      winBonus: 0,
      lossPenalty: 0,
      totalWinBonus: 0,
      totalLossPenalty: 0,
      victoryPoints: 0,
      vsrs: 0,
      vsrsRank: 0,
    });
  }

  // Pass 3: rank within division, higher SRS/SOS = better = rank 1 (the
  // conventional, human-readable convention used everywhere else on the
  // site, e.g. Power Rating Rank, Resume Rank).
  const divisionCounts: Record<"FBS" | "FCS", number> = { FBS: 0, FCS: 0 };
  for (const div of ["FBS", "FCS"] as const) {
    const pool = results.filter((r) => r.div === div);
    divisionCounts[div] = pool.length;
    [...pool].sort((a, b) => b.srs - a.srs).forEach((r, i) => (r.srsRank = i + 1));
    [...pool].sort((a, b) => b.sos - a.sos).forEach((r, i) => (r.sosRank = i + 1));
  }

  // Pass 4: Win Bonus / Loss Penalty. This is the spreadsheet's
  // "FO4" formula, confirmed by the site owner to mean each team's own SRS
  // rank, on an ASCENDING scale (1 = worst team in the division, N = best) —
  // the opposite of the descending "SRS Rank" display field above. Convert
  // algebraically rather than re-ranking: ascendingRank = N - srsRank + 1,
  // where srsRank=1 (best, descending) maps to ascendingRank=N (best,
  // ascending), and srsRank=N (worst) maps to ascendingRank=1 (worst).
  // Team-count denominator (N) is computed dynamically from the division's
  // actual roster size, not hardcoded (per "*change 126 to new # of fbs
  // teams" instruction) — currently 138 FBS / 128 FCS, matching the site
  // owner's own numbers.
  const winBonusFor = (r: SrsTeamRow): number => {
    const n = divisionCounts[r.div];
    if (n <= 1) return 0;
    const fo4 = n - r.srsRank + 1; // ascending rank, 1=worst, n=best
    const p = Math.max(WIN_BONUS_EPS, Math.min(1 - WIN_BONUS_EPS, (fo4 - 1) / (n - 1)));
    return invNorm(p) + 3;
  };
  const winBonusByTeam = new Map<string, number>();
  const lossPenaltyByTeam = new Map<string, number>();
  for (const r of results) {
    const wb = winBonusFor(r);
    r.winBonus = wb;
    r.lossPenalty = 6 - wb;
    winBonusByTeam.set(r.team, wb);
    lossPenaltyByTeam.set(r.team, r.lossPenalty);
  }

  // Pass 5: Total Win Bonus (sum of each beaten opponent's own Win Bonus)
  // and Total Loss Penalty (sum of each team-that-beat-you's own Loss
  // Penalty), then Victory Points and VSRS.
  for (const r of results) {
    const games = gamesByTeam.get(r.team) ?? [];
    let totalWinBonus = 0;
    let totalLossPenalty = 0;
    for (const g of games) {
      if (g.isWin) {
        const oppWinBonus = winBonusByTeam.get(g.opponent);
        if (oppWinBonus != null) totalWinBonus += oppWinBonus;
      } else {
        const oppLossPenalty = lossPenaltyByTeam.get(g.opponent);
        if (oppLossPenalty != null) totalLossPenalty += oppLossPenalty;
      }
    }
    r.totalWinBonus = totalWinBonus;
    r.totalLossPenalty = totalLossPenalty;
    r.victoryPoints = totalWinBonus - totalLossPenalty;
    r.vsrs = r.victoryPoints + r.srs;
  }

  // Pass 6: VSRS rank within division, same descending convention as SRS Rank.
  for (const div of ["FBS", "FCS"] as const) {
    const pool = results.filter((r) => r.div === div);
    [...pool].sort((a, b) => b.vsrs - a.vsrs).forEach((r, i) => (r.vsrsRank = i + 1));
  }

  return results;
}

// Mirrors BracketPage.tsx's fixed 12-team CFP bracket shape: round 1 is
// seeds 5-8 hosting 9-12; quarterfinals are neutral-site, each top-4 seed
// facing the corresponding round-1 winner; semis and championship are
// also neutral. Uses the same margin-simulation method as everything else.
export interface BracketResult {
  champion: number | null;
  quarterfinalists: number[]; // 8: the 4 bye seeds + the 4 first-round winners
  semifinalists: number[]; // 4: the quarterfinal winners
  ncgParticipants: number[]; // 2: the semifinal winners (played FOR the title)
}

function simulateBracket(field: number[], fbsTeams: any[], liveByTeam: Record<string, any>): BracketResult {
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

  const quarterfinalists = [s1, s2, s3, s4, r1_8v9, r1_5v12, r1_6v11, r1_7v10];

  const qf1 = playGame(s1, r1_8v9, null);
  const qf2 = playGame(s2, r1_5v12, null);
  const qf3 = playGame(s3, r1_6v11, null);
  const qf4 = playGame(s4, r1_7v10, null);

  const semifinalists = [qf1, qf2, qf3, qf4];

  const sf1 = playGame(qf1, qf4, null);
  const sf2 = playGame(qf2, qf3, null);

  const ncgParticipants = [sf1, sf2];
  const champion = playGame(sf1, sf2, null);

  return { champion, quarterfinalists, semifinalists, ncgParticipants };
}
