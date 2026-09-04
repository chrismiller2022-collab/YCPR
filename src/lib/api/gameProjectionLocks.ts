import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export interface GameProjectionLockRow {
  game_id: string;
  my_away_spread: number | null;
  my_total: number | null;
  my_away_win_pct: number | null;
}

/**
 * Reads existing locks for a season+week set. Public read (RLS allows
 * it) — no password needed, unlike writing one.
 */
export async function fetchGameProjectionLocks(season: number, weekNumbers: number[]): Promise<Record<string, GameProjectionLockRow>> {
  if (weekNumbers.length === 0) return {};
  const { data, error } = await supabase
    .from("game_projection_locks")
    .select("game_id, my_away_spread, my_total, my_away_win_pct")
    .eq("season", season)
    .in("week", weekNumbers);
  if (error) throw error;
  const map: Record<string, GameProjectionLockRow> = {};
  for (const row of data ?? []) map[row.game_id] = row;
  return map;
}

/** React hook wrapper around fetchGameProjectionLocks — same shape/usage as useWeekAccurateRatings. */
export function useGameProjectionLocks(season: number, weekNumbers: number[]) {
  const [locks, setLocks] = useState<Record<string, GameProjectionLockRow>>({});
  const [loading, setLoading] = useState(true);
  const key = Array.from(new Set(weekNumbers)).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGameProjectionLocks(season, weekNumbers)
      .then((data) => {
        if (!cancelled) setLocks(data);
      })
      .catch(() => {
        if (!cancelled) setLocks({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, key]);

  return { locks, loading };
}

export interface LockCandidate {
  game_id: string;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  my_away_spread: number | null;
  my_total: number | null;
  my_away_win_pct: number | null;
}

/**
 * Locks any of the given games that don't already have a lock —
 * INSERT ... ON CONFLICT DO NOTHING server-side, so this is always
 * safe to call speculatively (e.g. "lock anything that's kicked off
 * since I last visited this page") without any risk of overwriting an
 * existing lock. Needs the admin password since it writes.
 */
export async function overrideGameProjectionLock(
  gameId: string,
  values: { my_away_spread: number | null; my_total: number | null; my_away_win_pct: number | null }
): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "overrideProjectionLock", game_id: gameId, ...values }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to correct lock");
}

export async function lockGameProjections(candidates: LockCandidate[]): Promise<{ locked: number }> {
  if (candidates.length === 0) return { locked: 0 };
  // No admin password needed — lockProjections is deliberately exempt
  // server-side (see api/admin-bets-save.ts) since it's append-only and
  // needs to fire from public pages too, not just when Chris is logged
  // into admin.
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "lockProjections", candidates }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to lock projections");
  return data;
}
