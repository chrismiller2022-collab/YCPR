import { createHmac as pkCreateHmac, timingSafeEqual as pkTimingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

  const { password, year, sourceYear, action } = req.body ?? {};
  if (!(await isAdmin(password))) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!year || typeof year !== "number") {
    res.status(400).json({ error: "Missing or invalid 'year'" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Manual entry — for when CFBD doesn't have FPI for this season yet
    // (e.g. very early in a season before ratings are published) and you
    // want to hand-enter a placeholder value for one team instead of
    // pulling from CFBD at all.
    if (action === "manualUpsert") {
      const { team, conference, fpi } = req.body;
      if (!team || fpi == null) {
        res.status(400).json({ error: "Missing team or fpi" });
        return;
      }
      const { error } = await supabaseAdmin.from("fpi_ratings").upsert(
        [{ season: year, team, conference: conference ?? null, fpi, updated_at: new Date().toISOString() }],
        { onConflict: "season,team" }
      );
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    // sourceYear lets you pull a DIFFERENT year's FPI from CFBD (e.g. 2025,
    // if 2026's hasn't been published yet) while still saving it tagged
    // under the actual pool season (`year`) — so the rest of the app finds
    // it under the season it actually needs, as a stand-in/placeholder.
    const fetchYear = sourceYear && typeof sourceYear === "number" ? sourceYear : year;

    const cfbdRes = await fetch(`${CFBD_BASE}/ratings/fpi?year=${fetchYear}`, {
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

    res.status(200).json({ ok: true, year, sourceYear: fetchYear, fetched: (data ?? []).length, saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "FPI sync failed" });
  }
}
