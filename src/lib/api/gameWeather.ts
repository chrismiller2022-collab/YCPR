import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch } from "./cache";

/** A stadium with coordinates — one row of `venues`, or a team's home stadium from `team_venues`. */
export interface VenueRow {
  id: number | null;
  name: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  dome: boolean | null;
  grass: boolean | null;
}

export interface TeamVenueRow {
  team: string;
  venue_id: number | null;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  capacity: number | null;
  grass: boolean | null;
  dome: boolean | null;
}

export interface GameVenueRow {
  id: string;
  venue_id: number | null;
  venue: string | null;
  start_time_tbd: boolean | null;
}

const num = (v: unknown) => (v == null ? null : Number(v));

/** Every team's home stadium (from the Team Info "Stadiums" pull), keyed by team name. */
export async function fetchTeamVenues(): Promise<Record<string, TeamVenueRow>> {
  return cachedFetch("team-venues", async () => {
    const rows = await fetchAllRows<TeamVenueRow>((from, to) =>
      supabase
        .from("team_venues")
        .select("team, venue_id, venue_name, city, state, timezone, latitude, longitude, elevation, capacity, grass, dome")
        .order("team")
        .range(from, to)
    );
    const out: Record<string, TeamVenueRow> = {};
    for (const r of rows) out[r.team] = { ...r, latitude: num(r.latitude), longitude: num(r.longitude), elevation: num(r.elevation) };
    return out;
  });
}

/** The venue CFBD lists for each game in a week (null until a games sync or Stadiums pull has stored it). */
export async function fetchGameVenues(season: number, week: number): Promise<Record<string, GameVenueRow>> {
  return cachedFetch(`game-venues:${season}:${week}`, async () => {
    const rows = await fetchAllRows<GameVenueRow>((from, to) =>
      supabase.from("games").select("id, venue_id, venue, start_time_tbd").eq("season", season).eq("week", week).order("id").range(from, to)
    );
    const out: Record<string, GameVenueRow> = {};
    for (const r of rows) out[r.id] = r;
    return out;
  });
}

export async function fetchVenuesByIds(ids: number[]): Promise<Record<number, VenueRow>> {
  const unique = Array.from(new Set(ids)).sort((a, b) => a - b);
  if (unique.length === 0) return {};
  return cachedFetch(`venues:${unique.join(",")}`, async () => {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, city, state, timezone, latitude, longitude, elevation, dome, grass")
      .in("id", unique);
    if (error) throw error;
    const out: Record<number, VenueRow> = {};
    for (const r of (data ?? []) as VenueRow[]) out[Number(r.id)] = { ...r, latitude: num(r.latitude), longitude: num(r.longitude), elevation: num(r.elevation) };
    return out;
  });
}

export type GameLocationSource = "venue" | "home";

export interface GameLocation {
  latitude: number;
  longitude: number;
  name: string | null;
  city: string | null;
  state: string | null;
  dome: boolean;
  source: GameLocationSource;
}

/**
 * Where a game is actually played. The venue CFBD lists for the game wins when it has coordinates — that covers
 * neutral sites and teams playing away from their usual stadium. Otherwise a non-neutral game falls back to the home
 * team's stadium. A neutral-site game with no venue has no location (the home team's city would be wrong).
 */
export function resolveGameLocation(
  game: { home_team: string; neutral_site: boolean },
  gameVenue: GameVenueRow | undefined,
  venues: Record<number, VenueRow>,
  teamVenues: Record<string, TeamVenueRow>
): GameLocation | null {
  const v = gameVenue?.venue_id != null ? venues[gameVenue.venue_id] : undefined;
  if (v && v.latitude != null && v.longitude != null) {
    return { latitude: v.latitude, longitude: v.longitude, name: v.name ?? gameVenue?.venue ?? null, city: v.city, state: v.state, dome: !!v.dome, source: "venue" };
  }
  if (game.neutral_site) return null;
  const t = teamVenues[game.home_team];
  if (t && t.latitude != null && t.longitude != null) {
    return { latitude: t.latitude, longitude: t.longitude, name: t.venue_name, city: t.city, state: t.state, dome: !!t.dome, source: "home" };
  }
  return null;
}

/** Runs the CFBD stadium pull (venues, team home stadiums, and the week's game venues) server-side. `week` null = whole season. */
export async function pullVenues(season: number, week: number | null) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/cfbd-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "teaminfo", password, year: season, week, parts: ["venues"] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Stadium pull failed");
  return data as {
    venues?: { venues: number; withCoords: number; teams: number; games: number; gamesWithVenue: number };
    warnings?: string[];
  };
}
