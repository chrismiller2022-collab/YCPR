import { createClient } from "@supabase/supabase-js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!ADMIN_PASSWORD) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured on the server" });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }

  const { password, season, week, numTrials, results, unmatchedTeams } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!season || !week || !numTrials || !Array.isArray(results)) {
    res.status(400).json({ error: "Missing season, week, numTrials, or results" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data, error } = await supabaseAdmin
      .from("monte_carlo_runs")
      .insert([
        {
          season,
          week,
          num_trials: numTrials,
          results,
          unmatched_teams: unmatchedTeams ?? [],
        },
      ])
      .select("id")
      .single();
    if (error) throw error;

    res.status(200).json({ ok: true, id: data.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
