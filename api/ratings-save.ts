import { createClient } from "@supabase/supabase-js";

// Generic upsert target for rating_pulls, fed by the client after it's
// already done CSV/sheet parsing + team-name matching (that logic lives in
// src/lib, which the browser can import directly — see the note in
// ratings-sheet-proxy.ts). One row can carry multiple systems' values at
// once (the Google Sheet pull sends ~11 systems per team in a single
// request); CSV uploads typically send just one.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface IncomingRow {
  team: string;
  conference?: string | null;
  division?: string | null;
  values: Record<string, number | null>;
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

  const { password, rows } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
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
        system_key: systemKey,
        team: row.team,
        division: row.division ?? null,
        conference: row.conference ?? null,
        value,
        pulled_at: now,
      });
    }
  }

  if (upsertRows.length === 0) {
    res.status(400).json({ error: "No usable (non-null) values in 'rows'" });
    return;
  }

  const { error, count } = await supabaseAdmin
    .from("rating_pulls")
    .upsert(upsertRows, { onConflict: "system_key,team", count: "exact" });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ ok: true, saved: count ?? upsertRows.length });
}
