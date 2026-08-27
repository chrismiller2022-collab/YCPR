import { supabase } from "../supabaseClient";
import { fetchGamesWithLines } from "./gamesLines";
import { computeRow } from "../matchupsCompute";
import type { GameRow } from "./gamesLines";

export interface WestgateRow {
  game_id: string;
  game: GameRow;
  westgate_line: number | null;
  picked_side: "home" | "away" | null;
  is_key_pick: boolean;
  myProjAwaySpread: number | null;
  vegasAwaySpread: number | null;
  westgateVsMine: number | null;
  westgateVsVegas: number | null;
}

export type WestgateGrade = "win" | "loss" | "push" | "pending";

export function gradeWestgatePick(row: WestgateRow): WestgateGrade {
  const g = row.game;
  if (!g.completed || g.home_points == null || g.away_points == null || row.picked_side == null || row.westgate_line == null) {
    return "pending";
  }
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + row.westgate_line;
  const actualCoverSide: "home" | "away" | "push" = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
  if (actualCoverSide === "push") return "push";
  return row.picked_side === actualCoverSide ? "win" : "loss";
}

/**
 * Every FBS-vs-FBS game for the week, merged with any saved Westgate Supercontest
 * line/pick. Unlike Brit, there's no separate "selection" step — every
 * FBS-vs-FBS game is in scope automatically. Uses computeRow() (Admin
 * Matchups' own calculation) for myProjAwaySpread/vegasAwaySpread —
 * see espnMlPool.ts for the full reasoning.
 */
export async function fetchWestgateWeek(season: number, week: number, liveByTeam: Record<string, any> = {}): Promise<WestgateRow[]> {
  const [gamesWithLines, { data: westgate, error: westgateError }] = await Promise.all([
    fetchGamesWithLines(season, week),
    supabase.from("westgate_picks").select("*").eq("season", season).eq("week", week),
  ]);
  if (westgateError) throw westgateError;

  const fbsGames = gamesWithLines.filter(
    (g) => (g.home_classification ?? "").toLowerCase() === "fbs" && (g.away_classification ?? "").toLowerCase() === "fbs"
  );
  const westgateByGame = new Map((westgate ?? []).map((p) => [p.game_id, p]));

  return fbsGames.map((gwl) => {
    const computed = computeRow(gwl, liveByTeam);
    const saved = westgateByGame.get(gwl.id);
    const westgateLine = saved?.westgate_line ?? null;

    return {
      game_id: gwl.id,
      game: gwl,
      westgate_line: westgateLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread: computed.vegasAwaySpread,
      westgateVsMine: westgateLine != null && computed.projAwaySpread != null ? westgateLine - computed.projAwaySpread : null,
      westgateVsVegas: westgateLine != null && computed.vegasAwaySpread != null ? westgateLine - computed.vegasAwaySpread : null,
    };
  });
}
