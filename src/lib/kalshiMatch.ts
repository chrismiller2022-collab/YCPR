import { matchTeamName } from "./teamNameMatch";
import type { KalshiGame } from "./api/kalshi";
import type { EnrichedGameRow } from "./gameTotalsEngine";

// Kalshi's display names are "School Mascot" (e.g. "Ohio State Buckeyes",
// "Central Washington Wildcats"), while our canonical roster (data/teams.ts,
// via teamNameMatch.ts) is just the school name. Try the string as-is
// first (teamNameMatch already knows plenty of "School Mascot ABBR"
// forms from other sources), then progressively drop trailing words —
// the canonical name is almost always a strict prefix of Kalshi's title.
function matchKalshiTeamName(name: string): string | null {
  let result = matchTeamName(name);
  if (result.matched) return result.matched;

  const words = name.split(" ");
  for (let cut = 1; cut <= 2 && words.length - cut >= 1; cut++) {
    result = matchTeamName(words.slice(0, words.length - cut).join(" "));
    if (result.matched) return result.matched;
  }
  return null;
}

export interface KalshiMatch {
  game: EnrichedGameRow;
  homeProb: number | null; // Kalshi's implied win probability for the HOME team
  awayProb: number | null;
  homeVolume: number;
  awayVolume: number;
}

/**
 * Matches Kalshi's per-game markets onto our own season's games, by team
 * name (fuzzy, via teamNameMatch) plus kickoff date within a few days
 * (guards against name-only matching landing on the wrong instance of a
 * rare same-season rematch). Kalshi games that don't resolve to two
 * matched teams, or don't line up with anything in our own schedule
 * (very common for the small-school games Kalshi lists that we don't
 * track), are silently dropped rather than guessed at.
 */
export function matchKalshiGames(kalshiGames: KalshiGame[], siteGames: EnrichedGameRow[]): KalshiMatch[] {
  const results: KalshiMatch[] = [];
  for (const kg of kalshiGames) {
    const teamAMatch = matchKalshiTeamName(kg.teamA.name);
    const teamBMatch = matchKalshiTeamName(kg.teamB.name);
    if (!teamAMatch || !teamBMatch) continue;

    const kickoffMs = kg.kickoff ? new Date(kg.kickoff).getTime() : null;
    const site = siteGames.find((g) => {
      const teams = new Set([g.game.homeTeam, g.game.awayTeam]);
      if (!teams.has(teamAMatch!) || !teams.has(teamBMatch!)) return false;
      if (kickoffMs == null || !g.game.startDate) return true; // no date to check against — the team-pair match is enough
      const diffDays = Math.abs(new Date(g.game.startDate).getTime() - kickoffMs) / 86400000;
      return diffDays <= 3;
    });
    if (!site) continue;

    const aIsHome = teamAMatch === site.game.homeTeam;
    const home = aIsHome ? kg.teamA : kg.teamB;
    const away = aIsHome ? kg.teamB : kg.teamA;
    const homeProb = aIsHome ? kg.teamAProb : kg.teamBProb;
    const awayProb = aIsHome ? kg.teamBProb : kg.teamAProb;

    results.push({ game: site, homeProb, awayProb, homeVolume: home.volume, awayVolume: away.volume });
  }
  return results;
}
