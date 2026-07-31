import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: any = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return (asUTC - date.getTime()) / 60000;
}

function easternWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(naiveUtcMs + 5 * 3600 * 1000);
  const offsetMin = getTimeZoneOffsetMinutes(guess, "America/New_York");
  return new Date(naiveUtcMs - offsetMin * 60000);
}

function computeWeekDeadline(gameStartDates: (string | null)[]): Date | null {
  const valid = gameStartDates.filter((d): d is string => !!d).sort();
  if (valid.length === 0) return null;
  const earliest = new Date(valid[0]);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(earliest);
  const map: any = {};
  for (const p of parts) map[p.type] = p.value;

  const anchor = new Date(Date.UTC(+map.year, +map.month - 1, +map.day, 12, 0));
  const daysToSaturday = (6 - anchor.getUTCDay() + 7) % 7;
  const saturday = new Date(anchor.getTime() + daysToSaturday * 86400000);

  return easternWallTimeToUtc(saturday.getUTCFullYear(), saturday.getUTCMonth() + 1, saturday.getUTCDate(), 11, 0);
}

function computeGameLockTime(gameStartDate: string | null, weekDeadline: Date | null): Date | null {
  const kickoff = gameStartDate ? new Date(gameStartDate) : null;
  if (kickoff && weekDeadline) return kickoff < weekDeadline ? kickoff : weekDeadline;
  return kickoff ?? weekDeadline;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase server env vars are not configured" });
    return;
  }

  const { slug, week, gameId, team, remove } = req.body ?? {};
  if (!slug || !week || !gameId || !team) {
    res.status(400).json({ error: "Missing slug, week, gameId, or team" });
    return;
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: entrant, error: entrantError } = await supabaseAdmin
      .from("survivor_pool_entrants")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (entrantError) throw entrantError;
    if (!entrant) {
      res.status(404).json({ error: "No entrant found for this link" });
      return;
    }

    const { data: game, error: gameError } = await supabaseAdmin.from("games").select("*").eq("id", gameId).maybeSingle();
    if (gameError) throw gameError;
    if (!game || game.season !== entrant.season || game.week !== week) {
      res.status(400).json({ error: "Game not found for this pool/week" });
      return;
    }
    const isHome = game.home_team === team;
    const isAway = game.away_team === team;
    if (!isHome && !isAway) {
      res.status(400).json({ error: "That team isn't in this game" });
      return;
    }

    const { data: weekPicks, error: weekPicksError } = await supabaseAdmin
      .from("survivor_pool_picks")
      .select("*")
      .eq("entrant_id", entrant.id)
      .eq("week", week);
    if (weekPicksError) throw weekPicksError;

    const existingForTeam = (weekPicks ?? []).find((p) => p.team === team);

    const { data: weekGames, error: weekGamesError } = await supabaseAdmin
      .from("games")
      .select("start_date")
      .eq("season", entrant.season)
      .eq("week", week);
    if (weekGamesError) throw weekGamesError;
    const weekDeadline = computeWeekDeadline((weekGames ?? []).map((g) => g.start_date));
    const gameLockTime = computeGameLockTime(game.start_date, weekDeadline);
    if (gameLockTime && new Date() >= gameLockTime) {
      res.status(400).json({ error: "This pick has already locked" });
      return;
    }

    if (remove) {
      if (!existingForTeam) {
        res.status(400).json({ error: "That pick isn't currently saved" });
        return;
      }
      const { error: deleteError } = await supabaseAdmin.from("survivor_pool_picks").delete().eq("id", existingForTeam.id);
      if (deleteError) throw deleteError;
      res.status(200).json({ ok: true, removed: true });
      return;
    }

    if (existingForTeam) {
      res.status(200).json({ ok: true, alreadyPicked: true });
      return;
    }

    if ((weekPicks ?? []).length >= 2) {
      res.status(400).json({ error: "Both picks for this week are already made — remove one first" });
      return;
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("survivor_pool_settings")
      .select("*")
      .eq("season", entrant.season)
      .maybeSingle();
    if (settingsError) throw settingsError;
    const confs: string[] = settings?.conferences ?? [];
    const ownConf = isHome ? game.home_conference : game.away_conference;
    const oppConf = isHome ? game.away_conference : game.home_conference;
    if (!ownConf || !oppConf || !confs.includes(ownConf) || !confs.includes(oppConf)) {
      res.status(400).json({ error: "This pick isn't eligible — opponent's conference isn't in the pool" });
      return;
    }

    const { data: existingTeamUse, error: teamUseError } = await supabaseAdmin
      .from("survivor_pool_picks")
      .select("week")
      .eq("entrant_id", entrant.id)
      .eq("team", team);
    if (teamUseError) throw teamUseError;
    if ((existingTeamUse ?? []).some((p) => p.week !== week)) {
      res.status(400).json({ error: `${team} has already been used in a different week` });
      return;
    }

    const usedSlots = new Set((weekPicks ?? []).map((p) => p.slot));
    const nextSlot = usedSlots.has(1) ? 2 : 1;

    const { error: insertError } = await supabaseAdmin.from("survivor_pool_picks").insert([
      {
        entrant_id: entrant.id,
        season: entrant.season,
        week,
        slot: nextSlot,
        game_id: gameId,
        team,
        submitted_at: new Date().toISOString(),
      },
    ]);
    if (insertError) throw insertError;

    res.status(200).json({ ok: true, slot: nextSlot });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to save pick" });
  }
}
