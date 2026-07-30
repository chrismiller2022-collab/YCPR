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

// Division filter: keep any game where at least one side is FBS or FCS.
// This lets FBS-vs-FBS, FBS-vs-FCS, FCS-vs-FCS, and FCS-vs-other-division
// games through, but drops games where BOTH sides are below FCS (e.g. a
// Division II vs Division II game), since neither team in that matchup
// is one we track ratings for anyway.
const TRACKED_CLASSIFICATIONS = new Set(["fbs", "fcs"]);

function isTrackedGame(g: any): boolean {
  const home = String(g.homeClassification ?? "").toLowerCase();
  const away = String(g.awayClassification ?? "").toLowerCase();
  return TRACKED_CLASSIFICATIONS.has(home) || TRACKED_CLASSIFICATIONS.has(away);
}

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

  // `week` is now optional — omit it (or send null) to pull the entire
  // season in one call, matching how CFBD's own /games and /lines
  // endpoints behave when week is left off the query string.
  const { password, year, week, seasonType } = req.body ?? {};

  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (!year || typeof year !== "number") {
    res.status(400).json({ error: "Missing or invalid 'year'" });
    return;
  }
  if (week != null && typeof week !== "number") {
    res.status(400).json({ error: "'week', if provided, must be a number" });
    return;
  }

  const stype = seasonType === "postseason" ? "postseason" : "regular";
  const weekParam = week != null ? `&week=${week}` : "";
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // --- Games ---
    const cfbdGames = await cfbdFetch(`/games?year=${year}${weekParam}&seasonType=${stype}`);
    const trackedGames = (cfbdGames ?? []).filter(isTrackedGame);
    const trackedGameIds = new Set(trackedGames.map((g: any) => String(g.id)));

    const gameRows = trackedGames.map((g: any) => ({
      id: String(g.id),
      season: g.season,
      week: g.week,
      season_type: g.seasonType ?? stype,
      start_date: g.startDate ?? null,
      neutral_site: !!g.neutralSite,
      conference_game: !!g.conferenceGame,
      completed: !!g.completed,
      home_team: g.homeTeam,
      home_classification: g.homeClassification ?? null,
      home_conference: g.homeConference ?? null,
      home_points: g.homePoints ?? null,
      home_postgame_win_probability: g.homePostgameWinProbability ?? null,
      away_team: g.awayTeam,
      away_classification: g.awayClassification ?? null,
      away_conference: g.awayConference ?? null,
      away_points: g.awayPoints ?? null,
      away_postgame_win_probability: g.awayPostgameWinProbability ?? null,
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
    const cfbdLines = await cfbdFetch(`/lines?year=${year}${weekParam}&seasonType=${stype}`);

    const lineRows: any[] = [];
    for (const entry of cfbdLines ?? []) {
      const gameId = String(entry.id);
      // Only keep lines for games we actually kept above — a game filtered
      // out by division shouldn't end up with orphaned lines rows.
      if (!trackedGameIds.has(gameId)) continue;
      for (const line of entry.lines ?? []) {
        lineRows.push({
          game_id: gameId,
          season: entry.season ?? year,
          week: entry.week ?? week ?? null,
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
      week: week ?? "all",
      seasonType: stype,
      gamesFetched: (cfbdGames ?? []).length,
      gamesSkippedByDivision: (cfbdGames ?? []).length - trackedGames.length,
      gamesUpserted,
      linesUpserted,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "CFBD sync failed" });
  }
}
