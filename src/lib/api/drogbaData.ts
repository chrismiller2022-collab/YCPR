import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch, invalidateCacheKey } from "./cache";
import type { RawGameRow, RawLineRow } from "../drogba/dataset";
import type { RawAdvRow, RawPlayAggRow } from "../drogba/efficiencyRatings";
import type { RawCoachSeason } from "../drogba/preseasonPrior";
import type { RawPreseasonRow } from "../drogba/preseason";

export const DROGBA_FIRST_SEASON = 2021;

export interface DrogbaRaw {
  games: RawGameRow[];
  lines: RawLineRow[];
}

// Raw rows; the page builds DGame[] from them (so switching the "open" book doesn't re-download anything).
export async function fetchDrogbaRaw(): Promise<DrogbaRaw> {
  return cachedFetch("drogba-raw", async () => {
    const [games, lines] = await Promise.all([
      fetchAllRows<RawGameRow>((from, to) =>
        supabase
          .from("games")
          .select("id, season, week, season_type, start_date, neutral_site, home_team, away_team, home_classification, away_classification, home_conference, away_conference, home_points, away_points, completed")
          .gte("season", DROGBA_FIRST_SEASON)
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<RawLineRow>((from, to) =>
        supabase.from("betting_lines").select("game_id, provider, spread, opening_spread, opening_over_under").gte("season", DROGBA_FIRST_SEASON).order("id").range(from, to)
      ),
    ]);
    return { games, lines };
  });
}

export async function fetchDrogbaAdv(): Promise<RawAdvRow[]> {
  return cachedFetch("drogba-adv", () =>
    fetchAllRows<RawAdvRow>((from, to) =>
      supabase
        .from("team_game_advanced")
        .select("game_id, team, season, week, off_success_rate, off_explosiveness, off_ppa")
        .gte("season", DROGBA_FIRST_SEASON)
        .order("game_id")
        .order("team")
        .range(from, to)
    )
  );
}

export async function fetchDrogbaPlays(): Promise<RawPlayAggRow[]> {
  return cachedFetch("drogba-plays", () =>
    fetchAllRows<RawPlayAggRow>((from, to) =>
      supabase
        .from("team_game_play_agg")
        .select("game_id, team, season, week, f_plays, f_success, f_ppa_success_sum, f_ppa_success_n, st_fg_att, st_fg_pts_over, st_ppa_sum, st_n, st_punt_net_yds, st_punt_net_n, st_ko_net_yds, st_ko_net_n")
        .gte("season", DROGBA_FIRST_SEASON)
        .order("game_id")
        .order("team")
        .range(from, to)
    )
  );
}

export async function fetchDrogbaCoaches(): Promise<RawCoachSeason[]> {
  return cachedFetch("drogba-coaches", () =>
    fetchAllRows<RawCoachSeason>((from, to) => supabase.from("team_coach_seasons").select("team, year, coach_id, games").order("team").order("year").range(from, to))
  );
}

export async function fetchDrogbaPreseason(): Promise<RawPreseasonRow[]> {
  return cachedFetch("drogba-preseason", () =>
    fetchAllRows<RawPreseasonRow>((from, to) =>
      supabase
        .from("team_preseason_inputs")
        .select("season, team, returning_ppa_pct, talent, recruiting_points, portal_in_rating_sum, portal_out_rating_sum")
        .order("season")
        .order("team")
        .range(from, to)
    )
  );
}

export interface DrogbaPickRow {
  game_id: string;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  model_home_spread: number;
  open_spread: number | null;
  open_provider: string | null;
  edge: number | null;
  tier: string | null;
  side: "home" | "away" | null;
  filtered: boolean;
  model_version: string | null;
  created_at: string;
}

export async function fetchDrogbaPicks(): Promise<DrogbaPickRow[]> {
  return fetchAllRows<DrogbaPickRow>((from, to) => supabase.from("drogba_picks").select("*").order("created_at", { ascending: false }).range(from, to));
}

export function invalidateDrogbaCache() {
  invalidateCacheKey("drogba-", true);
}

function adminPassword(): string {
  return sessionStorage.getItem("admin_password") ?? "";
}

export interface DrogbaPullResult {
  gameAdv?: { fetched: number; saved: number; withPpa: number; sample: Record<string, unknown> | null };
  preseason?: { teams: number; saved: number; counts: Record<string, number>; sample: Record<string, unknown> | null };
  plays?: {
    fetched: number;
    teamGames: number;
    saved: number;
    scrimmage: number;
    garbageDropped: number;
    ppaCoverage: { scrimmage: number | null; specialTeams: number | null };
    kicks: { puntNetAvg: number | null; puntNetCoverage: number | null; koNetAvg: number | null; koNetCoverage: number | null };
    topPlayTypes: [string, number][];
    sample: Record<string, unknown> | null;
  };
  warnings?: string[];
}

// One CFBD pull: one week of per-game advanced stats, or one season of preseason inputs. Needs
// CFBD_API_KEY on the server; the page loops these so each request stays small.
export async function pullDrogba(part: "gameadv" | "preseason" | "plays", season: number, week: number | null): Promise<DrogbaPullResult> {
  const res = await fetch("/api/cfbd-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "drogba", password: adminPassword(), year: season, week, part }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `DROGBA pull failed (${res.status})`);
  return data as DrogbaPullResult;
}

export interface SavePicksResult {
  saved: number;
  skippedExisting: number;
  overwritten: number;
}

export async function saveDrogbaPicks(
  picks: Omit<DrogbaPickRow, "created_at">[],
  overwrite: boolean
): Promise<SavePicksResult> {
  const res = await fetch("/api/admin-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword(), action: "saveDrogbaPicks", picks, overwrite }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  return data as SavePicksResult;
}
