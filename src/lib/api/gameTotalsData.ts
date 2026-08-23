import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { type TeamSeasonInputs, type SystemWeights, DEFAULT_SYSTEM_WEIGHTS } from "../gameTotals";

// Every off_*/def_* advanced-stat column in team_season_stats — these are
// the ones that get carried-over/blended from last season early on (see
// fetchTeamSeasonInputs below). Basic box-score columns (games, plays,
// yards) are NOT in this list — those legitimately start at 0 for a new
// season and stay current-season-only.
const ADVANCED_STAT_COLUMNS = [
  "off_ppa", "off_success_rate", "off_explosiveness", "off_points_per_opportunity", "off_power_success",
  "off_stuff_rate", "off_line_yards", "off_standard_downs_ppa", "off_standard_downs_success_rate",
  "off_standard_downs_explosiveness", "off_passing_downs_ppa", "off_passing_downs_success_rate",
  "off_passing_downs_explosiveness", "off_rushing_plays_ppa", "off_rushing_plays_success_rate",
  "off_rushing_plays_explosiveness", "off_passing_plays_ppa", "off_passing_plays_success_rate",
  "off_passing_plays_explosiveness", "off_field_position_avg_start", "off_field_position_avg_predicted_points",
  "off_havoc_total", "off_havoc_front_seven", "off_havoc_db",
  "def_ppa", "def_success_rate", "def_explosiveness", "def_points_per_opportunity", "def_power_success",
  "def_stuff_rate", "def_line_yards", "def_standard_downs_ppa", "def_standard_downs_success_rate",
  "def_standard_downs_explosiveness", "def_passing_downs_ppa", "def_passing_downs_success_rate",
  "def_passing_downs_explosiveness", "def_rushing_plays_ppa", "def_rushing_plays_success_rate",
  "def_rushing_plays_explosiveness", "def_passing_plays_ppa", "def_passing_plays_success_rate",
  "def_passing_plays_explosiveness", "def_field_position_avg_start", "def_field_position_avg_predicted_points",
  "def_havoc_total", "def_havoc_front_seven", "def_havoc_db",
] as const;

// Weeks 1-3ish of a new season have thin-to-nonexistent CURRENT-season
// advanced stats (CFBD's /stats/season/advanced has nothing to compute
// from 0-1 games) — without a fallback every team collapses to the same
// league-average input and the model can't tell teams apart. Real
// power-rating systems (SP+, FPI) handle this the same way: blend last
// season's final numbers in as a prior, tapering it out as this season's
// own sample size grows. This is a simple linear taper — fully this
// season's own numbers by WEIGHT_FULL_AT games played, straight-line
// blended with last season's before that.
const WEIGHT_FULL_AT_GAMES = 4;

function blendWeight(gamesPlayed: number): number {
  return Math.max(0, Math.min(1, gamesPlayed / WEIGHT_FULL_AT_GAMES));
}

function blendedValue(curr: number | null | undefined, prev: number | null | undefined, w: number): number | null {
  const c = curr ?? null;
  const p = prev ?? null;
  if (c == null && p == null) return null;
  if (c == null) return p; // no current-season data at all yet — lean fully on last season
  if (p == null) return c; // no prior-season row (new/reclassified program) — just use current
  return w * c + (1 - w) * p;
}

