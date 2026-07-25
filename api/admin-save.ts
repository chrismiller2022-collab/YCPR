import { createClient } from "@supabase/supabase-js";

// This runs on Vercel's servers, not in the browser — it's the only place
// the service role key is used, and it's the only code path allowed to write
// to weekly_team_stats. The browser only ever holds the public anon (read-only) key.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const REQUIRED_FIELDS = [
  "team",
  "rating",
  "rank",
  "sor",
  "resume_rank",
  "resume_rating",
  "total_wins",
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

  // Only pass through known columns, and stamp every row with the target week.
  const cleanRows = rows.map((r: any) => {
    const cleaned: Record<string, any> = { week };
    for (const field of REQUIRED_FIELDS) {
      cleaned[field] = r[field] ?? null;
    }
    return cleaned;
  });

  const missingTeam = cleanRows.find((r) => !r.team);
  if (missingTeam) {
    res.status(400).json({ error: "One or more rows is missing a team name" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error, count } = await supabaseAdmin
    .from("weekly_team_stats")
    .upsert(cleanRows, { onConflict: "team,week", count: "exact" });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ ok: true, saved: cleanRows.length, week, count });
}
