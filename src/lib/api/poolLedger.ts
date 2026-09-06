import { supabase } from "../supabaseClient";

export interface PoolLedgerEntry {
  id?: number;
  season: number;
  pool_key: string;
  label: string;
  cost: number;
  winnings: number;
  is_hypothetical: boolean;
  note: string | null;
}

export async function fetchPoolLedger(season: number, isHypothetical: boolean): Promise<PoolLedgerEntry[]> {
  const { data, error } = await supabase
    .from("pool_ledger_entries")
    .select("*")
    .eq("season", season)
    .eq("is_hypothetical", isHypothetical)
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function savePoolLedgerEntry(entry: PoolLedgerEntry): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "ledger", action: "upsertEntry", entry }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
}
