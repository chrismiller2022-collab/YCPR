import { supabase } from "../supabaseClient";
import { fetchGamesWithLines } from "./gamesLines";
import { computeRow } from "../matchupsCompute";
import type { GameRow } from "./gamesLines";

// CBS and Kelly are two separate real-money contests that happen to
// share this one page — same synced line per game, and Chris usually
// (not always) makes the same pick for both, but they're independently
// scored: CBS picks exactly 6 games (1 flagged as a key pick), Kelly
// picks exactly 7 (no key game). Rather than two separate pages/tables,
// both contests' selection+pick state live on the same row per game,
// since the line itself really is shared. cbs_selected/kelly_selected
// mark whether a given game is even part of that contest's slate this
// week — neither contest uses every FBS-vs-FBS game.
export interface CbsSplashRow {
  game_id: string;
  game: GameRow;
  splash_line: number | null;
  cbsSelected: boolean;
  cbsPickedSide: "home" | "away" | null;
  cbsIsKeyPick: boolean;
  kellySelected: boolean;
  kellyPickedSide: "home" | "away" | null;
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
  // Vegas) — informational only, doesn't drive either contest's pick
  // buttons, which stay fully manual per Chris's request.
  projCoverTeam: "away" | "home" | null;
  // Which side actually covered the Splash line, once the game's
  // final — null (not "pending") until then. Shared by both contests
  // since it's the same line either way.
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

function gradeSide(pickedSide: "away" | "home" | null, actual: "away" | "home" | "push" | null): CbsSplashGrade {
  if (pickedSide == null) return "pending";
  if (actual == null) return "pending";
  if (actual === "push") return "push";
  return pickedSide === actual ? "win" : "loss";
}

export function gradeCbsPick(row: CbsSplashRow): CbsSplashGrade {
  return gradeSide(row.cbsPickedSide, row.actualCoverTeam);
}

export function gradeKellyPick(row: CbsSplashRow): CbsSplashGrade {
  return gradeSide(row.kellyPickedSide, row.actualCoverTeam);
}

/**
 * Every FBS-vs-FBS game for the week, merged with any saved CBS/Kelly
 * line/selection/pick. Unlike Brit, there's no separate "selection"
 * step gating which games even show up — every FBS-vs-FBS game is
 * listed, with per-contest checkboxes marking which ones count toward
 * that contest's 6 or 7. Uses computeRow() (Admin Matchups' own
 * calculation) for myProjAwaySpread/vegasAwaySpread — see
 * espnMlPool.ts for the full reasoning.
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
      cbsSelected: saved?.cbs_selected ?? false,
      cbsPickedSide: saved?.picked_side ?? null,
      cbsIsKeyPick: saved?.is_key_pick ?? false,
      kellySelected: saved?.kelly_selected ?? false,
      kellyPickedSide: saved?.kelly_picked_side ?? null,
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
