import { createClient } from "@supabase/supabase-js";

// Consolidates what used to be six separate serverless functions
// (brit-save, peay-save, espn-ml-save, espn-spread-save,
// espn-confidence-save, cbs-pickem-save) into one, dispatched by a
// `pool` field in the request body. This exists purely to stay under
// Vercel Hobby's 12-serverless-function-per-deployment cap — the actual
// logic is unchanged from each pool's original endpoint.
//
// cbssplash (CBS Splash) was added later as a straight copy of peay's
// shape/logic, targeting cbs_splash_picks/splash_line instead of
// peay_picks/peay_line — see the branch below.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Brit, ESPN Moneyline/Spreads/Confidence, and CBS Pickem all share the
// same "select games, then pick" shape (selectGames / savePicks /
// resetPicks). Peay is structurally different (no game-selection step,
// one "saveWeek" action) and is handled separately below.
const POOL_TABLES: Record<string, string> = {
  brit: "brit_picks",
  espnml: "espn_ml_picks",
  espnspread: "espn_spread_picks",
  espnconfidence: "espn_confidence_picks",
  cbspickem: "cbs_pickem_picks",
};

const SPECIAL_FIELD: Record<string, string> = {
  brit: "is_special",
  espnml: "is_key_game",
  espnspread: "is_key_game",
  espnconfidence: "is_key_game",
  cbspickem: "is_key_game",
};

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

  const { password, pool, action } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // --- Peay: its own distinct shape (all FBS-vs-FBS games auto-scoped,
    // one action that saves the whole week's lines/picks/key-picks at once) ---
    if (pool === "peay") {
      if (action !== "saveWeek") {
        res.status(400).json({ error: `Unknown action for peay: ${action}` });
        return;
      }
      const { season, week, rows } = req.body;
      if (!season || !week || !Array.isArray(rows)) {
        res.status(400).json({ error: "Missing season, week, or rows" });
        return;
      }
      const cleanRows = rows.map((r: any) => ({
        season,
        week,
        game_id: r.game_id,
        peay_line: r.peay_line ?? null,
        picked_side: r.picked_side ?? null,
        is_key_pick: !!r.is_key_pick,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("peay_picks").upsert(cleanRows, { onConflict: "season,week,game_id" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: cleanRows.length });
      return;
    }

    // --- CBS Splash: same shape as Peay, own table/field names ---
    if (pool === "cbssplash") {
      if (action !== "saveWeek") {
        res.status(400).json({ error: `Unknown action for cbssplash: ${action}` });
        return;
      }
      const { season, week, rows } = req.body;
      if (!season || !week || !Array.isArray(rows)) {
        res.status(400).json({ error: "Missing season, week, or rows" });
        return;
      }
      const cleanRows = rows.map((r: any) => ({
        season,
        week,
        game_id: r.game_id,
        splash_line: r.splash_line ?? null,
        picked_side: r.picked_side ?? null,
        is_key_pick: !!r.is_key_pick,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("cbs_splash_picks").upsert(cleanRows, { onConflict: "season,week,game_id" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: cleanRows.length });
      return;
    }

    // --- Westgate Supercontest: same shape as Peay/CBS Splash, own table/field names ---
    if (pool === "westgate") {
      if (action !== "saveWeek") {
        res.status(400).json({ error: `Unknown action for westgate: ${action}` });
        return;
      }
      const { season, week, rows } = req.body;
      if (!season || !week || !Array.isArray(rows)) {
        res.status(400).json({ error: "Missing season, week, or rows" });
        return;
      }
      const cleanRows = rows.map((r: any) => ({
        season,
        week,
        game_id: r.game_id,
        westgate_line: r.westgate_line ?? null,
        picked_side: r.picked_side ?? null,
        is_key_pick: !!r.is_key_pick,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("westgate_picks").upsert(cleanRows, { onConflict: "season,week,game_id" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: cleanRows.length });
      return;
    }

    // --- Survivor saved paths: named candidate paths, not tied to a season/week ---
    if (pool === "survivorpaths") {
      if (action === "save") {
        const { name, picks } = req.body;
        if (!name || typeof name !== "string" || !picks) {
          res.status(400).json({ error: "Missing name or picks" });
          return;
        }
        const { error } = await supabaseAdmin.from("survivor_saved_paths").insert({ name, picks });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      if (action === "delete") {
        const { id } = req.body;
        if (!id) {
          res.status(400).json({ error: "Missing id" });
          return;
        }
        const { error } = await supabaseAdmin.from("survivor_saved_paths").delete().eq("id", id);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: `Unknown action for survivorpaths: ${action}` });
      return;
    }

    // --- Brit / ESPN ML / ESPN Spreads / ESPN Confidence / CBS Pickem ---
    const table = POOL_TABLES[pool];
    const specialField = SPECIAL_FIELD[pool];
    if (!table) {
      res.status(400).json({ error: `Unknown pool: ${pool}` });
      return;
    }

    if (action === "selectGames") {
      const { season, week, gameIds, keyGameId, specialGameId } = req.body;
      const specialId = keyGameId ?? specialGameId ?? null;
      if (!season || !week || !Array.isArray(gameIds)) {
        res.status(400).json({ error: "Missing season, week, or gameIds" });
        return;
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from(table)
        .select("id, game_id")
        .eq("season", season)
        .eq("week", week);
      if (existingError) throw existingError;

      const keepIds = new Set(gameIds);
      const toDelete = (existing ?? []).filter((r: any) => !keepIds.has(r.game_id)).map((r: any) => r.id);
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabaseAdmin.from(table).delete().in("id", toDelete);
        if (deleteError) throw deleteError;
      }

      const rows = gameIds.map((gameId: string) => ({
        season,
        week,
        game_id: gameId,
        [specialField]: gameId === specialId,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabaseAdmin
        .from(table)
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
        const update: any = { picked_side: p.picked_side ?? null, updated_at: new Date().toISOString() };
        if (pool === "brit") {
          update.predicted_home_score = p.predicted_home_score ?? null;
          update.predicted_away_score = p.predicted_away_score ?? null;
        } else {
          update.predicted_total_points = p.predicted_total_points ?? null;
        }
        if (pool === "espnconfidence") {
          update.confidence_points = p.confidence_points ?? null;
        }
        const { error } = await supabaseAdmin.from(table).update(update).eq("id", p.id);
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
      const update: any = { picked_side: null, updated_at: new Date().toISOString() };
      if (pool === "brit") {
        update.predicted_home_score = null;
        update.predicted_away_score = null;
      } else {
        update.predicted_total_points = null;
      }
      if (pool === "espnconfidence") update.confidence_points = null;

      const { error } = await supabaseAdmin.from(table).update(update).eq("season", season).eq("week", week);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
