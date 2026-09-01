import { supabase } from "../supabaseClient";

export interface SurvivorPoolEntrantPublic {
  id: number;
  season: number;
  name: string;
  slug: string;
}

export async function fetchEntrantBySlug(slug: string): Promise<SurvivorPoolEntrantPublic | null> {
  const { data, error } = await supabase.from("survivor_pool_entrants").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Looks up an entrant by just the short code (the random suffix after the
 * last hyphen in their slug, e.g. slug "test1-es7ikk" -> code "es7ikk").
 * This is what the public CFB Survivor tool's "enter your code" box uses —
 * entrants only need to remember/type the short code, not the full link.
 */
export async function fetchEntrantByCode(code: string): Promise<SurvivorPoolEntrantPublic | null> {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from("survivor_pool_entrants")
    .select("*")
    .ilike("slug", `%-${trimmed}`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export interface PoolGameRow {
  gameId: string;
  week: number;
  startDate: string | null;
  homeTeam: string;
  awayTeam: string;
  homeConference: string | null;
  awayConference: string | null;
  completed: boolean;
  homePoints: number | null;
  awayPoints: number | null;
}

/** Every game in a season involving at least one team from the pool's selected conferences. */
export async function fetchPoolSeasonGames(season: number, conferences: string[]): Promise<PoolGameRow[]> {
  if (conferences.length === 0) return [];
  const [{ data: homeMatches, error: homeError }, { data: awayMatches, error: awayError }] = await Promise.all([
    supabase.from("games").select("*").eq("season", season).in("home_conference", conferences),
    supabase.from("games").select("*").eq("season", season).in("away_conference", conferences),
  ]);
  if (homeError) throw homeError;
  if (awayError) throw awayError;

  const byId = new Map<string, any>();
  for (const g of [...(homeMatches ?? []), ...(awayMatches ?? [])]) byId.set(g.id, g);

  return Array.from(byId.values()).map((g) => ({
    gameId: g.id,
    week: g.week,
    startDate: g.start_date,
    homeTeam: g.home_team,
    awayTeam: g.away_team,
    homeConference: g.home_conference,
    awayConference: g.away_conference,
    completed: g.completed,
    homePoints: g.home_points,
    awayPoints: g.away_points,
  }));
}

// Vegas and FPI are now kept fully separate (not a waterfall) so the UI
// can offer them as two distinct view modes. Both are always "away
// perspective" (negative = away favored), the same convention used
// throughout this site — display code is responsible for flipping the
// sign when showing a value from the HOME team's row (this was the
// source of the Auburn/Baylor-both-show-+6.5 bug: the raw away-spread
// value was being shown unflipped for the home team's row too).
export interface GameSpreads {
  vegasAwaySpread: number | null;
  fpiAwaySpread: number | null;
}

const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Bovada"];

// Per explicit request: FPI mode always uses a flat 2.4-point home-field
// edge, not each team's live/custom HFA value.
const FPI_FLAT_HFA = 2.4;

/**
 * Fetches Vegas and FPI spreads for a batch of games, independently (no
 * fallback precedence baked in here — the UI toggle decides which to show).
 * FPI is higher-is-better (ESPN's own convention), the opposite of this
 * site's own power ratings, so the sign is flipped to land in the site's
 * existing away-perspective convention:
 *   awaySpread = homeFpi - awayFpi + 2.4 (flat, non-neutral-site games)
 * ESPN's FPI is designed so the difference between two teams' FPI values
 * approximates the expected scoring margin directly — this hasn't been
 * spot-checked against a real completed game yet, worth eyeballing once
 * results start coming in.
 */
export async function fetchSpreadsForGames(season: number, gameIds: string[]): Promise<Map<string, GameSpreads>> {
  const result = new Map<string, GameSpreads>();
  if (gameIds.length === 0) return result;

  const [{ data: lines, error: linesError }, { data: fpiRows, error: fpiError }, { data: gameRows, error: gameError }] =
    await Promise.all([
      supabase.from("betting_lines").select("*").in("game_id", gameIds),
      supabase.from("fpi_ratings").select("*").eq("season", season),
      supabase.from("games").select("id, home_team, away_team, neutral_site").in("id", gameIds),
    ]);
  if (linesError) throw linesError;
  if (fpiError) throw fpiError;
  if (gameError) throw gameError;

  const linesByGame = new Map<string, any[]>();
  for (const l of lines ?? []) {
    const list = linesByGame.get(l.game_id) ?? [];
    list.push(l);
    linesByGame.set(l.game_id, list);
  }
  const fpiByTeam = new Map((fpiRows ?? []).map((r) => [r.team, r.fpi]));
  const gamesById = new Map((gameRows ?? []).map((g) => [g.id, g]));

  function pickLine(candidateLines: any[]): any | null {
    if (candidateLines.length === 0) return null;
    for (const p of PREFERRED_PROVIDERS) {
      const m = candidateLines.find((l) => l.provider === p);
      if (m) return m;
    }
    return candidateLines[0];
  }

  for (const gameId of gameIds) {
    const g = gamesById.get(gameId);
    if (!g) {
      result.set(gameId, { vegasAwaySpread: null, fpiAwaySpread: null });
      continue;
    }

    const line = pickLine(linesByGame.get(gameId) ?? []);
    const vegasAwaySpread = line?.spread != null ? -line.spread : null;

    const homeFpi = fpiByTeam.get(g.home_team);
    const awayFpi = fpiByTeam.get(g.away_team);
    const fpiAwaySpread =
      homeFpi != null && awayFpi != null
        ? g.neutral_site
          ? homeFpi - awayFpi
          : homeFpi - awayFpi + FPI_FLAT_HFA
        : null;

    result.set(gameId, { vegasAwaySpread, fpiAwaySpread });
  }

  return result;
}

export interface EntrantPickRow {
  id: number;
  week: number;
  slot: number;
  game_id: string;
  team: string;
  submitted_at: string;
}

/** Empty until an entrant has submitted anything. */
export async function fetchEntrantPicks(entrantId: number): Promise<EntrantPickRow[]> {
  const { data, error } = await supabase
    .from("survivor_pool_picks")
    .select("*")
    .eq("entrant_id", entrantId)
    .order("week", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * The pool's currently-pickable week — the week right after the last one
 * where EVERY game has finished, not just "any" game in it. A real CFB
 * week's games finish at staggered times (Tuesday/Wednesday/Thursday
 * games are done long before Saturday's slate even kicks off), so basing
 * this on "any completed game in week N" advanced to week N+1 the moment
 * a single Thursday game finished — marking next week "Pickable" while
 * most of the actual current week hadn't started yet. A week with zero
 * games scheduled doesn't count as complete (an empty array's .every()
 * is vacuously true, which would otherwise treat "no games synced for
 * this week yet" as "this week is done").
 *
 * Used by every page that needs to know which week is open for real
 * submissions (SurvivorPoolPublicPage, SurvivorPoolAdminPanel,
 * CfbSurvivorToolPage) — centralized here so they can't drift apart on
 * what "current" means, the same reasoning as computeWeekDeadline below.
 */
export function computeCurrentWeek(games: { week: number; completed: boolean }[]): number {
  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);
  const gamesByWeek = new Map<number, boolean[]>();
  for (const g of games) {
    const list = gamesByWeek.get(g.week) ?? [];
    list.push(g.completed);
    gamesByWeek.set(g.week, list);
  }
  const fullyCompletedWeeks = Array.from(gamesByWeek.entries())
    .filter(([, completedFlags]) => completedFlags.length > 0 && completedFlags.every(Boolean))
    .map(([week]) => week);
  return fullyCompletedWeeks.length > 0 ? Math.max(...fullyCompletedWeeks) + 1 : weeks[0] ?? 1;
}

// ---------------------------------------------------------------------
// Deadline math — client-side mirror of api/survivor-pool-pick-save.ts's
// logic, used here only for display (countdown/lock status in the UI).
// The server independently re-derives and enforces the real deadline on
// every submit — this copy being stale or wrong can't let a late pick
// through, it would just show misleading UI. Keep both in sync regardless.
// ---------------------------------------------------------------------
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

/** The week's overall deadline: Saturday 11:59 AM ET of the week containing its earliest game. */
export function computeWeekDeadline(gameStartDates: (string | null)[]): Date | null {
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

  return easternWallTimeToUtc(saturday.getUTCFullYear(), saturday.getUTCMonth() + 1, saturday.getUTCDate(), 11, 59);
}

/** A specific game locks at whichever is earlier: its own kickoff, or the week's overall deadline. */
export function computeGameLockTime(gameStartDate: string | null, weekDeadline: Date | null): Date | null {
  const kickoff = gameStartDate ? new Date(gameStartDate) : null;
  if (kickoff && weekDeadline) return kickoff < weekDeadline ? kickoff : weekDeadline;
  return kickoff ?? weekDeadline;
}

/** Every pick from every entrant this season — used for the admin view and the public standings table. */
export async function fetchAllSeasonPicks(season: number): Promise<(EntrantPickRow & { entrant_id: number })[]> {
  const { data, error } = await supabase
    .from("survivor_pool_picks")
    .select("*")
    .eq("season", season)
    .order("week", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type PickResult = "win" | "loss" | "pending";

/** Grades a pick against its game's actual result, using the already-fetched pool games list. */
export function gradePickResult(pick: { game_id: string; team: string }, gamesById: Map<string, PoolGameRow>): PickResult {
  const g = gamesById.get(pick.game_id);
  if (!g || !g.completed || g.homePoints == null || g.awayPoints == null) return "pending";
  const homeWon = g.homePoints > g.awayPoints;
  const teamWasHome = g.homeTeam === pick.team;
  const teamWon = teamWasHome ? homeWon : !homeWon;
  return teamWon ? "win" : "loss";
}

export async function submitPick(slug: string, week: number, gameId: string, team: string, remove = false) {
  const res = await fetch("/api/survivor-pool-pick-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, week, gameId, team, remove }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to save pick");
  return data;
}
