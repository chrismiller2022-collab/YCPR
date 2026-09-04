import { createClient } from "@supabase/supabase-js";

// Handles more than just bets now — saveBets (Admin Matchups),
// saveResumeWeights (Admin Resume Rating), and weeklyReportSign (Weekly
// Image Dump's PDF publish step) share this one function deliberately,
// to avoid adding a new serverless function on Vercel Hobby's
// 12-function cap. Same action-dispatched, password-gated pattern as
// brit-save.ts and friends.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEEKLY_REPORTS_BUCKET = "weekly-reports";

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
  // lockProjections is deliberately exempt from the password gate below
  // — it's append-only (INSERT ... ON CONFLICT DO NOTHING, can never
  // overwrite an existing lock), the values it writes are just "what
  // the live computation already says," and it needs to fire from the
  // PUBLIC matchups page too, not only when Chris happens to be logged
  // into admin — the whole point is catching a game the moment it
  // kicks off regardless of who's viewing the site right then.
  if (password !== ADMIN_PASSWORD && action !== "lockProjections") {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (action === "lockProjections") {
      const { candidates } = req.body;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        res.status(200).json({ locked: 0 });
        return;
      }
      const rows = candidates.map((c: any) => ({
        game_id: c.game_id,
        season: c.season,
        week: c.week,
        home_team: c.home_team,
        away_team: c.away_team,
        my_away_spread: c.my_away_spread ?? null,
        my_total: c.my_total ?? null,
        my_away_win_pct: c.my_away_win_pct ?? null,
      }));
      const { error, count } = await supabaseAdmin
        .from("game_projection_locks")
        .upsert(rows, { onConflict: "game_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      res.status(200).json({ locked: count ?? rows.length });
      return;
    }

    // Deliberate, explicit overwrite of an EXISTING lock — unlike
    // lockProjections (which can only ever create a lock, never touch
    // one that already exists), this is for correcting a lock that
    // captured the wrong number, e.g. because it was written after
    // ratings had already drifted from what was actually posted
    // publicly before kickoff. Requires the password (not exempted
    // like lockProjections) since this can genuinely overwrite data,
    // and updates locked_at to reflect when the correction was made.
    if (action === "overrideProjectionLock") {
      const { game_id, my_away_spread, my_total, my_away_win_pct } = req.body;
      if (!game_id) {
        res.status(400).json({ error: "game_id is required" });
        return;
      }
      const { error } = await supabaseAdmin
        .from("game_projection_locks")
        .update({
          my_away_spread: my_away_spread ?? null,
          my_total: my_total ?? null,
          my_away_win_pct: my_away_win_pct ?? null,
          locked_at: new Date().toISOString(),
        })
        .eq("game_id", game_id);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

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

    if (action === "saveGameTotalsSettings") {
      const { season, settings } = req.body;
      if (typeof season !== "number" || typeof settings !== "object" || settings == null) {
        res.status(400).json({ error: "season and settings are required" });
        return;
      }

      const { error } = await supabaseAdmin
        .from("game_totals_settings")
        .upsert({ season, settings, updated_at: new Date().toISOString() }, { onConflict: "season" });
      if (error) throw error;

      res.status(200).json({ ok: true });
      return;
    }

    if (action === "importTeamStatsCsv") {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "No rows to import" });
        return;
      }

      const statRows = rows.map((r: any) => ({ ...r, updated_at: new Date().toISOString() }));
      const { error, count } = await supabaseAdmin
        .from("team_season_stats")
        .upsert(statRows, { onConflict: "season,team", count: "exact" });
      if (error) throw error;

      res.status(200).json({ ok: true, imported: count ?? statRows.length });
      return;
    }

    if (action === "savePlacedBet") {
      const { bet } = req.body;
      if (!bet || !bet.gameId || !bet.book || !bet.betType || !bet.side || bet.price == null) {
        res.status(400).json({ error: "Missing required bet fields" });
        return;
      }

      const { error } = await supabaseAdmin.from("placed_bets").insert({
        game_id: bet.gameId,
        season: bet.season,
        week: bet.week,
        away_team: bet.awayTeam,
        home_team: bet.homeTeam,
        book: bet.book,
        bet_type: bet.betType,
        side: bet.side,
        line_value: bet.lineValue ?? null,
        price: bet.price,
      });
      if (error) throw error;

      res.status(200).json({ ok: true });
      return;
    }

    if (action === "weeklyReportSign") {
      const { week, division } = req.body;
      if (!week || typeof week !== "string") {
        res.status(400).json({ error: "Missing or invalid week" });
        return;
      }
      if (division !== "FBS" && division !== "FCS") {
        res.status(400).json({ error: "Missing or invalid division (must be FBS or FCS)" });
        return;
      }

      // FBS and FCS are now separate published reports — divisionqualified
      // path (was just `${week}.pdf` for one combined report).
      const path = `${week}-${division.toLowerCase()}.pdf`;
      // Remove any existing object first rather than relying on upsert —
      // Supabase's signed-upload-URL + upsert combination has open
      // reliability issues around overwriting existing files.
      await supabaseAdmin.storage.from(WEEKLY_REPORTS_BUCKET).remove([path]);

      const { data: signData, error: signError } = await supabaseAdmin.storage
        .from(WEEKLY_REPORTS_BUCKET)
        .createSignedUploadUrl(path);
      if (signError) throw signError;

      res.status(200).json({ ok: true, path, token: signData.token, signedUrl: signData.signedUrl });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Save failed" });
  }
}
