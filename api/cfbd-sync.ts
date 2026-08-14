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

  const { password, year, week, seasonType, syncStats } = req.body ?? {};

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
      if (!trackedGameIds.has(gameId)) continue;
      for (const line of entry.lines ?? []) {
        lineRows.push({
          game_id: gameId,
          season: entry.season ?? year,
          week: entry.week ?? week ?? null,
          provider: line.provider ?? "unknown",
          spread: line.spread != null ? Number(line.spread) : null,
          over_under: line.overUnder != null ? Number(line.overUnder) : null,
          // Opening lines — NOT previously captured at all. CFBD's field
          // names here are inferred as "spreadOpen"/"overUnderOpen"
          // (camelCase "Open" suffix, matching their convention
          // elsewhere) but haven't been confirmed against a live
          // response — worth checking the first real sync's stored
          // values against collegefootballdata.com's own game page to
          // make sure these landed correctly, since a silent null here
          // would just make Composite 3-6 fall back to "live" forever
          // without an obvious error.
          opening_spread: line.spreadOpen != null ? Number(line.spreadOpen) : null,
          opening_over_under: line.overUnderOpen != null ? Number(line.overUnderOpen) : null,
          // Confirmed against CFBD's OpenAPI spec: homeMoneyline/awayMoneyline
          // (camelCase). The betting_lines columns for these already existed
          // and are read elsewhere (matchupsCompute.ts, espnMlPool.ts), but
          // nothing ever actually wrote them — this was a silent gap, not a
          // wrong field name.
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

    // --- Team season stats (only when explicitly requested — separate
    // concern from games/lines, and a much bigger payload) ---
    let statsTeamsUpserted = 0;
    if (syncStats) {
      // /stats/season is long-format: one row per {team, statName,
      // statValue}. Pivot into one wide row per team, keeping only the
      // fields the Game Totals engine actually uses.
      const basicStats = await cfbdFetch(`/stats/season?year=${year}`);
      const WANTED_STATS: Record<string, string> = {
        rushingAttempts: "rushing_attempts",
        rushingYards: "rushing_yards",
        rushingAttemptsOpponent: "rushing_attempts_opponent",
        rushingYardsOpponent: "rushing_yards_opponent",
        passAttempts: "pass_attempts",
        netPassingYards: "net_passing_yards",
        passAttemptsOpponent: "pass_attempts_opponent",
        netPassingYardsOpponent: "net_passing_yards_opponent",
        totalYards: "total_yards",
        totalYardsOpponent: "total_yards_opponent",
        games: "games",
        possessionTime: "possession_time",
        possessionTimeOpponent: "possession_time_opponent",
      };

      // CFBD returns possessionTime as MM:SS — converted to seconds so
      // it's a plain number to do math on later.
      function toSeconds(v: any): number | null {
        if (v == null) return null;
        if (typeof v === "number") return v;
        const parts = String(v).split(":");
        if (parts.length !== 2) return Number(v) || null;
        const [m, s] = parts.map(Number);
        return m * 60 + s;
      }

      const byTeam = new Map<string, any>();
      for (const row of basicStats ?? []) {
        const col = WANTED_STATS[row.statName];
        if (!col) continue;
        const key = row.team;
        const entry = byTeam.get(key) ?? { season: row.season ?? year, team: row.team, conference: row.conference ?? null };
        entry[col] = col === "possession_time" || col === "possession_time_opponent" ? toSeconds(row.statValue) : Number(row.statValue);
        byTeam.set(key, entry);
      }

      // /stats/season/advanced — nested offense/defense objects, per
      // established CFBD API convention (matches how the CSV exporter's
      // "Offense Plays"/"Defense Plays" columns are flattened from
      // offense.plays/defense.plays). NOT verified against a live
      // response yet — worth checking the first real sync's stored
      // offense_plays/defense_plays values against the exporter CSV to
      // confirm these landed, since a wrong nesting assumption here
      // would silently store nulls rather than error.
      const advancedStats = await cfbdFetch(`/stats/season/advanced?year=${year}`);
      for (const row of advancedStats ?? []) {
        const entry = byTeam.get(row.team) ?? { season: row.season ?? year, team: row.team, conference: row.conference ?? null };
        entry.offense_plays = row.offense?.plays ?? null;
        entry.offense_drives = row.offense?.drives ?? null;
        entry.defense_plays = row.defense?.plays ?? null;
        entry.defense_drives = row.defense?.drives ?? null;
        byTeam.set(row.team, entry);
      }

      const statRows = Array.from(byTeam.values()).map((e) => ({ ...e, updated_at: new Date().toISOString() }));

      if (statRows.length > 0) {
        const { error: statsError, count } = await supabaseAdmin
          .from("team_season_stats")
          .upsert(statRows, { onConflict: "season,team", count: "exact" });
        if (statsError) {
          res.status(500).json({ error: `Saving team season stats failed: ${statsError.message}` });
          return;
        }
        statsTeamsUpserted = count ?? statRows.length;
      }
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
      statsTeamsUpserted,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "CFBD sync failed" });
  }
}
