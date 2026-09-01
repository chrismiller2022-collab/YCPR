import { supabase } from "../supabaseClient";

// Separate table/pool from survivorPaths.ts on purpose — Splash Survivor
// is built around a different eligibility rule, so a path saved here has
// no relationship to the original tool's saved paths.

export interface SplashSurvivorSavedPath {
  id: number;
  name: string;
  picks: Record<string, string[]>;
  created_at: string;
}

export async function fetchSplashSavedPaths(): Promise<SplashSurvivorSavedPath[]> {
  const { data, error } = await supabase.from("splash_survivor_saved_paths").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function normalizePath(picks: Record<string, string[]>): string {
  const entries = Object.entries(picks)
    .filter(([, teams]) => teams.length > 0)
    .map(([week, teams]) => [week, [...teams].sort()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

export function splashPathsAreEqual(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  return normalizePath(a) === normalizePath(b);
}

export async function saveSplashSurvivorPath(name: string, picks: Record<string, string[]>): Promise<void> {
  const existing = await fetchSplashSavedPaths();
  const dupe = existing.find((p) => splashPathsAreEqual(p.picks, picks));
  if (dupe) {
    throw new Error(`This path is identical to the already-saved path "${dupe.name}" — not saving a duplicate.`);
  }
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "splashsurvivorpaths", action: "save", name, picks }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save path");
}

export async function deleteSplashSurvivorPath(id: number): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "splashsurvivorpaths", action: "delete", id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete path");
}
