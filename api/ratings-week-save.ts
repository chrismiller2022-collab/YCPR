import { createClient } from "@supabase/supabase-js";

// "Save As Week" — freezes the current conglomerated table (every system's
// live rating_pulls value, plus the client-computed YC/Consensus) into
// weekly_power_ratings for a specific (season, week). Upsert on the
// (season, week, team, system_key) unique constraint means this naturally
// either creates a new week's snapshot or overwrites an existing one,
// depending on what the admin picks client-side — no separate "mode" flag
// needed here.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface IncomingRow {
  team: string;
  division?: string | null;
  conference?: string | null;
  values: Record<string, number | null>; // system_key -> value, includes 'yc' and 'consensus'
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

  const { password, season, week, rows } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!season || typeof season !== "number" || week == null || typeof week !== "number") {
    res.status(400).json({ error: "Missing or invalid 'season'/'week'" });
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "Missing or empty 'rows'" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  const upsertRows: any[] = [];
  for (const row of rows as IncomingRow[]) {
    if (!row.team || !row.values) continue;
    for (const [systemKey, value] of Object.entries(row.values)) {
      if (value == null || Number.isNaN(value)) continue;
      upsertRows.push({
        season,
        week,
        team: row.team,
        division: row.division ?? null,
        conference: row.conference ?? null,
        system_key: systemKey,
        value,
        saved_at: now,
      });
    }
  }

  if (upsertRows.length === 0) {
    res.status(400).json({ error: "No usable (non-null) values in 'rows'" });
    return;
  }

  const { error, count } = await supabaseAdmin
    .from("weekly_power_ratings")
    .upsert(upsertRows, { onConflict: "season,week,team,system_key", count: "exact" });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ ok: true, saved: count ?? upsertRows.length });
}
