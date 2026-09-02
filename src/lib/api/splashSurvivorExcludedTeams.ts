import { supabase } from "../supabaseClient";

// Separate table/pool from survivorExcludedTeams.ts — Splash Survivor's
// don't-use list is independent of the original tool's.

export async function fetchSplashExcludedTeams(): Promise<Set<string>> {
  const { data, error } = await supabase.from("splash_survivor_excluded_teams").select("team");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.team));
}

export async function setSplashTeamExcluded(team: string, excluded: boolean): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "splashsurvivorexcluded", action: excluded ? "add" : "remove", team }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update excluded teams");
}
