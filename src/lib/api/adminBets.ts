import { supabase } from "../supabaseClient";

export interface AdminBetRow {
  id: number;
  season: number;
  week: number;
  away_team: string;
  home_team: string;
  bet_team: string;
  bet_spread: number;
  is_filtered: boolean;
  is_wfb: boolean;
  is_nwfb: boolean;
  placed_at: string;
}

export async function fetchBetsMade(season: number): Promise<AdminBetRow[]> {
  const { data, error } = await supabase
    .from("admin_bets")
    .select("*")
    .eq("season", season)
    .order("placed_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
