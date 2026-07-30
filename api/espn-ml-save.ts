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

  const { password, action } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (action === "selectGames") {
      const { season, week, gameIds, keyGameId } = req.body;
      if (!season || !week || !Array.isArray(gameIds)) {
        res.status(400).json({ error: "Missing season, week, or gameIds" });
        return;
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from("espn_ml_picks")
        .select("id, game_id")
        .eq("season", season)
        .eq("week", week);
      if (existingError) throw existingError;

      const keepIds = new Set(gameIds);
      const toDelete = (existing ?? []).filter((r) => !keepIds.has(r.game_id)).map((r) => r.id);
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabaseAdmin.from("espn_ml_picks").delete().in("id", toDelete);
        if (deleteError) throw deleteError;
      }

      const rows = gameIds.map((gameId: string) => ({
        season,
        week,
        game_id: gameId,
        is_key_game: gameId === keyGameId,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabaseAdmin
        .from("espn_ml_picks")
        .upsert(rows, { onConflict: "season,week,game_id", ignoreDuplicates: false });
      if (upsertError) throw upsertError;

      res.status(200).json({ ok: true, saved: rows.length, removed: toDelete.length });
      return;
    }

    if (action === "savePicks") {
      const { picks } = req.body;
      if (!Array.isArray(picks) || picks.length === 0) {
        res.status(400).json({ error: "No picks to save" });
        return;
      }
      for (const p of picks) {
        const { error } = await supabaseAdmin
          .from("espn_ml_picks")
          .update({
            picked_side: p.picked_side ?? null,
            predicted_total_points: p.predicted_total_points ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
        if (error) throw error;
      }
      res.status(200).json({ ok: true, saved: picks.length });
      return;
    }

    if (action === "resetPicks") {
      const { season, week } = req.body;
      if (!season || !week) {
        res.status(400).json({ error: "Missing season or week" });
        return;
      }
      const { error } = await supabaseAdmin
        .from("espn_ml_picks")
        .update({ picked_side: null, predicted_total_points: null, updated_at: new Date().toISOString() })
        .eq("season", season)
        .eq("week", week);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
