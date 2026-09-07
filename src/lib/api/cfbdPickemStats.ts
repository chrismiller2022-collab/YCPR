import { supabase } from "../supabaseClient";
import { fetchGamesWithLines } from "./gamesLines";
import { pickLine } from "../matchupsCompute";
import { actualCoverSide } from "./peayPool";

export interface CfbdPickemPrediction {
  game_id: string;
  season: number;
  predicted_margin: number;
}

export async function fetchCfbdPickemPredictions(season: number): Promise<CfbdPickemPrediction[]> {
  const { data, error } = await supabase.from("cfbd_pickem_predictions").select("*").eq("season", season);
  if (error) throw error;
  return data ?? [];
}

export async function saveCfbdPickemPredictions(
  season: number,
  rows: { game_id: string; predicted_margin: number }[]
): Promise<{ saved: number }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "cfbdpickem", action: "savePredictions", season, rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

export interface CfbdPickemStats {
  totalGames: number;
  completedGames: number;
  pendingGames: number;
  suWins: number;
  suLosses: number;
  atsWins: number;
  atsLosses: number;
  atsPushes: number;
  mae: number | null;
  mse: number | null;
}

function emptyStats(total: number): CfbdPickemStats {
  return { totalGames: total, completedGames: 0, pendingGames: total, suWins: 0, suLosses: 0, atsWins: 0, atsLosses: 0, atsPushes: 0, mae: null, mse: null };
}

/**
 * Grades every saved CFBD Pick'em prediction against actual results —
 * optionally narrowed to one week (a game's week is read off the joined
 * `games` row, not stored on the prediction itself). predicted_margin
 * uses CFBD's own convention (negative = home favored, positive = away
 * favored), which is the same sign convention `betting_lines.spread`
 * already uses site-wide — see peayPool.ts's actualCoverSide, reused
 * here unchanged for the ATS grade.
 */
export async function fetchCfbdPickemStats(season: number, week?: number): Promise<CfbdPickemStats> {
  const predictions = await fetchCfbdPickemPredictions(season);
  if (predictions.length === 0) return emptyStats(0);

  const gamesWithLines = await fetchGamesWithLines(season);
  const byId = new Map(gamesWithLines.map((g) => [g.id, g]));

  const scoped = week == null ? predictions : predictions.filter((p) => byId.get(p.game_id)?.week === week);
  const stats = emptyStats(scoped.length);

  let errSum = 0;
  let errSqSum = 0;
  let errCount = 0;

  for (const p of scoped) {
    const g = byId.get(p.game_id);
    if (!g || !g.completed || g.home_points == null || g.away_points == null) continue;
    stats.completedGames++;

    const actualHomeMargin = g.home_points - g.away_points;
    const predictedHomeMargin = -p.predicted_margin;

    const predictedWinner = p.predicted_margin < 0 ? "home" : p.predicted_margin > 0 ? "away" : null;
    const actualWinner = actualHomeMargin > 0 ? "home" : actualHomeMargin < 0 ? "away" : null;
    if (predictedWinner && actualWinner) {
      if (predictedWinner === actualWinner) stats.suWins++;
      else stats.suLosses++;
    }

    const line = pickLine(g.lines);
    const vegasAwaySpread = line?.spread != null ? -line.spread : null;
    if (vegasAwaySpread != null) {
      const predictedAwaySpread = p.predicted_margin;
      const pickedSide: "away" | "home" | null =
        predictedAwaySpread < vegasAwaySpread ? "away" : predictedAwaySpread > vegasAwaySpread ? "home" : null;
      const cover = actualCoverSide(g, vegasAwaySpread);
      if (pickedSide && cover) {
        if (cover === "push") stats.atsPushes++;
        else if (pickedSide === cover) stats.atsWins++;
        else stats.atsLosses++;
      }
    }

    const err = predictedHomeMargin - actualHomeMargin;
    errSum += Math.abs(err);
    errSqSum += err * err;
    errCount++;
  }

  stats.pendingGames = stats.totalGames - stats.completedGames;
  stats.mae = errCount > 0 ? errSum / errCount : null;
  stats.mse = errCount > 0 ? errSqSum / errCount : null;
  return stats;
}

export interface CfbdPickemPredictionDetail {
  game_id: string;
  week: number | null;
  start_date: string | null;
  away_team: string;
  home_team: string;
  predicted_margin: number;
  completed: boolean;
  away_points: number | null;
  home_points: number | null;
  suGrade: "win" | "loss" | "pending";
  atsGrade: "win" | "loss" | "push" | "pending";
}

/** Per-game list backing fetchCfbdPickemStats' totals — same grading, one row per saved prediction, for "which games" visibility. */
export async function fetchCfbdPickemPredictionDetails(season: number): Promise<CfbdPickemPredictionDetail[]> {
  const predictions = await fetchCfbdPickemPredictions(season);
  if (predictions.length === 0) return [];

  const gamesWithLines = await fetchGamesWithLines(season);
  const byId = new Map(gamesWithLines.map((g) => [g.id, g]));

  return predictions.map((p) => {
    const g = byId.get(p.game_id);
    if (!g) {
      return {
        game_id: p.game_id,
        week: null,
        start_date: null,
        away_team: "Unknown",
        home_team: "Unknown",
        predicted_margin: p.predicted_margin,
        completed: false,
        away_points: null,
        home_points: null,
        suGrade: "pending",
        atsGrade: "pending",
      };
    }

    let suGrade: "win" | "loss" | "pending" = "pending";
    let atsGrade: "win" | "loss" | "push" | "pending" = "pending";

    if (g.completed && g.home_points != null && g.away_points != null) {
      const actualHomeMargin = g.home_points - g.away_points;
      const predictedWinner = p.predicted_margin < 0 ? "home" : p.predicted_margin > 0 ? "away" : null;
      const actualWinner = actualHomeMargin > 0 ? "home" : actualHomeMargin < 0 ? "away" : null;
      if (predictedWinner && actualWinner) suGrade = predictedWinner === actualWinner ? "win" : "loss";

      const line = pickLine(g.lines);
      const vegasAwaySpread = line?.spread != null ? -line.spread : null;
      if (vegasAwaySpread != null) {
        const pickedSide: "away" | "home" | null =
          p.predicted_margin < vegasAwaySpread ? "away" : p.predicted_margin > vegasAwaySpread ? "home" : null;
        const cover = actualCoverSide(g, vegasAwaySpread);
        if (pickedSide && cover) {
          atsGrade = cover === "push" ? "push" : pickedSide === cover ? "win" : "loss";
        }
      }
    }

    return {
      game_id: p.game_id,
      week: g.week,
      start_date: g.start_date,
      away_team: g.away_team,
      home_team: g.home_team,
      predicted_margin: p.predicted_margin,
      completed: g.completed,
      away_points: g.away_points,
      home_points: g.home_points,
      suGrade,
      atsGrade,
    };
  });
}
