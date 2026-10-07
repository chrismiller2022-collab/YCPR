import { supabase } from "../supabaseClient";

/**
 * Distinct `week` values saved for a season in a week-keyed table, ascending.
 *
 * A plain select("week") returns at most 1,000 rows (PostgREST's page cap) and
 * these tables hold hundreds to thousands of rows PER week, so it only ever saw
 * the first week or two — later saved weeks looked unsaved (which also made the
 * "will overwrite" checks wrong). This walks the weeks instead: ask for the
 * smallest week greater than the last one found, one row at a time.
 */
export async function fetchDistinctWeeks(table: string, season: number): Promise<number[]> {
  const found: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < 40; i++) {
    let q = supabase.from(table).select("week").eq("season", season).not("week", "is", null);
    if (last !== -Infinity) q = q.gt("week", last);
    const { data, error } = await q.order("week", { ascending: true }).limit(1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    last = (data[0] as { week: number }).week;
    found.push(last);
  }
  return found;
}
