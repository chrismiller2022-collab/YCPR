import { supabase } from "../supabaseClient";
import { fetchGamesWithLines } from "./gamesLines";
import { computeRow } from "../matchupsCompute";
import type { GameRow } from "./gamesLines";

export interface CbsSplashRow {
  game_id: string;
  game: GameRow;
  splash_line: number | null;
  picked_side: "home" | "away" | null;
  is_key_pick: boolean;
  myProjAwaySpread: number | null;
  vegasAwaySpread: number | null;
  splashVsMine: number | null;
  splashVsVegas: number | null;
}

export type CbsSplashGrade = "win" | "loss" | "push" | "pending";

export function gradeCbsSplashPick(row: CbsSplashRow): CbsSplashGrade {
  const g = row.game;
  if (!g.completed || g.home_points == null || g.away_points == null || row.picked_side == null || row.splash_line == null) {
    return "pending";
  }
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + row.splash_line;
  const actualCoverSide: "home" | "away" | "push" = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
  if (actualCoverSide === "push") return "push";
  return row.picked_side === actualCoverSide ? "win" : "loss";
}

/**
 * Every FBS-vs-FBS game for the week, merged with any saved CBS Splash
 * line/pick. Unlike Brit, there's no separate "selection" step — every
 * FBS-vs-FBS game is in scope automatically. Uses computeRow() (Admin
 * Matchups' own calculation) for myProjAwaySpread/vegasAwaySpread —
 * see espnMlPool.ts for the full reasoning.
 */
export async function fetchCbsSplashWeek(season: number, week: number, liveByTeam: Record<string, any> = {}): Promise<CbsSplashRow[]> {
  const [gamesWithLines, { data: splash, error: splashError }] = await Promise.all([
    fetchGamesWithLines(season, week),
    supabase.from("cbs_splash_picks").select("*").eq("season", season).eq("week", week),
  ]);
  if (splashError) throw splashError;

  const fbsGames = gamesWithLines.filter(
    (g) => (g.home_classification ?? "").toLowerCase() === "fbs" && (g.away_classification ?? "").toLowerCase() === "fbs"
  );
  const splashByGame = new Map((splash ?? []).map((p) => [p.game_id, p]));

  return fbsGames.map((gwl) => {
    const computed = computeRow(gwl, liveByTeam);
    const saved = splashByGame.get(gwl.id);
    const splashLine = saved?.splash_line ?? null;

    return {
      game_id: gwl.id,
      game: gwl,
      splash_line: splashLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread: computed.vegasAwaySpread,
      splashVsMine: splashLine != null && computed.projAwaySpread != null ? splashLine - computed.projAwaySpread : null,
      splashVsVegas: splashLine != null && computed.vegasAwaySpread != null ? splashLine - computed.vegasAwaySpread : null,
    };
  });
}
