import { supabase } from "../supabaseClient";

// The site's own known books get a fixed casing/label (below) so filters
// and the manual bet-entry dropdown stay tidy. Widened to `string` (not a
// closed union) so the CSV importer can accept a genuinely new book by
// name — e.g. "FanDuel" — without every display site needing a matching
// literal added first; every render site already falls back to the raw
// value via `BOOK_LABELS[x] ?? x`, so an unlisted book just shows as
// whatever text was imported instead of a mapped label.
export type BetBook = string;
export type KnownBetBook = "bovada" | "betonlineag" | "novig" | "kalshi" | "dkpredictions" | "polymarket" | "other";
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
// Bulk UPSERT (see the placed_bets_dedupe_key migration) on identity
// (game_id, book, bet_type, side, line_value, price, stake) — a row that
// matches a bet already saved updates it (result/stake/to_win/price)
// instead of inserting a duplicate, so re-uploading the same season sheet
// every week is safe.
export async function importPlacedBets(bets: NewPlacedBet[]): Promise<{ inserted: number; updated: number }> {
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

// Record<string, string> (not Record<KnownBetBook, string>) on purpose —
// BetBook is a plain string now, and every call site indexes this with a
// `bet.book` value (falling back to the raw string via `?? bet.book`), so
// the key type has to accept any string, not just the known literals.
export const BOOK_LABELS: Record<string, string> = {
  bovada: "Bovada",
  betonlineag: "BetOnline",
  novig: "Novig",
  kalshi: "Kalshi",
  dkpredictions: "DK Predictions",
  polymarket: "Polymarket",
  // CSV rows with no book column filled in (e.g. a manually tracked pick
  // with no specific sportsbook attached) land here rather than erroring.
  other: "Other / Unspecified",
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
