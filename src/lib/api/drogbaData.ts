import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch, invalidateCacheKey } from "./cache";
import { buildGames, type DGame, type RawGameRow, type RawLineRow } from "../drogba/dataset";
import type { RawAdvRow } from "../drogba/efficiencyRatings";
import type { RawPreseasonRow } from "../drogba/preseason";
import type { LockLike } from "../drogba/consensus";

export const DROGBA_FIRST_SEASON = 2021;

export async function fetchDrogbaGames(): Promise<DGame[]> {
  return cachedFetch("drogba-games", async () => {
    const [games, lines] = await Promise.all([
      fetchAllRows<RawGameRow>((from, to) =>
        supabase
          .from("games")
          .select("id, season, week, season_type, start_date, neutral_site, home_team, away_team, home_classification, away_classification, home_points, away_points, completed")
          .gte("season", DROGBA_FIRST_SEASON)
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<RawLineRow>((from, to) =>
        supabase.from("betting_lines").select("game_id, provider, spread, opening_spread").gte("season", DROGBA_FIRST_SEASON).order("id").range(from, to)
      ),
    ]);
    return buildGames(games, lines);
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

export async function fetchDrogbaLocks(): Promise<(LockLike & { season: number; week: number })[]> {
  return cachedFetch("drogba-locks", () =>
    fetchAllRows<LockLike & { season: number; week: number }>((from, to) =>
      supabase.from("game_projection_locks").select("game_id, season, week, my_away_spread").order("game_id").range(from, to)
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
  warnings?: string[];
}

// One CFBD pull: one week of per-game advanced stats, or one season of preseason inputs. Needs
// CFBD_API_KEY on the server; the page loops these so each request stays small.
export async function pullDrogba(part: "gameadv" | "preseason", season: number, week: number | null): Promise<DrogbaPullResult> {
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
