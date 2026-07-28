import { TEAMS, TEAMS_BY_NAME, type Team } from "../data/teams";
import { GAMES, type Game } from "../data/games";
import { hfaFor } from "./odds";

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

export const DEFAULT_CONFERENCES = new Set(["Big Ten", "Big 12", "SEC"]);

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
// Mirrors the convention already used on TeamPage.tsx.
export function teamSpread(team: Team, opp: Team, game: Game): number {
  const isHome = game.home === team.team;
  return isHome
    ? team.rating - opp.rating - hfaFor(team.team, undefined)
    : team.rating - opp.rating + hfaFor(opp.team, undefined);
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
