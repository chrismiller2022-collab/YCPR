import { supabase } from "../supabaseClient";
import { SURVIVOR_WEEKS, gameForTeamInWeek } from "../survivor";

export type SurvivorPickResult = "win" | "loss" | "pending";

export interface SurvivorLivePick {
  team: string;
  opponent: string | null;
  homePoints: number | null;
  awayPoints: number | null;
  result: SurvivorPickResult;
}

export interface SurvivorLiveWeek {
  weekLabel: string;
  picks: SurvivorLivePick[];
}

function readPicks(storageKey: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Grades whatever's currently saved in a Survivor tool's localStorage
 * working picks (survivor_picks_v1 / splash_survivor_picks_v1) for the
 * current week — these tools don't write a game_id-bearing Supabase
 * row, so there's no DB table to join against; instead this resolves
 * each picked team name to its scheduled game via gameForTeamInWeek()
 * (the same static schedule lookup the tool's own grid uses) and then
 * fetches that one game's live score directly. Returns null if the
 * current week isn't one of the tool's configured SURVIVOR_WEEKS yet
 * (e.g. bowl/CFP weeks with no matchups loaded).
 */
export async function fetchSurvivorLiveWeek(storageKey: string, currentDataWeek: number): Promise<SurvivorLiveWeek | null> {
  const week = SURVIVOR_WEEKS.find((w) => w.dataWeek === currentDataWeek);
  if (!week) return null;

  const teams = readPicks(storageKey)[week.key] ?? [];
  if (teams.length === 0) return { weekLabel: week.label, picks: [] };

  const gamesForTeams = teams.map((team) => ({ team, game: gameForTeamInWeek(team, week.dataWeek) }));
  const ids = gamesForTeams.map((g) => g.game?.id).filter((id): id is string => !!id);

  const { data, error } = ids.length
    ? await supabase.from("games").select("id, home_points, away_points, completed").in("id", ids)
    : { data: [], error: null };
  if (error) throw error;
  const liveById = new Map((data ?? []).map((g) => [g.id, g]));

  const picks: SurvivorLivePick[] = gamesForTeams.map(({ team, game }) => {
    if (!game) return { team, opponent: null, homePoints: null, awayPoints: null, result: "pending" };
    const isHome = game.home === team;
    const opponent = isHome ? game.away : game.home;
    const live = liveById.get(game.id);
    if (!live || !live.completed || live.home_points == null || live.away_points == null) {
      return { team, opponent, homePoints: live?.home_points ?? null, awayPoints: live?.away_points ?? null, result: "pending" };
    }
    const teamWon = isHome ? live.home_points > live.away_points : live.away_points > live.home_points;
    return { team, opponent, homePoints: live.home_points, awayPoints: live.away_points, result: teamWon ? "win" : "loss" };
  });

  return { weekLabel: week.label, picks };
}
