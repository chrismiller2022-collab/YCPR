import { supabase } from "../supabaseClient";
import { fetchGamesWithLines } from "./gamesLines";
import { computeRow } from "../matchupsCompute";
import type { GameRow } from "./gamesLines";

export interface PeayRow {
  game_id: string;
  game: GameRow;
  peay_line: number | null;
  picked_side: "home" | "away" | null;
  is_key_pick: boolean;
  myProjAwaySpread: number | null;
  vegasAwaySpread: number | null;
  peayVsMine: number | null;
  peayVsVegas: number | null;
}

export type PeayGrade = "win" | "loss" | "push" | "pending";

export function gradePeayPick(row: PeayRow): PeayGrade {
  const g = row.game;
  if (!g.completed || g.home_points == null || g.away_points == null || row.picked_side == null || row.peay_line == null) {
    return "pending";
  }
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + row.peay_line;
  const actualCoverSide: "home" | "away" | "push" = coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
  if (actualCoverSide === "push") return "push";
  return row.picked_side === actualCoverSide ? "win" : "loss";
}

/**
 * Every FBS-vs-FBS game for the week, merged with any saved Peay
 * line/pick. Unlike Brit, there's no separate "selection" step — every
 * FBS-vs-FBS game is in scope automatically. Uses computeRow() (Admin
 * Matchups' own calculation) for myProjAwaySpread/vegasAwaySpread —
 * see espnMlPool.ts for the full reasoning.
 */
export async function fetchPeayWeek(season: number, week: number, liveByTeam: Record<string, any> = {}): Promise<PeayRow[]> {
  const [gamesWithLines, { data: peay, error: peayError }] = await Promise.all([
    fetchGamesWithLines(season, week),
    supabase.from("peay_picks").select("*").eq("season", season).eq("week", week),
  ]);
  if (peayError) throw peayError;

  const fbsGames = gamesWithLines.filter(
    (g) => (g.home_classification ?? "").toLowerCase() === "fbs" && (g.away_classification ?? "").toLowerCase() === "fbs"
  );
  const peayByGame = new Map((peay ?? []).map((p) => [p.game_id, p]));

  return fbsGames.map((gwl) => {
    const computed = computeRow(gwl, liveByTeam);
    const saved = peayByGame.get(gwl.id);
    // Defaults to Vegas so Chris doesn't have to retype every line that
    // matches Vegas exactly — only the ones the actual Peay Pool line
    // diverges from Vegas need to be typed over before saving.
    const peayLine = saved?.peay_line ?? computed.vegasAwaySpread ?? null;

    return {
      game_id: gwl.id,
      game: gwl,
      peay_line: peayLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread: computed.vegasAwaySpread,
      peayVsMine: peayLine != null && computed.projAwaySpread != null ? peayLine - computed.projAwaySpread : null,
      peayVsVegas: peayLine != null && computed.vegasAwaySpread != null ? peayLine - computed.vegasAwaySpread : null,
    };
  });
}
