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
  // The opening line CFBD had before any movement, away-perspective
  // (negated from the raw provider convention, same transform as
  // vegasAwaySpread) — null if no opening line was ever synced for
  // this game's provider.
  openingAwaySpread: number | null;
  peayVsMine: number | null;
  peayVsVegas: number | null;
  // Which side (if any) the Weighted Filtered Bet signal favors — same
  // computeRow() field Admin Matchups' WFB column reads.
  wfbTeam: "away" | "home" | null;
  // Magnitude behind that WFB signal (computeRow's absAmountOff) — WFB
  // firing is a yes/no threshold check, but the actual size of the
  // disagreement still varies underneath it, and Chris wants to see
  // that even on a WFB game that doesn't also clear a bigger amount-off
  // bar elsewhere.
  wfbAmountOff: number | null;
  // Which side my model likes against the Peay line specifically (not
  // Vegas) — informational only, doesn't drive picked_side/Pick
  // buttons, which stay fully manual per Chris's request.
  projCoverTeam: "away" | "home" | null;
  // Which side actually covered the Peay line, once the game's final —
  // null (not "pending") until then. Shares the exact margin math with
  // gradePeayPick via actualCoverSide, so the two can't diverge.
  actualCoverTeam: "away" | "home" | "push" | null;
}

export type PeayGrade = "win" | "loss" | "push" | "pending";

/** Which side covered `line` (Peay's own line, away-perspective) once the game's final — null if not completed or no line set yet. */
export function actualCoverSide(g: GameRow, line: number | null): "away" | "home" | "push" | null {
  if (!g.completed || g.home_points == null || g.away_points == null || line == null) return null;
  const actualAwayMargin = g.away_points - g.home_points;
  const coverMargin = actualAwayMargin + line;
  return coverMargin > 0 ? "away" : coverMargin < 0 ? "home" : "push";
}

export function gradePeayPick(row: PeayRow): PeayGrade {
  if (row.picked_side == null) return "pending";
  const side = actualCoverSide(row.game, row.peay_line);
  if (side == null) return "pending";
  if (side === "push") return "push";
  return row.picked_side === side ? "win" : "loss";
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
    const projCoverTeam: "away" | "home" | null =
      peayLine == null || computed.projAwaySpread == null
        ? null
        : computed.projAwaySpread < peayLine
        ? "away"
        : computed.projAwaySpread > peayLine
        ? "home"
        : null;

    return {
      game_id: gwl.id,
      game: gwl,
      peay_line: peayLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread: computed.projAwaySpread,
      vegasAwaySpread: computed.vegasAwaySpread,
      openingAwaySpread: computed.line?.opening_spread != null ? -computed.line.opening_spread : null,
      peayVsMine: peayLine != null && computed.projAwaySpread != null ? peayLine - computed.projAwaySpread : null,
      peayVsVegas: peayLine != null && computed.vegasAwaySpread != null ? peayLine - computed.vegasAwaySpread : null,
      wfbTeam: computed.weightedFilteredBetTeam,
      wfbAmountOff: computed.weightedFilteredBetTeam != null ? computed.absAmountOff : null,
      projCoverTeam,
      actualCoverTeam: actualCoverSide(gwl, peayLine),
    };
  });
}
