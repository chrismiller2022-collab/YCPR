import { supabase } from "../supabaseClient";

export interface SurvivorPoolSettings {
  season: number;
  conferences: string[];
  updated_at: string;
}

export async function fetchSurvivorPoolSettings(season: number): Promise<SurvivorPoolSettings | null> {
  const { data, error } = await supabase.from("survivor_pool_settings").select("*").eq("season", season).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export interface SurvivorPoolEntrant {
  id: number;
  season: number;
  name: string;
  slug: string;
  created_at: string;
}

export async function fetchSurvivorPoolEntrants(season: number): Promise<SurvivorPoolEntrant[]> {
  const { data, error } = await supabase
    .from("survivor_pool_entrants")
    .select("*")
    .eq("season", season)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function survivorPoolAdminSave(body: any) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/survivor-pool-admin-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

export async function saveSurvivorPoolSettings(season: number, conferences: string[]) {
  return survivorPoolAdminSave({ action: "saveSettings", season, conferences });
}

export async function addSurvivorPoolEntrant(season: number, name: string): Promise<SurvivorPoolEntrant> {
  const data = await survivorPoolAdminSave({ action: "addEntrant", season, name });
  return data.entrant;
}

export async function removeSurvivorPoolEntrant(entrantId: number) {
  return survivorPoolAdminSave({ action: "removeEntrant", entrantId });
}
