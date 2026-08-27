import { TEAMS, TEAMS_BY_NAME, type Team } from "../data/teams";
import { GAMES, type Game } from "../data/games";
import { hfaFor } from "./odds";
import { billRAwayWinPct } from "./moneylineBetHistory";

// ---------------------------------------------------------------------
// Week configuration — matches the actual contest pick sheet (dates/
// deadlines/game counts as published), separate from the raw weekly
// game data pulled in from games.ts. `dataWeek` is the numeric week key
// used in GAMES so we can look up each team's matchup for that slate.
// Conference Championship week isn't in games.ts yet (no matchups
// scheduled/known at data-pull time) — it'll just render as byes until
// that data is added, same as any other future week would.
// ---------------------------------------------------------------------
export interface SurvivorWeek {
  key: string;
  label: string;
  dataWeek: number;
  gameCount: number;
  lockLabel: string;
}

export const SURVIVOR_WEEKS: SurvivorWeek[] = [
  { key: "w1", label: "Week 1", dataWeek: 1, gameCount: 39, lockLabel: "9/3 @ 6:00 PM" },
  { key: "w2", label: "Week 2", dataWeek: 2, gameCount: 35, lockLabel: "9/11 @ 7:30 PM" },
  { key: "w3", label: "Week 3", dataWeek: 3, gameCount: 43, lockLabel: "9/17 @ 7:30 PM" },
  { key: "w4", label: "Week 4", dataWeek: 4, gameCount: 40, lockLabel: "9/25 @ 8:00 PM" },
  { key: "w5", label: "Week 5", dataWeek: 5, gameCount: 34, lockLabel: "10/2 @ 7:00 PM" },
  { key: "w6", label: "Week 6", dataWeek: 6, gameCount: 32, lockLabel: "10/9 @ 7:00 PM" },
  { key: "w7", label: "Week 7", dataWeek: 7, gameCount: 33, lockLabel: "10/16 @ 8:00 PM" },
  { key: "w8", label: "Week 8", dataWeek: 8, gameCount: 31, lockLabel: "10/23 @ 7:00 PM" },
  { key: "w9", label: "Week 9", dataWeek: 9, gameCount: 33, lockLabel: "10/30 @ 1:00 PM" },
  { key: "w10", label: "Week 10", dataWeek: 10, gameCount: 36, lockLabel: "11/6 @ 1:00 PM" },
  { key: "w11", label: "Week 11", dataWeek: 11, gameCount: 39, lockLabel: "11/13 @ 7:00 PM" },
  { key: "w12", label: "Week 12", dataWeek: 12, gameCount: 37, lockLabel: "11/20 @ 6:00 PM" },
  { key: "w13", label: "Week 13", dataWeek: 13, gameCount: 40, lockLabel: "11/26 @ 8:00 PM" },
  { key: "champ", label: "Conf Championships", dataWeek: 14, gameCount: 11, lockLabel: "12/4 @ 7:00 PM" },
];

// ---------------------------------------------------------------------
// Conferences available for the filter. Driven off the real team list
// (FBS only — survivor picks are always FBS teams) rather than a fixed
// list, so conference realignment doesn't require a code change.
// ---------------------------------------------------------------------
const PREFERRED_ORDER = ["SEC", "Big Ten", "Big 12", "ACC"];

export function availableConferences(): string[] {
  const confs = Array.from(
    new Set(TEAMS.filter((t) => t.div === "FBS").map((t) => t.conf))
  );
  confs.sort((a, b) => {
    const ai = PREFERRED_ORDER.indexOf(a);
    const bi = PREFERRED_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    return a.localeCompare(b);
  });
  return confs;
}

// P4 (+ ACC, which was previously missing from this default set).
export const DEFAULT_CONFERENCES = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);

// ---------------------------------------------------------------------
// Row teams: any FBS team belonging to a currently-selected conference.
// ---------------------------------------------------------------------
export function rowTeams(selectedConfs: Set<string>): Team[] {
  return TEAMS.filter((t) => t.div === "FBS" && selectedConfs.has(t.conf)).sort(
    (a, b) => a.team.localeCompare(b.team)
  );
}

// ---------------------------------------------------------------------
// Find a team's game for a given data week (undefined = bye).
// ---------------------------------------------------------------------
export function gameForTeamInWeek(teamName: string, dataWeek: number): Game | undefined {
  return GAMES.find(
    (g) => g.week === dataWeek && (g.home === teamName || g.away === teamName)
  );
}

export function opponentOf(game: Game, teamName: string): Team | undefined {
  const oppName = game.home === teamName ? game.away : game.home;
  return TEAMS_BY_NAME[oppName];
}

