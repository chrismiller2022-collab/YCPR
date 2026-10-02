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
 * Share of the prize pool paid to each of the top 10 PLACES (index 0 = 1st).
 * Only the top 10 places pay. Verified against two real final standings
 * files: 2025 (1st 40%, 2nd 20%, 3rd 15%, 4th 9%, a 3-way tie for 5th
 * splitting places 5-7 = 11%, a 3-way tie for 8th splitting places 8-10 =
 * 5%) and 2026's uploaded file (a 2-way tie for 1st = places 1-2 = 60%, a
 * 6-way tie for 3rd = places 3-8 = 37.5%, an 8-way tie for 9th = places
 * 9-10 only = 2.5%). Those files only ever show the SUMS for tied places,
 * so the split within 5-7 (5 / 3.5 / 2.5) and within 9-10 (1.5 / 1.0) is
 * an assumption — it only matters for a tie group that cuts through
 * those ranges, and the sums above are exact.
 */
export const WESTGATE_PLACE_PCT = [0.4, 0.2, 0.15, 0.09, 0.05, 0.035, 0.025, 0.025, 0.015, 0.01];

/**
 * Each person's payout when `groupSize` people finish tied starting at
 * `startRank`: the prize money for every place the group occupies AMONG THE
 * PAID PLACES (1-10) is pooled and split evenly across the whole group —
 * including people tied past the cutoff, who dilute the share rather than
 * being excluded (an 8-way tie for 9th splits only places 9 and 10).
 */
export function tieGroupPayoutPct(startRank: number, groupSize: number): number {
  let total = 0;
  for (let place = startRank; place < startRank + groupSize; place++) {
    total += WESTGATE_PLACE_PCT[place - 1] ?? 0;
  }
  return total / groupSize;
}

/** Projected payout for a finishing rank, given how many people share that rank (tie group size). */
export function projectPayout(rank: number, groupSize: number, settings: WestgatePoolSettings): number {
  return tieGroupPayoutPct(rank, groupSize) * settings.entries * settings.entry_fee;
}
