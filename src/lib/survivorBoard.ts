import { TEAMS, TEAMS_BY_NAME, type Team } from "../data/teams";
import { hfaFor } from "./odds";
import { pickVegasLine } from "./linePick";
import { billRWinPctFromSpread } from "./moneylineBetHistory";
import { bucketFor } from "./conferenceBuckets";
import type { GameWithLines } from "./api/gamesLines";
import type { SurvivorWeek } from "./survivor";

// The admin Survivor page's board: every synced game with a YC projection (the frozen pregame lock once a game has
// one, else that week's saved ratings) and the Vegas line, plus the two pools' eligibility rules. Spread and win %
// come from the same number, so the Spread and Win % views always agree: win % is Bill R's curve applied to the
// spread, YC or Vegas alike. No home field at neutral sites.

export type SurvivorRules = "survivor" | "splash";
export type ProjectionSource = "yc" | "vegas";

export interface BoardGame {
  id: string;
  week: number;
  home: string;
  away: string;
  neutral: boolean;
  startDate: string | null;
  completed: boolean;
  homePoints: number | null;
  awayPoints: number | null;
  ycAwaySpread: number | null;
  vegasAwaySpread: number | null;
  locked: boolean; // YC projection is the frozen pregame lock
}

export function buildBoardGames(
  games: GameWithLines[],
  ratingsByWeek: Record<number, Record<string, { rating: number | null }>>,
  locks: Record<string, { my_away_spread: number | null } | undefined>
): BoardGame[] {
  return games
    .filter((g) => g.season_type === "regular")
    .map((g) => {
      const lock = locks[g.id]?.my_away_spread ?? null;
      const wk = ratingsByWeek[g.week] ?? {};
      const a = wk[g.away_team]?.rating ?? TEAMS_BY_NAME[g.away_team]?.rating ?? null;
      const h = wk[g.home_team]?.rating ?? TEAMS_BY_NAME[g.home_team]?.rating ?? null;
      const yc = lock != null ? lock : a != null && h != null ? a - h + (g.neutral_site ? 0 : hfaFor(g.home_team, wk)) : null;
      const line = pickVegasLine(g.lines, g.completed);
      return {
        id: g.id,
        week: g.week,
        home: g.home_team,
        away: g.away_team,
        neutral: !!g.neutral_site,
        startDate: g.start_date,
        completed: g.completed,
        homePoints: g.home_points,
        awayPoints: g.away_points,
        ycAwaySpread: yc,
        vegasAwaySpread: line?.spread != null ? -line.spread : null,
        locked: lock != null,
      };
    });
}

export class Board {
  private byTeamWeek = new Map<string, BoardGame>();
  private firstKickoff = new Map<number, number>();

  constructor(public games: BoardGame[]) {
    for (const g of games) {
      this.byTeamWeek.set(`${g.home}|${g.week}`, g);
      this.byTeamWeek.set(`${g.away}|${g.week}`, g);
      if (g.startDate) {
        const t = Date.parse(g.startDate);
        const cur = this.firstKickoff.get(g.week);
        if (cur == null || t < cur) this.firstKickoff.set(g.week, t);
      }
    }
  }

  game(team: string, week: SurvivorWeek): BoardGame | undefined {
    return this.byTeamWeek.get(`${team}|${week.dataWeek}`);
  }

  opponent(g: BoardGame, team: string): Team | undefined {
    return TEAMS_BY_NAME[g.home === team ? g.away : g.home];
  }

  /** A week is played (read-only) once its first game has kicked off. */
  isPlayed(week: SurvivorWeek, now = Date.now()): boolean {
    const t = this.firstKickoff.get(week.dataWeek);
    return t != null && t <= now;
  }

  /** `team`'s own spread (negative = favored) from the chosen source; falls back to YC when Vegas has no line yet. */
  spread(team: string, g: BoardGame, source: ProjectionSource): { value: number; source: ProjectionSource } | null {
    const away = source === "vegas" && g.vegasAwaySpread != null ? g.vegasAwaySpread : g.ycAwaySpread;
    if (away == null) return null;
    const used: ProjectionSource = source === "vegas" && g.vegasAwaySpread != null ? "vegas" : "yc";
    return { value: g.away === team ? away : -away, source: used };
  }

  winPct(team: string, g: BoardGame, source: ProjectionSource): number | null {
    const s = this.spread(team, g, source);
    return s ? billRWinPctFromSpread(s.value) : null;
  }

  /** "won" / "lost" once the game is final, else null. */
  result(team: string, g: BoardGame): "won" | "lost" | "tie" | null {
    if (!g.completed || g.homePoints == null || g.awayPoints == null) return null;
    const mine = g.home === team ? g.homePoints : g.awayPoints;
    const theirs = g.home === team ? g.awayPoints : g.homePoints;
    return mine > theirs ? "won" : mine < theirs ? "lost" : "tie";
  }
}

// ---- Rules ----
export const fbsTeams = (): Team[] => TEAMS.filter((t) => t.div === "FBS").sort((a, b) => a.team.localeCompare(b.team));

/** Survivor: the row team's and the opponent's conferences must both be selected (opponent FBS). Splash: any FBS game except G6 vs G6. */
export function isEligible(rules: SurvivorRules, team: Team, opp: Team | undefined, selectedConfs: Set<string>): boolean {
  if (!opp || opp.div !== "FBS") return false;
  if (rules === "survivor") return selectedConfs.has(team.conf) && selectedConfs.has(opp.conf);
  return !(bucketFor(team.team, team.conf) === "G6" && bucketFor(opp.team, opp.conf) === "G6");
}

export function rowTeamsFor(rules: SurvivorRules, selectedConfs: Set<string>): Team[] {
  return rules === "survivor" ? fbsTeams().filter((t) => selectedConfs.has(t.conf)) : fbsTeams();
}
