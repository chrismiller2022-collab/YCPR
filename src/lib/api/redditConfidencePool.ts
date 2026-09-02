import { supabase } from "../supabaseClient";
import { fetchGamesWithLines, type GameRow, type BettingLineRow } from "./gamesLines";
import { computeRow } from "../matchupsCompute";

// Reddit's Official CFB Pick 'Em (pickem.redditcfb.com) — a straight
// confidence pool, exactly 10 games, confidence points 10 (most
// confident) down to 1. Picks are submitted there by pasting a
// comma-separated list of team names in descending point order (their
// own fallback input literally says so) — Chris exports that list from
// here rather than re-entering picks manually on their site.

export interface RedditConfidencePickRow {
  id: number;
  season: number;
  week: number;
  game_id: string;
  picked_side: "home" | "away" | null;
  confidence_points: number | null;
}

export interface RedditConfidencePickWithGame extends RedditConfidencePickRow {
  game: GameRow | null;
  lines: BettingLineRow[];
  myProjAwaySpread: number | null;
  myProjAwayWinPct: number | null;
  vegasAwaySpread: number | null;
  amountOff: number | null; // myProjAwaySpread - vegasAwaySpread, informational only — never exported to the CSV
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

/**
 * This week's selected Reddit Confidence games, with projections/vegas
 * info attached. Reuses computeRow() (Admin Matchups' own calculation)
 * — see espnMlPool.ts for the full reasoning.
 */
export async function fetchRedditConfidencePicksForWeek(
  season: number,
  week: number,
  liveByTeam: Record<string, any> = {}
): Promise<RedditConfidencePickWithGame[]> {
  const { data: picks, error: picksError } = await supabase
    .from("reddit_confidence_picks")
    .select("*")
    .eq("season", season)
    .eq("week", week)
    .order("id", { ascending: true });
  if (picksError) throw picksError;
  if (!picks || picks.length === 0) return [];

  const gamesWithLines = await fetchGamesWithLines(season, week);
  const byGameId = new Map(gamesWithLines.map((g) => [g.id, g]));

  return picks.map((p) => {
    const gwl = byGameId.get(p.game_id) ?? null;
    if (!gwl) {
      return { ...p, game: null, lines: [], myProjAwaySpread: null, myProjAwayWinPct: null, vegasAwaySpread: null, amountOff: null };
    }

    const computed = computeRow(gwl, liveByTeam);
    const amountOff =
      computed.projAwaySpread != null && computed.vegasAwaySpread != null ? computed.projAwaySpread - computed.vegasAwaySpread : null;

    return {
      ...p,
      game: gwl,
      lines: gwl.lines,
      myProjAwaySpread: computed.projAwaySpread,
      myProjAwayWinPct: computed.projWinPct,
      vegasAwaySpread: computed.vegasAwaySpread,
      amountOff,
    };
  });
}

export type RedditConfidenceGrade = "win" | "loss" | "pending";

export function gradeRedditConfidencePick(pick: RedditConfidencePickWithGame): RedditConfidenceGrade {
  const g = pick.game;
  if (!g || !g.completed || g.home_points == null || g.away_points == null || !pick.picked_side) {
    return "pending";
  }
  if (g.home_points === g.away_points) return "pending";
  const actualWinnerSide = g.home_points > g.away_points ? "home" : "away";
  return pick.picked_side === actualWinnerSide ? "win" : "loss";
}

/** Points actually earned so far vs. total points in play this week. */
export function summarizeRedditConfidencePoints(picks: RedditConfidencePickWithGame[]) {
  let earned = 0;
  let possible = 0;
  for (const p of picks) {
    if (p.confidence_points == null) continue;
    possible += p.confidence_points;
    if (gradeRedditConfidencePick(p) === "win") earned += p.confidence_points;
  }
  return { earned, possible };
}
