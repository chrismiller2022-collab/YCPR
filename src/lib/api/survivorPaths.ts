import { supabase } from "../supabaseClient";

export interface SurvivorSavedPath {
  id: number;
  name: string;
  picks: Record<string, string[]>;
  created_at: string;
}

export async function fetchSavedPaths(): Promise<SurvivorSavedPath[]> {
  const { data, error } = await supabase.from("survivor_saved_paths").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Normalizes a path for comparison: sort each week's team list (pick
// order within a week doesn't make it a "different" path) and drop
// empty weeks entirely (an unset week and a week explicitly set to []
// should read as the same path).
function normalizePath(picks: Record<string, string[]>): string {
  const entries = Object.entries(picks)
    .filter(([, teams]) => teams.length > 0)
    .map(([week, teams]) => [week, [...teams].sort()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

export function pathsAreEqual(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** Throws a descriptive error if an identical path (same team per week, order-independent) is already saved. */
export async function saveSurvivorPath(name: string, picks: Record<string, string[]>): Promise<void> {
  const existing = await fetchSavedPaths();
  const dupe = existing.find((p) => pathsAreEqual(p.picks, picks));
  if (dupe) {
    throw new Error(`This path is identical to the already-saved path "${dupe.name}" — not saving a duplicate.`);
  }
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "survivorpaths", action: "save", name, picks }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save path");
}

export async function deleteSurvivorPath(id: number): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "survivorpaths", action: "delete", id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete path");
}
