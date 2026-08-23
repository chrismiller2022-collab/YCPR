import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { type TeamSeasonInputs, type SystemWeights, DEFAULT_SYSTEM_WEIGHTS } from "../gameTotals";

export async function fetchTeamSeasonInputs(season: number): Promise<Record<string, TeamSeasonInputs>> {
  const [statsRows, gameRows] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      supabase.from("team_season_stats").select("*").eq("season", season).range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabase
        .from("games")
        .select("home_team, away_team, home_points, away_points, completed")
        .eq("season", season)
        .eq("completed", true)
        .range(from, to)
    ),
  ]);

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

      offPpa: row.off_ppa ?? null,
      offSuccessRate: row.off_success_rate ?? null,
      offExplosiveness: row.off_explosiveness ?? null,
      offPointsPerOpportunity: row.off_points_per_opportunity ?? null,
      offPowerSuccess: row.off_power_success ?? null,
      offStuffRate: row.off_stuff_rate ?? null,
      offLineYards: row.off_line_yards ?? null,
      offStandardDownsPpa: row.off_standard_downs_ppa ?? null,
      offStandardDownsSuccessRate: row.off_standard_downs_success_rate ?? null,
      offStandardDownsExplosiveness: row.off_standard_downs_explosiveness ?? null,
      offPassingDownsPpa: row.off_passing_downs_ppa ?? null,
      offPassingDownsSuccessRate: row.off_passing_downs_success_rate ?? null,
      offPassingDownsExplosiveness: row.off_passing_downs_explosiveness ?? null,
      offRushingPlaysPpa: row.off_rushing_plays_ppa ?? null,
      offRushingPlaysSuccessRate: row.off_rushing_plays_success_rate ?? null,
      offRushingPlaysExplosiveness: row.off_rushing_plays_explosiveness ?? null,
      offPassingPlaysPpa: row.off_passing_plays_ppa ?? null,
      offPassingPlaysSuccessRate: row.off_passing_plays_success_rate ?? null,
      offPassingPlaysExplosiveness: row.off_passing_plays_explosiveness ?? null,
      offFieldPositionAvgStart: row.off_field_position_avg_start ?? null,
      offFieldPositionAvgPredictedPoints: row.off_field_position_avg_predicted_points ?? null,
      offHavocTotal: row.off_havoc_total ?? null,
      offHavocFrontSeven: row.off_havoc_front_seven ?? null,
      offHavocDb: row.off_havoc_db ?? null,

      defPpa: row.def_ppa ?? null,
      defSuccessRate: row.def_success_rate ?? null,
      defExplosiveness: row.def_explosiveness ?? null,
      defPointsPerOpportunity: row.def_points_per_opportunity ?? null,
      defPowerSuccess: row.def_power_success ?? null,
      defStuffRate: row.def_stuff_rate ?? null,
      defLineYards: row.def_line_yards ?? null,
      defStandardDownsPpa: row.def_standard_downs_ppa ?? null,
      defStandardDownsSuccessRate: row.def_standard_downs_success_rate ?? null,
      defStandardDownsExplosiveness: row.def_standard_downs_explosiveness ?? null,
      defPassingDownsPpa: row.def_passing_downs_ppa ?? null,
      defPassingDownsSuccessRate: row.def_passing_downs_success_rate ?? null,
      defPassingDownsExplosiveness: row.def_passing_downs_explosiveness ?? null,
      defRushingPlaysPpa: row.def_rushing_plays_ppa ?? null,
      defRushingPlaysSuccessRate: row.def_rushing_plays_success_rate ?? null,
      defRushingPlaysExplosiveness: row.def_rushing_plays_explosiveness ?? null,
      defPassingPlaysPpa: row.def_passing_plays_ppa ?? null,
      defPassingPlaysSuccessRate: row.def_passing_plays_success_rate ?? null,
      defPassingPlaysExplosiveness: row.def_passing_plays_explosiveness ?? null,
      defFieldPositionAvgStart: row.def_field_position_avg_start ?? null,
      defFieldPositionAvgPredictedPoints: row.def_field_position_avg_predicted_points ?? null,
      defHavocTotal: row.def_havoc_total ?? null,
      defHavocFrontSeven: row.def_havoc_front_seven ?? null,
      defHavocDb: row.def_havoc_db ?? null,
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
  neutralSite: boolean; // feeds the Ridge total model's home_flag (1.0 true home, 0.5 neutral)
  startDate: string | null; // feeds rest-days-before-this-game for the Ridge total model
}

export async function fetchGamesForTotals(season: number): Promise<GameForTotals[]> {
  const games = await fetchAllRows<any>((from, to) =>
    supabase
      .from("games")
      .select(
        "id, week, home_team, away_team, home_classification, away_classification, completed, home_points, away_points, neutral_site, start_date"
      )
      .eq("season", season)
      .range(from, to)
  );

  const lines = await fetchAllRows<any>((from, to) =>
    supabase
      .from("betting_lines")
      .select("game_id, spread, over_under, opening_spread, opening_over_under, provider")
      .eq("season", season)
      .range(from, to)
  );

  const lineByGame = new Map<string, any>();
  for (const l of lines) {
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
      neutralSite: !!g.neutral_site,
      startDate: g.start_date ?? null,
    };
  });
}

export interface GameTotalsSettings {
  weights: SystemWeights;
  regressPct: number;
  filterThresholdMultiplier: number;
  spreadSource: "vegas" | "mine" | "vegas-fill-mine";
}

export const DEFAULT_GAME_TOTALS_SETTINGS: GameTotalsSettings = {
  weights: { ...DEFAULT_SYSTEM_WEIGHTS },
  regressPct: 0.3,
  filterThresholdMultiplier: 0.5,
  spreadSource: "vegas-fill-mine",
};

export async function fetchGameTotalsSettings(season: number): Promise<GameTotalsSettings | null> {
  const { data, error } = await supabase.from("game_totals_settings").select("settings").eq("season", season).maybeSingle();
  if (error) throw error;
  return (data?.settings as GameTotalsSettings) ?? null;
}
