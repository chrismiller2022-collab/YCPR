import { supabase } from "../supabaseClient";
import { fetchGamesWithLines, type GameRow, type BettingLineRow } from "./gamesLines";
import { computeRow, homeSideMlValues } from "../matchupsCompute";

export interface EspnConfidencePickRow {
  id: number;
  season: number;
  week: number;
  game_id: string;
  is_key_game: boolean;
  picked_side: "home" | "away" | null;
  confidence_points: number | null;
  predicted_total_points: number | null;
}

export interface EspnConfidencePickWithGame extends EspnConfidencePickRow {
  game: GameRow | null;
  lines: BettingLineRow[];
  myProjAwaySpread: number | null;
  myProjAwayMoneyline: number | null;
  myProjHomeMoneyline: number | null;
  vegasAwayMoneyline: number | null;
  vegasHomeMoneyline: number | null;
  vegasTotal: number | null;
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

/**
 * This week's selected ESPN Confidence games, with projections/vegas info
 * attached. See espnMlPool.ts for why this reuses computeRow() (Admin
 * Matchups' own calculation) instead of computing its own — same reasoning
 * applies here.
 */
export async function fetchEspnConfidencePicksForWeek(
  season: number,
  week: number,
  liveByTeam: Record<string, any> = {}
): Promise<EspnConfidencePickWithGame[]> {
  const { data: picks, error: picksError } = await supabase
    .from("espn_confidence_picks")
    .select("*")
    .eq("season", season)
    .eq("week", week)
    .order("id", { ascending: true });
  if (picksError) throw picksError;
  if (!picks || picks.length === 0) return [];

  const gamesWithLines = await fetchGamesWithLines(season, week);
  const byGameId = new Map(gamesWithLines.map((g) => [g.id, g]));

  return picks.map((p) => {
    const gwl = byGameId.get(p.game_id) ?? null;
    if (!gwl) {
      return {
        ...p,
        game: null,
        lines: [],
        myProjAwaySpread: null,
        myProjAwayMoneyline: null,
        myProjHomeMoneyline: null,
        vegasAwayMoneyline: null,
        vegasHomeMoneyline: null,
        vegasTotal: null,
      };
    }

    const computed = computeRow(gwl, liveByTeam);
    const { homeMoneyline } = homeSideMlValues(computed);

    return {
      ...p,
      game: gwl,
      lines: gwl.lines,
      myProjAwaySpread: computed.projAwaySpread,
      myProjAwayMoneyline: computed.projMoneyline,
      myProjHomeMoneyline: homeMoneyline,
      vegasAwayMoneyline: computed.line?.away_moneyline ?? null,
      vegasHomeMoneyline: computed.line?.home_moneyline ?? null,
      vegasTotal: computed.line?.over_under ?? null,
    };
  });
}

export type EspnConfidenceGrade = "win" | "loss" | "pending";

export function gradeEspnConfidencePick(pick: EspnConfidencePickWithGame): EspnConfidenceGrade {
  const g = pick.game;
  if (!g || !g.completed || g.home_points == null || g.away_points == null || !pick.picked_side) {
    return "pending";
  }
  if (g.home_points === g.away_points) return "pending";
  const actualWinnerSide = g.home_points > g.away_points ? "home" : "away";
  return pick.picked_side === actualWinnerSide ? "win" : "loss";
}

/** Points actually earned so far vs. total points in play this week (once assigned). */
export function summarizeConfidencePoints(picks: EspnConfidencePickWithGame[]) {
  let earned = 0;
  let possible = 0;
  for (const p of picks) {
    if (p.confidence_points == null) continue;
    possible += p.confidence_points;
    if (gradeEspnConfidencePick(p) === "win") earned += p.confidence_points;
  }
  return { earned, possible };
}
