import { supabase } from "../supabaseClient";

export type BetBook = "bovada" | "betonlineag" | "novig" | "kalshi" | "dkpredictions" | "polymarket";
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
  dkpredictions: "DK Predictions",
  polymarket: "Polymarket",
};

// ---------------------------------------------------------------------
// Parlays — a single-game bet_type/side/line_value row can't represent a
// multi-leg bet, so parlays live in their own two tables instead: one
// row per parlay (the stake/to_win/price that's actually at risk) and
// one row per leg (which game, which side — no stake of its own, since
// the whole parlay's stake rides on every leg together). Kept separate
// from placed_bets rather than shoehorned in with a nullable game_id,
// so every placed_bets row can stay "one game, one real stake."
// ---------------------------------------------------------------------
export interface PlacedParlayLeg {
  id: number;
  parlay_id: number;
  game_id: string;
  season: number;
  week: number;
  away_team: string;
  home_team: string;
  bet_type: BetType;
  side: string;
  line_value: number | null;
  price: number | null;
}

export interface PlacedParlayRow {
  id: number;
  created_at: string;
  season: number;
  week: number;
  book: BetBook;
  price: number;
  stake: number | null;
  to_win: number | null;
  result: BetResult;
  legs: PlacedParlayLeg[];
}

export async function fetchPlacedParlays(season?: number): Promise<PlacedParlayRow[]> {
  let q = supabase.from("placed_bet_parlays").select("*, legs:placed_bet_parlay_legs(*)").order("created_at", { ascending: false });
  if (season != null) q = q.eq("season", season);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PlacedParlayRow[];
}

export interface JuicereelStatus {
  connected: boolean;
  displayName: string | null;
  scope: string | null;
  lastSyncCheckpoint: string | null;
}

export interface JuicereelSyncResult {
  ok: true;
  fetched: number;
  imported: number;
  skipped: { juicereelBetId: number; reason: string }[];
}

function juicereelPost(action: string, body: Record<string, any> = {}) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  return fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action, ...body }),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data;
  });
}

/** Starts the OAuth handshake — returns the JuiceReel URL to redirect the browser to. */
export function fetchJuicereelAuthorizeUrl(): Promise<{ url: string }> {
  return juicereelPost("juicereelAuthorizeUrl");
}

export function fetchJuicereelStatus(): Promise<JuicereelStatus> {
  return juicereelPost("juicereelStatus");
}

export function disconnectJuicereel(): Promise<{ ok: true }> {
  return juicereelPost("juicereelDisconnect");
}

export function syncJuicereel(): Promise<JuicereelSyncResult> {
  return juicereelPost("juicereelSync");
}
