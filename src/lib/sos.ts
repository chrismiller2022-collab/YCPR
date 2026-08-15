import { TEAMS_BY_NAME } from "../data/teams";
import type { ConglomeratedRow } from "./ratingConglomerate";
import type { GameWithLines } from "./api/gamesLines";
import type { SeasonGame } from "./api/monteCarlo";
import { simulateSingleSeason, computeSrsStats } from "./montecarlo/engine";

// ---------------------------------------------------------------------
// Shared building blocks for the SOS admin page (and, for the in-conference
// SRS-SOS piece, eventually the Conference Previews column too):
//   - YC per team, pulled from the Rating Systems conglomerated table
//   - a games list restricted to conference-only games (reused for both the
//     "Avg Opp PR" average and the Best/Worst-PR lookups via computeBestWorst)
//   - an SRS-SOS engine that averages many simulated-season realizations
//     instead of relying on one stochastic Monte Carlo SRS tab run
// ---------------------------------------------------------------------

/** Team -> YC power rating (null if the team hasn't been pulled into any source system). */
export function getYcByTeam(rows: ConglomeratedRow[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const r of rows) out[r.team] = r.yc;
  return out;
}

interface ConfGameLike {
  home_team: string;
  away_team: string;
  conference_game: boolean;
}

/**
 * True conference game: CFBD's own conference_game flag AND both sides
 * mapped to the same conference on this site — same test runMonteCarlo()
 * uses for its own isConf check, kept consistent here so "in conference"
 * means the same thing everywhere on the site.
 */
export function isConferenceGame(g: ConfGameLike): boolean {
  const home = TEAMS_BY_NAME[g.home_team];
  const away = TEAMS_BY_NAME[g.away_team];
  return !!g.conference_game && !!home && !!away && home.conf === away.conf;
}

export function conferenceOnly<T extends ConfGameLike>(games: T[]): T[] {
  return games.filter(isConferenceGame);
}

export interface OppPrResult {
  total: number | null;
  conference: number | null;
}

/**
 * Average opponent YC power rating across a team's full schedule (both
 * played and remaining games), and separately across conference-only
 * games. Site convention: lower/negative YC = better, so a lower "Avg Opp
 * PR" number means a tougher schedule.
 */
export function computeAvgOppYc(
  teamName: string,
  games: SeasonGame[],
  ycByTeam: Record<string, number | null | undefined>
): OppPrResult {
  let totalSum = 0,
    totalN = 0,
    confSum = 0,
    confN = 0;

  for (const g of games) {
    const isHome = g.home_team === teamName;
    const isAway = g.away_team === teamName;
    if (!isHome && !isAway) continue;

    const oppName = isHome ? g.away_team : g.home_team;
    const oppYc = ycByTeam[oppName];
    if (oppYc == null) continue;

    totalSum += oppYc;
    totalN++;
    if (isConferenceGame(g)) {
      confSum += oppYc;
      confN++;
    }
  }

  return {
    total: totalN > 0 ? totalSum / totalN : null,
    conference: confN > 0 ? confSum / confN : null,
  };
}

export interface SrsSosRow {
  team: string;
  sosTotal: number | null;
  sosConference: number | null;
}

/**
 * SOS from SRS in Monte Carlo, but stabilized: the SRS tab's SOS number
 * comes from ONE simulated-season realization (it changes every "Re-roll").
 * This runs `numRuns` independent realizations through the exact same
 * engine (simulateSingleSeason + computeSrsStats) and averages each team's
 * SOS across all of them.
 *
 * The in-conference variant does NOT simply average conference opponents'
 * YC — per an explicit product decision, it restricts the INPUT GAMES to
 * conference-only games and reruns the identical SRS winner/loser-MOV
 * algorithm on that subset, so a team's in-conference SOS is purely a
 * function of its own conference games and its conference opponents'
 * (also conference-only) MOV.
 *
 * Computed for every team in one batched pass per run (not one team at a
 * time) — simulateSingleSeason simulates the whole site's schedule
 * regardless of which team you care about, so re-running it per team would
 * be numRuns * numTeams simulations instead of numRuns.
 */
export function computeAveragedSrsSos(
  games: SeasonGame[],
  liveByTeam: Record<string, any>,
  numRuns: number
): Map<string, SrsSosRow> {
  const confGames = conferenceOnly(games);

  const totalSums = new Map<string, number>();
  const totalCounts = new Map<string, number>();
  const confSums = new Map<string, number>();
  const confCounts = new Map<string, number>();

  for (let i = 0; i < numRuns; i++) {
    const rows = simulateSingleSeason(games, liveByTeam);
    for (const r of computeSrsStats(rows, liveByTeam)) {
      totalSums.set(r.team, (totalSums.get(r.team) ?? 0) + r.sos);
      totalCounts.set(r.team, (totalCounts.get(r.team) ?? 0) + 1);
    }

    if (confGames.length > 0) {
      const confRows = simulateSingleSeason(confGames, liveByTeam);
      for (const r of computeSrsStats(confRows, liveByTeam)) {
        confSums.set(r.team, (confSums.get(r.team) ?? 0) + r.sos);
        confCounts.set(r.team, (confCounts.get(r.team) ?? 0) + 1);
      }
    }
  }

  const teams = new Set([...totalSums.keys(), ...confSums.keys()]);
  const out = new Map<string, SrsSosRow>();
  for (const team of teams) {
    const tN = totalCounts.get(team) ?? 0;
    const cN = confCounts.get(team) ?? 0;
    out.set(team, {
      team,
      sosTotal: tN > 0 ? totalSums.get(team)! / tN : null,
      sosConference: cN > 0 ? confSums.get(team)! / cN : null,
    });
  }
  return out;
}

/** Games restricted to a team's own schedule — used to feed computeBestWorst() for the in-conference Best/Worst-PR variant. */
export function gamesForTeamName<T extends { home_team: string; away_team: string }>(
  teamName: string,
  games: T[]
): T[] {
  return games.filter((g) => g.home_team === teamName || g.away_team === teamName);
}

/** Cast helper: GameWithLines already satisfies SeasonGame's shape for the fields computeAvgOppYc/computeAveragedSrsSos need, so a Best/Worst call site can share one games fetch. */
export type { GameWithLines };
