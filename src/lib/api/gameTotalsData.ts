import { supabase } from "../supabaseClient";
import { type TeamSeasonInputs } from "../gameTotals";

export async function fetchTeamSeasonInputs(season: number): Promise<Record<string, TeamSeasonInputs>> {
  const [{ data: statsRows, error: statsError }, { data: gameRows, error: gamesError }] = await Promise.all([
    supabase.from("team_season_stats").select("*").eq("season", season),
    supabase
      .from("games")
      .select("home_team, away_team, home_points, away_points, completed")
      .eq("season", season)
      .eq("completed", true),
  ]);

  if (statsError) throw statsError;
  if (gamesError) throw gamesError;

  // Points aren't in CFBD's stats endpoints (confirmed earlier against
  // the actual CSV columns) — aggregated here from completed games
  // instead, same pattern used for Resume Rating and the SOS
  // hypothetical-wins tab.
  const pointsFor: Record<string, number> = {};
  const pointsAgainst: Record<string, number> = {};
  for (const g of gameRows ?? []) {
    if (g.home_points == null || g.away_points == null) continue;
    pointsFor[g.home_team] = (pointsFor[g.home_team] ?? 0) + g.home_points;
    pointsAgainst[g.home_team] = (pointsAgainst[g.home_team] ?? 0) + g.away_points;
    pointsFor[g.away_team] = (pointsFor[g.away_team] ?? 0) + g.away_points;
    pointsAgainst[g.away_team] = (pointsAgainst[g.away_team] ?? 0) + g.home_points;
  }

  const result: Record<string, TeamSeasonInputs> = {};
  for (const row of statsRows ?? []) {
    result[row.team] = {
      team: row.team,
      games: row.games ?? 0,
      pointsFor: pointsFor[row.team] ?? 0,
      pointsAgainst: pointsAgainst[row.team] ?? 0,
      offensePlays: row.offense_plays ?? 0,
      defensePlays: row.defense_plays ?? 0,
      offenseDrives: row.offense_drives ?? 0,
      defenseDrives: row.defense_drives ?? 0,
      totalYards: row.total_yards ?? 0,
      totalYardsOpponent: row.total_yards_opponent ?? 0,
      passAttempts: row.pass_attempts ?? 0,
      netPassingYards: row.net_passing_yards ?? 0,
      passAttemptsOpponent: row.pass_attempts_opponent ?? 0,
      netPassingYardsOpponent: row.net_passing_yards_opponent ?? 0,
      rushingAttempts: row.rushing_attempts ?? 0,
      rushingYards: row.rushing_yards ?? 0,
      rushingAttemptsOpponent: row.rushing_attempts_opponent ?? 0,
      rushingYardsOpponent: row.rushing_yards_opponent ?? 0,
    };
  }
  return result;
}

export interface GameForTotals {
  id: string;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeClassification: string | null;
  awayClassification: string | null;
  completed: boolean;
  homePoints: number | null;
  awayPoints: number | null;
  overUnder: number | null;
  openingOverUnder: number | null;
  homeSpread: number | null; // negative = home favored, CFBD's own raw convention
}

export async function fetchGamesForTotals(season: number): Promise<GameForTotals[]> {
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, week, home_team, away_team, home_classification, away_classification, completed, home_points, away_points")
    .eq("season", season);
  if (gamesError) throw gamesError;

  const { data: lines, error: linesError } = await supabase
    .from("betting_lines")
    .select("game_id, spread, over_under, opening_spread, opening_over_under, provider")
    .eq("season", season);
  if (linesError) throw linesError;

  const lineByGame = new Map<string, any>();
  for (const l of lines ?? []) {
    // Prefer a consensus/first-seen line per game — last write wins here,
    // fine for now since most games only have one provider synced.
    lineByGame.set(l.game_id, l);
  }

  return (games ?? []).map((g) => {
    const line = lineByGame.get(g.id);
    return {
      id: g.id,
      week: g.week,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      homeClassification: g.home_classification ?? null,
      awayClassification: g.away_classification ?? null,
      completed: !!g.completed,
      homePoints: g.home_points,
      awayPoints: g.away_points,
      overUnder: line?.over_under ?? null,
      openingOverUnder: line?.opening_over_under ?? null,
      homeSpread: line?.spread ?? null,
    };
  });
}

export interface GameTotalsSettings {
  weights: [number, number, number, number];
  regressPct: number;
  filterThresholdMultiplier: number;
  spreadSource: "vegas" | "mine" | "vegas-fill-mine";
}

export const DEFAULT_GAME_TOTALS_SETTINGS: GameTotalsSettings = {
  weights: [2, 2, 1, 1],
  regressPct: 0.3,
  filterThresholdMultiplier: 0.5,
  spreadSource: "vegas-fill-mine",
};

export async function fetchGameTotalsSettings(season: number): Promise<GameTotalsSettings | null> {
  const { data, error } = await supabase.from("game_totals_settings").select("settings").eq("season", season).maybeSingle();
  if (error) throw error;
  return (data?.settings as GameTotalsSettings) ?? null;
}
