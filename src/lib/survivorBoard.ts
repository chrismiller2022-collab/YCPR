import { TEAMS, TEAMS_BY_NAME, type Team } from "../data/teams";
import { hfaFor } from "./odds";
import { pickVegasLine } from "./linePick";
import { billRWinPctFromSpread } from "./moneylineBetHistory";
import { bucketFor } from "./conferenceBuckets";
import type { GameWithLines } from "./api/gamesLines";
import { weekLockTime, type SurvivorWeek } from "./survivor";

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
  /** Conference title game projected from the Monte Carlo run, not yet on the schedule. */
  projected?: boolean;
  /** Each side's Monte Carlo odds (0–1) to make this title game; projected games only. */
  madeAway?: number;
  madeHome?: number;
}

/**
 * Projected conference championship games: in each conference, the two teams
 * most likely to reach the title game in the latest Monte Carlo run, at a
 * neutral site with the YC spread from the latest ratings. Conferences whose
 * real title game is already on the schedule are skipped.
 */
export function projectChampGames(
  mc: { team: string; conf: string; madeConfChampPct: number }[] | null | undefined,
  ratings: Record<string, { rating: number | null }>,
  week: number,
  scheduledTeams: Set<string>
): BoardGame[] {
  if (!mc) return [];
  const byConf = new Map<string, typeof mc>();
  for (const r of mc) {
    if (!r.conf || /independent/i.test(r.conf) || !(r.madeConfChampPct > 0)) continue;
    byConf.set(r.conf, [...(byConf.get(r.conf) ?? []), r]);
  }
  const out: BoardGame[] = [];
  for (const [conf, teams] of byConf) {
    const [first, second] = [...teams].sort((a, b) => b.madeConfChampPct - a.madeConfChampPct);
    if (!first || !second || scheduledTeams.has(first.team) || scheduledTeams.has(second.team)) continue;
    const rate = (t: string) => ratings[t]?.rating ?? TEAMS_BY_NAME[t]?.rating ?? null;
    const a = rate(second.team);
    const h = rate(first.team);
    out.push({
      id: `proj-ccg-${conf}`,
      week,
      home: first.team,
      away: second.team,
      neutral: true,
      startDate: null,
      completed: false,
      homePoints: null,
      awayPoints: null,
      ycAwaySpread: a != null && h != null ? a - h : null,
      vegasAwaySpread: null,
      locked: false,
      projected: true,
      madeAway: second.madeConfChampPct / 100,
      madeHome: first.madeConfChampPct / 100,
    });
  }
  return out;
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

  /**
   * A week is played (read-only) once the pool's pick deadline has passed —
   * not the first kickoff, since midweek games kick off before the lock.
   * Falls back to first kickoff when the deadline label doesn't parse.
   */
  isPlayed(week: SurvivorWeek, now = Date.now(), season = new Date().getFullYear()): boolean {
    const t = weekLockTime(week, season) ?? this.firstKickoff.get(week.dataWeek);
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
export function isEligible(rules: SurvivorRules, team: Team, opp: Team | undefined, selectedConfs: Set<string>, week?: SurvivorWeek): boolean {
  if (!opp || opp.div !== "FBS") return false;
  // Every conference title game is pickable, whatever the conference rules.
  if (week?.key === "champ") return true;
  if (rules === "survivor") return selectedConfs.has(team.conf) && selectedConfs.has(opp.conf);
  return !(bucketFor(team.team, team.conf) === "G6" && bucketFor(opp.team, opp.conf) === "G6");
}

export function rowTeamsFor(rules: SurvivorRules, selectedConfs: Set<string>, champTeams: Set<string> = new Set()): Team[] {
  // Teams outside the eligible conferences still get a row when they're in a title game: champ week is their only pick.
  return rules === "survivor" ? fbsTeams().filter((t) => selectedConfs.has(t.conf) || champTeams.has(t.team)) : fbsTeams();
}
