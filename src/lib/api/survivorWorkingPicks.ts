import { supabase } from "../supabaseClient";
import type { SurvivorRules } from "../survivorBoard";

// The admin Survivor page's working picks, one row per season + pool (survivor_working_picks). Before this they lived in
// each browser's localStorage, so the old keys are read once as a seed when the database has nothing yet.
const LEGACY_KEYS: Record<SurvivorRules, string> = { survivor: "survivor_picks_v1", splash: "splash_survivor_picks_v1" };

export async function fetchWorkingPicks(season: number, rules: SurvivorRules): Promise<{ picks: Record<string, string[]>; fromLegacy: boolean }> {
  const { data, error } = await supabase.from("survivor_working_picks").select("picks").eq("season", season).eq("pool", rules).maybeSingle();
  if (error) throw error;
  if (data?.picks) return { picks: data.picks as Record<string, string[]>, fromLegacy: false };
  try {
    const raw = localStorage.getItem(LEGACY_KEYS[rules]);
    const picks = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return { picks, fromLegacy: Object.keys(picks).length > 0 };
  } catch {
    return { picks: {}, fromLegacy: false };
  }
}

export async function saveWorkingPicks(season: number, rules: SurvivorRules, picks: Record<string, string[]>): Promise<void> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "survivorpicks", season, which: rules, picks }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to save picks");
}
