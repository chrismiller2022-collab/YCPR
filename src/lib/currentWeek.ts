import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

// "Current week" = the highest week number with a game that's already
// kicked off, per that season's own synced schedule — not a fixed
// calendar-date table, so it stays correct regardless of Tue-Mon week
// boundaries, byes, or a season's exact start date. Falls back to 1
// before any game has kicked off (preseason, or nothing synced yet).
export async function fetchCurrentWeekNumber(season: number): Promise<number> {
  const { data, error } = await supabase
    .from("games")
    .select("week")
    .eq("season", season)
    .lte("start_date", new Date().toISOString())
    .order("week", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? data[0].week : 1;
}

/** React hook wrapper — same shape/usage as useWeekAccurateRatings. */
export function useCurrentWeek(season: number): { currentWeek: number; loading: boolean } {
  const [currentWeek, setCurrentWeek] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCurrentWeekNumber(season)
      .then((w) => {
        if (!cancelled) setCurrentWeek(w);
      })
      .catch(() => {
        if (!cancelled) setCurrentWeek(1);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  return { currentWeek, loading };
}

/**
 * Drop-in "default a week selector to the current week, once, without
 * fighting the user's own later clicks" — call alongside your own
 * useState(1) for `week`/`setWeek` and pass its returned setWeek to
 * your UI as normal. Applies the default exactly once, the first time
 * fetchCurrentWeekNumber resolves; any manual selection before or after
 * that is left alone.
 */
export function useDefaultToCurrentWeek(season: number, week: number, setWeek: (w: number) => void) {
  const { currentWeek, loading } = useCurrentWeek(season);
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current || loading) return;
    applied.current = true;
    setWeek(currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, currentWeek]);
}
