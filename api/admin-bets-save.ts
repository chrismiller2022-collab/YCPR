import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Handles more than just bets now — saveBets (Admin Matchups),
// saveResumeWeights (Admin Resume Rating), weeklyReportSign (Weekly
// Image Dump's PDF publish step), and now the JuiceReel bet-sync actions
// share this one function deliberately, to avoid adding a new serverless
// function on Vercel Hobby's 12-function cap. Same action-dispatched,
// password-gated pattern as brit-save.ts and friends. (The JuiceReel
// OAuth redirect callback itself is the one piece that couldn't live
// here — its URL is fixed by what's registered on the JuiceReel OAuth
// application — see juicereel-oauth-callback.ts.)

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEEKLY_REPORTS_BUCKET = "weekly-reports";

const JUICEREEL_CLIENT_ID = process.env.JUICEREEL_CLIENT_ID;
const JUICEREEL_CLIENT_SECRET = process.env.JUICEREEL_CLIENT_SECRET;
const JUICEREEL_API_BASE = "https://external-api.juicereel.com";
const JUICEREEL_AUTHORIZE_URL = "https://www.juicereel.com/oauth2/authorize";
// Must exactly match juicereel-oauth-callback.ts's own REDIRECT_URI and
// the Redirect URI registered on the JuiceReel OAuth application.
const JUICEREEL_REDIRECT_URI = "https://ycpr.vercel.app/api/juicereel-oauth-callback";

// JuiceReel's own book names, mapped to this site's fixed BetBook enum
// (bovada/betonlineag/novig/kalshi/dkpredictions). Anything not listed
// here (FanDuel, BetMGM, Caesars, PrizePicks, etc.) is a book JuiceReel
// tracks but this site doesn't — those bets are silently skipped during
// sync, not treated as errors. NOT yet verified against a real synced
// bet from every one of these five — confirm the exact `Site.name`
// spelling JuiceReel sends once a real sync runs, and adjust here if any
// don't actually match.
const JUICEREEL_BOOK_MAP: Record<string, string> = {
  novig: "novig",
  kalshi: "kalshi",
  bovada: "bovada",
  betonline: "betonlineag",
  "betonline.ag": "betonlineag",
  "draftkings predictions": "dkpredictions",
  "dk predictions": "dkpredictions",
};

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// subbetType -> this site's fixed BetType enum. Only "Moneyline" is
// confirmed from JuiceReel's own docs example — the rest are a best
// guess at their naming and NOT yet verified against a real bet; a
// sync that can't confidently classify a subbetType skips it (see
// mapBetType's null return) rather than guessing wrong on real money.
function mapBetType(subbetType: string): "spread" | "moneyline" | "total" | "team_total" | null {
  const t = (subbetType ?? "").toLowerCase();
  if (t.includes("team") && t.includes("total")) return "team_total";
  if (t.includes("total")) return "total";
  if (t.includes("spread")) return "spread";
  if (t.includes("money")) return "moneyline";
  return null;
}

// JuiceReel's settlement result -> this site's fixed BetResult enum.
// "Cancelled"/"Void" is treated as a push (stake returned, no money
// changed hands) rather than dropped, so it still shows up as settled.
function mapJuicereelResult(r: string | null | undefined): "win" | "loss" | "push" | "pending" {
  const t = (r ?? "").toLowerCase();
  if (t === "won" || t === "win") return "win";
  if (t === "lost" || t === "loss") return "loss";
  if (t === "push" || t === "cancelled" || t === "canceled" || t === "voided" || t === "void") return "push";
  return "pending";
}

