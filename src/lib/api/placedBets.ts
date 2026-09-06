import { supabase } from "../supabaseClient";

export type BetBook = "bovada" | "betonlineag" | "novig" | "kalshi";
export type BetType = "spread" | "moneyline" | "total" | "team_total";
export type BetResult = "win" | "loss" | "push" | "pending";

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
  side: string; // team name for spread/moneyline/team_total, "over"/"under" for total/team_total
  line_value: number | null;
  price: number;
  stake: number | null;
  to_win: number | null;
  result: BetResult;
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
  stake?: number | null;
  toWin?: number | null;
  result?: BetResult;
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

// Bulk insert for the CSV importer — same shape as savePlacedBet's
// `bet`, just an array of them in one round trip instead of one POST per
// row. Parsing/team-matching happens client-side (parsePlacedBetsCsv);
// this just persists whatever it already resolved.
export async function importPlacedBets(bets: NewPlacedBet[]): Promise<{ imported: number }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "importPlacedBets", bets }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to import bets");
  return data;
}

export const BOOK_LABELS: Record<BetBook, string> = {
  bovada: "Bovada",
  betonlineag: "BetOnline",
  novig: "Novig",
  kalshi: "Kalshi",
};
