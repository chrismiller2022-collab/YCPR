import { supabase } from "../supabaseClient";
import { fetchAllRows } from "./fetchAll";
import { cachedFetch } from "./cache";
import type { OddsEvent, SnapshotRow } from "../drogba/openers";

// Client side of the manual, credit-costing single-book spread pulls (see api/odds-feed.ts). Nothing here
// runs on its own; the DROGBA Data & sync tab calls these from buttons, after showing the cost.
function pw(): Record<string, string> {
  return { "x-admin-password": sessionStorage.getItem("admin_password") ?? "" };
}

export interface Quota {
  remaining: string | null;
  used: string | null;
  last: string | null;
}
export interface SpreadPull {
  book: string;
  timestamp: string | null;
  totalEvents: number;
  events: (OddsEvent & { lastUpdate: string | null })[];
  quota: Quota;
}

export async function pullBookSpreads(book: string, dateISO: string | null): Promise<SpreadPull> {
  const qs = new URLSearchParams({ mode: dateISO ? "historical-spreads" : "current-spreads", book });
  if (dateISO) qs.set("date", dateISO);
  const res = await fetch(`/api/odds-feed?${qs.toString()}`, { headers: pw() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Spread pull failed (${res.status})`);
  return data as SpreadPull;
}

export interface SnapshotInsert {
  game_id: string;
  book: string;
  snapshot_at: string;
  season: number;
  week: number;
  home_spread: number;
  home_price: number | null;
  away_price: number | null;
  is_historical: boolean;
}
export interface PullLog {
  book: string;
  target_at: string;
  snapshot_at: string | null;
  season: number | null;
  week: number | null;
  events: number;
  matched: number;
  credits_last: string | null;
  credits_remaining: string | null;
}

export async function saveBookSnapshots(rows: SnapshotInsert[], pull: PullLog): Promise<{ saved: number }> {
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: sessionStorage.getItem("admin_password") ?? "", action: "saveBookSpreadSnapshots", rows, pull }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  return data;
}

export async function fetchBookSnapshots(book: string): Promise<SnapshotRow[]> {
  return cachedFetch(`drogba-snap-${book}`, () =>
    fetchAllRows<SnapshotRow>((from, to) =>
      supabase.from("book_spread_snapshots").select("game_id, snapshot_at, home_spread").eq("book", book).order("game_id").order("snapshot_at").range(from, to)
    )
  );
}

export async function fetchPulledTargets(book: string): Promise<Set<number>> {
  const rows = await fetchAllRows<{ target_at: string }>((from, to) =>
    supabase.from("book_snapshot_pulls").select("target_at").eq("book", book).order("target_at").range(from, to)
  );
  return new Set(rows.map((r) => Date.parse(r.target_at)));
}
