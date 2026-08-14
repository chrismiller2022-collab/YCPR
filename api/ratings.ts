import { createClient } from "@supabase/supabase-js";

// Consolidated multi-rating-system endpoint — Vercel's Hobby plan caps
// deployments at 12 serverless functions (one per file in /api), and this
// project was right at that ceiling. Rather than 5 separate files
// (ratings-sync / ratings-sheet-proxy / ratings-save / ratings-week-save /
// ratings-weights-save), everything lives here behind an `action` field in
// the POST body. Each branch below is a verbatim copy of what used to be
// its own file — same behavior, same routes' worth of functionality, just
// dispatched from one function instead of five.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CFBD_API_KEY = process.env.CFBD_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CFBD_BASE = "https://api.collegefootballdata.com";

const PUBLISHED_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSVjBP2D2wtc8BqL4TjGFIUxPOK4108bp8VI-rSh9oVmeiEClfQQD2wECBnUvytTgEqOwjunK6Cwg9v/pub?output=csv";

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

interface IncomingSaveRow {
  team: string;
  conference?: string | null;
  division?: string | null;
  values: Record<string, number | null>;
}

// Postgres's upsert rejects a batch that hits the same conflict key twice
// ("ON CONFLICT DO UPDATE command cannot affect row a second time") —
// which happens here whenever the fuzzy team-name matcher maps two
// different raw CSV names onto the same canonical team (seen for real:
// McIllece's "UAB"/"LSU"/"Missouri State" and Massey's "LSU"/"Northwestern"
// each appeared twice under slightly different raw spellings). Rather than
// erroring the whole upload out, keep the LAST occurrence for each
// conflict key and drop the earlier duplicate silently — last-in-file
// wins, same as a plain object key overwrite would.
function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyOf(row), row);
  return Array.from(byKey.values());
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

  // sheetProxy doesn't need Supabase at all — check that separately per
  // action rather than gating the whole handler on it.
  if (action !== "sheetProxy") {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "Supabase server env vars are not configured" });
      return;
    }
  }

  // -----------------------------------------------------------------
  // action: "sheetProxy" — formerly ratings-sheet-proxy.ts
  // -----------------------------------------------------------------
  if (action === "sheetProxy") {
    try {
      const sheetRes = await fetch(PUBLISHED_SHEET_CSV_URL);
      if (!sheetRes.ok) throw new Error(`Sheet fetch failed (${sheetRes.status})`);
      const csv = await sheetRes.text();
      res.status(200).json({ ok: true, csv });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Sheet fetch failed" });
    }
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  // -----------------------------------------------------------------
  // action: "sync" — formerly ratings-sync.ts (FPI/SP+/SRS/Core from CFBD)
  // -----------------------------------------------------------------
  if (action === "sync") {
    if (!CFBD_API_KEY) {
      res.status(500).json({ error: "CFBD_API_KEY is not configured on the server" });
      return;
    }
    const { year } = req.body ?? {};
    if (!year || typeof year !== "number") {
      res.status(400).json({ error: "Missing or invalid 'year'" });
      return;
    }

    // Each puller takes the year to fetch for — pullWithFallback below
    // tries `year` first and, if CFBD has nothing for it yet (empty
    // array — this is normal early in a season before a given rating
    // system has published its first update), retries with `year - 1` so
    // the pull isn't just silently empty.
    const pullers: Record<string, (y: number) => Promise<{ team: string; conference: string | null; value: number }[]>> = {
      fpi: async (y) => {
        const data = await cfbdFetch(`/ratings/fpi?year=${y}`);
        return (data ?? [])
          .filter((r: any) => r.fpi != null)
          .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.fpi }));
      },
      sp: async (y) => {
        const data = await cfbdFetch(`/ratings/sp?year=${y}`);
        return (data ?? [])
          .filter((r: any) => r.rating != null)
          .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.rating }));
      },
      srs: async (y) => {
        let data = await cfbdFetch(`/ratings/srs?year=${y}`);
        // The plain endpoint has, in practice, come back empty in cases where
        // /ratings/srs/expanded (same schema + a classification field, and
        // documented to additionally include FCS) has data — fall back to it
        // before giving up on this year.
        if (!data || data.length === 0) {
          data = await cfbdFetch(`/ratings/srs/expanded?year=${y}`);
        }
        return (data ?? [])
          .filter((r: any) => r.rating != null)
          .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.rating }));
      },
      core: async (y) => {
        const data = await cfbdFetch(`/ratings/core?year=${y}`);
        return (data ?? [])
          .filter((r: any) => r.overall != null)
          .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: -r.overall }));
      },
      // Elo is on a completely different raw scale (~1200-1900, higher = better)
      // than every other system here (all point-spread scale, negative = better).
      // Stored RAW — not sign-flipped, not rescaled — since there's no principled
      // way to map Elo onto a spread scale. Defaults to weight 0 in YC/Consensus
      // (same as every other unweighted system) so it won't corrupt those averages
      // unless the admin deliberately dials in a weight knowing the scale mismatch.
      elo: async (y) => {
        const data = await cfbdFetch(`/ratings/elo?year=${y}`);
        return (data ?? [])
          .filter((r: any) => r.elo != null)
          .map((r: any) => ({ team: r.team, conference: r.conference ?? null, value: r.elo }));
      },
    };

    async function pullWithFallback(pull: (y: number) => Promise<any[]>, primaryYear: number) {
      let rows = await pull(primaryYear);
      let yearUsed = primaryYear;
      if (rows.length === 0) {
        rows = await pull(primaryYear - 1);
        yearUsed = primaryYear - 1;
      }
      return { rows, yearUsed };
    }

    const results: Record<string, { fetched: number; saved: number; yearUsed?: number; error?: string }> = {};
    for (const [systemKey, pull] of Object.entries(pullers)) {
      try {
        const { rows, yearUsed } = await pullWithFallback(pull, year);
        results[systemKey] = { fetched: rows.length, saved: 0, yearUsed };
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
    return;
  }

  // -----------------------------------------------------------------
  // action: "save" — formerly ratings-save.ts (rating_pulls upsert)
  // -----------------------------------------------------------------
  if (action === "save") {
    const { rows } = req.body ?? {};
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Missing or empty 'rows'" });
      return;
    }

    const now = new Date().toISOString();
    const upsertRows: any[] = [];
    for (const row of rows as IncomingSaveRow[]) {
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

    const deduped = dedupeByKey(upsertRows, (r) => `${r.system_key}::${r.team}`);

    const { error, count } = await supabaseAdmin
      .from("rating_pulls")
      .upsert(deduped, { onConflict: "system_key,team", count: "exact" });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true, saved: count ?? deduped.length, deduped: upsertRows.length - deduped.length });
    return;
  }

  // -----------------------------------------------------------------
  // action: "weekSave" — formerly ratings-week-save.ts (weekly_power_ratings upsert)
  // -----------------------------------------------------------------
  if (action === "weekSave") {
    const { season, week, rows } = req.body ?? {};
    if (!season || typeof season !== "number" || week == null || typeof week !== "number") {
      res.status(400).json({ error: "Missing or invalid 'season'/'week'" });
      return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Missing or empty 'rows'" });
      return;
    }

    const now = new Date().toISOString();
    const upsertRows: any[] = [];
    for (const row of rows as IncomingSaveRow[]) {
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

    const deduped = dedupeByKey(upsertRows, (r) => `${r.season}::${r.week}::${r.team}::${r.system_key}`);

    const { error, count } = await supabaseAdmin
      .from("weekly_power_ratings")
      .upsert(deduped, { onConflict: "season,week,team,system_key", count: "exact" });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true, saved: count ?? deduped.length, deduped: upsertRows.length - deduped.length });
    return;
  }

  // -----------------------------------------------------------------
  // action: "weightsSave" — formerly ratings-weights-save.ts
  // -----------------------------------------------------------------
  if (action === "weightsSave") {
    const { weights } = req.body ?? {};
    if (!weights || typeof weights !== "object") {
      res.status(400).json({ error: "Missing or invalid 'weights'" });
      return;
    }
    const rows = Object.entries(weights).map(([system_key, weight]) => ({
      system_key,
      weight: Number(weight) || 0,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from("rating_system_weights").upsert(rows, { onConflict: "system_key" });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true, saved: rows.length });
    return;
  }

  // -----------------------------------------------------------------
  // action: "checklistToggle" — admin_weekly_checklist upsert, one row
  // per (week, item_key). Backs the weekly checklist widget on the admin
  // dashboard home view.
  // -----------------------------------------------------------------
  if (action === "checklistToggle") {
    const { week, itemKey, checked } = req.body ?? {};
    if (!week || typeof week !== "string" || !itemKey || typeof itemKey !== "string" || typeof checked !== "boolean") {
      res.status(400).json({ error: "Missing or invalid 'week'/'itemKey'/'checked'" });
      return;
    }
    const { error } = await supabaseAdmin
      .from("admin_weekly_checklist")
      .upsert({ week, item_key: itemKey, checked, updated_at: new Date().toISOString() }, { onConflict: "week,item_key" });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: `Unknown action '${action}'` });
}
