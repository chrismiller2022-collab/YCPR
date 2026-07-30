import { supabase } from "../supabaseClient";

export interface GameRow {
  id: string;
  season: number;
  week: number;
  season_type: string;
  start_date: string | null;
  neutral_site: boolean;
  conference_game: boolean;
  completed: boolean;
  home_team: string;
  home_classification: string | null;
  home_conference: string | null;
  home_points: number | null;
  home_postgame_win_probability: number | null;
  away_team: string;
  away_classification: string | null;
  away_conference: string | null;
  away_points: number | null;
  away_postgame_win_probability: number | null;
}

export interface BettingLineRow {
  id: number;
  game_id: string;
  season: number;
  week: number;
  provider: string;
  spread: number | null;
  over_under: number | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
  pulled_at: string;
}

export interface GameWithLines extends GameRow {
  lines: BettingLineRow[];
}

/**
 * Games for a given season, each with its betting lines attached. Pass a
 * week to filter to just that week, or omit it to pull the whole season.
 */
export async function fetchGamesWithLines(season: number, week?: number): Promise<GameWithLines[]> {
  let gamesQuery = supabase.from("games").select("*").eq("season", season);
  let linesQuery = supabase.from("betting_lines").select("*").eq("season", season);

  if (week != null) {
    gamesQuery = gamesQuery.eq("week", week);
    linesQuery = linesQuery.eq("week", week);
  }

  const [{ data: games, error: gamesError }, { data: lines, error: linesError }] = await Promise.all([
    gamesQuery.order("start_date", { ascending: true }),
    linesQuery,
  ]);

  if (gamesError) throw gamesError;
  if (linesError) throw linesError;

  const linesByGame = new Map<string, BettingLineRow[]>();
  for (const line of lines ?? []) {
    const list = linesByGame.get(line.game_id) ?? [];
    list.push(line);
    linesByGame.set(line.game_id, list);
  }

  return (games ?? []).map((g) => ({
    ...g,
    lines: linesByGame.get(g.id) ?? [],
  }));
}

/** Distinct (season, week) pairs currently in the games table, most recent first. */
export async function fetchSyncedWeeks(): Promise<{ season: number; week: number }[]> {
  const { data, error } = await supabase
    .from("games")
    .select("season, week")
    .order("season", { ascending: false })
    .order("week", { ascending: false });
  if (error) throw error;

  const seen = new Set<string>();
  const result: { season: number; week: number }[] = [];
  for (const row of data ?? []) {
    const key = `${row.season}-${row.week}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ season: row.season, week: row.week });
    }
  }
  return result;
}
