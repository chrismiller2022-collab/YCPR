import { createClient } from "@supabase/supabase-js";
// This runs on Vercel's servers, not in the browser — it's the only place
// the service role key is used, and it's the only code path allowed to write
// to weekly_team_stats or teams. The browser only ever holds the public
// anon (read-only) key.
//
// Also absorbs what used to be admin-auth.ts (action: "checkPassword") and
// montecarlo-save.ts (action: "saveMonteCarloRun") — Vercel's Hobby plan
// caps a deployment at 12 serverless functions, and this project was
// already at that ceiling before adding the JuiceReel OAuth callback (see
// admin-bets-save.ts). Sending no `action` at all keeps behaving exactly
// like the original admin-save.ts (saving weekly team stats), so the one
// existing caller that predates this merge didn't need to change.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAT_FIELDS = [
  "team",
  "rating",
  "rank",
  "sor",
  "resume_rank",
  "resume_rating",
  "total_wins",
  "season_win_line",
  "preseason_proj",
  "change_from_preseason",
  "live_wins",
  "live_losses",
  "wins_left",
  "losses_left",
  "conf_proj_wins",
  "conf_line",
  "dif",
  "abs_dif",
  "bet",
  "edge",
  "conf_win_pct",
  "fair_price",
  "implied_pct",
  "odds",
  "value",
  "natty_odds",
  "draftkings_natty_odds",
  "natty_rank",
  "playoff_seed",
  "ats_wins",
  "ats_losses",
  "games_completed",
  "ats_rank",
  "hfa",
];
// Mirrors WEEK_OPTIONS in AdminPage.tsx exactly — "preseason" and
// "week1".."week16", nothing else, since the dropdown only ever sends
// one of these. Used to derive week_number, the column that actually
// decides "which week is latest" (see fetchAvailableWeeks in
// weeklyStats.ts) — deliberately NOT based on when a row was written,
// so correcting an older week can never make it look current again.
function weekToNumber(week: string): number {
  if (week === "preseason") return 0;
  const m = /^week(\d+)$/.exec(week);
  return m ? parseInt(m[1], 10) : -1;
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

  const { password, action } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  // Formerly admin-auth.ts in full — the Admin gate just wants a yes/no on
  // the password, no Supabase access needed.
  if (action === "checkPassword") {
    res.status(200).json({ ok: true });
    return;
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Formerly montecarlo-save.ts in full.
  if (action === "saveMonteCarloRun") {
    const { season, week, numTrials, results, unmatchedTeams, resumeComparison, resumeComparisonTrials } = req.body ?? {};
    if (!season || !week || !numTrials || !Array.isArray(results)) {
      res.status(400).json({ error: "Missing season, week, numTrials, or results" });
      return;
    }
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
            resume_comparison: resumeComparison ?? null,
            resume_comparison_trials: resumeComparisonTrials ?? null,
          },
        ])
        .select("id")
        .single();
      if (error) throw error;
      res.status(200).json({ ok: true, id: data.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Save failed" });
    }
    return;
  }

  // DROGBA picks log. The point of the log is a record of what the model said while the line was
  // open, so by default a game that is already logged is left alone (first save wins); the caller must
  // pass overwrite: true — the page asks for confirmation first — to replace existing rows.
  if (action === "saveDrogbaPicks") {
    const { picks, overwrite } = req.body ?? {};
    if (!Array.isArray(picks) || picks.length === 0) {
      res.status(400).json({ error: "No picks to save" });
      return;
    }
    const rows = picks.map((p: any) => ({
      game_id: String(p.game_id),
      season: Number(p.season),
      week: Number(p.week),
      home_team: String(p.home_team),
      away_team: String(p.away_team),
      model_home_spread: Number(p.model_home_spread),
      open_spread: p.open_spread == null ? null : Number(p.open_spread),
      open_provider: p.open_provider ?? null,
      edge: p.edge == null ? null : Number(p.edge),
      tier: p.tier === "power" || p.tier === "other" ? p.tier : null,
      side: p.side === "home" || p.side === "away" ? p.side : null,
      filtered: !!p.filtered,
      model_version: p.model_version ?? null,
    }));
    if (rows.some((r: any) => !r.game_id || !Number.isFinite(r.season) || !Number.isFinite(r.week) || !Number.isFinite(r.model_home_spread))) {
      res.status(400).json({ error: "Every pick needs game_id, season, week and model_home_spread" });
      return;
    }
    try {
      const existing = new Set<string>();
      for (let i = 0; i < rows.length; i += 200) {
        const ids = rows.slice(i, i + 200).map((r: any) => r.game_id);
        const { data, error } = await supabaseAdmin.from("drogba_picks").select("game_id").in("game_id", ids);
        if (error) throw error;
        for (const d of data ?? []) existing.add(d.game_id);
      }
      const toWrite = overwrite ? rows : rows.filter((r: any) => !existing.has(r.game_id));
      if (toWrite.length > 0) {
        const { error } = await supabaseAdmin.from("drogba_picks").upsert(toWrite, { onConflict: "game_id" });
        if (error) throw error;
      }
      res.status(200).json({ ok: true, saved: toWrite.length, skippedExisting: overwrite ? 0 : rows.length - toWrite.length, overwritten: overwrite ? rows.filter((r: any) => existing.has(r.game_id)).length : 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Save failed" });
    }
    return;
  }

  // Default (no action, or action: "saveWeeklyStats") — original
  // admin-save.ts behavior, unchanged.
  const { week, rows } = req.body ?? {};
  if (!week || typeof week !== "string") {
    res.status(400).json({ error: "Missing or invalid 'week'" });
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "No rows to save" });
    return;
  }
  const missingTeam = rows.find((r: any) => !r.team);
  if (missingTeam) {
    res.status(400).json({ error: "One or more rows is missing a team name" });
    return;
  }
  // Keep the teams table in sync automatically: if a row includes div/conf
  // (the paste tool sends these even though they aren't stored per-week),
  // upsert them so a new team shows up immediately and conference
  // realignment doesn't require a manual reseed. Existing teams not
  // present in this week's paste are left alone — nothing gets deleted.
  const teamRows = rows
    .filter((r: any) => r.div && r.conf)
    .map((r: any) => ({ team: r.team, div: r.div, conf: r.conf }));
  if (teamRows.length > 0) {
    const { error: teamsError } = await supabaseAdmin
      .from("teams")
      .upsert(teamRows, { onConflict: "team" });
    if (teamsError) {
      res.status(500).json({ error: `Saving teams failed: ${teamsError.message}` });
      return;
    }
  }
  // Only pass through known stat columns, and stamp every row with the
  // target week AND updated_at — the latter is what "latest" now
  // resolves by (see fetchAvailableWeeks in weeklyStats.ts). Without
  // this, re-uploading under a previously-used week label silently
  // breaks "latest" everywhere, since an upsert UPDATE never changes a
  // row's id, which was the old (broken) way "latest" was determined.
  const nowIso = new Date().toISOString();
  const weekNumber = weekToNumber(week);
  const cleanRows = rows.map((r: any) => {
    const cleaned: Record<string, any> = { week, week_number: weekNumber, updated_at: nowIso };
    for (const field of STAT_FIELDS) {
      cleaned[field] = r[field] ?? null;
    }
    return cleaned;
  });
  // Freeze Week: teams whose game this week is frozen keep their row as saved.
  const lockedTeams = new Set<string>();
  if (weekNumber >= 1) {
    const { data: lockRows, error: lockError } = await supabaseAdmin
      .from("game_projection_locks")
      .select("home_team, away_team")
      .eq("season", new Date().getFullYear())
      .eq("week", weekNumber)
      .limit(2000);
    if (lockError) {
      res.status(500).json({ error: `Couldn't read this week's frozen games (${lockError.message}) — nothing was written` });
      return;
    }
    for (const r of lockRows ?? []) {
      if (r.home_team) lockedTeams.add(r.home_team);
      if (r.away_team) lockedTeams.add(r.away_team);
    }
  }
  const skippedLocked = cleanRows.filter((r: any) => lockedTeams.has(r.team)).map((r: any) => r.team);
  const writeRows = cleanRows.filter((r: any) => !lockedTeams.has(r.team));
  const { error, count } = writeRows.length
    ? await supabaseAdmin.from("weekly_team_stats").upsert(writeRows, { onConflict: "team,week", count: "exact" })
    : { error: null, count: 0 };
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({
    ok: true,
    skippedLocked,
    saved: writeRows.length,
    teamsSynced: teamRows.length,
    week,
    count,
  });
}
