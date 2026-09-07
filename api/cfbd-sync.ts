import { createClient } from "@supabase/supabase-js";

// This runs on Vercel's servers, not in the browser — CFBD_API_KEY and the
// Supabase service role key never ship in the client bundle. Mirrors
// admin-save.ts's auth pattern: the password is re-checked here even
// though the Admin gate already confirmed it once client-side.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CFBD_API_KEY = process.env.CFBD_API_KEY;
// Separate from CFBD_API_KEY on purpose — CFBD's own docs are explicit
// that the Model Pick'em prediction token is a different credential
// from the main data-API key and the two "cannot be used
// interchangeably." This token also expires monthly (obtained from
// predictions.collegefootballdata.com/api/auth/token while logged in),
// so it'll periodically need updating in Vercel's env vars — there's no
// way to auto-refresh it from here.
const CFBD_PREDICTIONS_TOKEN = process.env.CFBD_PREDICTIONS_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CFBD_BASE = "https://api.collegefootballdata.com";
const PREDICTIONS_BASE = "https://predictionsapi.collegefootballdata.com/api";

const TRACKED_CLASSIFICATIONS = new Set(["fbs", "fcs"]);

function isTrackedGame(g: any): boolean {
  const home = String(g.homeClassification ?? "").toLowerCase();
  const away = String(g.awayClassification ?? "").toLowerCase();
  return TRACKED_CLASSIFICATIONS.has(home) || TRACKED_CLASSIFICATIONS.has(away);
}

interface PredictionsPick {
  gameId: number;
  pick: string;
}

const DEFAULT_HFA = 2.4;

