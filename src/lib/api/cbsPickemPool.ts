import { supabase } from "../supabaseClient";
import { fetchGamesWithLines, type GameRow, type BettingLineRow } from "./gamesLines";
import { computeRow } from "../matchupsCompute";

export interface CbsPickemPickRow {
  id: number;
  season: number;
  week: number;
  game_id: string;
  is_key_game: boolean;
  picked_side: "home" | "away" | null;
  predicted_total_points: number | null;
  // CBS's own displayed spread, as typed in by Chris — separate from
  // vegasAwaySpread below. Defaults to Vegas at fetch time (see
  // fetchCbsPickemPicksForWeek) whenever nothing's been saved yet, so
  // only the games where CBS's actual number diverges from Vegas need
  // to be typed over before saving.
  cbs_line: number | null;
}

export interface CbsPickemPickWithGame extends CbsPickemPickRow {
  game: GameRow | null;
  lines: BettingLineRow[];
  myProjAwaySpread: number | null;
  // Raw synced Vegas line — kept separate from cbsAwaySpread now that
  // the two can genuinely differ once cbs_line is overridden.
  vegasAwaySpread: number | null;
  // Effective CBS line for grading/pick comparison: cbs_line if saved,
  // else Vegas. Grading (gradeCbsPickemPick) reads this unchanged from
  // before — only what it resolves to has changed.
  cbsAwaySpread: number | null;
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
 * This week's selected CBS Pickem games, with projections/CBS spread
 * attached. See cbsPickemPool.ts for why this reuses computeRow() (Admin
 * Matchups' own calculation) instead of computing its own — same
 * reasoning applies here, even though this pool doesn't need the
 * moneyline fields.
 */
export async function fetchCbsPickemPicksForWeek(
  season: number,
  week: number,
  liveByTeam: Record<string, any> = {}
): Promise<CbsPickemPickWithGame[]> {
  const { data: picks, error: picksError } = await supabase
    .from("cbs_pickem_picks")
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
      return { ...p, game: null, lines: [], myProjAwaySpread: null, vegasAwaySpread: null, cbsAwaySpread: p.cbs_line ?? null, vegasTotal: null };
    }

    const computed = computeRow(gwl, liveByTeam);
    const vegasAwaySpread = computed.vegasAwaySpread;

    return {
      ...p,
      game: gwl,
      lines: gwl.lines,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread,
      cbsAwaySpread: p.cbs_line ?? vegasAwaySpread,
      vegasTotal: computed.line?.over_under ?? null,
    };
  });
}

export type CbsPickemGrade = "win" | "loss" | "push" | "pending";

export function gradeCbsPickemPick(pick: CbsPickemPickWithGame): CbsPickemGrade {
  const g = pick.game;
  if (
    !g ||
    !g.completed ||
    g.home_points == null ||
    g.away_points == null ||
    !pick.picked_side ||
    pick.cbsAwaySpread == null
  ) {
    return "pending";
  }
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + pick.cbsAwaySpread;
  if (coverMargin === 0) return "push";
  const actualCoverSide = coverMargin > 0 ? "away" : "home";
  return pick.picked_side === actualCoverSide ? "win" : "loss";
}
