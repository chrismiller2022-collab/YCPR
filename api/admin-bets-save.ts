import { createClient } from "@supabase/supabase-js";

// Handles more than just bets now — saveBets (Admin Matchups) and
// saveResumeWeights (Admin Resume Rating) share this one function
// deliberately, to avoid adding a new serverless function on Vercel
// Hobby's 12-function cap. Same action-dispatched, password-gated
// pattern as brit-save.ts and friends.

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

  const { password, action } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (action === "saveBets") {
      const { bets } = req.body;
      if (!Array.isArray(bets) || bets.length === 0) {
        res.status(400).json({ error: "No bets to save" });
        return;
      }

      const rows = bets.map((b: any) => ({
        season: b.season,
        week: b.week,
        away_team: b.awayTeam,
        home_team: b.homeTeam,
        bet_team: b.betTeam,
        bet_spread: b.betSpread,
        is_filtered: !!b.isFiltered,
        is_wfb: !!b.isWfb,
        is_nwfb: !!b.isNwfb,
      }));

      const { error } = await supabaseAdmin.from("admin_bets").insert(rows);
      if (error) throw error;

      res.status(200).json({ ok: true, saved: rows.length });
      return;
    }

    if (action === "saveResumeWeights") {
      const { season, weights } = req.body;
      if (typeof season !== "number" || typeof weights !== "object" || weights == null) {
        res.status(400).json({ error: "season and weights are required" });
        return;
      }

      const { error } = await supabaseAdmin
        .from("resume_rating_weights")
        .upsert({ season, weights, updated_at: new Date().toISOString() }, { onConflict: "season" });
      if (error) throw error;

      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
