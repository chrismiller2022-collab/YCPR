import { supabase } from "../supabaseClient";

export type BetBook = "bovada" | "betonlineag" | "novig" | "kalshi";
export type BetType = "spread" | "moneyline" | "total";

export interface PlacedBetRow {
  id: number;
  created_at: string;
  game_id: string;
  season: number;
  week: number;
  away_team: string;
  home_team: string;
  book: BetBook;
  bet_type: BetType;
  side: string; // team name for spread/moneyline, "over"/"under" for total
  line_value: number | null;
  price: number;
}

export interface NewPlacedBet {
  gameId: string;
  season: number;
  week: number;
  awayTeam: string;
  homeTeam: string;
  book: BetBook;
  betType: BetType;
  side: string;
  lineValue: number | null;
  price: number;
}

export async function fetchPlacedBets(season?: number): Promise<PlacedBetRow[]> {
  let q = supabase.from("placed_bets").select("*").order("created_at", { ascending: false });
  if (season != null) q = q.eq("season", season);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function savePlacedBet(bet: NewPlacedBet): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "savePlacedBet", bet }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save bet");
}

export const BOOK_LABELS: Record<BetBook, string> = {
  bovada: "Bovada",
  betonlineag: "BetOnline",
  novig: "Novig",
  kalshi: "Kalshi",
};
