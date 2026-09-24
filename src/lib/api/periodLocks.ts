import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import type { PeriodKey } from "../periodSim";

export interface PeriodLockRow {
  game_id: string;
  season: number;
  week: number;
  home_team: string | null;
  away_team: string | null;
  neutral_site: boolean;
  game_home_spread: number | null;
  game_total: number | null;
  ridge_model_version: string | null;
  h1_away_spread: number | null;
  h1_total: number | null;
  h2_away_spread: number | null;
  h2_total: number | null;
  q1_away_spread: number | null;
  q1_total: number | null;
  q2_away_spread: number | null;
  q2_total: number | null;
  q3_away_spread: number | null;
  q3_total: number | null;
  q4_away_spread: number | null;
  q4_total: number | null;
  locked_at: string;
}

const COLS =
  "game_id, season, week, home_team, away_team, neutral_site, game_home_spread, game_total, ridge_model_version, h1_away_spread, h1_total, h2_away_spread, h2_total, q1_away_spread, q1_total, q2_away_spread, q2_total, q3_away_spread, q3_total, q4_away_spread, q4_total, locked_at";

export async function fetchPeriodLocks(season: number, week: number): Promise<Record<string, PeriodLockRow>> {
  const rows = await fetchAllRows<PeriodLockRow>((from, to) =>
    supabase.from("period_projection_locks").select(COLS).eq("season", season).eq("week", week).order("game_id").range(from, to)
  );
  const map: Record<string, PeriodLockRow> = {};
  for (const r of rows) map[r.game_id] = r;
  return map;
}

/** Locked (mean) away spread / total for one period, or null when that period isn't stored (the full game is in game_home_spread/game_total). */
export function lockedPeriodValue(lock: PeriodLockRow, period: Exclude<PeriodKey, "game">): { awaySpread: number | null; total: number | null } {
  return {
    awaySpread: lock[`${period}_away_spread` as keyof PeriodLockRow] as number | null,
    total: lock[`${period}_total` as keyof PeriodLockRow] as number | null,
  };
}

export async function lockPeriodProjections(candidates: Record<string, unknown>[]): Promise<{ locked: number; alreadyLocked: string[] }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "lockPeriodProjections", candidates }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Lock failed");
  return data;
}