export async function fetchTeamSeasonInputs(season: number): Promise<Record<string, TeamSeasonInputs>> {
  const [statsRows, prevStatsRows, gameRows] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      supabase.from("team_season_stats").select("*").eq("season", season).range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabase.from("team_season_stats").select("*").eq("season", season - 1).range(from, to)
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

  const currByTeam = new Map<string, any>((statsRows ?? []).map((r) => [r.team, r]));
  const prevByTeam = new Map<string, any>((prevStatsRows ?? []).map((r) => [r.team, r]));
  const allTeams = new Set<string>([...currByTeam.keys(), ...prevByTeam.keys()]);

  const result: Record<string, TeamSeasonInputs> = {};
  for (const team of allTeams) {
    const row = currByTeam.get(team) ?? {};
    const prevRow = prevByTeam.get(team);
    const gamesPlayed = row.games ?? 0;
    const w = blendWeight(gamesPlayed);

    const blended: Record<string, number | null> = {};
    for (const col of ADVANCED_STAT_COLUMNS) {
      blended[col] = blendedValue(row[col], prevRow?.[col], w);
    }

    result[team] = {
      team,
      games: gamesPlayed,
      pointsFor: pointsFor[team] ?? 0,
      pointsAgainst: pointsAgainst[team] ?? 0,
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

      offPpa: blended.off_ppa,
      offSuccessRate: blended.off_success_rate,
      offExplosiveness: blended.off_explosiveness,
      offPointsPerOpportunity: blended.off_points_per_opportunity,
      offPowerSuccess: blended.off_power_success,
      offStuffRate: blended.off_stuff_rate,
      offLineYards: blended.off_line_yards,
      offStandardDownsPpa: blended.off_standard_downs_ppa,
      offStandardDownsSuccessRate: blended.off_standard_downs_success_rate,
      offStandardDownsExplosiveness: blended.off_standard_downs_explosiveness,
      offPassingDownsPpa: blended.off_passing_downs_ppa,
      offPassingDownsSuccessRate: blended.off_passing_downs_success_rate,
      offPassingDownsExplosiveness: blended.off_passing_downs_explosiveness,
      offRushingPlaysPpa: blended.off_rushing_plays_ppa,
      offRushingPlaysSuccessRate: blended.off_rushing_plays_success_rate,
      offRushingPlaysExplosiveness: blended.off_rushing_plays_explosiveness,
      offPassingPlaysPpa: blended.off_passing_plays_ppa,
      offPassingPlaysSuccessRate: blended.off_passing_plays_success_rate,
      offPassingPlaysExplosiveness: blended.off_passing_plays_explosiveness,
      offFieldPositionAvgStart: blended.off_field_position_avg_start,
      offFieldPositionAvgPredictedPoints: blended.off_field_position_avg_predicted_points,
      offHavocTotal: blended.off_havoc_total,
      offHavocFrontSeven: blended.off_havoc_front_seven,
      offHavocDb: blended.off_havoc_db,

      defPpa: blended.def_ppa,
      defSuccessRate: blended.def_success_rate,
      defExplosiveness: blended.def_explosiveness,
      defPointsPerOpportunity: blended.def_points_per_opportunity,
      defPowerSuccess: blended.def_power_success,
      defStuffRate: blended.def_stuff_rate,
      defLineYards: blended.def_line_yards,
      defStandardDownsPpa: blended.def_standard_downs_ppa,
      defStandardDownsSuccessRate: blended.def_standard_downs_success_rate,
      defStandardDownsExplosiveness: blended.def_standard_downs_explosiveness,
      defPassingDownsPpa: blended.def_passing_downs_ppa,
      defPassingDownsSuccessRate: blended.def_passing_downs_success_rate,
      defPassingDownsExplosiveness: blended.def_passing_downs_explosiveness,
      defRushingPlaysPpa: blended.def_rushing_plays_ppa,
      defRushingPlaysSuccessRate: blended.def_rushing_plays_success_rate,
      defRushingPlaysExplosiveness: blended.def_rushing_plays_explosiveness,
      defPassingPlaysPpa: blended.def_passing_plays_ppa,
      defPassingPlaysSuccessRate: blended.def_passing_plays_success_rate,
      defPassingPlaysExplosiveness: blended.def_passing_plays_explosiveness,
      defFieldPositionAvgStart: blended.def_field_position_avg_start,
      defFieldPositionAvgPredictedPoints: blended.def_field_position_avg_predicted_points,
      defHavocTotal: blended.def_havoc_total,
      defHavocFrontSeven: blended.def_havoc_front_seven,
      defHavocDb: blended.def_havoc_db,
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
