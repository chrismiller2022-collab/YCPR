import { supabase } from "../supabaseClient";
import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor } from "../lib/odds";
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
 * Every FBS-vs-FBS game for the week, merged with any saved Peay line/pick.
 * Unlike Brit, there's no separate "selection" step — every FBS-vs-FBS
 * game is in scope automatically.
 */
export async function fetchPeayWeek(season: number, week: number, liveByTeam: Record<string, any> = {}): Promise<PeayRow[]> {
  const [{ data: games, error: gamesError }, { data: lines, error: linesError }, { data: peay, error: peayError }] =
    await Promise.all([
      supabase
        .from("games")
        .select("*")
        .eq("season", season)
        .eq("week", week)
        .eq("home_classification", "fbs")
        .eq("away_classification", "fbs")
        .order("start_date", { ascending: true }),
      supabase.from("betting_lines").select("*").eq("season", season).eq("week", week),
      supabase.from("peay_picks").select("*").eq("season", season).eq("week", week),
    ]);
  if (gamesError) throw gamesError;
  if (linesError) throw linesError;
  if (peayError) throw peayError;

  const linesByGame = new Map<string, BettingLineRow[]>();
  for (const l of lines ?? []) {
    const list = linesByGame.get(l.game_id) ?? [];
    list.push(l);
    linesByGame.set(l.game_id, list);
  }
  const peayByGame = new Map((peay ?? []).map((p) => [p.game_id, p]));

  return (games ?? []).map((g) => {
    const line = pickLine(linesByGame.get(g.id) ?? []);
    const awayTeam = TEAMS_BY_NAME[g.away_team];
    const homeTeam = TEAMS_BY_NAME[g.home_team];
    const myProjAwaySpread =
      awayTeam && homeTeam ? awayTeam.rating - homeTeam.rating + hfaFor(g.home_team, liveByTeam) : null;
    const vegasAwaySpread = line?.spread != null ? -line.spread : null;

    const saved = peayByGame.get(g.id);
    const peayLine = saved?.peay_line ?? null;

    return {
      game_id: g.id,
      game: g,
      peay_line: peayLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread,
      vegasAwaySpread,
      peayVsMine: peayLine != null && myProjAwaySpread != null ? peayLine - myProjAwaySpread : null,
      peayVsVegas: peayLine != null && vegasAwaySpread != null ? peayLine - vegasAwaySpread : null,
    };
  });
}
