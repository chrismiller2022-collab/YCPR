import { pickVegasLine } from "./linePick";
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import type { BettingLineRow } from "./api/gamesLines";
import type { PlacedBetRow } from "./api/placedBets";

// ---------------------------------------------------------------------
// TV score bug (/overlay) + its remote (/overlay/control).
//
// Live data is ESPN's free scoreboard only (odds-feed.ts?mode=scoreboard,
// edge-cached 10s). Everything else on the bug — pregame line, my locked
// numbers, my bets — is read once from rows already in Supabase when the
// game list changes. Nothing here touches CFBD or The Odds API.
//
// `games.id` is ESPN's own event id (CFBD reuses it), so scoreboard
// events join to games/betting_lines/locks/bets by id with no name
// matching.
// ---------------------------------------------------------------------

export type OverlayLayout = "corner" | "ticker";
export type OverlayPosition = "tl" | "tr" | "bl" | "br";
export type TickerPosition = "bottom" | "top";
export type League = "cfb" | "nfl";

export interface OverlayState {
  id: string;
  game_ids: string[];
  league: League;
  nfl_game_ids: string[];
  nfl_week: number | null;
  visible: boolean;
  layout: OverlayLayout;
  position: OverlayPosition;
  ticker_position: TickerPosition;
  scale: number;
  delay_seconds: number;
  rotate_seconds: number;
  show_lines: boolean;
  show_bets: boolean;
  fullscreen: boolean;
  full_opacity: number;
  expand_game_id: string | null;
  pick_source: "bets" | "pools" | "both";
  pool_keys: string[];
  pools_full: boolean;
  sleeper_username: string | null;
  sleeper_league_ids: string[];
  fantasy_full: boolean;
  show_fantasy_players: boolean;
  show_last_play: boolean;
  show_field: boolean;
  show_cover_prob: boolean;
  show_timeouts: boolean;
  show_win_prob: boolean;
  show_network: boolean;
  compact: boolean;
  flash_swings: boolean;
  updated_at: string;
}

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  id: "default",
  game_ids: [],
  league: "cfb",
  nfl_game_ids: [],
  nfl_week: null,
  visible: true,
  layout: "corner",
  position: "tr",
  ticker_position: "bottom",
  scale: 1,
  delay_seconds: 0,
  rotate_seconds: 12,
  show_lines: true,
  show_bets: true,
  fullscreen: false,
  full_opacity: 1,
  expand_game_id: null,
  pick_source: "bets",
  pool_keys: [],
  pools_full: false,
  sleeper_username: null,
  sleeper_league_ids: [],
  fantasy_full: false,
  show_fantasy_players: true,
  show_last_play: true,
  show_field: true,
  show_cover_prob: true,
  show_timeouts: true,
  show_win_prob: true,
  show_network: true,
  compact: false,
  flash_swings: true,
  updated_at: "",
};

function normalizeState(row: any): OverlayState {
  return { ...DEFAULT_OVERLAY_STATE, ...row, scale: Number(row?.scale ?? 1), full_opacity: Number(row?.full_opacity ?? 1) };
}

export async function fetchOverlayState(screen: string): Promise<OverlayState> {
  const { data, error } = await supabase.from("overlay_state").select("*").eq("id", screen).maybeSingle();
  if (error) throw error;
  return normalizeState(data ?? { id: screen });
}

export async function saveOverlayState(screen: string, patch: Partial<OverlayState>, password: string): Promise<void> {
  const res = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "saveOverlayState", screen, patch }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Save failed (${res.status})`);
  }
}

/**
 * Live overlay settings: Realtime pushes changes within a second, and a
 * slow refetch covers a dropped socket (the TV runs for hours unattended).
 */
export function useOverlayState(screen: string, holdUntil?: { current: number }) {
  const [state, setState] = useState<OverlayState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchOverlayState(screen)
        .then((s) => !cancelled && !(holdUntil && holdUntil.current > Date.now()) && setState(s))
        .catch(() => {});
    load();
    const channel = supabase
      .channel(`overlay-${screen}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "overlay_state", filter: `id=eq.${screen}` }, (payload: any) => {
        // The control page sets holdUntil while the user is mid-edit, so the
        // echo of an earlier save can't snap a slider back.
        if (holdUntil && holdUntil.current > Date.now()) return;
        if (!cancelled && payload.new) setState(normalizeState(payload.new));
      })
      .subscribe();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [screen]);

  return [state, setState] as const;
}

