import type { GameWithLines } from "./api/gamesLines";
import { pickLine } from "./matchupsCompute";

export interface SplitRecord {
  wins: number;
  losses: number;
  atsWins: number;
  atsLosses: number;
  atsPushes: number;
  overs: number;
  unders: number;
  ouPushes: number;
}

export interface HomeRoadSplits {
  home: SplitRecord;
  away: SplitRecord;
}

function emptyRecord(): SplitRecord {
  return { wins: 0, losses: 0, atsWins: 0, atsLosses: 0, atsPushes: 0, overs: 0, unders: 0, ouPushes: 0 };
}

/**
 * Home/road (ATS + O/U + straight-up) splits for a team, from completed
 * games only. Neutral-site games are excluded from BOTH splits per user
 * decision (not a road game, not a home game). Grading logic (vegasAwaySpread
 * sign convention, cover/push math, over/under math) mirrors computeRow() in
 * matchupsCompute.ts exactly, so results here always agree with the
 * Matchups page.
 */
export function computeHomeRoadSplits(teamName: string, games: GameWithLines[]): HomeRoadSplits {
  const home = emptyRecord();
  const away = emptyRecord();

  for (const g of games) {
    if (!g.completed || g.home_points == null || g.away_points == null) continue;
    if (g.neutral_site) continue;

    const isHome = g.home_team === teamName;
    const isAway = g.away_team === teamName;
    if (!isHome && !isAway) continue;

    const bucket = isHome ? home : away;

    if (g.home_points !== g.away_points) {
      const teamWon = isHome ? g.home_points > g.away_points : g.away_points > g.home_points;
      if (teamWon) bucket.wins++;
      else bucket.losses++;
    }

    const line = pickLine(g.lines);
    const vegasAwaySpread = line?.spread != null ? -line.spread : null;

    if (vegasAwaySpread != null) {
      const actualAwayMargin = g.away_points - g.home_points;
      const coverMargin = actualAwayMargin + vegasAwaySpread;
      const coverTeam: "away" | "home" | "push" = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
      if (coverTeam === "push") bucket.atsPushes++;
      else if ((isHome && coverTeam === "home") || (isAway && coverTeam === "away")) bucket.atsWins++;
      else bucket.atsLosses++;
    }

    if (line?.over_under != null) {
      const actualTotal = g.away_points + g.home_points;
      if (actualTotal > line.over_under) bucket.overs++;
      else if (actualTotal < line.over_under) bucket.unders++;
      else bucket.ouPushes++;
    }
  }

  return { home, away };
}
