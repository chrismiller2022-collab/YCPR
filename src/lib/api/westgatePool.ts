import { supabase } from "../supabaseClient";
import { fetchGamesWithLines } from "./gamesLines";
import { computeRow } from "../matchupsCompute";
import type { GameRow } from "./gamesLines";

// The real Westgate Supercontest picks exactly 7 games a week — no key
// picks (that's a Peay/Brit concept, not Westgate's), pushes count as a
// half-win toward both record and points.
export const WESTGATE_PICK_LIMIT = 7;

export interface WestgateRow {
  game_id: string;
  game: GameRow;
  westgate_line: number | null;
  picked_side: "home" | "away" | null;
  myProjAwaySpread: number | null;
  vegasAwaySpread: number | null;
  openingAwaySpread: number | null;
  westgateVsMine: number | null;
  westgateVsVegas: number | null;
  wfbTeam: "away" | "home" | null;
  wfbAmountOff: number | null;
  projCoverTeam: "away" | "home" | null;
  actualCoverTeam: "away" | "home" | "push" | null;
}

export type WestgateGrade = "win" | "loss" | "push" | "pending";

/** Which side covered `line` (Westgate's own line, away-perspective) once the game's final — null if not completed or no line set yet. */
export function actualCoverSide(g: GameRow, line: number | null): "away" | "home" | "push" | null {
  if (!g.completed || g.home_points == null || g.away_points == null || line == null) return null;
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + line;
  return coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
}

export function gradeWestgatePick(row: WestgateRow): WestgateGrade {
  if (row.picked_side == null) return "pending";
  const side = actualCoverSide(row.game, row.westgate_line);
  if (side == null) return "pending";
  if (side === "push") return "push";
  return row.picked_side === side ? "win" : "loss";
}

/** 1 point per win, 0.5 per push — the real contest's tiebreaker scoring. */
export function westgatePoints(record: { wins: number; losses: number; pushes: number }): number {
  return record.wins + record.pushes * 0.5;
}

/**
 * Every FBS-vs-FBS game for the week, merged with any saved Westgate
 * line/pick. Unlike Brit, there's no separate "selection" step — every
 * FBS-vs-FBS game is in scope automatically. Uses computeRow() (Admin
 * Matchups' own calculation) for myProjAwaySpread/vegasAwaySpread/WFB —
 * see peayPool.ts for the full reasoning, this mirrors it exactly.
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
    // Defaults to Vegas — see peayPool.ts's fetchPeayWeek for the reasoning.
    const westgateLine = saved?.westgate_line ?? computed.vegasAwaySpread ?? null;
    const projCoverTeam: "away" | "home" | null =
      westgateLine == null || computed.projAwaySpread == null
        ? null
        : computed.projAwaySpread < westgateLine
        ? "away"
        : computed.projAwaySpread > westgateLine
        ? "home"
        : null;

    return {
      game_id: gwl.id,
      game: gwl,
      westgate_line: westgateLine,
      picked_side: saved?.picked_side ?? null,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread: computed.vegasAwaySpread,
      openingAwaySpread: computed.line?.opening_spread != null ? -computed.line.opening_spread : null,
      westgateVsMine: westgateLine != null && computed.projAwaySpread != null ? westgateLine - computed.projAwaySpread : null,
      westgateVsVegas: westgateLine != null && computed.vegasAwaySpread != null ? westgateLine - computed.vegasAwaySpread : null,
      wfbTeam: computed.weightedFilteredBetTeam,
      wfbAmountOff: computed.weightedFilteredBetTeam != null ? computed.absAmountOff : null,
      projCoverTeam,
      actualCoverTeam: actualCoverSide(gwl, westgateLine),
    };
  });
}

/** Every Westgate pick made all season — used to compute the live season record/points shown in the Standings tab. */
export async function fetchWestgateSeasonRows(season: number, liveByTeam: Record<string, any> = {}): Promise<WestgateRow[]> {
  const { data: westgate, error } = await supabase.from("westgate_picks").select("*").eq("season", season).not("picked_side", "is", null);
  if (error) throw error;
  if (!westgate || westgate.length === 0) return [];

  const weeks = Array.from(new Set(westgate.map((w) => w.week)));
  const gamesByWeek = await Promise.all(weeks.map((w) => fetchGamesWithLines(season, w)));
  const gamesById = new Map(gamesByWeek.flat().map((g) => [g.id, g]));

  return westgate
    .filter((w) => gamesById.has(w.game_id))
    .map((w) => {
      const gwl = gamesById.get(w.game_id)!;
      const computed = computeRow(gwl, liveByTeam);
      return {
        game_id: w.game_id,
        game: gwl,
        westgate_line: w.westgate_line ?? null,
        picked_side: w.picked_side ?? null,
        myProjAwaySpread: computed.projAwaySpread,
        vegasAwaySpread: computed.vegasAwaySpread,
        openingAwaySpread: null,
        westgateVsMine: null,
        westgateVsVegas: null,
        wfbTeam: null,
        wfbAmountOff: null,
        projCoverTeam: null,
        actualCoverTeam: actualCoverSide(gwl, w.westgate_line ?? null),
      };
    });
}
