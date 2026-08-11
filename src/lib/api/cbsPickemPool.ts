import { supabase } from "../supabaseClient";
import { TEAMS_BY_NAME } from "../../data/teams";
import { hfaFor } from "../odds";
import type { GameRow, BettingLineRow } from "./gamesLines";

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];
function pickLine(lines: BettingLineRow[]): BettingLineRow | null {
  if (lines.length === 0) return null;
  for (const p of PREFERRED_PROVIDERS) {
    const m = lines.find((l) => l.provider === p);
    if (m) return m;
  }
  return lines[0];
}

export interface CbsPickemPickRow {
  id: number;
  season: number;
  week: number;
  game_id: string;
  is_key_game: boolean;
  picked_side: "home" | "away" | null;
  predicted_total_points: number | null;
}

export interface CbsPickemPickWithGame extends CbsPickemPickRow {
  game: GameRow | null;
  lines: BettingLineRow[];
  myProjAwaySpread: number | null;
  // CBS's own displayed spread. We don't have a separate CBS-specific
  // feed — this uses the same synced betting line as everywhere else on
  // the site, on the assumption CBS's number tracks the market
  // consensus closely enough to use as a stand-in. Worth spot-checking
  // one week against CBS's actual displayed numbers.
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

/** This week's selected CBS Pickem games, with projections/CBS spread attached. */
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

  const gameIds = picks.map((p) => p.game_id);
  const [{ data: games, error: gamesError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("games").select("*").in("id", gameIds),
    supabase.from("betting_lines").select("*").in("game_id", gameIds),
  ]);
  if (gamesError) throw gamesError;
  if (linesError) throw linesError;

  const gamesById = new Map((games ?? []).map((g) => [g.id, g]));
  const linesByGame = new Map<string, BettingLineRow[]>();
  for (const l of lines ?? []) {
    const list = linesByGame.get(l.game_id) ?? [];
    list.push(l);
    linesByGame.set(l.game_id, list);
  }

  return picks.map((p) => {
    const g = gamesById.get(p.game_id) ?? null;
    const gameLines = linesByGame.get(p.game_id) ?? [];
    const line = pickLine(gameLines);

    const awayTeam = g ? TEAMS_BY_NAME[g.away_team] : null;
    const homeTeam = g ? TEAMS_BY_NAME[g.home_team] : null;
    const awayRating = awayTeam ? liveByTeam[g!.away_team]?.rating ?? awayTeam.rating : null;
    const homeRating = homeTeam ? liveByTeam[g!.home_team]?.rating ?? homeTeam.rating : null;
    const myProjAwaySpread =
      g && awayRating != null && homeRating != null ? awayRating - homeRating + hfaFor(g.home_team, liveByTeam) : null;

    return {
      ...p,
      game: g,
      lines: gameLines,
      myProjAwaySpread,
      cbsAwaySpread: line?.spread != null ? -line.spread : null,
      vegasTotal: line?.over_under ?? null,
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
