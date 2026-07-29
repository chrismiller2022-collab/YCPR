import { createClient } from "@supabase/supabase-js";

// This runs on Vercel's servers, not in the browser — CFBD_API_KEY and the
// Supabase service role key never ship in the client bundle. Mirrors
// admin-save.ts's auth pattern: the password is re-checked here even
// though the Admin gate already confirmed it once client-side.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CFBD_API_KEY = process.env.CFBD_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CFBD_BASE = "https://api.collegefootballdata.com";

async function cfbdFetch(path: string) {
  const res = await fetch(`${CFBD_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${CFBD_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CFBD request failed (${res.status}): ${text || res.statusText}`);
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

  const { password, year, week, seasonType } = req.body ?? {};

  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!year || typeof year !== "number") {
    res.status(400).json({ error: "Missing or invalid 'year'" });
    return;
  }
  if (!week || typeof week !== "number") {
    res.status(400).json({ error: "Missing or invalid 'week'" });
    return;
  }

  const stype = seasonType === "postseason" ? "postseason" : "regular";
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // --- Games ---
    const cfbdGames = await cfbdFetch(
      `/games?year=${year}&week=${week}&seasonType=${stype}`
    );

    const gameRows = (cfbdGames ?? []).map((g: any) => ({
      id: String(g.id),
      season: g.season,
      week: g.week,
      season_type: g.seasonType ?? stype,
      start_date: g.startDate ?? null,
      neutral_site: !!g.neutralSite,
      home_team: g.homeTeam,
      away_team: g.awayTeam,
      home_points: g.homePoints ?? null,
      away_points: g.awayPoints ?? null,
      updated_at: new Date().toISOString(),
    }));

    let gamesUpserted = 0;
    if (gameRows.length > 0) {
      const { error: gamesError, count } = await supabaseAdmin
        .from("games")
        .upsert(gameRows, { onConflict: "id", count: "exact" });
      if (gamesError) {
        res.status(500).json({ error: `Saving games failed: ${gamesError.message}` });
        return;
      }
      gamesUpserted = count ?? gameRows.length;
    }

    // --- Betting lines ---
    const cfbdLines = await cfbdFetch(
      `/lines?year=${year}&week=${week}&seasonType=${stype}`
    );

    const lineRows: any[] = [];
    for (const entry of cfbdLines ?? []) {
      const gameId = String(entry.id);
      for (const line of entry.lines ?? []) {
        lineRows.push({
          game_id: gameId,
          season: entry.season ?? year,
          week: entry.week ?? week,
          provider: line.provider ?? "unknown",
          spread: line.spread != null ? Number(line.spread) : null,
          over_under: line.overUnder != null ? Number(line.overUnder) : null,
          home_moneyline: line.homeMoneyline != null ? Number(line.homeMoneyline) : null,
          away_moneyline: line.awayMoneyline != null ? Number(line.awayMoneyline) : null,
          pulled_at: new Date().toISOString(),
        });
      }
    }

    let linesUpserted = 0;
    if (lineRows.length > 0) {
      const { error: linesError, count } = await supabaseAdmin
        .from("betting_lines")
        .upsert(lineRows, { onConflict: "game_id,provider", count: "exact" });
      if (linesError) {
        res.status(500).json({ error: `Saving betting lines failed: ${linesError.message}` });
        return;
      }
      linesUpserted = count ?? lineRows.length;
    }

    res.status(200).json({
      ok: true,
      year,
      week,
      seasonType: stype,
      gamesUpserted,
      linesUpserted,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "CFBD sync failed" });
  }
}