// --- ESPN scoreboard ---------------------------------------------------

export interface ScoreTeam {
  espnId: string | null;
  abbrev: string | null;
  name: string | null;
  color: string | null;
  score: number | null;
  rank: number | null;
  logo?: string | null;
  record?: string | null;
}

export interface ScoreGame {
  id: string;
  start: string;
  state: "pre" | "in" | "post";
  detail: string;
  period: number;
  clock: string | null;
  home: ScoreTeam;
  away: ScoreTeam;
  possession: string | null;
  downDistance: string | null;
  redZone: boolean;
  lastPlay?: string | null;
  timeouts?: { home: number; away: number } | null;
  homeWinPct?: number | null; // 0–1
  network?: string | null;
  yardLine?: number | null; // yards from the home team's goal line
  possessionText?: string | null;
  distance?: number | null;
  odds?: { homeSpread: number | null; overUnder: number | null; details: string | null } | null;
}

/** The games the TV is showing right now: college picks or NFL picks. */
export function activeIds(state: OverlayState): string[] {
  return state.league === "nfl" ? state.nfl_game_ids : state.game_ids;
}

/** YYYYMMDD in Eastern time — the calendar ESPN's `dates` param uses. */
export function espnDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .replace(/-/g, "");
}

/** query: "dates=YYYYMMDD,…" for college, or "league=nfl[&week=N]". */
export async function fetchScoreboard(query: string): Promise<{ games: ScoreGame[]; week: number | null }> {
  const res = await fetch(`/api/odds-feed?mode=scoreboard&${query}`);
  if (!res.ok) throw new Error(`Scoreboard request failed (${res.status})`);
  const body = await res.json();
  return { games: body.games ?? [], week: body.week ?? null };
}

/**
 * Polls the scoreboard for the given date range. Fast (10s) while any
 * watched game is live or about to start, slow otherwise, so a TV left
 * on overnight costs next to nothing.
 */
export function useScoreboard(query: string | null, watchedIds: string[]) {
  const [games, setGames] = useState<Record<string, ScoreGame>>({});
  const [fetchedAt, setFetchedAt] = useState(0);
  const watchedKey = watchedIds.join(",");

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      let next = 60_000;
      try {
        const { games: list } = await fetchScoreboard(query);
        if (cancelled) return;
        const map: Record<string, ScoreGame> = {};
        for (const g of list) map[g.id] = g;
        setGames(map);
        setFetchedAt(Date.now());
        const watched = watchedIds.map((id) => map[id]).filter(Boolean);
        const soon = watched.some((g) => g.state === "in" || (g.state === "pre" && new Date(g.start).getTime() - Date.now() < 15 * 60_000));
        const allDone = watched.length > 0 && watched.every((g) => g.state === "post");
        next = soon ? 10_000 : allDone ? 300_000 : 60_000;
      } catch {
        next = 20_000;
      }
      if (!cancelled) timer = window.setTimeout(tick, next);
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, watchedKey]);

  return { games, fetchedAt };
}

/**
 * Spoiler delay: holds each value back by `delaySeconds` so the bug
 * doesn't show a touchdown before a streaming feed (YouTube TV runs
 * ~30–90s behind live) does. Until a snapshot is old enough, the oldest
 * one held is shown.
 */
