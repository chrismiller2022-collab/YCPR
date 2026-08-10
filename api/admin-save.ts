import { createClient } from "@supabase/supabase-js";
// This runs on Vercel's servers, not in the browser — it's the only place
// the service role key is used, and it's the only code path allowed to write
// to weekly_team_stats or teams. The browser only ever holds the public
// anon (read-only) key.
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
  const { password, week, rows } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
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
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
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
  const cleanRows = rows.map((r: any) => {
    const cleaned: Record<string, any> = { week, updated_at: nowIso };
    for (const field of STAT_FIELDS) {
      cleaned[field] = r[field] ?? null;
    }
    return cleaned;
  });
  const { error, count } = await supabaseAdmin
    .from("weekly_team_stats")
    .upsert(cleanRows, { onConflict: "team,week", count: "exact" });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({
    ok: true,
    saved: cleanRows.length,
    teamsSynced: teamRows.length,
    week,
    count,
  });
}
