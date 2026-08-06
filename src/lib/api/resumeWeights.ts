import { supabase } from "../supabaseClient";

export async function fetchResumeWeights(season: number): Promise<Record<string, number> | null> {
  const { data, error } = await supabase
    .from("resume_rating_weights")
    .select("weights")
    .eq("season", season)
    .maybeSingle();
  if (error) throw error;
  return (data?.weights as Record<string, number>) ?? null;
}
