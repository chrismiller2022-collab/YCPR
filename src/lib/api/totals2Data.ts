// Data for Totals v2 (Models → Totals → Model v2). Games, lines, play-level aggregates and preseason inputs are the
// same rows DROGBA loads (shared cache); the per-game advanced pull adds plays and drives for the pace ratings.
import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch, invalidateCacheKey } from "./cache";
import { DROGBA_FIRST_SEASON } from "./drogbaData";
import type { RawAdvRowT2 } from "../totals2/model";

export async function fetchTotals2Adv(): Promise<RawAdvRowT2[]> {
  return cachedFetch("totals2-adv", () =>
    fetchAllRows<RawAdvRowT2>((from, to) =>
      supabase
        .from("team_game_advanced")
        .select("game_id, team, season, week, off_success_rate, off_explosiveness, off_ppa, off_plays, off_drives")
        .gte("season", DROGBA_FIRST_SEASON)
        .order("game_id")
        .order("team")
        .range(from, to)
    )
  );
}

export interface SeasonGameVenue {
  id: string;
  week: number;
  venue_id: number | null;
  neutral_site: boolean | null;
  home_team: string;
  start_date: string | null;
  start_time_tbd: boolean | null;
}

export async function fetchSeasonGameVenues(season: number): Promise<SeasonGameVenue[]> {
  return cachedFetch(`totals2-venues:${season}`, () =>
    fetchAllRows<SeasonGameVenue>((from, to) =>
      supabase.from("games").select("id, week, venue_id, neutral_site, home_team, start_date, start_time_tbd").eq("season", season).order("id").range(from, to)
    )
  );
}

export interface Totals2PickRow {
  game_id: string;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  model_version: string | null;
  market_total: number | null;
  market_home_spread: number | null;
  market_provider: string | null;
  proj_total: number | null;
  proj_home_pts: number | null;
  proj_away_pts: number | null;
  stats_home_pts: number | null;
  stats_away_pts: number | null;
  yc_home_spread: number | null;
  open_total: number | null; // opening total when saved
  proj_move: number | null; // line-move model: expected open → close move of the total
  weather: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchTotals2Picks(season: number): Promise<Totals2PickRow[]> {
  return cachedFetch(`totals2-picks:${season}`, async () => {
    const rows = await fetchAllRows<Totals2PickRow>((from, to) => supabase.from("totals2_picks").select("*").eq("season", season).order("game_id").range(from, to));
    const num = (v: unknown) => (v == null ? null : Number(v));
    return rows.map((r) => ({
      ...r,
      market_total: num(r.market_total),
      market_home_spread: num(r.market_home_spread),
      proj_total: num(r.proj_total),
      proj_home_pts: num(r.proj_home_pts),
      proj_away_pts: num(r.proj_away_pts),
      stats_home_pts: num(r.stats_home_pts),
      stats_away_pts: num(r.stats_away_pts),
      yc_home_spread: num(r.yc_home_spread),
      open_total: num(r.open_total),
      proj_move: num(r.proj_move),
    }));
  });
}

export interface TeamTotalLineLite {
  game_id: string;
  week: number;
  team: string;
  provider: string | null;
  point: number | null;
  pulled_at: string | null;
}

/** Every real team-total line on file for a season (all pulls; the caller picks the one it wants per game/team). */
export async function fetchSeasonTeamTotalLines(season: number): Promise<TeamTotalLineLite[]> {
  return cachedFetch(`totals2-ttlines:${season}`, () =>
    fetchAllRows<TeamTotalLineLite>((from, to) =>
      supabase.from("team_total_lines").select("game_id, week, team, provider, point, pulled_at").eq("season", season).order("game_id").range(from, to)
    )
  );
}

function adminPassword(): string {
  return sessionStorage.getItem("admin_password") ?? "";
}

export async function saveTotals2Picks(picks: Omit<Totals2PickRow, "created_at">[], overwrite: boolean) {
  const res = await fetch("/api/admin-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword(), action: "saveTotals2Picks", picks, overwrite }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  invalidateCacheKey("totals2-picks:", true);
  return data as { saved: number; overwritten: number; skippedExisting: number; skippedStarted: number };
}

export function invalidateTotals2Cache() {
  invalidateCacheKey("totals2-", true);
}
