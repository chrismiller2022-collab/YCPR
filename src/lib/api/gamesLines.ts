import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch } from "./cache";

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

// Explicit column lists instead of select("*") — this is by far the
// most widely-called fetcher on the site (14 callers across public
// pages and admin panels), so a wide unfiltered select here gets
// multiplied by every one of those. Matches GameRow/BettingLineRow above
// exactly, field for field.
const GAME_COLUMNS =
  "id, season, week, season_type, start_date, neutral_site, conference_game, completed, home_team, home_classification, home_conference, home_points, home_postgame_win_probability, away_team, away_classification, away_conference, away_points, away_postgame_win_probability";
const LINE_COLUMNS = "id, game_id, season, week, provider, spread, over_under, home_moneyline, away_moneyline, pulled_at";

/**
 * Games for a given season, each with its betting lines attached. Pass a
 * week to filter to just that week, or omit it to pull the whole season.
 * Cached for 5 minutes per (season, week) — 14 different pages/panels
 * call this independently, often for the same season within one browsing
 * session, so without a cache every navigation re-pulled the full
 * dataset from Supabase.
 */
export async function fetchGamesWithLines(season: number, week?: number): Promise<GameWithLines[]> {
  return cachedFetch(`games-with-lines:${season}:${week ?? "all"}`, async () => {
    const [games, lines] = await Promise.all([
      fetchAllRows<GameRow>((from, to) => {
        let q = supabase.from("games").select(GAME_COLUMNS).eq("season", season);
        if (week != null) q = q.eq("week", week);
        return q.order("start_date", { ascending: true }).range(from, to);
      }),
      fetchAllRows<BettingLineRow>((from, to) => {
        let q = supabase.from("betting_lines").select(LINE_COLUMNS).eq("season", season);
        if (week != null) q = q.eq("week", week);
        return q.range(from, to);
      }),
    ]);

    const linesByGame = new Map<string, BettingLineRow[]>();
    for (const line of lines) {
      const list = linesByGame.get(line.game_id) ?? [];
      list.push(line);
      linesByGame.set(line.game_id, list);
    }

    return games.map((g) => ({
      ...g,
      lines: linesByGame.get(g.id) ?? [],
    }));
  });
}

/** Distinct (season, week) pairs currently in the games table, most recent first. */
export async function fetchSyncedWeeks(): Promise<{ season: number; week: number }[]> {
  const data = await fetchAllRows<{ season: number; week: number }>((from, to) =>
    supabase
      .from("games")
      .select("season, week")
      .order("season", { ascending: false })
      .order("week", { ascending: false })
      .range(from, to)
  );

  const seen = new Set<string>();
  const result: { season: number; week: number }[] = [];
  for (const row of data) {
    const key = `${row.season}-${row.week}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ season: row.season, week: row.week });
    }
  }
  return result;
}