// Auto-fills and submits a prediction for every game CFBD's Model
// Pick'em contest currently has open, using this site's own live power
// ratings — same formula/sign convention as CfbdPickemPanel.tsx's
// manual paste tool (negative = home favored), just without the
// copy/paste round trip.
//
// Rewritten against the real payload CFBD's own "Copy API Submission
// Payload" button produces: GET/POST /api/picks both use the shape
// { picks: [{ gameId, pick }] } (pick is a STRING, "" when unset), with
// no team names at all — gameId is CFBD's own event id, which matches
// this site's `games.id` exactly (same source), so games are resolved
// from our own already-synced `games` table instead of trusting team
// names that this endpoint apparently no longer sends. Submitted in one
// batched POST rather than one request per game, matching that same
// payload shape. Also mirrors every submitted prediction into
// cfbd_pickem_predictions so CfbdPickemPanel's SU/ATS/MAE/MSE stats
// pick it up automatically, without a separate manual save step.
//
// Re-derives hfaFor()'s tiny lookup inline rather than importing
// src/lib/odds.ts — every other api/*.ts file in this repo is
// self-contained (Vercel bundles this directory in isolation from the
// Vite client build), so this follows the same convention instead of
// introducing a cross-directory import.
async function syncPredictions(res: any) {
  const supabaseAdmin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const picksRes = await fetch(`${PREDICTIONS_BASE}/picks`, { headers: { authorization: `Bearer ${CFBD_PREDICTIONS_TOKEN}` } });
  if (!picksRes.ok) {
    const text = await picksRes.text().catch(() => "");
    throw new Error(`CFBD predictions API request failed (${picksRes.status}): ${text || picksRes.statusText}`);
  }
  const picksData = await picksRes.json();
  const picks: PredictionsPick[] = Array.isArray(picksData) ? picksData : picksData.picks ?? [];
  // Diagnostic only — the "gameId"/"pick" field names are inferred from
  // CFBD's "Copy API Submission Payload" button, which produces a
  // submission TEMPLATE and may not exactly match this GET response's
  // real shape. Surfaced back to the client whenever nothing resolves,
  // so a shape mismatch shows the actual field names instead of a bare
  // "0 submitted."
  const rawSample = picks[0] ?? (Array.isArray(picksData) ? null : picksData);
  if (picks.length === 0) {
    res.status(200).json({ ok: true, totalGames: 0, submitted: 0, unmatchedTeams: [], gamesNotFound: [], failedSubmits: [], rawSample });
    return;
  }

  const gameIds = picks.map((p) => String(p.gameId));
  const { data: games, error: gamesError } = await supabaseAdmin.from("games").select("id, season, home_team, away_team").in("id", gameIds);
  if (gamesError) throw gamesError;
  const gameById = new Map((games ?? []).map((g) => [g.id, g]));

  // "latest" isn't a real week label in weekly_team_stats — resolve the
  // actual most-recent week first, same as the rest of the site does.
  const { data: weeks } = await supabaseAdmin
    .from("weekly_team_stats")
    .select("week, week_number")
    .order("week_number", { ascending: false })
    .limit(1);
  const latestWeek = weeks?.[0]?.week;
  if (!latestWeek) throw new Error("No weekly_team_stats rows found to resolve the latest week");

  const { data: ratingRows, error: ratingsError } = await supabaseAdmin
    .from("weekly_team_stats")
    .select("team, rating, hfa")
    .eq("week", latestWeek);
  if (ratingsError) throw ratingsError;

  const ratingByTeam = new Map<string, { rating: number; hfa: number | null }>();
  for (const r of ratingRows ?? []) ratingByTeam.set(r.team, { rating: r.rating, hfa: r.hfa });

  const submissions: { gameId: number; pick: string }[] = [];
  const predictionRows: { game_id: string; season: number; predicted_margin: number }[] = [];
  const unmatched: string[] = [];
  const gamesNotFound: string[] = [];

  for (const p of picks) {
    const game = gameById.get(String(p.gameId));
    if (!game) {
      gamesNotFound.push(String(p.gameId));
      continue;
    }
    const home = ratingByTeam.get(game.home_team);
    const away = ratingByTeam.get(game.away_team);
    if (!home || !away) {
      if (!home) unmatched.push(game.home_team);
      if (!away) unmatched.push(game.away_team);
      continue;
    }
    const hfa = home.hfa ?? DEFAULT_HFA;
    const predicted = Math.round((home.rating - away.rating - hfa) * 100) / 100;
    submissions.push({ gameId: p.gameId, pick: String(predicted) });
    predictionRows.push({ game_id: game.id, season: game.season, predicted_margin: predicted });
  }

  if (submissions.length > 0) {
    const submitRes = await fetch(`${PREDICTIONS_BASE}/picks`, {
      method: "POST",
      headers: { authorization: `Bearer ${CFBD_PREDICTIONS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ picks: submissions }),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      throw new Error(`CFBD picks submission failed (${submitRes.status}): ${text || submitRes.statusText}`);
    }

    const { error: predError } = await supabaseAdmin
      .from("cfbd_pickem_predictions")
      .upsert(predictionRows, { onConflict: "game_id" });
    if (predError) throw predError;
  }

  res.status(200).json({
    ok: true,
    totalGames: picks.length,
    submitted: submissions.length,
    unmatchedTeams: Array.from(new Set(unmatched)),
    gamesNotFound: Array.from(new Set(gamesNotFound)),
    failedSubmits: [],
    rawSample: submissions.length === 0 ? rawSample : undefined,
  });
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
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }

  if (req.body?.mode === "predictions") {
    const { password } = req.body ?? {};
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    if (!CFBD_PREDICTIONS_TOKEN) {
      res.status(500).json({ error: "CFBD_PREDICTIONS_TOKEN is not configured on the server" });
      return;
    }
    try {
      await syncPredictions(res);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Predictions sync failed" });
    }
    return;
  }

  if (!CFBD_API_KEY) {
    res.status(500).json({ error: "CFBD_API_KEY is not configured on the server" });
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

    // TV/radio/streaming outlet per game — best-effort merge by game id;
    // a game with no media entry yet (announced late) just has null
    // tv_outlet/media_type until the next sync.
    const cfbdMedia = await cfbdFetch(`/games/media?year=${year}${weekParam}&seasonType=${stype}`).catch(() => []);
    const mediaByGameId = new Map<string, { outlet: string | null; mediaType: string | null }>();
    for (const m of cfbdMedia ?? []) {
      // Prefer a "tv" entry over radio/web/etc if a game has more than
      // one outlet listed; otherwise take whatever's first.
      const existing = mediaByGameId.get(String(m.id));
      if (!existing || (m.mediaType === "tv" && existing.mediaType !== "tv")) {
        mediaByGameId.set(String(m.id), { outlet: m.outlet ?? null, mediaType: m.mediaType ?? null });
      }
    }

    const gameRows = trackedGames.map((g: any) => {
      const media = mediaByGameId.get(String(g.id));
      return {
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
        tv_outlet: media?.outlet ?? null,
        media_type: media?.mediaType ?? null,
        updated_at: new Date().toISOString(),
      };
    });

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
      // response yet — every field below is read with optional chaining
      // so a wrong nesting assumption produces nulls, not a thrown error;
      // worth checking a real synced row against CFBD's docs/an actual
      // response the first time this runs. This used to only keep
      // plays/drives — the Game Totals engine now runs on the full
      // efficiency set (PPA/success rate/explosiveness/points-per-
      // opportunity/havoc/etc.), so everything CFBD gives us here gets
      // stored instead of discarded.
      const advancedStats = await cfbdFetch(`/stats/season/advanced?year=${year}`);
      for (const row of advancedStats ?? []) {
        const entry = byTeam.get(row.team) ?? { season: row.season ?? year, team: row.team, conference: row.conference ?? null };
        const off = row.offense ?? {};
        const def = row.defense ?? {};

        entry.offense_plays = off.plays ?? null;
        entry.offense_drives = off.drives ?? null;
        entry.defense_plays = def.plays ?? null;
        entry.defense_drives = def.drives ?? null;

        entry.off_ppa = off.ppa ?? null;
        entry.off_success_rate = off.successRate ?? null;
        entry.off_explosiveness = off.explosiveness ?? null;
        entry.off_points_per_opportunity = off.pointsPerOpportunity ?? null;
        entry.off_power_success = off.powerSuccess ?? null;
        entry.off_stuff_rate = off.stuffRate ?? null;
        entry.off_line_yards = off.lineYards ?? null;
        entry.off_standard_downs_ppa = off.standardDowns?.ppa ?? null;
        entry.off_standard_downs_success_rate = off.standardDowns?.successRate ?? null;
        entry.off_standard_downs_explosiveness = off.standardDowns?.explosiveness ?? null;
        entry.off_passing_downs_ppa = off.passingDowns?.ppa ?? null;
        entry.off_passing_downs_success_rate = off.passingDowns?.successRate ?? null;
        entry.off_passing_downs_explosiveness = off.passingDowns?.explosiveness ?? null;
        entry.off_rushing_plays_ppa = off.rushingPlays?.ppa ?? null;
        entry.off_rushing_plays_success_rate = off.rushingPlays?.successRate ?? null;
        entry.off_rushing_plays_explosiveness = off.rushingPlays?.explosiveness ?? null;
        entry.off_passing_plays_ppa = off.passingPlays?.ppa ?? null;
        entry.off_passing_plays_success_rate = off.passingPlays?.successRate ?? null;
        entry.off_passing_plays_explosiveness = off.passingPlays?.explosiveness ?? null;
        entry.off_field_position_avg_start = off.fieldPosition?.averageStart ?? null;
        entry.off_field_position_avg_predicted_points = off.fieldPosition?.averagePredictedPoints ?? null;
        entry.off_havoc_total = off.havoc?.total ?? null;
        entry.off_havoc_front_seven = off.havoc?.frontSeven ?? null;
        entry.off_havoc_db = off.havoc?.db ?? null;

        entry.def_ppa = def.ppa ?? null;
        entry.def_success_rate = def.successRate ?? null;
        entry.def_explosiveness = def.explosiveness ?? null;
        entry.def_points_per_opportunity = def.pointsPerOpportunity ?? null;
        entry.def_power_success = def.powerSuccess ?? null;
        entry.def_stuff_rate = def.stuffRate ?? null;
        entry.def_line_yards = def.lineYards ?? null;
        entry.def_standard_downs_ppa = def.standardDowns?.ppa ?? null;
        entry.def_standard_downs_success_rate = def.standardDowns?.successRate ?? null;
        entry.def_standard_downs_explosiveness = def.standardDowns?.explosiveness ?? null;
        entry.def_passing_downs_ppa = def.passingDowns?.ppa ?? null;
        entry.def_passing_downs_success_rate = def.passingDowns?.successRate ?? null;
        entry.def_passing_downs_explosiveness = def.passingDowns?.explosiveness ?? null;
        entry.def_rushing_plays_ppa = def.rushingPlays?.ppa ?? null;
        entry.def_rushing_plays_success_rate = def.rushingPlays?.successRate ?? null;
        entry.def_rushing_plays_explosiveness = def.rushingPlays?.explosiveness ?? null;
        entry.def_passing_plays_ppa = def.passingPlays?.ppa ?? null;
        entry.def_passing_plays_success_rate = def.passingPlays?.successRate ?? null;
        entry.def_passing_plays_explosiveness = def.passingPlays?.explosiveness ?? null;
        entry.def_field_position_avg_start = def.fieldPosition?.averageStart ?? null;
        entry.def_field_position_avg_predicted_points = def.fieldPosition?.averagePredictedPoints ?? null;
        entry.def_havoc_total = def.havoc?.total ?? null;
        entry.def_havoc_front_seven = def.havoc?.frontSeven ?? null;
        entry.def_havoc_db = def.havoc?.db ?? null;

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
