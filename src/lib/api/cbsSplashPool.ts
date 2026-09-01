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
  // The opening line CFBD had before any movement, away-perspective —
  // see peayPool.ts's fetchPeayWeek for the exact transform/reasoning.
  openingAwaySpread: number | null;
  splashVsMine: number | null;
  splashVsVegas: number | null;
  // Which side (if any) the Weighted Filtered Bet signal favors — same
  // computeRow() field Admin Matchups' WFB column reads.
  wfbTeam: "away" | "home" | null;
  // Magnitude behind that WFB signal (computeRow's absAmountOff) — see
  // peayPool.ts's fetchPeayWeek for the reasoning.
  wfbAmountOff: number | null;
  // Which side my model likes against the Splash line specifically (not
  // Vegas) — informational only, doesn't drive picked_side/Pick
  // buttons, which stay fully manual per Chris's request.
  projCoverTeam: "away" | "home" | null;
  // Which side actually covered the Splash line, once the game's
  // final — null (not "pending") until then. Shares the exact margin
  // math with gradeCbsSplashPick via actualCoverSide, so the two can't
  // diverge.
  actualCoverTeam: "away" | "home" | "push" | null;
}

export type CbsSplashGrade = "win" | "loss" | "push" | "pending";

/** Which side covered `line` (Splash's own line, away-perspective) once the game's final — null if not completed or no line set yet. */
export function actualCoverSide(g: GameRow, line: number | null): "away" | "home" | "push" | null {
  if (!g.completed || g.home_points == null || g.away_points == null || line == null) return null;
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + line;
  return coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
}

export function gradeCbsSplashPick(row: CbsSplashRow): CbsSplashGrade {
  if (row.picked_side == null) return "pending";
  const side = actualCoverSide(row.game, row.splash_line);
  if (side == null) return "pending";
  if (side === "push") return "push";
  return row.picked_side === side ? "win" : "loss";
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
    // Defaults to Vegas — see peayPool.ts's fetchPeayWeek for the reasoning.
    const splashLine = saved?.splash_line ?? computed.vegasAwaySpread ?? null;
    const projCoverTeam: "away" | "home" | null =
      splashLine == null || computed.projAwaySpread == null
        ? null
        : computed.projAwaySpread < splashLine
        ? "away"
        : computed.projAwaySpread > splashLine
        ? "home"
        : null;

    return {
      game_id: gwl.id,
      game: gwl,
      splash_line: splashLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread: computed.vegasAwaySpread,
      openingAwaySpread: computed.line?.opening_spread != null ? -computed.line.opening_spread : null,
      splashVsMine: splashLine != null && computed.projAwaySpread != null ? splashLine - computed.projAwaySpread : null,
      splashVsVegas: splashLine != null && computed.vegasAwaySpread != null ? splashLine - computed.vegasAwaySpread : null,
      wfbTeam: computed.weightedFilteredBetTeam,
      wfbAmountOff: computed.weightedFilteredBetTeam != null ? computed.absAmountOff : null,
      projCoverTeam,
      actualCoverTeam: actualCoverSide(gwl, splashLine),
    };
  });
}
