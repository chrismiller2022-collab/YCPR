import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export interface WeeklyTeamStats {
  team: string;
  week: string;
  rating: number | null;
  rank: number | null;
  sor: number | null;
  resume_rank: number | null;
  resume_rating: number | null;
  total_wins: number | null;
  season_win_line: number | null;
  preseason_proj: number | null;
  change_from_preseason: number | null;
  live_wins: number | null;
  live_losses: number | null;
  wins_left: number | null;
  losses_left: number | null;
  conf_proj_wins: number | null;
  conf_line: number | null;
  dif: number | null;
  abs_dif: number | null;
  bet: string | null;
  edge: number | null;
  conf_win_pct: number | null;
  fair_price: number | null;
  implied_pct: number | null;
  odds: number | null;
  value: number | null;
  natty_odds: number | null;
  draftkings_natty_odds: number | null;
  natty_rank: number | null;
  playoff_seed: number | null;
  ats_wins: number | null;
  ats_losses: number | null;
  games_completed: number | null;
  ats_rank: number | null;
  hfa: number | null;
}

/** All weeks that currently have at least one row saved, most recent first. */
export async function fetchAvailableWeeks(): Promise<string[]> {
  // Ordered by week_number — the actual chronological week, derived
  // server-side from the exact "preseason"/"week1".."week16" values the
  // dropdown sends (see weekToNumber in admin-save.ts). NOT updated_at:
  // that answers "when was this row last written," which briefly seemed
  // like the right fix for a different bug, but breaks the moment an
  // OLDER week gets corrected after newer weeks already exist — its
  // fresh timestamp would outrank weeks that are chronologically later.
  // week_number can't have that problem, since editing Week 1 never
  // changes the fact that it's numbered 1.
  const { data, error } = await supabase
    .from("weekly_team_stats")
    .select("week, week_number")
    .order("week_number", { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  const weeks: string[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.week)) {
      seen.add(row.week);
      weeks.push(row.week);
    }
  }
  return weeks;
}

/** Every team's stats for a single week. */
export async function fetchWeeklyStats(week: string): Promise<WeeklyTeamStats[]> {
  const { data, error } = await supabase
    .from("weekly_team_stats")
    .select("*")
    .eq("week", week);
  if (error) throw error;
  return data ?? [];
}

/** A single team's stats across every week saved so far (for progression charts). */
export async function fetchTeamHistory(team: string): Promise<WeeklyTeamStats[]> {
  const { data, error } = await supabase
    .from("weekly_team_stats")
    .select("*")
    .eq("team", team)
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface LastUpload {
  week: string;
  insertedAt: string;
}

/**
 * The single most recently saved row across every week — used by the Admin
 * dashboard's "Last upload date" card. Returns null if nothing has been
 * saved yet at all.
 */
export async function fetchLastUpload(): Promise<LastUpload | null> {
  // updated_at, not inserted_at — inserted_at only stamps on the row's
  // first-ever INSERT and is never touched by a later UPDATE, so this
  // had the identical blind spot as fetchAvailableWeeks did: a
  // re-upload under a previously-used week label would leave the Admin
  // dashboard's "Last upload date" card showing a stale date.
  const { data, error } = await supabase
    .from("weekly_team_stats")
    .select("week, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return { week: data[0].week, insertedAt: data[0].updated_at };
}

interface UseWeeklyStatsResult {
  rows: WeeklyTeamStats[];
  byTeam: Record<string, WeeklyTeamStats>;
  loading: boolean;
  error: string | null;
}

/**
 * React hook: loads every team's stats for the given week.
 * Pass "latest" to automatically resolve to the most recently saved week.
 */
export function useWeeklyStats(week: string): UseWeeklyStatsResult {
  const [rows, setRows] = useState<WeeklyTeamStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let targetWeek = week;
        if (week === "latest") {
          const weeks = await fetchAvailableWeeks();
          targetWeek = weeks[0] ?? "preseason";
        }
        const data = await fetchWeeklyStats(targetWeek);
        if (!cancelled) setRows(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load weekly stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [week]);

  const byTeam = Object.fromEntries(rows.map((r) => [r.team, r]));
  return { rows, byTeam, loading, error };
}

interface WeeklyChangeEntry {
  current: number | null;
  previous: number | null;
  change: number | null;
}

interface UseWeeklyChangeResult {
  byTeam: Record<string, WeeklyChangeEntry>;
  currentWeek: string | null;
  previousWeek: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * React hook: compares a single metric (e.g. "rating", "sor",
 * "resume_rating") between the two most recently saved weeks, per team.
 * Returns an empty map (not an error) until at least two weeks exist.
 */
export function useWeeklyChange(field: keyof WeeklyTeamStats): UseWeeklyChangeResult {
  const [byTeam, setByTeam] = useState<Record<string, WeeklyChangeEntry>>({});
  const [currentWeek, setCurrentWeek] = useState<string | null>(null);
  const [previousWeek, setPreviousWeek] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const weeks = await fetchAvailableWeeks();
        const current = weeks[0] ?? null;
        const previous = weeks[1] ?? null;

        if (!current || !previous) {
          if (!cancelled) {
            setByTeam({});
            setCurrentWeek(current);
            setPreviousWeek(previous);
          }
          return;
        }

        const [currentRows, previousRows] = await Promise.all([
          fetchWeeklyStats(current),
          fetchWeeklyStats(previous),
        ]);
        const previousByTeam = Object.fromEntries(previousRows.map((r) => [r.team, r]));

        const map: Record<string, WeeklyChangeEntry> = {};
        for (const row of currentRows) {
          const currentVal = row[field] as number | null;
          const previousVal = (previousByTeam[row.team]?.[field] as number | null) ?? null;
          map[row.team] = {
            current: currentVal,
            previous: previousVal,
            change: currentVal != null && previousVal != null ? currentVal - previousVal : null,
          };
        }

        if (!cancelled) {
          setByTeam(map);
          setCurrentWeek(current);
          setPreviousWeek(previous);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load weekly change");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [field]);

  return { byTeam, currentWeek, previousWeek, loading, error };
}