// Spread from `team`'s own perspective — negative means `team` is favored.
// Mirrors the convention already used on TeamPage.tsx. Ratings are
// live-preferred (falling back to each team's static preseason rating)
// when a liveByTeam map is passed.
export function teamSpread(team: Team, opp: Team, game: Game, liveByTeam?: Record<string, any>): number {
  const isHome = game.home === team.team;
  const teamRating = liveByTeam?.[team.team]?.rating ?? team.rating;
  const oppRating = liveByTeam?.[opp.team]?.rating ?? opp.rating;
  return isHome
    ? teamRating - oppRating - hfaFor(team.team, liveByTeam)
    : teamRating - oppRating + hfaFor(opp.team, liveByTeam);
}

/**
 * `team`'s own fair win probability for this game — Bill R Method
 * (site-wide standard for moneyline), not the spread-derived curve
 * teamSpread()/the Spread view use. Confirmed via Chris: the Survivor
 * Moneyline view was still on the old method before this.
 */
export function teamWinPct(team: Team, opp: Team, game: Game, liveByTeam?: Record<string, any>): number {
  const isHome = game.home === team.team;
  const teamRating = liveByTeam?.[team.team]?.rating ?? team.rating;
  const oppRating = liveByTeam?.[opp.team]?.rating ?? opp.rating;
  return isHome ? 1 - billRAwayWinPct(oppRating, teamRating) : billRAwayWinPct(teamRating, oppRating);
}

// ---------------------------------------------------------------------
// Eligibility: a cell is pickable only if the opponent is FBS AND the
// opponent's conference is currently selected in the filter. Both
// checks are independent of whether the row team itself is "in" one of
// the selected conferences (it always is, since it's a row).
// ---------------------------------------------------------------------
export function isOpponentEligible(opp: Team | undefined, selectedConfs: Set<string>): boolean {
  if (!opp) return false;
  if (opp.div !== "FBS") return false;
  return selectedConfs.has(opp.conf);
}

export type CellStatus = "bye" | "ineligible" | "team-used" | "week-locked" | "selected" | "open";

export function cellStatus(
  teamName: string,
  week: SurvivorWeek,
  game: Game | undefined,
  opp: Team | undefined,
  selectedConfs: Set<string>,
  picks: Record<string, string[]>,
  usedElsewhere: Set<string>
): CellStatus {
  if (!game) return "bye";
  if (!isOpponentEligible(opp, selectedConfs)) return "ineligible";

  const weekPicks = picks[week.key] || [];
  if (weekPicks.includes(teamName)) return "selected";
  if (usedElsewhere.has(teamName)) return "team-used";
  if (weekPicks.length >= 2) return "week-locked";
  return "open";
}

// Every team picked in any week other than `excludeWeekKey`.
export function teamsUsedElsewhere(
  picks: Record<string, string[]>,
  excludeWeekKey: string
): Set<string> {
  const set = new Set<string>();
  for (const [wk, arr] of Object.entries(picks)) {
    if (wk === excludeWeekKey) continue;
    arr.forEach((t) => set.add(t));
  }
  return set;
}

export function allUsedTeams(picks: Record<string, string[]>): Set<string> {
  const set = new Set<string>();
  Object.values(picks).forEach((arr) => arr.forEach((t) => set.add(t)));
  return set;
}

// ---------------------------------------------------------------------
// Spread ranks — for every (team, week) cell with an eligible opponent,
// two ranks: where that spread falls among ALL teams' eligible games that
// same week (1 = biggest favorite in the whole slate that week), and where
// it falls among THIS team's own eligible games across the whole season
// (1 = this team's single best matchup all year). "Eligible" here is
// isOpponentEligible only (opponent FBS + in a selected conference) —
// deliberately independent of whether a team/week is already used in the
// in-progress picks, since this is about comparing matchup quality, not
// current pick state. Used to flag "this is the biggest favorite this
// week, but only their Nth-biggest all season — maybe save them."
// ---------------------------------------------------------------------
export interface SpreadRank {
  weekRank: number;
  weekPoolSize: number;
  seasonRank: number;
  seasonPoolSize: number;
}

export function computeSpreadRanks(
  teams: Team[],
  selectedConfs: Set<string>,
  liveByTeam?: Record<string, any>
): Map<string, SpreadRank> {
  interface Entry {
    team: string;
    weekKey: string;
    spread: number;
  }
  const entries: Entry[] = [];
  for (const team of teams) {
    for (const week of SURVIVOR_WEEKS) {
      const game = gameForTeamInWeek(team.team, week.dataWeek);
      if (!game) continue;
      const opp = opponentOf(game, team.team);
      if (!isOpponentEligible(opp, selectedConfs)) continue;
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
    const sorted = [...list].sort((a, b) => a.spread - b.spread); // most negative (biggest favorite) first
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
