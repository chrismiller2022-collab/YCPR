import { TEAMS, TEAMS_BY_NAME } from "../../data/teams";
import { hfaFor, spreadToWinPct } from "../odds";

export interface SimGame {
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
  meanWins: number;
  winDistribution: number[]; // index = win count (0..15), value = trial count
  confTitlePct: number;
  playoffPct: number;
  avgSeed: number | null;
  nattyPct: number;
}

export interface SimulationResult {
  teamResults: TeamSimResult[];
  unmatchedTeams: string[];
}

const MAX_WINS_BUCKET = 15;

interface RemainingGame {
  homeIdx: number | null; // index into fbsTeams, or null if not a tracked FBS team
  awayIdx: number | null;
  isConf: boolean;
  awayWinProb: number; // precomputed once — ratings don't change trial to trial
}

/**
 * Runs `numTrials` full-season simulations and returns per-FBS-team
 * aggregate results. Only FBS teams are tracked for win totals, conference
 * titles, and playoff/natty odds — games against FCS/other opponents
 * still count toward an FBS team's simulated record, they just don't
 * produce a tracked result for the other side.
 *
 * v1 simplifications (by design, not oversight):
 * - Conference tiebreakers are a straight win% comparison with a random
 *   coin-flip on ties — not each conference's real tiebreaker rules.
 * - Playoff seeding uses each team's current (static) power rating as a
 *   stand-in for a committee ranking — ratings don't evolve mid-simulation.
 * - Playoff bracket structure (5 auto-bids + 7 at-large, byes to the top 4
 *   conference champions) mirrors the real 12-team CFP format and reuses
 *   this site's existing 12-team bracket shape from BracketPage.tsx.
 */
export function runMonteCarlo(
  games: SimGame[],
  liveByTeam: Record<string, any>,
  numTrials: number
): SimulationResult {
  const fbsTeams = TEAMS.filter((t) => t.div === "FBS");
  const indexByName = new Map(fbsTeams.map((t, i) => [t.team, i]));
  const n = fbsTeams.length;

  const baseWins = new Array(n).fill(0);
  const baseLosses = new Array(n).fill(0);
  const baseConfWins = new Array(n).fill(0);
  const baseConfLosses = new Array(n).fill(0);

  const unmatchedTeams = new Set<string>();
  const remaining: RemainingGame[] = [];

  for (const g of games) {
    const homeIdx = indexByName.get(g.home_team) ?? null;
    const awayIdx = indexByName.get(g.away_team) ?? null;
    const homeRatingTeam = TEAMS_BY_NAME[g.home_team];
    const awayRatingTeam = TEAMS_BY_NAME[g.away_team];

    if (!homeRatingTeam) unmatchedTeams.add(g.home_team);
    if (!awayRatingTeam) unmatchedTeams.add(g.away_team);

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

    // Remaining (not yet played) game — precompute win probability once,
    // since ratings are static for the whole simulation.
    let awayWinProb = 0.5;
    if (homeRatingTeam && awayRatingTeam) {
      const awaySpread = g.neutral_site
        ? awayRatingTeam.rating - homeRatingTeam.rating
        : awayRatingTeam.rating - homeRatingTeam.rating + hfaFor(g.home_team, liveByTeam);
      const wp = spreadToWinPct(awaySpread);
      if (wp != null) awayWinProb = wp;
    }

    remaining.push({
      homeIdx,
      awayIdx,
      isConf,
      awayWinProb,
    });
  }

  // Conference groups (FBS only, excluding independents — no title to win there).
  const confGroups = new Map<string, number[]>();
  fbsTeams.forEach((t, i) => {
    if (t.conf === "FBS Independents") return;
    const list = confGroups.get(t.conf) ?? [];
    list.push(i);
    confGroups.set(t.conf, list);
  });

  const winDistribution: number[][] = Array.from({ length: n }, () => new Array(MAX_WINS_BUCKET + 1).fill(0));
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
      const awayWins = Math.random() < g.awayWinProb;
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

    // Conference champions: best conf win% per group, random tiebreak.
    const champions: number[] = [];
    for (const [, teamIdxs] of confGroups) {
      let bestPct = -1;
      let candidates: number[] = [];
      for (const i of teamIdxs) {
        const total = confWins[i] + confLosses[i];
        const pct = total > 0 ? confWins[i] / total : -1;
        if (pct > bestPct) {
          bestPct = pct;
          candidates = [i];
        } else if (pct === bestPct && pct >= 0) {
          candidates.push(i);
        }
      }
      if (candidates.length > 0 && bestPct >= 0) {
        const champ = candidates[Math.floor(Math.random() * candidates.length)];
        champions.push(champ);
        confTitleCount[champ]++;
      }
    }

    // Playoff field: 5 highest-rated conference champions get auto-bids;
    // remaining 7 spots are the next-best teams overall (any FBS team not
    // already selected) by rating. Byes (seeds 1-4) go to the top 4 of
    // the 5 auto-bid champions; the 5th champion drops into the reseeded
    // 5-12 pool alongside the 7 at-large teams.
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

    const field = [...byeSeeds, ...seed5to12]; // index 0 = seed 1, etc.
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
    const totalWins = winDistribution[i].reduce((sum, count, wins) => sum + count * wins, 0);
    return {
      team: t.team,
      conf: t.conf,
      currentWins: baseWins[i],
      currentLosses: baseLosses[i],
      meanWins: totalWins / numTrials,
      winDistribution: winDistribution[i],
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
// also neutral. Unlike BracketPage.tsx (which always picks the favorite),
// this draws a random outcome from the win probability each time.
function simulateBracket(field: number[], fbsTeams: any[], liveByTeam: Record<string, any>): number | null {
  function playGame(aIdx: number, bIdx: number, hostIdx: number | null): number {
    const a = fbsTeams[aIdx];
    const b = fbsTeams[bIdx];
    const awayIsB = hostIdx === aIdx || hostIdx == null;
    const awaySpread =
      hostIdx === aIdx
        ? b.rating - a.rating + hfaFor(a.team, liveByTeam)
        : hostIdx === bIdx
        ? a.rating - b.rating + hfaFor(b.team, liveByTeam)
        : b.rating - a.rating; // neutral, arbitrary "away" = b
    const awayWinProb = spreadToWinPct(awaySpread) ?? 0.5;
    const awayWins = Math.random() < awayWinProb;
    if (awayIsB) return awayWins ? bIdx : aIdx;
    return awayWins ? aIdx : bIdx;
  }

  // field: [seed1..seed12] as team indices
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
