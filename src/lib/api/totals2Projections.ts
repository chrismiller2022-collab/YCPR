// The stored Totals v2 numbers (written every few hours by .github/workflows/totals-v2.yml). Small and fast to read —
// this is what the site's totals use; nothing here rebuilds ratings.
import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch } from "./cache";

export interface Totals2ProjectionRow {
  game_id: string;
  season: number;
  week: number;
  start_date: string | null;
  home_team: string;
  away_team: string;
  model_version: string | null;
  market_provider: string | null;
  open_total: number | null;
  open_spread: number | null;
  line_total: number | null; // the line when computed
  line_spread: number | null;
  resid_total: number | null; // model's expected (actual − line); projected total = current line + this
  proj_total: number | null;
  proj_home_pts: number | null;
  proj_away_pts: number | null;
  open_proj_total: number | null;
  move: number | null; // expected open → close move of the total (the bet signal)
  star: boolean | null; // top-10% move = a bet
  stats_home_pts: number | null;
  stats_away_pts: number | null;
  weather: { dome?: boolean; avgWind?: number | null; precip?: number | null; snow?: number | null; temp?: number | null } | null;
  computed_at: string;
}

const NUMS = ["open_total", "open_spread", "line_total", "line_spread", "resid_total", "proj_total", "proj_home_pts", "proj_away_pts", "open_proj_total", "move", "stats_home_pts", "stats_away_pts"] as const;

export async function fetchTotals2Projections(season: number): Promise<Totals2ProjectionRow[]> {
  return cachedFetch(`totals2-proj:${season}`, async () => {
    const rows = await fetchAllRows<Totals2ProjectionRow>((from, to) => supabase.from("totals2_projections").select("*").eq("season", season).order("game_id").range(from, to));
    return rows.map((r) => {
      const o: any = { ...r };
      for (const k of NUMS) o[k] = r[k] == null ? null : Number(r[k]);
      return o as Totals2ProjectionRow;
    });
  });
}

/** game id → stored v2 row. Empty (never throws) when the table isn't reachable, so callers fall back to v1. */
export async function fetchTotals2ProjectionMap(season: number): Promise<Map<string, Totals2ProjectionRow>> {
  try {
    return new Map((await fetchTotals2Projections(season)).map((r) => [r.game_id, r]));
  } catch {
    return new Map();
  }
}
