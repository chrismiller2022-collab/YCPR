import { supabase } from "../supabaseClient";

export interface WestgateStandingRow {
  id?: number;
  season: number;
  place_rank: number;
  place_label: string;
  alias: string;
  record: string | null;
  points: number | null;
  cash_prize: number | null;
}

export async function fetchWestgateStandings(season: number): Promise<WestgateStandingRow[]> {
  const { data, error } = await supabase.from("westgate_standings").select("*").eq("season", season).order("place_rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function importWestgateStandings(
  season: number,
  rows: Omit<WestgateStandingRow, "id" | "season">[]
): Promise<{ imported: number }> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "westgate", action: "importStandings", season, rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Import failed");
  return data;
}

export interface WestgatePoolSettings {
  season: number;
  entries: number;
  entry_fee: number;
}

const DEFAULT_SETTINGS: Omit<WestgatePoolSettings, "season"> = { entries: 774, entry_fee: 500 };

export async function fetchWestgatePoolSettings(season: number): Promise<WestgatePoolSettings> {
  const { data, error } = await supabase.from("westgate_pool_settings").select("*").eq("season", season).maybeSingle();
  if (error) throw error;
  return data ?? { season, ...DEFAULT_SETTINGS };
}

export async function saveWestgatePoolSettings(season: number, entries: number, entry_fee: number): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "westgate", action: "saveSettings", season, entries, entry_fee }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
}

/**
 * Maps place_rank -> this-person's share of the total pool, read off a
 * REFERENCE season's standings (one with cash_prize populated, e.g. last
 * year's final results). Ties already carry identical cash_prize per
 * person in the source data, so no special grouping is needed — take
 * whichever row for that rank as the representative percentage.
 */
export function computePayoutPctByRank(referenceRows: WestgateStandingRow[]): Map<number, number> {
  const totalCash = referenceRows.reduce((sum, r) => sum + (r.cash_prize ?? 0), 0);
  const pctByRank = new Map<number, number>();
  if (totalCash <= 0) return pctByRank;
  for (const r of referenceRows) {
    if (r.cash_prize == null || pctByRank.has(r.place_rank)) continue;
    pctByRank.set(r.place_rank, r.cash_prize / totalCash);
  }
  return pctByRank;
}

/** This season's projected payout for a given finishing rank, scaled off the reference season's percentages. */
export function projectPayout(rank: number, settings: WestgatePoolSettings, pctByRank: Map<number, number>): number {
  const pct = pctByRank.get(rank) ?? 0;
  return pct * settings.entries * settings.entry_fee;
}
