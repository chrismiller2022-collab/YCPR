import { createClient } from "@supabase/supabase-js";

// Mirrors admin-save.ts / brit-save.ts's auth pattern.

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

  const { password, season, week, rows } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!season || !week || !Array.isArray(rows)) {
    res.status(400).json({ error: "Missing season, week, or rows" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const cleanRows = rows.map((r: any) => ({
      season,
      week,
      game_id: r.game_id,
      peay_line: r.peay_line ?? null,
      picked_side: r.picked_side ?? null,
      is_key_pick: !!r.is_key_pick,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from("peay_picks")
      .upsert(cleanRows, { onConflict: "season,week,game_id" });
    if (error) throw error;

    res.status(200).json({ ok: true, saved: cleanRows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