async function refreshJuiceReelTokenIfNeeded(supabaseAdmin: any, connection: any) {
  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return connection; // still good for another minute+
  const res = await fetch(`${JUICEREEL_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${JUICEREEL_CLIENT_ID}:${JUICEREEL_CLIENT_SECRET}`).toString("base64")}`,
      "X-OAuth-Client-Id": JUICEREEL_CLIENT_ID!,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refresh_token }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? "JuiceReel token refresh failed");
  const updated = {
    ...connection,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope ?? connection.scope,
  };
  const { error } = await supabaseAdmin
    .from("juicereel_connection")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at: updated.expires_at,
      scope: updated.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw error;
  return updated;
}

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
  // syncTeamTotals is exempt from the password gate: it just mirrors
  // whatever The Odds API is currently quoting (upsert, always
  // overwritable by a fresher pull), can't corrupt anything the site
  // actually computes, and needs to fire from the PUBLIC matchups page.
  // lockProjections USED to be exempt too, on the theory that it's
  // append-only so it couldn't do harm — but "append-only" isn't the
  // same as "safe": it was firing opportunistically from page views
  // (see the removed useAutoLockProjections), which meant a game's
  // projection got frozen at whatever moment someone next happened to
  // load a page after kickoff, using whatever ratings were live AT THAT
  // MOMENT — not at kickoff, and not necessarily what was true when
  // picks were actually made. That's what caused Week 1's locked values
  // to already disagree with the pregame report before anything else
  // ever touched them. Freezing a week is now a single deliberate admin
  // action (see LockGamesPanel.tsx) and requires the password like any
  // other write.
  if (password !== ADMIN_PASSWORD && action !== "syncTeamTotals") {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (action === "lockProjections") {
      const { candidates } = req.body;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        res.status(200).json({ locked: 0, alreadyLocked: [], failed: [] });
        return;
      }
      const gameIds = candidates.map((c: any) => c.game_id);
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("game_projection_locks")
        .select("game_id")
        .in("game_id", gameIds);
      if (existingError) throw existingError;
      const alreadyLockedIds = new Set((existing ?? []).map((r: any) => r.game_id));

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
      // INSERT ... ON CONFLICT DO NOTHING — a game already locked is
      // never overwritten by this action, no matter what value is
      // submitted for it. Correcting an existing lock is a separate,
      // explicit action (overrideProjectionLock below).
      const { error } = await supabaseAdmin
        .from("game_projection_locks")
        .upsert(rows, { onConflict: "game_id", ignoreDuplicates: true });
      if (error) throw error;

      const newlyLocked = candidates.filter((c: any) => !alreadyLockedIds.has(c.game_id));
      res.status(200).json({
        locked: newlyLocked.length,
        newlyLockedGameIds: newlyLocked.map((c: any) => c.game_id),
        alreadyLocked: Array.from(alreadyLockedIds),
      });
      return;
    }

    // Freezes a week's period (1H/2H/quarter) projections. Same rule as
    // lockProjections above: INSERT ... ON CONFLICT DO NOTHING, so a game
    // that's already locked is never rewritten — retraining the ridge
    // model later can't change a past week's numbers.
    if (action === "lockPeriodProjections") {
      const { candidates } = req.body;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        res.status(200).json({ locked: 0, alreadyLocked: [] });
        return;
      }
      const gameIds = candidates.map((c: any) => c.game_id);
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("period_projection_locks")
        .select("game_id")
        .in("game_id", gameIds);
      if (existingError) throw existingError;
      const alreadyLockedIds = new Set((existing ?? []).map((r: any) => r.game_id));
      const cols = [
        "game_id", "season", "week", "home_team", "away_team", "neutral_site", "game_home_spread", "game_total", "ridge_model_version",
        "h1_away_spread", "h1_total", "h2_away_spread", "h2_total",
        "q1_away_spread", "q1_total", "q2_away_spread", "q2_total", "q3_away_spread", "q3_total", "q4_away_spread", "q4_total",
      ];
      const rows = candidates.map((c: any) => Object.fromEntries(cols.map((k) => [k, c[k] ?? null])));
      const { error } = await supabaseAdmin
        .from("period_projection_locks")
        .upsert(rows, { onConflict: "game_id", ignoreDuplicates: true });
      if (error) throw error;
      const newlyLocked = candidates.filter((c: any) => !alreadyLockedIds.has(c.game_id));
      res.status(200).json({ locked: newlyLocked.length, alreadyLocked: Array.from(alreadyLockedIds) });
      return;
    }

    // One-time historical pulls (Odds API historical endpoint, real credits).
    // INSERT ... ON CONFLICT DO NOTHING: an already-saved historical line is
    // never overwritten, so re-running a pull can't change it.
    if (action === "savePeriodMarketLines") {
      // overwrite=true is for refreshing CURRENT-week lines (they move until
      // kickoff); historical pulls never pass it.
      const { rows, overwrite } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(200).json({ saved: 0 });
        return;
      }
      const saveRows = rows.map((r: any) => ({
        game_id: r.game_id,
        season: r.season,
        week: r.week,
        period: r.period,
        market_type: r.market_type,
        provider: r.provider ?? null,
        point: r.point ?? null,
        home_price: r.home_price ?? null,
        away_price: r.away_price ?? null,
        over_price: r.over_price ?? null,
        under_price: r.under_price ?? null,
        is_historical: !!r.is_historical,
        pulled_at: r.pulled_at ?? new Date().toISOString(),
      }));
      const { error, count } = await supabaseAdmin
        .from("period_market_lines")
        .upsert(saveRows, { onConflict: "game_id,period,market_type,provider", ignoreDuplicates: !overwrite, count: "exact" });
      if (error) throw error;
      res.status(200).json({ saved: count ?? saveRows.length });
      return;
    }

    // FanDuel (or any book) spread snapshots from The Odds API. Snapshots are immutable: an existing
    // (game, book, snapshot time) is never rewritten. Every call is also logged in book_snapshot_pulls
    // — even when it returned nothing — so the page can skip snapshots that were already paid for.
    if (action === "saveBookSpreadSnapshots") {
      const { rows, pull } = req.body;
      let saved = 0;
      if (Array.isArray(rows) && rows.length > 0) {
        const saveRows = rows.map((r: any) => ({
          game_id: String(r.game_id),
          book: String(r.book),
          snapshot_at: r.snapshot_at,
          season: Number(r.season),
          week: Number(r.week),
          home_spread: Number(r.home_spread),
          home_price: r.home_price ?? null,
          away_price: r.away_price ?? null,
          is_historical: r.is_historical !== false,
        }));
        const { error, count } = await supabaseAdmin
          .from("book_spread_snapshots")
          .upsert(saveRows, { onConflict: "game_id,book,snapshot_at", ignoreDuplicates: true, count: "exact" });
        if (error) throw error;
        saved = count ?? saveRows.length;
      }
      if (pull && pull.book && pull.target_at) {
        const { error } = await supabaseAdmin.from("book_snapshot_pulls").upsert(
          [
            {
              book: String(pull.book),
              target_at: pull.target_at,
              snapshot_at: pull.snapshot_at ?? null,
              season: pull.season ?? null,
              week: pull.week ?? null,
              events: pull.events ?? null,
              matched: pull.matched ?? null,
              saved,
              credits_last: pull.credits_last ?? null,
              credits_remaining: pull.credits_remaining ?? null,
            },
          ],
          { onConflict: "book,target_at" }
        );
        if (error) throw error;
      }
      res.status(200).json({ saved });
      return;
    }

    if (action === "saveHistoricalTeamTotals") {
      // `overwrite` is for replacing an earlier LIVE snapshot (a week-1 line
      // captured days before kickoff) with the pulled closing consensus;
      // otherwise a saved line is never rewritten.
      const { rows, overwrite } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(200).json({ saved: 0 });
        return;
      }
      const saveRows = rows.map((r: any) => ({
        game_id: r.game_id,
        season: r.season,
        week: r.week,
        team: r.team,
        provider: r.provider ?? null,
        point: r.point ?? null,
        over_price: r.over_price ?? null,
        under_price: r.under_price ?? null,
        book_count: r.book_count ?? null,
        pulled_at: r.pulled_at ?? new Date().toISOString(),
      }));
      const { error, count } = await supabaseAdmin
        .from("team_total_lines")
        .upsert(saveRows, { onConflict: "game_id,team", ignoreDuplicates: !overwrite, count: "exact" });
      if (error) throw error;
      res.status(200).json({ saved: count ?? saveRows.length });
      return;
    }

    if (action === "syncTeamTotals") {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(200).json({ synced: 0 });
        return;
      }
      const saveRows = rows.map((r: any) => ({
        game_id: r.game_id,
        season: r.season,
        week: r.week,
        team: r.team,
        provider: r.provider ?? null,
        point: r.point ?? null,
        over_price: r.over_price ?? null,
        under_price: r.under_price ?? null,
        pulled_at: new Date().toISOString(),
      }));
      const { error, count } = await supabaseAdmin
        .from("team_total_lines")
        .upsert(saveRows, { onConflict: "game_id,team", count: "exact" });
      if (error) throw error;
      res.status(200).json({ synced: count ?? saveRows.length });
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

    // Snapshots the Resume Rating admin page's computed scores into
    // team_resume_ratings, one row per (season, week, team) — this is
    // the save side of the same gap SOS just got fixed for: the admin
    // page previously only saved the WEIGHTS (the formula config),
    // never the actual computed output for a given week. Week-scoped
    // from the start.
    if (action === "saveResumeRatings") {
      const { season, week, rows } = req.body ?? {};
      if (typeof season !== "number" || typeof week !== "number") {
        res.status(400).json({ error: "season and week are required" });
        return;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "Missing or empty 'rows'" });
        return;
      }

      const nowIso = new Date().toISOString();
      const saveRows = rows.map((r: any) => ({
        season,
        week,
        team: r.team,
        updated_at: nowIso,
        score: r.score ?? null,
        act_wins: r.actWins ?? null,
        losses: r.losses ?? null,
      }));

      const { error, count } = await supabaseAdmin
        .from("team_resume_ratings")
        .upsert(saveRows, { onConflict: "season,week,team", count: "exact" });
      if (error) throw error;

      res.status(200).json({ ok: true, saved: count ?? saveRows.length });
      return;
    }

    // Same snapshot as saveResumeRatings, but for the "completed games only"
    // Resume Rating (no rest-of-season projection) — its own table so it can
    // never overwrite the published numbers. Not read by any public page yet.
    if (action === "saveResumeRatingsFinished") {
      const { season, week, rows } = req.body ?? {};
      if (typeof season !== "number" || typeof week !== "number") {
        res.status(400).json({ error: "season and week are required" });
        return;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "Missing or empty 'rows'" });
        return;
      }
      const nowIso = new Date().toISOString();
      const saveRows = rows.map((r: any) => ({
        season,
        week,
        team: r.team,
        updated_at: nowIso,
        score: r.score ?? null,
        act_wins: r.actWins ?? null,
        losses: r.losses ?? null,
      }));
      const { error, count } = await supabaseAdmin
        .from("team_resume_ratings_finished")
        .upsert(saveRows, { onConflict: "season,week,team", count: "exact" });
      if (error) throw error;

      res.status(200).json({ ok: true, saved: count ?? saveRows.length });
      return;
    }

    // Preseason win-total markets (line + over/under prices), pasted in from the
    // sheet. One row per (season, team); re-saving a team replaces its line.
    if (action === "saveWinTotalLines") {
      const { season, rows, source } = req.body ?? {};
      if (typeof season !== "number" || !Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "season and rows are required" });
        return;
      }
      const nowIso = new Date().toISOString();
      const saveRows = rows
        .filter((r: any) => r.team && [r.line, r.overPrice, r.underPrice].every((v: any) => typeof v === "number" && !Number.isNaN(v)))
        .map((r: any) => ({
          season,
          team: r.team,
          line: r.line,
          over_price: r.overPrice,
          under_price: r.underPrice,
          source: source ?? null,
          updated_at: nowIso,
        }));
      if (saveRows.length === 0) {
        res.status(400).json({ error: "No valid rows (team, line, over price, under price)" });
        return;
      }
      const { error, count } = await supabaseAdmin.from("team_win_total_lines").upsert(saveRows, { onConflict: "season,team", count: "exact" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: count ?? saveRows.length });
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

    // TV score bug settings (/overlay/control). Only whitelisted columns
    // are written, so a stray field in the body can't touch anything else.
    if (action === "saveOverlayState") {
      const { screen, patch } = req.body;
      if (typeof screen !== "string" || !screen || typeof patch !== "object" || patch == null) {
        res.status(400).json({ error: "screen and patch are required" });
        return;
      }
      const allowed = ["game_ids", "visible", "layout", "position", "scale", "delay_seconds", "rotate_seconds", "show_lines", "show_bets"];
      const row: Record<string, any> = { id: screen, updated_at: new Date().toISOString() };
      for (const k of allowed) if (k in patch) row[k] = patch[k];

      const { error } = await supabaseAdmin.from("overlay_state").upsert(row, { onConflict: "id" });
      if (error) throw error;

      res.status(200).json({ ok: true });
      return;
    }

    // Explicit "commit this week's Totals numbers" snapshot — mirrors
    // Rating Systems' own "Save as week" pattern (weekly_power_ratings).
    // Snapshots the model's ALREADY-COMPUTED per-game outputs (ridge-model
    // efficiency inputs + projected total/team totals), not raw CFBD stats
    // — team_season_stats has no week dimension and gets overwritten in
    // place on every sync, so this is the only place "what did the model
    // say as of week N" survives the next sync. Upserts on (season, week,
    // game_id), so re-saving the same week just overwrites that week's
    // numbers rather than creating duplicates.
    if (action === "saveGameTotalSnapshot") {
      const { season, week, rows } = req.body;
      if (typeof season !== "number" || typeof week !== "number" || !Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "season, week, and rows are required" });
        return;
      }

      const now = new Date().toISOString();
      // Freeze Week: a game frozen this week that already has a row in this week's snapshot
      // keeps it — re-saving the snapshot never rewrites a locked game's numbers.
      const { data: lockRows, error: lockErr } = await supabaseAdmin.from("game_projection_locks").select("game_id").eq("season", season).eq("week", week).limit(2000);
      if (lockErr) throw lockErr;
      const lockedIds = new Set((lockRows ?? []).map((r: any) => r.game_id));
      let existingLockedRows = new Set<string>();
      if (lockedIds.size > 0) {
        const { data: existing, error: exErr } = await supabaseAdmin
          .from("game_total_snapshots")
          .select("game_id")
          .eq("season", season)
          .eq("week", week)
          .in("game_id", Array.from(lockedIds));
        if (exErr) throw exErr;
        existingLockedRows = new Set((existing ?? []).map((r: any) => r.game_id));
      }
      const skippedLocked = rows.filter((r: any) => existingLockedRows.has(r.gameId)).length;
      const upsertRows = rows.filter((r: any) => !existingLockedRows.has(r.gameId)).map((r: any) => ({
        season,
        week,
        game_id: r.gameId,
        home_team: r.homeTeam,
        away_team: r.awayTeam,
        home_efficiency_inputs: r.homeEfficiencyInputs ?? null,
        away_efficiency_inputs: r.awayEfficiencyInputs ?? null,
        projected_total: r.projectedTotal ?? null,
        home_team_total: r.homeTeamTotal ?? null,
        away_team_total: r.awayTeamTotal ?? null,
        vegas_total: r.vegasTotal ?? null,
        actual_total: r.actualTotal ?? null,
        home_actual_points: r.homeActualPoints ?? null,
        away_actual_points: r.awayActualPoints ?? null,
        saved_at: now,
      }));

      const { error, count } = upsertRows.length
        ? await supabaseAdmin.from("game_total_snapshots").upsert(upsertRows, { onConflict: "season,week,game_id", count: "exact" })
        : { error: null, count: 0 };
      if (error) throw error;

      res.status(200).json({ ok: true, saved: count ?? upsertRows.length, skippedLocked });
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
        stake: bet.stake ?? null,
        to_win: bet.toWin ?? null,
        result: bet.result ?? "pending",
        placed_at: bet.placedAt ?? null,
        market: bet.market ?? null,
      });
      if (error) throw error;

      res.status(200).json({ ok: true });
      return;
    }

    // Bulk version of savePlacedBet for the CSV importer — team-name
    // matching and game resolution already happened client-side
    // (parsePlacedBetsCsv). A row is matched against an already-saved bet
    // by (game_id, book, bet_type, side, line_value, price, stake) — the
    // terms of the wager itself — and UPDATES that bet's result/stake/
    // to_win/price instead of inserting a duplicate; only a row with no
    // match gets inserted. This is what makes re-uploading the same
    // season-long sheet every week (to pick up newly graded results, plus
    // whatever new bets were appended) safe rather than piling up
    // duplicate rows on every upload — see placedBetsImport.ts's own
    // in-file dedupe for the companion half of this (two rows in the SAME
    // file that already match each other).
    if (action === "importPlacedBets") {
      const { bets } = req.body;
      if (!Array.isArray(bets) || bets.length === 0) {
        res.status(400).json({ error: "No bets to import" });
        return;
      }

      // Futures/season-long props have no game_id to key off (see
      // parsePlacedBetsCsv's betIdentityKey, which this mirrors exactly) —
      // matched by team + market + side instead.
      type RowLike = {
        game_id: string | null;
        book: string;
        bet_type: string;
        side: string;
        line_value: number | null;
        price: number;
        stake: number | null;
        away_team: string;
        market: string | null;
      };
      const betKey = (b: RowLike) =>
        b.bet_type === "futures"
          ? ["futures", b.away_team, b.market ?? "∅", b.book, b.side, b.line_value ?? "∅", b.price, b.stake ?? "∅"].join("|")
          : [b.game_id, b.book, b.bet_type, b.side, b.line_value ?? "∅", b.price, b.stake ?? "∅"].join("|");

      const rows = bets.map((bet: any) => ({
        game_id: bet.gameId ?? null,
        season: bet.season,
        week: bet.week ?? null,
        away_team: bet.awayTeam,
        home_team: bet.homeTeam ?? null,
        book: bet.book,
        bet_type: bet.betType,
        side: bet.side,
        line_value: bet.lineValue ?? null,
        price: bet.price,
        stake: bet.stake ?? null,
        to_win: bet.toWin ?? null,
        result: bet.result ?? "pending",
        placed_at: bet.placedAt ?? null,
        market: bet.market ?? null,
      }));

      // Postgres's IN never matches NULL, so a futures row's null game_id
      // needs its own lookup (by bet_type='futures') rather than being
      // folded into the game_id.in(...) query below.
      const gameIds = Array.from(new Set(rows.filter((r) => r.game_id != null).map((r) => r.game_id as string)));
      const hasFutures = rows.some((r) => r.bet_type === "futures");
      const existingCols = "id, game_id, book, bet_type, side, line_value, price, stake, to_win, away_team, market, placed_at";
      const [byGame, byFutures] = await Promise.all([
        gameIds.length > 0
          ? supabaseAdmin.from("placed_bets").select(existingCols).in("game_id", gameIds)
          : Promise.resolve({ data: [], error: null }),
        hasFutures
          ? supabaseAdmin.from("placed_bets").select(existingCols).eq("bet_type", "futures")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (byGame.error) throw byGame.error;
      if (byFutures.error) throw byFutures.error;
      const existing = [...(byGame.data ?? []), ...(byFutures.data ?? [])];

      // A key already saved under more than one row (a duplicate from
      // before this fix existed) just updates the first one found — it
      // doesn't delete the others, so a stale duplicate needs a one-time
      // manual cleanup, but no import ever creates a new one going forward.
      const existingIdByKey = new Map<string, number>();
      for (const e of existing ?? []) {
        const key = betKey(e);
        if (!existingIdByKey.has(key)) existingIdByKey.set(key, e.id);
      }

      const toInsert: typeof rows = [];
      const toUpdate: { id: number; row: (typeof rows)[number] }[] = [];
      for (const row of rows) {
        const id = existingIdByKey.get(betKey(row));
        if (id != null) toUpdate.push({ id, row });
        else toInsert.push(row);
      }

      if (toInsert.length > 0) {
        const { error } = await supabaseAdmin.from("placed_bets").insert(toInsert);
        if (error) throw error;
      }
      for (const { id, row } of toUpdate) {
        // Keep whichever to_win is non-null rather than blanking a
        // previously-computed value with an unfilled re-export column.
        const existingRow = existing.find((e) => e.id === id) as any;
        const { error } = await supabaseAdmin
          .from("placed_bets")
          .update({
            result: row.result,
            to_win: row.to_win ?? existingRow?.to_win ?? null,
            price: row.price,
            stake: row.stake,
            placed_at: row.placed_at ?? existingRow?.placed_at ?? null,
          })
          .eq("id", id);
        if (error) throw error;
      }

      res.status(200).json({ inserted: toInsert.length, updated: toUpdate.length });
      return;
    }

    if (action === "juicereelAuthorizeUrl") {
      if (!JUICEREEL_CLIENT_ID || !JUICEREEL_CLIENT_SECRET) {
        res.status(500).json({ error: "JuiceReel client credentials are not configured on the server" });
        return;
      }
      const state = base64url(crypto.randomBytes(32));
      const verifier = base64url(crypto.randomBytes(32));
      const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
      const { error } = await supabaseAdmin.from("juicereel_oauth_state").insert({ state, code_verifier: verifier });
      if (error) throw error;

      const url = new URL(JUICEREEL_AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: JUICEREEL_CLIENT_ID,
        redirect_uri: JUICEREEL_REDIRECT_URI,
        response_type: "code",
        scope: "bets.open.read bets.settled.read",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      res.status(200).json({ url: url.toString() });
      return;
    }

    if (action === "juicereelStatus") {
      const { data, error } = await supabaseAdmin
        .from("juicereel_connection")
        .select("display_name, expires_at, scope, last_sync_checkpoint")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      // Deliberately never returns access_token/refresh_token — this
      // response goes straight back to the browser.
      res.status(200).json({
        connected: !!data,
        displayName: data?.display_name ?? null,
        scope: data?.scope ?? null,
        lastSyncCheckpoint: data?.last_sync_checkpoint ?? null,
      });
      return;
    }

    if (action === "juicereelDisconnect") {
      const { data: connection } = await supabaseAdmin.from("juicereel_connection").select("refresh_token").eq("id", 1).maybeSingle();
      if (connection?.refresh_token && JUICEREEL_CLIENT_ID && JUICEREEL_CLIENT_SECRET) {
        // Best-effort — a failed revoke on JuiceReel's end shouldn't block
        // clearing our own local connection.
        await fetch(`${JUICEREEL_API_BASE}/oauth2/revoke`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${JUICEREEL_CLIENT_ID}:${JUICEREEL_CLIENT_SECRET}`).toString("base64")}`,
            "X-OAuth-Client-Id": JUICEREEL_CLIENT_ID,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token: connection.refresh_token, token_type_hint: "refresh_token" }),
        }).catch(() => {});
      }
      const { error } = await supabaseAdmin.from("juicereel_connection").delete().eq("id", 1);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "juicereelSync") {
      if (!JUICEREEL_CLIENT_ID || !JUICEREEL_CLIENT_SECRET) {
        res.status(500).json({ error: "JuiceReel client credentials are not configured on the server" });
        return;
      }
      const { data: connection, error: connError } = await supabaseAdmin.from("juicereel_connection").select("*").eq("id", 1).maybeSingle();
      if (connError) throw connError;
      if (!connection) {
        res.status(400).json({ error: "JuiceReel isn't connected yet" });
        return;
      }
      const live = await refreshJuiceReelTokenIfNeeded(supabaseAdmin, connection);

      // /oauth2/bets/changed with updatedAtAfter is the doc-recommended
      // reconciliation pattern — first sync (no checkpoint yet) omits the
      // filter and pulls everything available instead.
      const bets: any[] = [];
      let cursor: string | null = null;
      let newestUpdatedAt: string | null = connection.last_sync_checkpoint ?? null;
      do {
        const params = new URLSearchParams();
        if (connection.last_sync_checkpoint) params.set("updatedAtAfter", connection.last_sync_checkpoint);
        if (cursor) params.set("cursor", cursor);
        const betsRes = await fetch(`${JUICEREEL_API_BASE}/oauth2/bets/changed?${params.toString()}`, {
          headers: { Authorization: `Bearer ${live.access_token}`, "X-OAuth-Client-Id": JUICEREEL_CLIENT_ID },
        });
        const betsData: any = await betsRes.json();
        if (!betsRes.ok) throw new Error(betsData.error_description ?? betsData.error ?? "Failed to fetch bets from JuiceReel");
        bets.push(...(betsData.bets ?? []));
        cursor = betsData.hasMore ? betsData.nextCursor : null;
      } while (cursor);

      for (const b of bets) {
        if (!newestUpdatedAt || new Date(b.updatedAt) > new Date(newestUpdatedAt)) newestUpdatedAt = b.updatedAt;
      }

      let imported = 0;
      const skipped: { juicereelBetId: number; reason: string }[] = [];

      for (const bet of bets) {
        // Parlays/combos have multiple Subbets and don't map to this
        // site's single-game bet_type/side/line_value shape — same
        // "ignore parlays" rule Chris gave for the manual reconciliation
        // pass earlier this season.
        if (bet.BetType?.typeName !== "Straight" || !Array.isArray(bet.Subbets) || bet.Subbets.length !== 1) {
          skipped.push({ juicereelBetId: bet.id, reason: "parlay/combo or multi-leg bet — not tracked here" });
          continue;
        }
        const leg = bet.Subbets[0];
        const league = (leg.League?.name ?? "").toLowerCase();
        const sport = (leg.Sport?.name ?? "").toLowerCase();
        if (!league.includes("ncaa") && !league.includes("cfb") && !(sport.includes("football") && league.includes("college"))) {
          continue; // not college football — silently skip, not an error
        }
        const book = JUICEREEL_BOOK_MAP[(bet.Site?.name ?? "").toLowerCase()];
        if (!book) continue; // a book this site doesn't track — not an error
        const betType = mapBetType(leg.subbetType);
        if (!betType) {
          skipped.push({ juicereelBetId: bet.id, reason: `unrecognized subbetType "${leg.subbetType}"` });
          continue;
        }

        const homeTeamName = leg.Event?.HomeTeam?.displayName;
        const awayTeamName = leg.Event?.AwayTeam?.displayName;
        if (!homeTeamName || !awayTeamName) {
          skipped.push({ juicereelBetId: bet.id, reason: "missing home/away team names" });
          continue;
        }
        const eventDate = leg.Event?.startDate ?? leg.startDate ?? bet.datePlaced;
        const { data: candidates, error: gamesError } = await supabaseAdmin
          .from("games")
          .select("id, season, week, home_team, away_team, start_date")
          .ilike("home_team", homeTeamName)
          .ilike("away_team", awayTeamName);
        if (gamesError) throw gamesError;
        let game = (candidates ?? [])[0];
        if ((candidates ?? []).length > 1 && eventDate) {
          const targetMs = new Date(eventDate).getTime();
          game = candidates.reduce((best: any, g: any) => {
            const gMs = g.start_date ? new Date(g.start_date).getTime() : Infinity;
            const bestMs = best.start_date ? new Date(best.start_date).getTime() : Infinity;
            return Math.abs(gMs - targetMs) < Math.abs(bestMs - targetMs) ? g : best;
          }, candidates[0]);
        }
        if (!game) {
          skipped.push({ juicereelBetId: bet.id, reason: `no matching game for ${awayTeamName} @ ${homeTeamName}` });
          continue;
        }

        let side: string | null = null;
        let lineValue: number | null = null;
        if (betType === "moneyline") {
          side = leg.position === homeTeamName ? game.home_team : leg.position === awayTeamName ? game.away_team : null;
        } else if (betType === "spread") {
          side = leg.position === homeTeamName ? game.home_team : leg.position === awayTeamName ? game.away_team : null;
          lineValue = leg.value ?? null; // assumed already signed from `side`'s own perspective — not yet verified against a real spread bet
        } else if (betType === "total") {
          const dir = (leg.position ?? "").toLowerCase();
          side = dir.startsWith("o") ? "over" : dir.startsWith("u") ? "under" : null;
          lineValue = leg.value != null ? Math.abs(leg.value) : null;
        } else if (betType === "team_total") {
          const dir = (leg.position ?? "").toLowerCase();
          const dirNorm = dir.startsWith("o") ? "over" : dir.startsWith("u") ? "under" : null;
          const teamName = leg.TruthTeam?.displayName === homeTeamName ? game.home_team : leg.TruthTeam?.displayName === awayTeamName ? game.away_team : null;
          side = dirNorm && teamName ? `${teamName}|${dirNorm}` : null;
          lineValue = leg.value != null ? Math.abs(leg.value) : null;
        }
        if (!side) {
          skipped.push({ juicereelBetId: bet.id, reason: `couldn't resolve side/team from position "${leg.position}"` });
          continue;
        }

        const row = {
          juicereel_bet_id: bet.id,
          game_id: game.id,
          season: game.season,
          week: game.week,
          away_team: game.away_team,
          home_team: game.home_team,
          book,
          bet_type: betType,
          side,
          line_value: lineValue,
          price: bet.oddsAmerican ?? 0,
          stake: bet.amountRisked ?? null,
          to_win: bet.toWin ?? null,
          result: mapJuicereelResult(bet.result),
        };
        const { error: upsertError } = await supabaseAdmin.from("placed_bets").upsert(row, { onConflict: "juicereel_bet_id" });
        if (upsertError) {
          skipped.push({ juicereelBetId: bet.id, reason: upsertError.message });
          continue;
        }
        imported++;
      }

      if (newestUpdatedAt) {
        await supabaseAdmin.from("juicereel_connection").update({ last_sync_checkpoint: newestUpdatedAt }).eq("id", 1);
      }

      res.status(200).json({ ok: true, fetched: bets.length, imported, skipped });
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
