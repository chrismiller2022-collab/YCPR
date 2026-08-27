import { supabase } from "../supabaseClient";

export async function fetchExcludedTeams(): Promise<Set<string>> {
  const { data, error } = await supabase.from("survivor_excluded_teams").select("team");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.team));
}

export async function setTeamExcluded(team: string, excluded: boolean): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "survivorexcluded", action: excluded ? "add" : "remove", team }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update excluded teams");
}
