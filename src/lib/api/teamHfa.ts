import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import type { HfaSource } from "./ratingSystems";

export interface TeamHfaRow {
  season: number;
  week: number;
  team: string;
  source: HfaSource;
  value: number;
  as_of: string | null;
  updated_at: string;
}

/** Every saved HFA input for a season (all weeks, all sources). */
export async function fetchTeamHfa(season: number): Promise<TeamHfaRow[]> {
  const rows = await fetchAllRows<TeamHfaRow>((from, to) =>
    supabase.from("team_hfa").select("season, week, team, source, value, as_of, updated_at").eq("season", season).order("week").order("team").order("source").range(from, to)
  );
  return rows.map((r) => ({ ...r, value: Number(r.value) }));
}

/** source -> week -> team -> value, for "latest week at or before N" lookups. */
export type HfaBySource = Partial<Record<HfaSource, Record<number, Record<string, number>>>>;

export function indexTeamHfa(rows: TeamHfaRow[]): HfaBySource {
  const out: HfaBySource = {};
  for (const r of rows) {
    const bySource = (out[r.source] ??= {});
    (bySource[r.week] ??= {})[r.team] = r.value;
  }
  return out;
}

/**
 * A source's value for `team` going into `week`: the latest saved week at or before it. When the source has nothing that
 * early, falls back to its earliest saved week and flags it (that value was set after the game, so it's lookahead).
 */
export function hfaAsOf(index: HfaBySource, source: HfaSource, team: string, week: number): { value: number; lookahead: boolean } | null {
  const byWeek = index[source];
  if (!byWeek) return null;
  const weeks = Object.keys(byWeek)
    .map(Number)
    .filter((w) => byWeek[w][team] != null)
    .sort((a, b) => a - b);
  if (weeks.length === 0) return null;
  const atOrBefore = weeks.filter((w) => w <= week);
  if (atOrBefore.length > 0) return { value: byWeek[atOrBefore[atOrBefore.length - 1]][team], lookahead: false };
  return { value: byWeek[weeks[0]][team], lookahead: true };
}
