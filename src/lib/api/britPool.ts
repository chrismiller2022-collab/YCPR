import { supabase } from "../supabaseClient";
import type { GameRow, BettingLineRow } from "./gamesLines";

export interface BritPickRow {
  id: number;
  season: number;
  week: number;
  game_id: string;
  is_special: boolean;
  picked_side: "home" | "away" | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
}

export interface BritPickWithGame extends BritPickRow {
  game: GameRow | null;
  lines: BettingLineRow[];
}

/** FBS-vs-FBS games available to pick from for a given season/week. */
export async function fetchFbsGamesForWeek(season: number, week: number): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("season", season)
    .eq("week", week)
    .eq("home_classification", "fbs")
    .eq("away_classification", "fbs")
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** This week's selected Brit games, each with its game info and betting lines attached. */
export async function fetchBritPicksForWeek(season: number, week: number): Promise<BritPickWithGame[]> {
  const { data: picks, error: picksError } = await supabase
    .from("brit_picks")
    .select("*")
    .eq("season", season)
    .eq("week", week)
    .order("id", { ascending: true });
  if (picksError) throw picksError;
  if (!picks || picks.length === 0) return [];

  const gameIds = picks.map((p) => p.game_id);

  const [{ data: games, error: gamesError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("games").select("*").in("id", gameIds),
    supabase.from("betting_lines").select("*").in("game_id", gameIds),
  ]);
  if (gamesError) throw gamesError;
  if (linesError) throw linesError;

  const gamesById = new Map((games ?? []).map((g) => [g.id, g]));
  const linesByGame = new Map<string, BettingLineRow[]>();
  for (const line of lines ?? []) {
    const list = linesByGame.get(line.game_id) ?? [];
    list.push(line);
    linesByGame.set(line.game_id, list);
  }

  return picks.map((p) => ({
    ...p,
    game: gamesById.get(p.game_id) ?? null,
    lines: linesByGame.get(p.game_id) ?? [],
  }));
}

/** Every Brit pick made all season, with game info attached, for the season tracking table. */
export async function fetchBritSeasonPicks(season: number): Promise<BritPickWithGame[]> {
  const { data: picks, error: picksError } = await supabase
    .from("brit_picks")
    .select("*")
    .eq("season", season)
    .order("week", { ascending: true });
  if (picksError) throw picksError;
  if (!picks || picks.length === 0) return [];

  const gameIds = picks.map((p) => p.game_id);
  const { data: games, error: gamesError } = await supabase.from("games").select("*").in("id", gameIds);
  if (gamesError) throw gamesError;

  const gamesById = new Map((games ?? []).map((g) => [g.id, g]));
  return picks.map((p) => ({ ...p, game: gamesById.get(p.game_id) ?? null, lines: [] }));
}

export interface BritEntryRow {
  season: number;
  week: number;
  entry_fee: number;
  winnings: number;
  note: string | null;
}

export async function fetchBritEntries(season: number): Promise<BritEntryRow[]> {
  const { data, error } = await supabase
    .from("brit_entries")
    .select("*")
    .eq("season", season)
    .order("week", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface BritSeasonBonusRow {
  season: number;
  payout: number;
  note: string | null;
}

export async function fetchBritSeasonBonus(season: number): Promise<BritSeasonBonusRow | null> {
  const { data, error } = await supabase.from("brit_season_bonus").select("*").eq("season", season).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type PickGrade = "win" | "loss" | "push" | "pending";

/** Grades a single pick against its game's actual result, if the game is complete. */
export function gradeBritPick(pick: BritPickWithGame): PickGrade {
  const g = pick.game;
  if (!g || !g.completed || g.home_points == null || g.away_points == null || !pick.picked_side) {
    return "pending";
  }
  if (g.home_points === g.away_points) return "push";
  const actualWinnerSide = g.home_points > g.away_points ? "home" : "away";
  return pick.picked_side === actualWinnerSide ? "win" : "loss";
}

export function summarizeWeekRecord(picks: BritPickWithGame[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  for (const p of picks) {
    const grade = gradeBritPick(p);
    if (grade === "win") wins++;
    else if (grade === "loss") losses++;
    else if (grade === "push") pushes++;
    else pending++;
  }
  return { wins, losses, pushes, pending, total: picks.length };
}
