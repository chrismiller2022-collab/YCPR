import { createClient } from "@supabase/supabase-js";

// Pulls FPI, SP+, SRS, and Core ratings from CFBD into rating_pulls for the
// multi-rating-system admin page. Deliberately separate from fpi-sync.ts's
// fpi_ratings table (used by Survivor Pool) — this is its own working
// table, not meant to affect anything already reading fpi_ratings.
//
// Sign convention: every row in rating_pulls is stored so negative =
// favored/better, matching this site's power rating / YC scale
// everywhere else. CFBD's FPI is already on that kind of scale (higher =
// better), so it's negated on the way in. SP+ and SRS are also
// higher-is-better on CFBD, so also negated. Core's scale/sign hasn't
// been verified against a live response yet — worth checking the first
// real sync's stored values for a few known-good teams (e.g. Ohio State
// should land clearly negative and near the top) before trusting it.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CFBD_API_KEY = process.env.CFBD_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CFBD_BASE = "https://api.collegefootballdata.com";

async function cfbdFetch(path: string) {
  const res = await fetch(`${CFBD_BASE}${path}`, {
    headers: { Authorization: `Bearer ${CFBD_API_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CFBD request failed (${res.status}) for ${path}: ${text || res.statusText}`);
  }
  return res.json();
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

  // Each puller returns rows shaped { team, conference, value }, already
  // sign-flipped to this site's negative-is-better convention.
  const pullers: Record<string, () => Promise<{ team: string; conference: string | null; value: number }[]>> = {
    fpi: async () => {
      const data = await cfbdFetch(`/ratings/fpi?year=${year}`);
      return (data ?? [])
        .filter((r: any) => r.fpi != null)
        .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.fpi }));
    },
    sp: async () => {
      const data = await cfbdFetch(`/ratings/sp?year=${year}`);
      return (data ?? [])
        .filter((r: any) => r.rating != null)
        .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.rating }));
    },
    srs: async () => {
      const data = await cfbdFetch(`/ratings/srs?year=${year}`);
      return (data ?? [])
        .filter((r: any) => r.rating != null)
        .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.rating }));
    },
    core: async () => {
      const data = await cfbdFetch(`/ratings/core?year=${year}`);
      return (data ?? [])
        .filter((r: any) => (r.rating ?? r.core ?? null) != null)
        .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -(r.rating ?? r.core) }));
    },
  };

  const results: Record<string, { fetched: number; saved: number; error?: string }> = {};

  for (const [systemKey, pull] of Object.entries(pullers)) {
    try {
      const rows = await pull();
      results[systemKey] = { fetched: rows.length, saved: 0 };
      if (rows.length === 0) continue;

      const upsertRows = rows.map((r) => ({
        system_key: systemKey,
        team: r.team,
        division: null,
        conference: r.conference,
        value: r.value,
        pulled_at: new Date().toISOString(),
      }));

      const { error, count } = await supabaseAdmin
        .from("rating_pulls")
        .upsert(upsertRows, { onConflict: "system_key,team", count: "exact" });
      if (error) {
        results[systemKey].error = error.message;
        continue;
      }
      results[systemKey].saved = count ?? upsertRows.length;
    } catch (err: any) {
      results[systemKey] = { fetched: 0, saved: 0, error: err.message ?? "Sync failed" };
    }
  }

  res.status(200).json({ ok: true, year, results });
}
