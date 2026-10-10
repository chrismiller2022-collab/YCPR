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

export interface OverlayState {
  id: string;
  game_ids: string[];
  visible: boolean;
  layout: OverlayLayout;
  position: OverlayPosition;
  scale: number;
  delay_seconds: number;
  rotate_seconds: number;
  show_lines: boolean;
  show_bets: boolean;
  fullscreen: boolean;
  updated_at: string;
}

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  id: "default",
  game_ids: [],
  visible: true,
  layout: "corner",
  position: "tr",
  scale: 1,
  delay_seconds: 0,
  rotate_seconds: 12,
  show_lines: true,
  show_bets: true,
  fullscreen: false,
  updated_at: "",
};

function normalizeState(row: any): OverlayState {
  return { ...DEFAULT_OVERLAY_STATE, ...row, scale: Number(row?.scale ?? 1) };
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
}

/** YYYYMMDD in Eastern time — the calendar ESPN's `dates` param uses. */
export function espnDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .replace(/-/g, "");
}

export async function fetchScoreboard(dates: string): Promise<ScoreGame[]> {
  const res = await fetch(`/api/odds-feed?mode=scoreboard&dates=${dates}`);
  if (!res.ok) throw new Error(`Scoreboard request failed (${res.status})`);
  return (await res.json()).games ?? [];
}

/**
 * Polls the scoreboard for the given date range. Fast (10s) while any
 * watched game is live or about to start, slow otherwise, so a TV left
 * on overnight costs next to nothing.
 */
export function useScoreboard(dates: string | null, watchedIds: string[]) {
  const [games, setGames] = useState<Record<string, ScoreGame>>({});
  const [fetchedAt, setFetchedAt] = useState(0);
  const watchedKey = watchedIds.join(",");

  useEffect(() => {
    if (!dates) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      let next = 60_000;
      try {
        const list = await fetchScoreboard(dates);
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
  }, [dates, watchedKey]);

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
}

export interface OverlayContext {
  game: OverlayGameRow;
  line: BettingLineRow | null;
  myHomeSpread: number | null;
  myTotal: number | null;
  bets: PlacedBetRow[];
}

// Same provider preference as matchupsCompute.pickLine, kept local so the
// TV page doesn't pull that module's team/ratings data into its bundle.
const PREFERRED_PROVIDERS = ["consensus", "DraftKings", "Draft Kings", "Bovada"];
function pickLine(lines: BettingLineRow[]): BettingLineRow | null {
  for (const p of PREFERRED_PROVIDERS) {
    const match = lines.find((l) => l.provider === p);
    if (match) return match;
  }
  return lines[0] ?? null;
}

/** One read per table for the selected games — called when the selection changes, never on a timer. */
export async function fetchOverlayContext(gameIds: string[]): Promise<Record<string, OverlayContext>> {
  if (gameIds.length === 0) return {};
  const [games, lines, locks, bets] = await Promise.all([
    supabase.from("games").select("id, season, week, start_date, home_team, away_team").in("id", gameIds),
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
      line: pickLine(((lines.data ?? []) as BettingLineRow[]).filter((l) => l.game_id === g.id)),
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

    if (b.bet_type === "spread" || b.bet_type === "moneyline") {
      const side = teamSide(b.side);
      const abbr = side === "home" ? homeAbbr : side === "away" ? awayAbbr : b.side;
      const line = b.bet_type === "spread" ? Number(b.line_value ?? 0) : 0;
      label = b.bet_type === "spread" ? `${abbr} ${line > 0 ? "+" : ""}${num(line)}` : `${abbr} ML`;
      if (live && side) {
        const margin = side === "home" ? hp - ap : ap - hp;
        status = cmp(margin + line);
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
      }
    } else {
      continue;
    }

    // A finished game shows the graded result even if the stored row
    // hasn't been settled yet.
    if (sb?.state === "post") note = status === "up" ? "WON" : status === "down" ? "LOST" : status === "push" ? "PUSH" : null;

    grouped.set(key, { key, label, status, note, count: 1 });
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
  const ids = state?.game_ids ?? [];
  const idsKey = ids.join(",");
  const [contexts, setContexts] = useState<Record<string, OverlayContext>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchOverlayContext(ids)
        .then((c) => !cancelled && setContexts(c))
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const starts = Object.values(contexts)
    .map((c) => c.game.start_date)
    .filter((s): s is string => !!s)
    .map(espnDate)
    .sort();
  const dates = starts.length ? (starts[0] === starts[starts.length - 1] ? starts[0] : `${starts[0]}-${starts[starts.length - 1]}`) : null;

  const { games, fetchedAt } = useScoreboard(dates, ids);
  const scores = useDelayed(games, fetchedAt, applyDelay ? state?.delay_seconds ?? 0 : 0);
  return { contexts, scores };
}
