import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";

export interface TeamGameAdvancedRow {
  game_id: string;
  team: string;
  season: number;
  week: number | null;
  opponent: string | null;
  off_success_rate: number | null;
  def_success_rate: number | null;
  net_success_rate: number | null;
}

export interface TeamCoachRow {
  season: number;
  team: string;
  coach_name: string;
  hire_date: string | null;
  tenure_seasons: number | null;
  first_year_at_school: number | null;
  latest_year_with_data: number | null;
}

export interface TeamCoachSeasonRow {
  team: string;
  year: number;
  coach_id: string;
  coach_name: string;
  hire_date: string | null;
  games: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  srs: number | null;
  sp_overall: number | null;
  preseason_rank: number | null;
  postseason_rank: number | null;
}

/** Every coach-season CFBD reported for one team (needs the Team Info "Coaches" pull to have run since coach history was added). */
export async function fetchTeamCoachSeasons(team: string): Promise<TeamCoachSeasonRow[]> {
  const { data, error } = await supabase
    .from("team_coach_seasons")
    .select("team, year, coach_id, coach_name, hire_date, games, wins, losses, ties, srs, sp_overall, preseason_rank, postseason_rank")
    .eq("team", team)
    .order("year", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TeamCoachSeasonRow[];
}

export async function fetchTeamGameAdvanced(season: number): Promise<TeamGameAdvancedRow[]> {
  return fetchAllRows<TeamGameAdvancedRow>((from, to) =>
    supabase
      .from("team_game_advanced")
      .select("game_id, team, season, week, opponent, off_success_rate, def_success_rate, net_success_rate")
      .eq("season", season)
      .order("game_id")
      .order("team")
      .range(from, to)
  );
}

export async function fetchTeamCoaches(season: number): Promise<Record<string, TeamCoachRow>> {
  const rows = await fetchAllRows<TeamCoachRow>((from, to) =>
    supabase
      .from("team_coaches")
      .select("season, team, coach_name, hire_date, tenure_seasons, first_year_at_school, latest_year_with_data")
      .eq("season", season)
      .order("team")
      .range(from, to)
  );
  const out: Record<string, TeamCoachRow> = {};
  for (const r of rows) out[r.team] = r;
  return out;
}

/** Runs the CFBD Team Info pull server-side (needs CFBD_API_KEY there). `week` null = whole season. */
export async function pullTeamInfo(season: number, week: number | null, parts: string[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/cfbd-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "teaminfo", password, year: season, week, parts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Team info pull failed");
  return data as {
    pgwe?: { games: number; withPgwe: number };
    netSr?: { fetched: number; saved: number };
    coaches?: { fetched: number; historySeasons?: number; teams: number; staleTeams: number };
    warnings?: string[];
  };
}
