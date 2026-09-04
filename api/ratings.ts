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
        // The plain /ratings/srs endpoint has, in practice, come back empty
        // OR thrown outright (404/deprecated) for some years — previously
        // only the "came back empty" case fell through to
        // /ratings/srs/expanded (same schema + a classification field,
        // documented to additionally include FCS); a thrown error skipped
        // the fallback entirely and just failed the whole pull. Now both
        // cases fall through the same way.
        let data: any[] | null = null;
        try {
          data = await cfbdFetch(`/ratings/srs?year=${y}`);
        } catch {
          data = null;
        }
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
      // than every other system here — min-max normalized across the pulled
      // batch onto [-30, +55] (best -> -30, worst -> +55) and sign-flipped,
      // same treatment as the Massey CSV upload's normalizeMasseyRows().
      elo: async (y) => {
        const data = await cfbdFetch(`/ratings/elo?year=${y}`);
        const rows = (data ?? []).filter((r: any) => r.elo != null);
        if (rows.length === 0) return [];
        const values = rows.map((r: any) => r.elo);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min;
        return rows.map((r: any) => {
          const t = span === 0 ? 0.5 : (r.elo - min) / span; // 0 = worst, 1 = best
          const normalized = 55 + t * (-30 - 55); // worst -> +55, best -> -30
          return { team: r.team, conference: r.conference ?? null, value: normalized };
        });
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

        const upsertRows = dedupeByKey(
          rows.map((r) => ({
            system_key: systemKey,
            team: r.team,
            division: null,
            conference: r.conference,
            value: r.value,
            pulled_at: new Date().toISOString(),
          })),
          (r) => `${r.system_key}::${r.team}`
        );

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

  // -----------------------------------------------------------------
  // action: "pushYc" — writes YC into weekly_team_stats.rating (the same
  // table/column Data Upload writes) for a given week, WITHOUT touching
  // any other column on those rows (resume metrics, win totals, etc. stay
  // whatever they already were). This is deliberately NOT admin-save.ts's
  // upsert-a-full-row pattern — that would null out every field the
  // caller didn't also send. Instead: read the week's existing rows,
  // merge in just the new rating per team (leaving teams YC has no value
  // for untouched), recompute rank across the resulting full set, upsert
  // the merged rows back.
  // -----------------------------------------------------------------
  if (action === "pushYc") {
    const { week, teamRatings } = req.body ?? {};
    if (!week || typeof week !== "string") {
      res.status(400).json({ error: "Missing or invalid 'week'" });
      return;
    }
    if (!Array.isArray(teamRatings) || teamRatings.length === 0) {
      res.status(400).json({ error: "Missing or empty 'teamRatings'" });
      return;
    }

    const weekToNumber = (w: string): number => {
      if (w === "preseason") return 0;
      const m = /^week(\d+)$/.exec(w);
      return m ? parseInt(m[1], 10) : -1;
    };

    const { data: existingRows, error: fetchError } = await supabaseAdmin
      .from("weekly_team_stats")
      .select("*")
      .eq("week", week);
    if (fetchError) {
      res.status(500).json({ error: fetchError.message });
      return;
    }

    // Drop `id` when copying — it's a GENERATED ALWAYS AS IDENTITY column,
    // so re-sending it (even the row's own existing value) in an upsert's
    // INSERT ... ON CONFLICT makes Postgres reject the whole batch with
    // "cannot insert a non-DEFAULT value into column \"id\"", regardless
    // of whether the row ends up inserted or updated. onConflict:
    // "team,week" is enough to match existing rows without it.
    const byTeam = new Map<string, any>();
    for (const row of existingRows ?? []) {
      const { id: _id, ...rest } = row;
      byTeam.set(row.team, rest);
    }

    const nowIso = new Date().toISOString();
    const weekNumber = weekToNumber(week);
    let matched = 0;
    for (const { team, rating } of teamRatings as { team: string; rating: number }[]) {
      if (rating == null || Number.isNaN(rating)) continue;
      const existing = byTeam.get(team);
      if (existing) {
        existing.rating = rating;
        existing.updated_at = nowIso;
      } else {
        byTeam.set(team, { team, week, week_number: weekNumber, rating, updated_at: nowIso });
      }
      matched++;
    }

    // Recompute rank across every row now in this week (old + newly pushed
    // alike) — negative = better, so ascending rating order = rank 1..N.
    // Rows with no rating at all (never uploaded, YC has no value either)
    // are left without a rank rather than guessed at.
    const allRows = Array.from(byTeam.values());
    const withRating = allRows.filter((r) => r.rating != null).sort((a, b) => a.rating - b.rating);
    withRating.forEach((r, i) => {
      r.rank = i + 1;
    });

    const { error: upsertError, count } = await supabaseAdmin
      .from("weekly_team_stats")
      .upsert(allRows, { onConflict: "team,week", count: "exact" });
    if (upsertError) {
      res.status(500).json({ error: upsertError.message });
      return;
    }

    // Mirror this week into the season archive (season_weekly_ratings) —
    // weekly_team_stats has no season column and upserts on (team, week)
    // alone, so the moment next season reuses these same week labels
    // (e.g. next year's "week1" upload), this season's data would
    // otherwise be silently overwritten with no record left. Archiving on
    // every push means it's already saved from the moment each week goes
    // live, not something that has to be remembered at season's end.
    // Best-effort: a failure here doesn't fail the actual ratings push.
    const currentSeason = new Date().getFullYear();
    const archiveRows = allRows
      .filter((r) => r.rating != null)
      .map((r) => ({
        season: currentSeason,
        week,
        week_number: weekNumber,
        team: r.team,
        rating: r.rating,
        resume_rating: r.resume_rating ?? null,
        sor: r.sor ?? null,
        rank: r.rank ?? null,
      }));
    if (archiveRows.length > 0) {
      await supabaseAdmin
        .from("season_weekly_ratings")
        .upsert(archiveRows, { onConflict: "season,week,team" });
      // Errors here are intentionally swallowed — archiving is a
      // best-effort mirror, not the primary write this action promises.
    }

    res.status(200).json({ ok: true, matched, saved: count ?? allRows.length, week });
    return;
  }

  // -----------------------------------------------------------------
  // action: "saveSos" — snapshots the SOS admin page's computed rows
  // (Avg Opp PR, SOS from SRS, Best/Worst Win/Loss PR — total and
  // in-conference) into team_sos, one row per (season, week, team).
  // Week-scoped (added Sept 2026) — this used to overwrite one row per
  // (season, team) with no week dimension at all, so saving a later
  // week destroyed the earlier week's numbers permanently. This is
  // what lets public pages like Conference Previews show an
  // in-conference SOS number without re-running the SRS Monte Carlo
  // simulation client side on every page load.
  // -----------------------------------------------------------------
  if (action === "saveSos") {
    const { season, week, rows } = req.body ?? {};
    if (!season || typeof season !== "number") {
      res.status(400).json({ error: "Missing or invalid 'season'" });
      return;
    }
    if (!week || typeof week !== "number") {
      res.status(400).json({ error: "Missing or invalid 'week'" });
      return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Missing or empty 'rows'" });
      return;
    }

    const nowIso = new Date().toISOString();
    const saveRows = rows.map((r: any) => ({
      season,
      week,
      team: r.team,
      updated_at: nowIso,
      avg_opp_pr_total: r.avgOppYcTotal ?? null,
      avg_opp_pr_conference: r.avgOppYcConf ?? null,
      sos_srs_total: r.sosSrsTotal ?? null,
      sos_srs_conference: r.sosSrsConf ?? null,
      num_srs_runs: r.numSrsRuns ?? null,
      best_win_pr_total: r.bestWinTotal?.rating ?? null,
      best_win_pr_total_opp: r.bestWinTotal?.opp ?? null,
      best_win_pr_conference: r.bestWinConf?.rating ?? null,
      best_win_pr_conference_opp: r.bestWinConf?.opp ?? null,
      best_loss_pr_total: r.bestLossTotal?.rating ?? null,
      best_loss_pr_total_opp: r.bestLossTotal?.opp ?? null,
      best_loss_pr_conference: r.bestLossConf?.rating ?? null,
      best_loss_pr_conference_opp: r.bestLossConf?.opp ?? null,
      worst_loss_pr_total: r.worstLossTotal?.rating ?? null,
      worst_loss_pr_total_opp: r.worstLossTotal?.opp ?? null,
      worst_loss_pr_conference: r.worstLossConf?.rating ?? null,
      worst_loss_pr_conference_opp: r.worstLossConf?.opp ?? null,
    }));

    const { error, count } = await supabaseAdmin
      .from("team_sos")
      .upsert(saveRows, { onConflict: "season,week,team", count: "exact" });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ ok: true, saved: count ?? saveRows.length });
    return;
  }

  res.status(400).json({ error: `Unknown action '${action}'` });
}
