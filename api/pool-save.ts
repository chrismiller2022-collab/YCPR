import { createHmac as pkCreateHmac, timingSafeEqual as pkTimingSafeEqual } from "node:crypto";
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

// Passkey sessions: a device signed in with a passkey gets a token ("pk.<credential id>.<expiry>.<signature>") that is
// accepted anywhere the admin password is, until it expires or that device is removed. Every api/ file that checks the admin
// password carries this same copy — api/ files can't share code (an extensionless relative import crashes the function under
// ES modules), so keep the copies identical. The token is only trusted while its credential still exists in admin_passkeys.
async function isAdmin(supplied: unknown): Promise<boolean> {
  if (typeof supplied !== "string" || !ADMIN_PASSWORD) return false;
  if (supplied === ADMIN_PASSWORD) return true;
  const parts = supplied.split(".");
  if (parts.length !== 4 || parts[0] !== "pk") return false;
  const [, credId, exp, sig] = parts;
  if (!(Number(exp) > Date.now())) return false;
  const want = pkCreateHmac("sha256", `${ADMIN_PASSWORD}|passkey-session`).update(`pk.${credId}.${exp}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !pkTimingSafeEqual(a, b)) return false;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url}/rest/v1/admin_passkeys?id=eq.${encodeURIComponent(credId)}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}
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

  // Calcutta live room: attendees (not the admin) claim their name with a
  // 4-digit PIN and send bids. Checked by a signed room token instead of the
  // admin password; the host's Stage decides which bids count.
  if (pool === "calcutta-room") {
    await handleCalcuttaRoom(req, res, createClient(SUPABASE_URL, SERVICE_ROLE_KEY));
    return;
  }

  if (!(await isAdmin(password))) {
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
        is_possible_pick: !!r.is_possible_pick,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("peay_picks").upsert(cleanRows, { onConflict: "season,week,game_id" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: cleanRows.length });
      return;
    }

    // --- CBS Splash: same shape as Peay, own table/field names. Two
    // contests (CBS, Kelly) share one row per game — see cbsSplashPool.ts. ---
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
        cbs_selected: !!r.cbs_selected,
        picked_side: r.picked_side ?? null,
        is_key_pick: !!r.is_key_pick,
        kelly_selected: !!r.kelly_selected,
        kelly_picked_side: r.kelly_picked_side ?? null,
        kelly_is_possible: !!r.kelly_is_possible,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from("cbs_splash_picks").upsert(cleanRows, { onConflict: "season,week,game_id" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: cleanRows.length });
      return;
    }

    // --- Westgate Supercontest: same shape as Peay/CBS Splash, own table/field names ---
    if (pool === "westgate") {
      if (action === "saveWeek") {
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
          is_possible_pick: !!r.is_possible_pick,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabaseAdmin.from("westgate_picks").upsert(cleanRows, { onConflict: "season,week,game_id" });
        if (error) throw error;
        res.status(200).json({ ok: true, saved: cleanRows.length });
        return;
      }

      // Bulk line update from the CSV importer (converted from the
      // contest's own PDF card) — only touches westgate_line, so it
      // never clobbers a pick/key-pick already saved for that game via
      // the shared onConflict update-column-list behavior (Supabase's
      // upsert only SETs the columns you pass on conflict).
      if (action === "importLines") {
        const { season, week, rows } = req.body;
        if (!season || !week || !Array.isArray(rows) || rows.length === 0) {
          res.status(400).json({ error: "Missing season, week, or rows" });
          return;
        }
        const cleanRows = rows.map((r: any) => ({
          season,
          week,
          game_id: r.game_id,
          westgate_line: r.westgate_line,
          updated_at: new Date().toISOString(),
        }));
        const { error, count } = await supabaseAdmin
          .from("westgate_picks")
          .upsert(cleanRows, { onConflict: "season,week,game_id", count: "exact" });
        if (error) throw error;
        res.status(200).json({ ok: true, saved: count ?? cleanRows.length });
        return;
      }

      // Full replace of a season's uploaded standings snapshot — the
      // contest publishes a whole new leaderboard each time, so there's
      // no meaningful per-row diff to preserve.
      if (action === "importStandings") {
        const { season, rows } = req.body;
        if (!season || !Array.isArray(rows) || rows.length === 0) {
          res.status(400).json({ error: "Missing season or rows" });
          return;
        }
        const { error: deleteError } = await supabaseAdmin.from("westgate_standings").delete().eq("season", season);
        if (deleteError) throw deleteError;
        const cleanRows = rows.map((r: any) => ({
          season,
          place_rank: r.place_rank,
          place_label: r.place_label,
          alias: r.alias,
          record: r.record ?? null,
          points: r.points ?? null,
          cash_prize: r.cash_prize ?? null,
        }));
        const { error, count } = await supabaseAdmin.from("westgate_standings").insert(cleanRows, { count: "exact" });
        if (error) throw error;
        res.status(200).json({ ok: true, saved: count ?? cleanRows.length });
        return;
      }

      if (action === "saveSettings") {
        const { season, entries, entry_fee } = req.body;
        if (!season || !entries || !entry_fee) {
          res.status(400).json({ error: "Missing season, entries, or entry_fee" });
          return;
        }
        const { error } = await supabaseAdmin
          .from("westgate_pool_settings")
          .upsert({ season, entries, entry_fee }, { onConflict: "season" });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: `Unknown action for westgate: ${action}` });
      return;
    }

    // --- CFBD Pick'em: previously a pure paste-in/paste-out tool with no
    // persistence at all — this lets its predicted margins be saved so
    // they can be graded (SU/ATS/MAE/MSE) once games finish. One row per
    // game, upserted so re-saving a week (e.g. after fixing a name
    // mismatch) just overwrites that game's prediction. ---
    if (pool === "cfbdpickem") {
      if (action !== "savePredictions") {
        res.status(400).json({ error: `Unknown action for cfbdpickem: ${action}` });
        return;
      }
      const { season, rows } = req.body;
      if (!season || !Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: "Missing season or rows" });
        return;
      }
      const cleanRows = rows.map((r: any) => ({ game_id: r.game_id, season, predicted_margin: r.predicted_margin }));
      const { error, count } = await supabaseAdmin
        .from("cfbd_pickem_predictions")
        .upsert(cleanRows, { onConflict: "game_id", count: "exact" });
      if (error) throw error;
      res.status(200).json({ ok: true, saved: count ?? cleanRows.length });
      return;
    }

    // --- Calcutta auctions: the whole auction is one JSON doc (settings,
    // attendees, lots, every bid, ownership splits, results). The browser
    // keeps the live copy in localStorage; this just mirrors it. ---
    if (pool === "calcutta") {
      if (action === "save") {
        const { doc } = req.body;
        if (!doc || typeof doc.id !== "string" || !doc.id || typeof doc.name !== "string" || typeof doc.format !== "string") {
          res.status(400).json({ error: "Missing auction doc" });
          return;
        }
        const row = {
          id: doc.id,
          name: doc.name,
          format: doc.format,
          status: typeof doc.status === "string" ? doc.status : "setup",
          doc,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabaseAdmin.from("calcutta_auctions").upsert(row, { onConflict: "id" });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      if (action === "delete") {
        const { id } = req.body;
        if (typeof id !== "string" || !id) {
          res.status(400).json({ error: "Missing id" });
          return;
        }
        const { error } = await supabaseAdmin.from("calcutta_auctions").delete().eq("id", id);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      // Live room: the Stage publishes the compact live state room pages watch.
      if (action === "live") {
        const { auctionId, state } = req.body;
        if (typeof auctionId !== "string" || !auctionId || !state || typeof state !== "object") {
          res.status(400).json({ error: "Missing auctionId or state" });
          return;
        }
        const { error } = await supabaseAdmin.from("calcutta_live").upsert({ auction_id: auctionId, state, updated_at: new Date().toISOString() }, { onConflict: "auction_id" });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      // Who has claimed which attendee (no PINs), and resetting a forgotten PIN.
      if (action === "roomMembers") {
        const { auctionId } = req.body;
        const { data, error } = await supabaseAdmin.from("calcutta_room_members").select("participant_id, claimed_at, locked_until").eq("auction_id", auctionId);
        if (error) throw error;
        res.status(200).json({ members: data ?? [] });
        return;
      }
      if (action === "resetPin") {
        const { auctionId, participantId } = req.body;
        const { error } = await supabaseAdmin.from("calcutta_room_members").delete().eq("auction_id", auctionId).eq("participant_id", participantId);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: `Unknown action for calcutta: ${action}` });
      return;
    }

    // --- Pool Balance Sheet: flat cost/winnings line items for pools
    // that don't otherwise track their own finances (Brit already does). ---
    if (pool === "ledger") {
      if (action !== "upsertEntry") {
        res.status(400).json({ error: `Unknown action for ledger: ${action}` });
        return;
      }
      const { entry } = req.body;
      if (!entry || !entry.season || !entry.pool_key || !entry.label) {
        res.status(400).json({ error: "Missing season, pool_key, or label" });
        return;
      }
      const row = {
        season: entry.season,
        pool_key: entry.pool_key,
        label: entry.label,
        cost: entry.cost ?? 0,
        winnings: entry.winnings ?? 0,
        is_hypothetical: !!entry.is_hypothetical,
        note: entry.note ?? null,
      };
      const { error } = await supabaseAdmin.from("pool_ledger_entries").upsert(row, { onConflict: "season,pool_key,is_hypothetical" });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    // --- Reddit Confidence: no key/special game concept (pure
    // confidence pool), so it doesn't fit the shared selectGames/
    // savePicks pattern below (which always writes a special-game
    // boolean) — its own small dedicated branch instead. ---
    // --- Paste import (CBS Pickem, ESPN Spreads/ML/Confidence, Reddit
    // Confidence): replaces the week's games with the pasted ones and
    // stores what the pool page showed — its line, moneylines and public
    // pick %. Picks for the week are cleared so the page re-picks from the
    // model. ---
    if (action === "applyPaste") {
      const pasteTables: Record<string, string> = { ...POOL_TABLES, redditconfidence: "reddit_confidence_picks" };
      const table = pasteTables[pool];
      const { season, week, games } = req.body;
      if (!table || pool === "brit") {
        res.status(400).json({ error: `Paste import not supported for ${pool}` });
        return;
      }
      if (!season || !week || !Array.isArray(games) || games.length === 0) {
        res.status(400).json({ error: "Missing season, week, or games" });
        return;
      }
      const { error: delError } = await supabaseAdmin.from(table).delete().eq("season", season).eq("week", week);
      if (delError) throw delError;
      const now = new Date().toISOString();
      const rows = games.map((g: any, i: number) => {
        const row: any = { season, week, game_id: String(g.gameId), paste_order: g.order ?? i + 1, updated_at: now };
        if (pool !== "redditconfidence") {
          row.is_key_game = !!g.isKey;
          row.public_away_pct = g.publicAwayPct ?? null;
          row.public_home_pct = g.publicHomePct ?? null;
        }
        if (pool === "cbspickem") row.cbs_line = g.line ?? null;
        if (pool === "espnspread") row.espn_line = g.line ?? null;
        if (pool === "espnml" || pool === "espnconfidence") {
          row.espn_away_ml = g.awayMl ?? null;
          row.espn_home_ml = g.homeMl ?? null;
        }
        return row;
      });
      const { error: insError } = await supabaseAdmin.from(table).insert(rows);
      if (insError) throw insError;
      res.status(200).json({ ok: true, saved: rows.length });
      return;
    }

    if (pool === "redditconfidence") {
      if (action === "selectGames") {
        const { season, week, gameIds } = req.body;
        if (!season || !week || !Array.isArray(gameIds)) {
          res.status(400).json({ error: "Missing season, week, or gameIds" });
          return;
        }
        const { data: existing, error: existingError } = await supabaseAdmin
          .from("reddit_confidence_picks")
          .select("id, game_id")
          .eq("season", season)
          .eq("week", week);
        if (existingError) throw existingError;
        const keepIds = new Set(gameIds);
        const toDelete = (existing ?? []).filter((r: any) => !keepIds.has(r.game_id)).map((r: any) => r.id);
        if (toDelete.length > 0) {
          const { error: deleteError } = await supabaseAdmin.from("reddit_confidence_picks").delete().in("id", toDelete);
          if (deleteError) throw deleteError;
        }
        const rows = gameIds.map((gameId: string) => ({ season, week, game_id: gameId, updated_at: new Date().toISOString() }));
        const { error: upsertError } = await supabaseAdmin
          .from("reddit_confidence_picks")
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
            .from("reddit_confidence_picks")
            .update({ picked_side: p.picked_side ?? null, confidence_points: p.confidence_points ?? null, updated_at: new Date().toISOString() })
            .eq("id", p.id);
          if (error) throw error;
        }
        res.status(200).json({ ok: true, saved: picks.length });
        return;
      }
      res.status(400).json({ error: `Unknown action for redditconfidence: ${action}` });
      return;
    }


    // --- Survivor working picks: the admin Survivor page's current picks, one row per season + pool ---
    if (pool === "survivorpicks") {
      const { season, which, picks } = req.body;
      if (typeof season !== "number" || (which !== "survivor" && which !== "splash") || !picks || typeof picks !== "object") {
        res.status(400).json({ error: "Missing season, which (survivor/splash) or picks" });
        return;
      }
      const { error } = await supabaseAdmin
        .from("survivor_working_picks")
        .upsert({ season, pool: which, picks, updated_at: new Date().toISOString() }, { onConflict: "season,pool" });
      if (error) throw error;
      res.status(200).json({ ok: true });
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

    // --- Survivor excluded teams: a simple "don't use" list ---
    if (pool === "survivorexcluded") {
      const { team } = req.body;
      if (!team || typeof team !== "string") {
        res.status(400).json({ error: "Missing team" });
        return;
      }
      if (action === "add") {
        const { error } = await supabaseAdmin.from("survivor_excluded_teams").upsert({ team }, { onConflict: "team" });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      if (action === "remove") {
        const { error } = await supabaseAdmin.from("survivor_excluded_teams").delete().eq("team", team);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: `Unknown action for survivorexcluded: ${action}` });
      return;
    }

    // --- Splash Survivor saved paths: separate tool, separate table from survivorpaths above ---
    if (pool === "splashsurvivorpaths") {
      if (action === "save") {
        const { name, picks } = req.body;
        if (!name || typeof name !== "string" || !picks) {
          res.status(400).json({ error: "Missing name or picks" });
          return;
        }
        const { error } = await supabaseAdmin.from("splash_survivor_saved_paths").insert({ name, picks });
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
        const { error } = await supabaseAdmin.from("splash_survivor_saved_paths").delete().eq("id", id);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: `Unknown action for splashsurvivorpaths: ${action}` });
      return;
    }

    // --- Splash Survivor excluded teams: separate tool, separate table from survivorexcluded above ---
    if (pool === "splashsurvivorexcluded") {
      const { team } = req.body;
      if (!team || typeof team !== "string") {
        res.status(400).json({ error: "Missing team" });
        return;
      }
      if (action === "add") {
        const { error } = await supabaseAdmin.from("splash_survivor_excluded_teams").upsert({ team }, { onConflict: "team" });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      if (action === "remove") {
        const { error } = await supabaseAdmin.from("splash_survivor_excluded_teams").delete().eq("team", team);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: `Unknown action for splashsurvivorexcluded: ${action}` });
      return;
    }

    // --- Brit finance: weekly entry fee/winnings + end-of-season bonus
    // payout. Separate tables (brit_entries/brit_season_bonus) from
    // brit_picks — picks themselves still flow through the generic Brit
    // block below via selectGames/savePicks/resetPicks. This was
    // previously entirely unhandled: both actions fell through to the
    // "Unknown action" 400 below, so brit_entries/brit_season_bonus never
    // got a single row written despite the frontend having a full save UI
    // for both (BritPoolPanel.tsx's WeeklyEntryStep/SeasonTrackingTab) —
    // which is why the Pool Balance Sheet's Brit numbers never moved. ---
    if (pool === "brit" && (action === "saveEntry" || action === "saveSeasonBonus")) {
      const { season } = req.body;
      if (!season) {
        res.status(400).json({ error: "Missing season" });
        return;
      }
      if (action === "saveEntry") {
        const { week, entry_fee, winnings, note } = req.body;
        if (!week) {
          res.status(400).json({ error: "Missing week" });
          return;
        }
        const row = {
          season,
          week,
          entry_fee: entry_fee ?? 10,
          winnings: winnings ?? 0,
          note: note ?? null,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabaseAdmin.from("brit_entries").upsert(row, { onConflict: "season,week" });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }
      const { payout, note } = req.body;
      const row = { season, payout: payout ?? 0, note: note ?? null, updated_at: new Date().toISOString() };
      const { error } = await supabaseAdmin.from("brit_season_bonus").upsert(row, { onConflict: "season" });
      if (error) throw error;
      res.status(200).json({ ok: true });
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
      const { season, week, gameIds, keyGameId, specialGameId, keyGameIds } = req.body;
      // keyGameIds (plural, array) is the general form — CBS Pickem needs
      // 2 tiebreaker games, so it sends this. Brit/ESPN ML/ESPN Spreads/
      // ESPN Confidence still send the older singular keyGameId/
      // specialGameId and are unaffected — wrapped into a one-element
      // array here rather than touching those clients.
      const specialIds: string[] = Array.isArray(keyGameIds) ? keyGameIds : [keyGameId ?? specialGameId].filter(Boolean);
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

      const specialIdSet = new Set(specialIds);
      const rows = gameIds.map((gameId: string) => ({
        season,
        week,
        game_id: gameId,
        [specialField]: specialIdSet.has(gameId),
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
        if (pool === "brit" || pool === "cbspickem") {
          update.predicted_home_score = p.predicted_home_score ?? null;
          update.predicted_away_score = p.predicted_away_score ?? null;
        } else {
          update.predicted_total_points = p.predicted_total_points ?? null;
        }
        if (pool === "espnconfidence") {
          update.confidence_points = p.confidence_points ?? null;
        }
        if (pool === "espnspread") {
          update.espn_line = p.espn_line ?? null;
        }
        if (pool === "cbspickem") {
          update.cbs_line = p.cbs_line ?? null;
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

// ---------------------------------------------------------------------------
// Calcutta live room
// ---------------------------------------------------------------------------

const ROOM_TOKEN_DAYS = 30;
const ROOM_ID_RE = /^[a-z0-9_]{3,64}$/;

function roomKey(): string {
  return `${ADMIN_PASSWORD}|calcutta-room`;
}

function pinHash(salt: string, pin: string): string {
  return pkCreateHmac("sha256", roomKey()).update(`${salt}:${pin}`).digest("hex");
}

function signRoomToken(auctionId: string, participantId: string, claimedAt: string): string {
  const exp = Date.now() + ROOM_TOKEN_DAYS * 86_400_000;
  const claimed = new Date(claimedAt).getTime();
  const body = `cr.${auctionId}.${participantId}.${claimed}.${exp}`;
  const sig = pkCreateHmac("sha256", roomKey()).update(body).digest("hex");
  return `${body}.${sig}`;
}

/** Returns { auctionId, participantId, claimed } for a valid, unexpired token, else null. */
function readRoomToken(token: unknown): { auctionId: string; participantId: string; claimed: number } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "cr") return null;
  const [, auctionId, participantId, claimed, exp, sig] = parts;
  if (!(Number(exp) > Date.now())) return null;
  const want = pkCreateHmac("sha256", roomKey()).update(parts.slice(0, 5).join(".")).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !pkTimingSafeEqual(a, b)) return null;
  return { auctionId, participantId, claimed: Number(claimed) };
}

async function handleCalcuttaRoom(req: any, res: any, db: any) {
  const { action } = req.body ?? {};
  try {
    // Which attendees are already claimed (so the join screen can say "sign in" vs "set a PIN").
    if (action === "status") {
      const { auctionId } = req.body;
      if (!ROOM_ID_RE.test(String(auctionId))) return void res.status(400).json({ error: "Bad room" });
      const { data, error } = await db.from("calcutta_room_members").select("participant_id").eq("auction_id", auctionId);
      if (error) throw error;
      res.status(200).json({ claimed: (data ?? []).map((r: any) => r.participant_id) });
      return;
    }

    if (action === "claim" || action === "login") {
      const { auctionId, participantId, pin } = req.body;
      if (!ROOM_ID_RE.test(String(auctionId)) || !ROOM_ID_RE.test(String(participantId))) return void res.status(400).json({ error: "Bad room or name" });
      if (!/^\d{4}$/.test(String(pin))) return void res.status(400).json({ error: "PIN must be 4 digits" });
      // The attendee has to be in the auction (and not a practice bot).
      const { data: auc, error: aErr } = await db.from("calcutta_auctions").select("doc").eq("id", auctionId).maybeSingle();
      if (aErr) throw aErr;
      const person = auc?.doc?.participants?.find((p: any) => p.id === participantId);
      if (!person || person.bot) return void res.status(404).json({ error: "That name isn't in this auction" });
      const { data: member, error: mErr } = await db.from("calcutta_room_members").select("*").eq("auction_id", auctionId).eq("participant_id", participantId).maybeSingle();
      if (mErr) throw mErr;

      if (action === "claim") {
        if (member) return void res.status(409).json({ error: `${person.name} is already claimed — enter the PIN instead` });
        const salt = pkCreateHmac("sha256", roomKey()).update(`${auctionId}:${participantId}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16);
        const claimed_at = new Date().toISOString();
        const { error } = await db.from("calcutta_room_members").insert({ auction_id: auctionId, participant_id: participantId, pin_salt: salt, pin_hash: pinHash(salt, String(pin)), claimed_at });
        if (error) {
          if (String(error.code) === "23505") return void res.status(409).json({ error: `${person.name} was just claimed — enter the PIN instead` });
          throw error;
        }
        res.status(200).json({ token: signRoomToken(auctionId, participantId, claimed_at), participantId, name: person.name });
        return;
      }

      // login
      if (!member) return void res.status(404).json({ error: `${person.name} hasn't set a PIN yet` });
      if (member.locked_until && new Date(member.locked_until).getTime() > Date.now()) {
        return void res.status(429).json({ error: "Too many wrong PINs — try again in a few minutes, or ask the host to reset it" });
      }
      if (pinHash(member.pin_salt, String(pin)) !== member.pin_hash) {
        const failed = (member.failed_attempts ?? 0) + 1;
        const locked = failed >= 5 ? new Date(Date.now() + 5 * 60_000).toISOString() : null;
        await db.from("calcutta_room_members").update({ failed_attempts: locked ? 0 : failed, locked_until: locked }).eq("auction_id", auctionId).eq("participant_id", participantId);
        return void res.status(401).json({ error: locked ? "Wrong PIN — locked for 5 minutes" : `Wrong PIN (${5 - failed} tries left)` });
      }
      await db.from("calcutta_room_members").update({ failed_attempts: 0, locked_until: null }).eq("auction_id", auctionId).eq("participant_id", participantId);
      res.status(200).json({ token: signRoomToken(auctionId, participantId, member.claimed_at), participantId, name: person.name });
      return;
    }

    // A bid (or bow-out) from the room. The host's Stage decides whether it counts.
    if (action === "bid" || action === "out") {
      const t = readRoomToken(req.body.token);
      if (!t) return void res.status(401).json({ error: "Signed out — open the room link and sign in again" });
      const { data: member, error: mErr } = await db.from("calcutta_room_members").select("claimed_at").eq("auction_id", t.auctionId).eq("participant_id", t.participantId).maybeSingle();
      if (mErr) throw mErr;
      if (!member || new Date(member.claimed_at).getTime() !== t.claimed) return void res.status(401).json({ error: "Your PIN was reset — sign in again" });
      const { data: live, error: lErr } = await db.from("calcutta_live").select("open:state->roomOpen").eq("auction_id", t.auctionId).maybeSingle();
      if (lErr) throw lErr;
      if (!live?.open) return void res.status(409).json({ error: "The room isn't open for bidding right now" });
      const amount = action === "bid" && req.body.amount != null ? Number(req.body.amount) : null;
      if (amount != null && !(amount > 0 && amount < 10_000_000)) return void res.status(400).json({ error: "Bad amount" });
      const lotId = typeof req.body.lotId === "string" ? req.body.lotId.slice(0, 64) : null;
      const { data, error } = await db
        .from("calcutta_bid_requests")
        .insert({ auction_id: t.auctionId, participant_id: t.participantId, lot_id: lotId, kind: action, amount })
        .select("id")
        .single();
      if (error) throw error;
      res.status(200).json({ ok: true, requestId: data.id });
      return;
    }

    res.status(400).json({ error: `Unknown action for calcutta-room: ${action}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Room request failed" });
  }
}
