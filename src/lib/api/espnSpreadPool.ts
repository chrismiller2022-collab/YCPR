import { supabase } from "../supabaseClient";
import { fetchGamesWithLines, type GameRow, type BettingLineRow } from "./gamesLines";
import { computeRow } from "../matchupsCompute";

export interface EspnSpreadPickRow {
  id: number;
  season: number;
  week: number;
  game_id: string;
  is_key_game: boolean;
  picked_side: "home" | "away" | null;
  predicted_total_points: number | null;
}

export interface EspnSpreadPickWithGame extends EspnSpreadPickRow {
  game: GameRow | null;
  lines: BettingLineRow[];
  myProjAwaySpread: number | null;
  // ESPN's own displayed spread. We don't have a separate ESPN-specific
  // feed — this uses the same synced betting line as everywhere else on
  // the site, on the assumption ESPN's number tracks the market
  // consensus closely enough to use as a stand-in. Worth spot-checking
  // one week against ESPN's actual displayed numbers.
  espnAwaySpread: number | null;
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
 * This week's selected ESPN Spreads games, with projections/ESPN spread
 * attached. See espnMlPool.ts for why this reuses computeRow() (Admin
 * Matchups' own calculation) instead of computing its own — same
 * reasoning applies here, even though this pool doesn't need the
 * moneyline fields.
 */
export async function fetchEspnSpreadPicksForWeek(
  season: number,
  week: number,
  liveByTeam: Record<string, any> = {}
): Promise<EspnSpreadPickWithGame[]> {
  const { data: picks, error: picksError } = await supabase
    .from("espn_spread_picks")
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
      return { ...p, game: null, lines: [], myProjAwaySpread: null, espnAwaySpread: null, vegasTotal: null };
    }

    const computed = computeRow(gwl, liveByTeam);

    return {
      ...p,
      game: gwl,
      lines: gwl.lines,
      myProjAwaySpread: computed.projAwaySpread,
      espnAwaySpread: computed.vegasAwaySpread,
      vegasTotal: computed.line?.over_under ?? null,
    };
  });
}

export type EspnSpreadGrade = "win" | "loss" | "push" | "pending";

export function gradeEspnSpreadPick(pick: EspnSpreadPickWithGame): EspnSpreadGrade {
  const g = pick.game;
  if (
    !g ||
    !g.completed ||
    g.home_points == null ||
    g.away_points == null ||
    !pick.picked_side ||
    pick.espnAwaySpread == null
  ) {
    return "pending";
  }
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + pick.espnAwaySpread;
  if (coverMargin === 0) return "push";
  const actualCoverSide = coverMargin > 0 ? "away" : "home";
  return pick.picked_side === actualCoverSide ? "win" : "loss";
}
