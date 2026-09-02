import { TEAMS, type Team } from "../data/teams";
import { bucketFor } from "./conferenceBuckets";

// ---------------------------------------------------------------------
// Splash Survivor — a fully separate survivor tool from the original
// Survivor pool (survivor.ts), built around a different eligibility
// rule: every FBS team is always a row (no conference filter/toggle),
// and a specific matchup is only excluded if it's Group of 6 vs Group
// of 6, or involves an FCS opponent. Everything generic (week
// schedule, spread/win% math, game/opponent lookups) is imported
// directly from survivor.ts by callers — this file only holds the
// pieces that are genuinely different: who counts as a row, and what
// makes a given matchup eligible.
//
// bucketFor (conferenceBuckets.ts) already special-cases Notre Dame as
// P4 despite its "FBS Independents" conference string (and correctly
// leaves UConn, the other FBS independent, as G6) — see that file's
// comment. That's exactly the ND handling this tool needs, for free,
// with no special-casing required here.
//
// Conference Championship week note (for later, once that week's
// matchups actually exist in games.ts): CCG week should override this
// exclusion entirely — every conference championship game is eligible
// that week, including a Group of 6 title game, not just P4 ones. Not
// implemented yet since there's no Week 14 game data to hang it on.
// ---------------------------------------------------------------------

/** Every FBS team, alphabetical — the fixed row list for this tool (no conference filter). */
export function rowTeams(): Team[] {
  return TEAMS.filter((t) => t.div === "FBS").sort((a, b) => a.team.localeCompare(b.team));
}

/**
 * A game is eligible unless the opponent isn't FBS, or both sides of
 * the matchup are Group of 6 (i.e. neither side is P4 or Notre Dame).
 * Equivalent to "the game has at least one P4(+ND) team," just phrased
 * as an exclusion per Chris's own framing.
 */
export function isGameEligible(team: Team, opp: Team | undefined): boolean {
  if (!opp) return false;
  if (opp.div !== "FBS") return false;
  return !(bucketFor(team.team, team.conf) === "G6" && bucketFor(opp.team, opp.conf) === "G6");
}

export type CellStatus = "bye" | "ineligible" | "team-used" | "week-locked" | "selected" | "open";

export function cellStatus(
  team: Team,
  game: import("../data/games").Game | undefined,
  opp: Team | undefined,
  weekKey: string,
  picks: Record<string, string[]>,
  usedElsewhere: Set<string>
): CellStatus {
  if (!game) return "bye";
  if (!isGameEligible(team, opp)) return "ineligible";

  const weekPicks = picks[weekKey] || [];
  if (weekPicks.includes(team.team)) return "selected";
  if (usedElsewhere.has(team.team)) return "team-used";
  if (weekPicks.length >= 2) return "week-locked";
  return "open";
}

// ---------------------------------------------------------------------
// Spread ranks — same idea and shape as survivor.ts's computeSpreadRanks
// (duplicated rather than imported since the eligibility check differs;
// re-parameterizing the original to accept a predicate would touch code
// the public survivor pages depend on, which is exactly what this tool
// needs to avoid), just driven by isGameEligible instead of
// isOpponentEligible/selectedConfs.
// ---------------------------------------------------------------------
export interface SpreadRank {
  weekRank: number;
  weekPoolSize: number;
  seasonRank: number;
  seasonPoolSize: number;
}

export function computeSpreadRanks(
  teams: Team[],
  weeks: import("./survivor").SurvivorWeek[],
  gameForTeamInWeek: (teamName: string, dataWeek: number) => import("../data/games").Game | undefined,
  opponentOf: (game: import("../data/games").Game, teamName: string) => Team | undefined,
  teamSpread: (team: Team, opp: Team, game: import("../data/games").Game, liveByTeam?: Record<string, any>) => number,
  liveByTeam?: Record<string, any>
): Map<string, SpreadRank> {
  interface Entry {
    team: string;
    weekKey: string;
    spread: number;
  }
  const entries: Entry[] = [];
  for (const team of teams) {
    for (const week of weeks) {
      const game = gameForTeamInWeek(team.team, week.dataWeek);
      if (!game) continue;
      const opp = opponentOf(game, team.team);
      if (!isGameEligible(team, opp)) continue;
      entries.push({ team: team.team, weekKey: week.key, spread: teamSpread(team, opp!, game, liveByTeam) });
    }
  }

  const cellKey = (team: string, weekKey: string) => `${team}::${weekKey}`;

  const byWeek = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byWeek.get(e.weekKey) ?? [];
    list.push(e);
    byWeek.set(e.weekKey, list);
  }
  const weekRankOf = new Map<string, number>();
  const weekPoolSizeOf = new Map<string, number>();
  for (const [weekKey, list] of byWeek) {
    const sorted = [...list].sort((a, b) => a.spread - b.spread);
    sorted.forEach((e, i) => weekRankOf.set(cellKey(e.team, e.weekKey), i + 1));
    weekPoolSizeOf.set(weekKey, sorted.length);
  }

  const byTeam = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byTeam.get(e.team) ?? [];
    list.push(e);
    byTeam.set(e.team, list);
  }
  const seasonRankOf = new Map<string, number>();
  const seasonPoolSizeOf = new Map<string, number>();
  for (const [team, list] of byTeam) {
    const sorted = [...list].sort((a, b) => a.spread - b.spread);
    sorted.forEach((e, i) => seasonRankOf.set(cellKey(e.team, e.weekKey), i + 1));
    seasonPoolSizeOf.set(team, sorted.length);
  }

  const out = new Map<string, SpreadRank>();
  for (const e of entries) {
    const key = cellKey(e.team, e.weekKey);
    out.set(key, {
      weekRank: weekRankOf.get(key)!,
      weekPoolSize: weekPoolSizeOf.get(e.weekKey)!,
      seasonRank: seasonRankOf.get(key)!,
      seasonPoolSize: seasonPoolSizeOf.get(e.team)!,
    });
  }
  return out;
}
