import { supabase } from "../supabaseClient";
import { TEAMS_BY_NAME } from "../../data/teams";
import { hfaFor } from "../odds";
import type { GameRow, BettingLineRow } from "./gamesLines";

// Straight copy of peayPool.ts's shape for a second "ATS vs a custom line,
// every FBS-vs-FBS game" pool — CBS Splash. Kept as its own file (rather
// than parameterizing peayPool.ts) so each pool's table name/field names
// stay simple and grep-able, matching how every other pool in this app is
// structured (one file per pool, deliberate duplication over a shared
// generic).

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];
function pickLine(lines: BettingLineRow[]): BettingLineRow | null {
  if (lines.length === 0) return null;
  for (const p of PREFERRED_PROVIDERS) {
    const m = lines.find((l) => l.provider === p);
    if (m) return m;
  }
  return lines[0];
}

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
 * FBS-vs-FBS game is in scope automatically.
 */
export async function fetchCbsSplashWeek(season: number, week: number, liveByTeam: Record<string, any> = {}): Promise<CbsSplashRow[]> {
  const [{ data: games, error: gamesError }, { data: lines, error: linesError }, { data: splash, error: splashError }] =
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
      supabase.from("cbs_splash_picks").select("*").eq("season", season).eq("week", week),
    ]);
  if (gamesError) throw gamesError;
  if (linesError) throw linesError;
  if (splashError) throw splashError;

  const linesByGame = new Map<string, BettingLineRow[]>();
  for (const l of lines ?? []) {
    const list = linesByGame.get(l.game_id) ?? [];
    list.push(l);
    linesByGame.set(l.game_id, list);
  }
  const splashByGame = new Map((splash ?? []).map((p) => [p.game_id, p]));

  return (games ?? []).map((g) => {
    const line = pickLine(linesByGame.get(g.id) ?? []);
    const awayTeam = TEAMS_BY_NAME[g.away_team];
    const homeTeam = TEAMS_BY_NAME[g.home_team];
    const awayRating = awayTeam ? liveByTeam[g.away_team]?.rating ?? awayTeam.rating : null;
    const homeRating = homeTeam ? liveByTeam[g.home_team]?.rating ?? homeTeam.rating : null;
    const myProjAwaySpread =
      awayRating != null && homeRating != null ? awayRating - homeRating + hfaFor(g.home_team, liveByTeam) : null;
    const vegasAwaySpread = line?.spread != null ? -line.spread : null;

    const saved = splashByGame.get(g.id);
    const splashLine = saved?.splash_line ?? null;

    return {
      game_id: g.id,
      game: g,
      splash_line: splashLine,
      picked_side: saved?.picked_side ?? null,
      is_key_pick: saved?.is_key_pick ?? false,
      myProjAwaySpread,
      vegasAwaySpread,
      splashVsMine: splashLine != null && myProjAwaySpread != null ? splashLine - myProjAwaySpread : null,
      splashVsVegas: splashLine != null && vegasAwaySpread != null ? splashLine - vegasAwaySpread : null,
    };
  });
}
