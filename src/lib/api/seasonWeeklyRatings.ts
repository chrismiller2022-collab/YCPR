import { supabase } from "../supabaseClient";

export interface SeasonWeeklyRatingRow {
  season: number;
  week: string;
  week_number: number;
  team: string;
  div: string | null;
  conf: string | null;
  rating: number | null;
  resume_rating: number | null;
  sor: number | null;
  rank: number | null;
}

/** Every distinct week_number archived for a season, ascending. */
export async function fetchSeasonAvailableWeeks(season: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("season_weekly_ratings")
    .select("week_number")
    .eq("season", season);
  if (error) throw error;
  const set = new Set<number>();
  for (const row of (data ?? []) as { week_number: number | null }[]) {
    if (row.week_number != null) set.add(row.week_number);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Resolves each requested game-week number to the correct archived
 * snapshot for that season: the latest archived week <= the target,
 * never a later one (a Week 3 game never uses Week 5's ratings), falling
 * back to the earliest archived week if nothing at-or-before the target
 * exists yet (e.g. requesting Week 1 of a season archived starting at
 * Week 2). Returns one ratings-by-team map per requested week number.
 */
export async function fetchSeasonWeeklyRatingsForWeeks(
  season: number,
  weekNumbers: number[]
): Promise<Record<number, Record<string, { rating: number | null }>>> {
  const uniqueTargets = Array.from(new Set(weekNumbers));
  const available = await fetchSeasonAvailableWeeks(season);

  const resolvedForTarget: Record<number, number | null> = {};
  const neededActualWeeks = new Set<number>();
  for (const wn of uniqueTargets) {
    const atOrBefore = available.filter((n) => n <= wn).sort((a, b) => b - a);
    const resolved = atOrBefore.length > 0 ? atOrBefore[0] : available[0] ?? null;
    resolvedForTarget[wn] = resolved;
    if (resolved != null) neededActualWeeks.add(resolved);
  }

  const byActualWeek: Record<number, Record<string, { rating: number | null }>> = {};
  if (neededActualWeeks.size > 0) {
    const { data, error } = await supabase
      .from("season_weekly_ratings")
      .select("week_number, team, rating")
      .eq("season", season)
      .in("week_number", Array.from(neededActualWeeks));
    if (error) throw error;
    for (const row of (data ?? []) as { week_number: number; team: string; rating: number | null }[]) {
      if (!byActualWeek[row.week_number]) byActualWeek[row.week_number] = {};
      byActualWeek[row.week_number][row.team] = { rating: row.rating };
    }
  }

  const out: Record<number, Record<string, { rating: number | null }>> = {};
  for (const wn of uniqueTargets) {
    const resolved = resolvedForTarget[wn];
    out[wn] = resolved != null ? byActualWeek[resolved] ?? {} : {};
  }
  return out;
}