export function useDelayed<T>(value: T, stamp: number, delaySeconds: number): T {
  const queue = useRef<{ t: number; v: T }[]>([]);
  const [shown, setShown] = useState<T>(value);

  useEffect(() => {
    if (!stamp) return;
    queue.current.push({ t: stamp, v: value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  useEffect(() => {
    const pick = () => {
      const cutoff = Date.now() - delaySeconds * 1000;
      const q = queue.current;
      let i = -1;
      for (let k = 0; k < q.length; k++) if (q[k].t <= cutoff) i = k;
      if (i > 0) q.splice(0, i); // keep the newest eligible one at q[0]
      if (q.length) setShown(q[0].v);
    };
    pick();
    const timer = window.setInterval(pick, 1000);
    return () => window.clearInterval(timer);
  }, [delaySeconds]);

  return delaySeconds > 0 ? shown : value;
}

// --- Stored context (lines, locks, bets) -------------------------------

export interface OverlayGameRow {
  id: string;
  season: number;
  week: number;
  start_date: string | null;
  home_team: string;
  away_team: string;
  completed: boolean | null;
  home_points: number | null;
  away_points: number | null;
}

export interface OverlayContext {
  game: OverlayGameRow;
  line: BettingLineRow | null;
  myHomeSpread: number | null;
  myTotal: number | null;
  bets: PlacedBetRow[];
}

// Shared provider order (linePick.ts has no heavy imports, so the TV page's bundle stays small).
export function pickLine(lines: BettingLineRow[], completed?: boolean): BettingLineRow | null {
  return pickVegasLine(lines, completed);
}

/** One read per table for the selected games — called when the selection changes, never on a timer. */
export async function fetchOverlayContext(gameIds: string[]): Promise<Record<string, OverlayContext>> {
  if (gameIds.length === 0) return {};
  const [games, lines, locks, bets] = await Promise.all([
    supabase.from("games").select("id, season, week, start_date, home_team, away_team, completed, home_points, away_points").in("id", gameIds),
    supabase
      .from("betting_lines")
      .select("id, game_id, season, week, provider, spread, over_under, home_moneyline, away_moneyline, pulled_at, opening_spread, opening_over_under")
      .in("game_id", gameIds),
    supabase.from("game_projection_locks").select("game_id, my_away_spread, my_total").in("game_id", gameIds),
    supabase.from("placed_bets").select("*").in("game_id", gameIds),
  ]);
  for (const r of [games, lines, locks, bets]) if (r.error) throw r.error;

  const out: Record<string, OverlayContext> = {};
  for (const g of (games.data ?? []) as OverlayGameRow[]) {
    const lock = (locks.data ?? []).find((l: any) => l.game_id === g.id);
    out[g.id] = {
      game: g,
      line: pickLine(((lines.data ?? []) as BettingLineRow[]).filter((l) => l.game_id === g.id), !!g.completed),
      // Locks store the AWAY spread; the bug works in home-perspective like betting_lines.
      myHomeSpread: lock?.my_away_spread != null ? -Number(lock.my_away_spread) : null,
      myTotal: lock?.my_total != null ? Number(lock.my_total) : null,
      bets: ((bets.data ?? []) as PlacedBetRow[]).filter((b) => b.game_id === g.id && b.bet_type !== "futures"),
    };
  }
  return out;
}

// --- Formatting + live bet status --------------------------------------

function num(n: number): string {
  const r = Math.round(n * 2) / 2; // books quote halves; my numbers get rounded to match
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "OSU -6.5" / "PK" from a home-perspective spread. */
export function spreadLabel(homeSpread: number | null, homeAbbr: string, awayAbbr: string): string | null {
  if (homeSpread == null) return null;
  const s = Math.round(homeSpread * 2) / 2;
  if (s === 0) return "PK";
  return s < 0 ? `${homeAbbr} -${num(-s)}` : `${awayAbbr} -${num(s)}`;
}

export type BetStatus = "up" | "down" | "push" | "pending";

export interface BetLine {
  key: string;
  label: string;
  status: BetStatus;
  note: string | null;
  count: number;
  /** Live chance this bet cashes (0–1); null before kickoff, after the final, or without a line. */
  prob: number | null;
}

// --- Live cover / over probability -------------------------------------
// ESPN publishes win probability but nothing against the spread, so this
// estimates it: final = current score + the pregame expectation for the
// time that's left, with the spread of outcomes shrinking as the clock runs
// down (sd × √fraction left). Full-game SDs are typical college values.
const SD_MARGIN = 16;
const SD_TOTAL = 15;
const SD_TEAM = 10;

function normCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7).
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** P(final > line) for a normal final with this mean and sd (sd 0 = already decided). */
function probAbove(mean: number, sd: number, line: number): number {
  if (sd < 0.01) return mean > line ? 1 : mean < line ? 0 : 0.5;
  return 1 - normCdf((line - mean) / sd);
}

interface LiveModel {
  left: number; // fraction of regulation left, 0–1
  homeMargin: number; // expected final home margin
  total: number; // expected final total
  home: number; // expected final home points
  away: number;
}

/** Expected finals from the score so far plus the pregame line for the time left. Null unless the game is live. */
function liveModel(ctx: OverlayContext, sb: ScoreGame | undefined): LiveModel | null {
  if (!sb || sb.state !== "in" || sb.home.score == null || sb.away.score == null) return null;
  const played = minutesPlayed(sb);
  if (played == null) return null;
  const spread = ctx.line?.spread != null ? Number(ctx.line.spread) : ctx.myHomeSpread;
  const total = ctx.line?.over_under != null ? Number(ctx.line.over_under) : ctx.myTotal;
  if (spread == null || total == null) return null;
  const left = Math.max(0, Math.min(1, (60 - played) / 60));
  const preHome = (total - spread) / 2;
  const preAway = (total + spread) / 2;
  return {
    left,
    homeMargin: sb.home.score - sb.away.score - spread * left,
    total: sb.home.score + sb.away.score + total * left,
    home: sb.home.score + preHome * left,
    away: sb.away.score + preAway * left,
  };
}

/** Live chance a side covers `line` (that side's spread, e.g. -3.5). */
function coverProb(m: LiveModel, side: "home" | "away", line: number): number {
  const mean = side === "home" ? m.homeMargin : -m.homeMargin;
  return probAbove(mean, SD_MARGIN * Math.sqrt(m.left), -line);
}

function totalProb(m: LiveModel, over: boolean, line: number): number {
  const p = probAbove(m.total, SD_TOTAL * Math.sqrt(m.left), line);
  return over ? p : 1 - p;
}

/** Minutes of regulation played, or null before kickoff. OT counts as 60. */
function minutesPlayed(g: ScoreGame): number | null {
  if (g.state === "pre") return null;
  if (g.state === "post" || g.period > 4) return 60;
  const [m, s] = (g.clock ?? "15:00").split(":").map(Number);
  const left = (m || 0) + (s || 0) / 60;
  return (g.period - 1) * 15 + (15 - left);
}

function cmp(diff: number): BetStatus {
  return diff > 0 ? "up" : diff < 0 ? "down" : "push";
}

/**
 * My bets on this game, graded against the live score. Repeat bets on
 * the same side/line (added across the week) collapse into one row
 * with a count.
 */
export function liveBets(ctx: OverlayContext, sb: ScoreGame | undefined): BetLine[] {
  const homeAbbr = sb?.home.abbrev ?? ctx.game.home_team;
  const awayAbbr = sb?.away.abbrev ?? ctx.game.away_team;
  const live = sb && sb.state !== "pre" && sb.home.score != null && sb.away.score != null;
  const hp = sb?.home.score ?? 0;
  const ap = sb?.away.score ?? 0;
  const played = sb ? minutesPlayed(sb) : null;
  const pace = (pts: number) => (sb?.state === "in" && played != null && played >= 6 ? Math.round((pts * 60) / played) : null);
  const model = liveModel(ctx, sb);

  const grouped = new Map<string, BetLine>();
  for (const b of ctx.bets) {
    const key = `${b.bet_type}|${b.side}|${b.line_value ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
      continue;
    }

    const teamSide = (team: string) => (team === ctx.game.home_team ? "home" : team === ctx.game.away_team ? "away" : null);
    let label = "";
    let status: BetStatus = "pending";
    let note: string | null = null;
    let prob: number | null = null;

    if (b.bet_type === "spread" || b.bet_type === "moneyline") {
      const side = teamSide(b.side);
      const abbr = side === "home" ? homeAbbr : side === "away" ? awayAbbr : b.side;
      const line = b.bet_type === "spread" ? Number(b.line_value ?? 0) : 0;
      label = b.bet_type === "spread" ? `${abbr} ${line > 0 ? "+" : ""}${num(line)}` : `${abbr} ML`;
      if (live && side) {
        const margin = side === "home" ? hp - ap : ap - hp;
        status = cmp(margin + line);
        if (model) {
          // Moneyline: ESPN's own live win % when it has one.
          const espnWin = sb?.homeWinPct != null ? (side === "home" ? sb.homeWinPct : 1 - sb.homeWinPct) : null;
          prob = b.bet_type === "moneyline" && espnWin != null ? espnWin : coverProb(model, side, line);
        }
      }
    } else if (b.bet_type === "total") {
      const line = Number(b.line_value ?? 0);
      const over = b.side.toLowerCase() === "over";
      label = `${over ? "O" : "U"} ${num(line)}`;
      if (live) {
        status = cmp(over ? hp + ap - line : line - (hp + ap));
        // Mid-game, "behind on an over" is the normal state, so grade by pace instead.
        const p = pace(hp + ap);
        if (p != null) {
          note = `pace ${p}`;
          status = cmp(over ? p - line : line - p);
        }
        if (model) prob = totalProb(model, over, line);
      }
    } else if (b.bet_type === "team_total") {
      const [team, dir] = b.side.split("|");
      const side = teamSide(team);
      const abbr = side === "home" ? homeAbbr : side === "away" ? awayAbbr : team;
      const line = Number(b.line_value ?? 0);
      const over = (dir ?? "").toLowerCase() === "over";
      label = `${abbr} TT ${over ? "O" : "U"} ${num(line)}`;
      if (live && side) {
        const pts = side === "home" ? hp : ap;
        status = cmp(over ? pts - line : line - pts);
        const p = pace(pts);
        if (p != null) {
          note = `pace ${p}`;
          status = cmp(over ? p - line : line - p);
        }
        if (model) {
          const pOver = probAbove(side === "home" ? model.home : model.away, SD_TEAM * Math.sqrt(model.left), line);
          prob = over ? pOver : 1 - pOver;
        }
      }
    } else {
      continue;
    }

    // A finished game shows the graded result even if the stored row
    // hasn't been settled yet.
    if (sb?.state === "post") note = status === "up" ? "WON" : status === "down" ? "LOST" : status === "push" ? "PUSH" : null;

    grouped.set(key, { key, label, status, note, count: 1, prob });
  }
  return Array.from(grouped.values());
}

/**
 * Everything the bug needs for the current selection: stored context
 * (re-read when the selection changes, and every 30 min to pick up a bet
 * placed mid-game) plus scores, held back by the spoiler delay when
 * `applyDelay` is set.
 */
export function useOverlayData(state: OverlayState | null, applyDelay: boolean) {
  const nfl = state?.league === "nfl";
  const cfbIds = nfl ? [] : state?.game_ids ?? [];
  const ids = state ? activeIds(state) : [];
  const idsKey = cfbIds.join(",");
  const [cfbContexts, setCfbContexts] = useState<Record<string, OverlayContext>>({});

  // College: stored line / locks / bets from Supabase. NFL has none.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchOverlayContext(cfbIds)
        .then((c) => !cancelled && setCfbContexts(c))
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const starts = Object.values(cfbContexts)
    .map((c) => c.game.start_date)
    .filter((s): s is string => !!s)
    .map(espnDate)
    .sort();
  const dates = starts.length ? Array.from(new Set(starts)).join(",") : null;
  const query = nfl ? `league=nfl${state?.nfl_week ? `&week=${state.nfl_week}` : ""}` : dates ? `dates=${dates}` : null;

  const { games, fetchedAt } = useScoreboard(query, ids);
  const delayed = useDelayed(games, fetchedAt, applyDelay ? state?.delay_seconds ?? 0 : 0);
  if (nfl) {
    const contexts: Record<string, OverlayContext> = {};
    for (const id of ids) if (games[id]) contexts[id] = nflContext(games[id]);
    return { contexts, scores: delayed };
  }
  return { contexts: cfbContexts, scores: withStoredFinals(delayed, cfbContexts) };
}

/** NFL games carry everything on the ESPN feed itself: teams, start, and ESPN's (DraftKings) line. */
function nflContext(g: ScoreGame): OverlayContext {
  return {
    game: {
      id: g.id,
      season: 0,
      week: 0,
      start_date: g.start,
      home_team: g.home.name ?? g.home.abbrev ?? "Home",
      away_team: g.away.name ?? g.away.abbrev ?? "Away",
      completed: g.state === "post",
      home_points: g.home.score,
      away_points: g.away.score,
    },
    line: g.odds ? ({ spread: g.odds.homeSpread, over_under: g.odds.overUnder } as BettingLineRow) : null,
    myHomeSpread: null,
    myTotal: null,
    bets: [],
  };
}

/**
 * A game ESPN didn't return (another day, a feed hiccup) but that our
 * `games` table already has as final still shows its final score, so bets
 * grade WON/LOST/PUSH instead of the card looking unplayed.
 */
function withStoredFinals(scores: Record<string, ScoreGame>, contexts: Record<string, OverlayContext>): Record<string, ScoreGame> {
  let out = scores;
  for (const [id, ctx] of Object.entries(contexts)) {
    const g = ctx.game;
    if (scores[id] || !g.completed || g.home_points == null || g.away_points == null) continue;
    if (out === scores) out = { ...scores };
    const team = (name: string, score: number): ScoreTeam => ({ espnId: null, abbrev: null, name, color: null, score, rank: null });
    out[id] = {
      id,
      start: g.start_date ?? "",
      state: "post",
      detail: "Final",
      period: 4,
      clock: null,
      home: team(g.home_team, g.home_points),
      away: team(g.away_team, g.away_points),
      possession: null,
      downDistance: null,
      redZone: false,
    };
  }
  return out;
}

// --- Tile-style projection block (mirrors MatchupGridGraphic) ----------

export type Side = "away" | "home";

export interface Projection {
  vegasAwaySpread: number | null;
  myAwaySpread: number | null;
  vegasTotal: number | null;
  myTotal: number | null;
  projCover: Side | null; // ATS pick vs. the Vegas line
  projTotal: "Over" | "Under" | null;
  projAway: number | null; // projected score split from my total + spread
  projHome: number | null;
  // Live chance my two calls hit (null unless live)
  coverProb: number | null;
  totalProb: number | null;
  // Final-game results (null until the game is over)
  atsResult: Side | "push" | null;
  totalResult: "Over" | "Under" | "Push" | null;
}

export function projection(ctx: OverlayContext, sb: ScoreGame | undefined): Projection {
  const vegasAwaySpread = ctx.line?.spread != null ? -Number(ctx.line.spread) : null;
  const myAwaySpread = ctx.myHomeSpread != null ? -ctx.myHomeSpread : null;
  const vegasTotal = ctx.line?.over_under != null ? Number(ctx.line.over_under) : null;
  const myTotal = ctx.myTotal;
  // Same rule as matchupsCompute.ts: positive (vegas - mine) = I give the away side more than Vegas does.
  const diff = vegasAwaySpread != null && myAwaySpread != null ? vegasAwaySpread - myAwaySpread : null;
  const projCover: Side | null = diff == null ? null : diff > 0 ? "away" : diff < 0 ? "home" : null;
  const projTotal = myTotal != null && vegasTotal != null ? (myTotal > vegasTotal ? "Over" : myTotal < vegasTotal ? "Under" : null) : null;
  // Same split as gameTotals.ts splitTeamTotal (favorite gets the spread on top of an even half), floored at 0.
  const projAway = myTotal != null && myAwaySpread != null ? Math.max(0, (myTotal - myAwaySpread) / 2) : null;
  const projHome = myTotal != null && myAwaySpread != null ? Math.max(0, (myTotal + myAwaySpread) / 2) : null;

  let atsResult: Projection["atsResult"] = null;
  let totalResult: Projection["totalResult"] = null;
  if (sb?.state === "post" && sb.away.score != null && sb.home.score != null) {
    if (vegasAwaySpread != null) {
      const m = sb.away.score - sb.home.score + vegasAwaySpread;
      atsResult = m > 0 ? "away" : m < 0 ? "home" : "push";
    }
    if (vegasTotal != null) {
      const t = sb.away.score + sb.home.score;
      totalResult = t > vegasTotal ? "Over" : t < vegasTotal ? "Under" : "Push";
    }
  }
  const m = liveModel(ctx, sb);
  const coverPct = m && projCover && vegasAwaySpread != null ? coverProb(m, projCover, projCover === "away" ? vegasAwaySpread : -vegasAwaySpread) : null;
  const totalPct = m && projTotal && vegasTotal != null ? totalProb(m, projTotal === "Over", vegasTotal) : null;
  return { vegasAwaySpread, myAwaySpread, vegasTotal, myTotal, projCover, projTotal, projAway, projHome, coverProb: coverPct, totalProb: totalPct, atsResult, totalResult };
}

/** Whether anything on screen needs Sleeper data (so the TV only polls Sleeper when it's used). */
export function needsFantasy(state: OverlayState | null): boolean {
  return !!state?.sleeper_username && state.visible && (state.fantasy_full || (state.league === "nfl" && state.show_fantasy_players));
}

/**
 * Live chance a side wins its pick, for anything graded like a bet: `sideLine`
 * is that side's spread (null = straight up, which uses ESPN's live win %
 * when it has one). Needs a pregame spread/total for the model; null unless live.
 */
export function pickChance(sb: ScoreGame | undefined, homeSpread: number | null, total: number | null, side: Side, sideLine: number | null): number | null {
  const ctx = { line: homeSpread != null && total != null ? ({ spread: homeSpread, over_under: total } as BettingLineRow) : null, myHomeSpread: null, myTotal: null } as unknown as OverlayContext;
  const m = liveModel(ctx, sb);
  if (!m) return null;
  if (sideLine == null && sb?.homeWinPct != null) return side === "home" ? sb.homeWinPct : 1 - sb.homeWinPct;
  return coverProb(m, side, sideLine ?? 0);
}
