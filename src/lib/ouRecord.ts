import type { GameWithLines } from "./api/gamesLines";
import { pickLine } from "./matchupsCompute";

export interface OuRecord {
  overs: number;
  unders: number;
  pushes: number;
}

/**
 * Over/Under record for a team, from completed games with a Vegas total
 * only. Grading is symmetric — there's no "favorite" side to a total the
 * way there is with ATS, so when a game goes over, BOTH teams get credited
 * with an over on their own record. Calling this once per team (each using
 * its own team name against the same shared games list) naturally produces
 * that; no special-casing needed here.
 *
 * `games` can be a team's own already-filtered schedule or a full season
 * list — either way, games not involving `teamName` are ignored.
 */
export function computeOverUnderRecord(teamName: string, games: GameWithLines[]): OuRecord {
  let overs = 0;
  let unders = 0;
  let pushes = 0;

  for (const g of games) {
    if (g.home_team !== teamName && g.away_team !== teamName) continue;
    if (!g.completed || g.home_points == null || g.away_points == null) continue;

    const line = pickLine(g.lines ?? []);
    if (line?.over_under == null) continue;

    const actualTotal = g.home_points + g.away_points;
    if (actualTotal > line.over_under) overs++;
    else if (actualTotal < line.over_under) unders++;
    else pushes++;
  }

  return { overs, unders, pushes };
}

export function fmtOuRecord(r: OuRecord): string | undefined {
  const gp = r.overs + r.unders + r.pushes;
  if (gp === 0) return undefined;
  return r.pushes > 0 ? `${r.overs}-${r.unders}-${r.pushes}` : `${r.overs}-${r.unders}`;
}
