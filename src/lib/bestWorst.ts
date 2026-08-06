import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor } from "./odds";
import { type GameWithLines } from "./api/gamesLines";

export interface BestWorstCandidate {
  opponent: any;
  oppCurrentRating: number;
  week: number;
  projSpread: number; // this team's own perspective — negative = this team favored
  isCompleted: boolean;
  teamScore: number | null;
  oppScore: number | null;
}

export interface BestWorstResult {
  proj: BestWorstCandidate | null;
  actual: BestWorstCandidate | null;
}

/**
 * Best Win: highest-current-rated opponent this team is projected to beat
 * (proj) / actually beat (actual). Best Loss: highest-current-rated
 * opponent projected/actual lost to (losing to a good team is the "best"
 * kind of loss). Worst Loss: lowest-current-rated opponent
 * projected/actual lost to (losing to a bad team is the "worst" kind).
 *
 * "Current rating" means the opponent's LIVE rating as of right now, not
 * whatever it was the week the game was played.
 */
export function computeBestWorst(
  team: any,
  seasonGames: GameWithLines[],
  liveByTeam: Record<string, any>
): { bestWin: BestWorstResult; bestLoss: BestWorstResult; worstLoss: BestWorstResult } {
  const ratingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;
  const teamCurrentRating = ratingFor(team.team, team.rating);

  const candidates: BestWorstCandidate[] = [];

  for (const g of seasonGames) {
    const isHome = g.home_team === team.team;
    const isAway = g.away_team === team.team;
    if (!isHome && !isAway) continue;

    const oppName = isHome ? g.away_team : g.home_team;
    const opponent = TEAMS_BY_NAME[oppName];
    if (!opponent) continue;

    const oppCurrentRating = ratingFor(oppName, opponent.rating);
    const projSpread = isHome
      ? teamCurrentRating - oppCurrentRating - hfaFor(team.team, liveByTeam)
      : teamCurrentRating - oppCurrentRating + hfaFor(oppName, liveByTeam);

    const isCompleted = !!g.completed && g.home_points != null && g.away_points != null;
    const teamScore = isCompleted ? (isHome ? g.home_points! : g.away_points!) : null;
    const oppScore = isCompleted ? (isHome ? g.away_points! : g.home_points!) : null;

    candidates.push({ opponent, oppCurrentRating, week: g.week, projSpread, isCompleted, teamScore, oppScore });
  }

  function bestOf(list: BestWorstCandidate[], wantLowestRating: boolean): BestWorstCandidate | null {
    if (list.length === 0) return null;
    return list.reduce((best, c) =>
      wantLowestRating
        ? c.oppCurrentRating < best.oppCurrentRating
          ? c
          : best
        : c.oppCurrentRating > best.oppCurrentRating
        ? c
        : best
    );
  }

  const projWins = candidates.filter((c) => c.projSpread < 0);
  const projLosses = candidates.filter((c) => c.projSpread > 0);
  const actualCompleted = candidates.filter((c) => c.isCompleted);
  const actualWins = actualCompleted.filter((c) => (c.teamScore ?? 0) > (c.oppScore ?? 0));
  const actualLosses = actualCompleted.filter((c) => (c.teamScore ?? 0) < (c.oppScore ?? 0));

  return {
    bestWin: { proj: bestOf(projWins, true), actual: bestOf(actualWins, true) },
    bestLoss: { proj: bestOf(projLosses, true), actual: bestOf(actualLosses, true) },
    worstLoss: { proj: bestOf(projLosses, false), actual: bestOf(actualLosses, false) },
  };
}
