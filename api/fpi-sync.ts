import { createClient } from "@supabase/supabase-js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CFBD_API_KEY = process.env.CFBD_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CFBD_BASE = "https://api.collegefootballdata.com";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!ADMIN_PASSWORD) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not configured on the server" });
    return;
  }
  if (!CFBD_API_KEY) {
    res.status(500).json({ error: "CFBD_API_KEY is not configured on the server" });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }

  const { password, year } = req.body ?? {};
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!year || typeof year !== "number") {
    res.status(400).json({ error: "Missing or invalid 'year'" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const cfbdRes = await fetch(`${CFBD_BASE}/ratings/fpi?year=${year}`, {
      headers: { Authorization: `Bearer ${CFBD_API_KEY}`, Accept: "application/json" },
    });
    if (!cfbdRes.ok) {
      const text = await cfbdRes.text().catch(() => "");
      throw new Error(`CFBD request failed (${cfbdRes.status}): ${text || cfbdRes.statusText}`);
    }
    const data = await cfbdRes.json();

    const rows = (data ?? [])
      .filter((r: any) => r.fpi != null)
      .map((r: any) => ({
        season: year,
        team: r.team,
        conference: r.conference ?? null,
        fpi: r.fpi,
        updated_at: new Date().toISOString(),
      }));

    let saved = 0;
    if (rows.length > 0) {
      const { error, count } = await supabaseAdmin
        .from("fpi_ratings")
        .upsert(rows, { onConflict: "season,team", count: "exact" });
      if (error) throw error;
      saved = count ?? rows.length;
    }

    res.status(200).json({ ok: true, year, fetched: (data ?? []).length, saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "FPI sync failed" });
  }
}
