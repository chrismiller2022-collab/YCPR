import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { espnDate, pickChance, pickLine, useScoreboard, type ScoreGame, type Side } from "./overlay";
import type { BettingLineRow } from "./api/gamesLines";

// ---------------------------------------------------------------------
// Pool picks on the TV score bug. Same tables and the same grading rules
// as each pool's own page (cbsSplashPool / peayPool / westgatePool /
// britPool / espnMlPool / espnSpreadPool / cbsPickemPool), graded live
// against ESPN's scoreboard. Confidence pools and Survivor are left out,
// same as poolLiveScores.ts: confidence picks aren't reliably saved and
// Survivor picks live in browser storage.
// ---------------------------------------------------------------------

export type PoolKey = "cbs" | "kelly" | "peay" | "westgate" | "brit" | "espnml" | "espnspread" | "cbspickem";

interface PoolDef {
  key: PoolKey;
  name: string;
  tag: string; // short label on the bug's chip
  table: string;
  sideCol: string;
  lineCol: string | null; // pool's own away-perspective line; null = straight up
  vegasFallback: boolean; // no line typed in = grade against Vegas (ESPN Spread, CBS Pick'em)
  keyCol: string | null;
  filter?: string; // boolean column that must be true (CBS Splash / Kelly share one table)
}

export const POOLS: PoolDef[] = [
  { key: "cbs", name: "CBS Splash", tag: "CBS", table: "cbs_splash_picks", sideCol: "picked_side", lineCol: "splash_line", vegasFallback: false, keyCol: "is_key_pick", filter: "cbs_selected" },
  { key: "kelly", name: "Kelly", tag: "KEL", table: "cbs_splash_picks", sideCol: "kelly_picked_side", lineCol: "splash_line", vegasFallback: false, keyCol: null, filter: "kelly_selected" },
  { key: "peay", name: "Peay", tag: "PEAY", table: "peay_picks", sideCol: "picked_side", lineCol: "peay_line", vegasFallback: false, keyCol: "is_key_pick" },
  { key: "westgate", name: "Westgate", tag: "WG", table: "westgate_picks", sideCol: "picked_side", lineCol: "westgate_line", vegasFallback: false, keyCol: "is_key_pick" },
  { key: "brit", name: "Brit", tag: "BRIT", table: "brit_picks", sideCol: "picked_side", lineCol: null, vegasFallback: false, keyCol: "is_special" },
  { key: "espnml", name: "ESPN Moneyline", tag: "ESPN ML", table: "espn_ml_picks", sideCol: "picked_side", lineCol: null, vegasFallback: false, keyCol: "is_key_game" },
  { key: "espnspread", name: "ESPN Spread", tag: "ESPN", table: "espn_spread_picks", sideCol: "picked_side", lineCol: "espn_line", vegasFallback: true, keyCol: "is_key_game" },
  { key: "cbspickem", name: "CBS Pick'em", tag: "CBS PK", table: "cbs_pickem_picks", sideCol: "picked_side", lineCol: "cbs_line", vegasFallback: true, keyCol: "is_key_game" },
];

export interface PoolPick {
  pool: PoolKey;
  gameId: string;
  side: Side;
  awayLine: number | null; // as stored; null with vegasFallback = use Vegas
  key: boolean;
}

/** Selected pools: none ticked = all of them. */
export function activePools(poolKeys: string[]): PoolDef[] {
  return poolKeys.length ? POOLS.filter((p) => poolKeys.includes(p.key)) : POOLS;
}

type Filter = { col: "game_id"; ids: string[] } | { col: "week"; season: number; week: number };

async function fetchPicks(pools: PoolDef[], f: Filter): Promise<PoolPick[]> {
  const tables = Array.from(new Set(pools.map((p) => p.table)));
  const rows = await Promise.all(
    tables.map(async (table) => {
      let q = supabase.from(table).select("*");
      q = f.col === "game_id" ? q.in("game_id", f.ids) : q.eq("season", f.season).eq("week", f.week);
      const { data, error } = await q;
      if (error) throw error;
      return { table, data: (data ?? []) as any[] };
    })
  );
  const out: PoolPick[] = [];
  for (const p of pools) {
    for (const r of rows.find((x) => x.table === p.table)?.data ?? []) {
      const side = r[p.sideCol];
      if ((side !== "home" && side !== "away") || (p.filter && !r[p.filter])) continue;
      const line = p.lineCol && r[p.lineCol] != null ? Number(r[p.lineCol]) : null;
      out.push({ pool: p.key, gameId: r.game_id, side, awayLine: line, key: p.keyCol ? !!r[p.keyCol] : false });
    }
  }
  return out;
}

/** Pool picks on the given college games, for the bug's chips. Re-read every 10 min. */
export function usePoolPicksForGames(gameIds: string[], poolKeys: string[], active: boolean): Record<string, PoolPick[]> {
  const [picks, setPicks] = useState<PoolPick[]>([]);
  const key = `${gameIds.join(",")}|${poolKeys.join(",")}`;
  useEffect(() => {
    if (!active || !gameIds.length) return setPicks([]);
    let cancelled = false;
    const load = () =>
      fetchPicks(activePools(poolKeys), { col: "game_id", ids: gameIds })
        .then((p) => !cancelled && setPicks(p))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return useMemo(() => {
    const m: Record<string, PoolPick[]> = {};
    for (const p of picks) (m[p.gameId] ??= []).push(p);
    return m;
  }, [picks]);
}

// --- Live grading --------------------------------------------------------

export interface GradedPick {
  pick: PoolPick;
  def: PoolDef;
  label: string; // "NEB +9.5" / "NEB ML"
  status: "up" | "down" | "push" | "pending";
  result: "WON" | "LOST" | "PUSH" | null; // once final
  prob: number | null;
}

export interface GameLite {
  homeTeam: string;
  awayTeam: string;
  homeSpread: number | null; // Vegas, home side
  total: number | null;
  final: { home: number; away: number } | null; // stored final from `games`, a fallback for ESPN
}

const num = (v: number) => {
  const r = Math.round(v * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export function gradePick(pick: PoolPick, g: GameLite, sb: ScoreGame | undefined): GradedPick {
  const def = POOLS.find((p) => p.key === pick.pool)!;
  const abbr = pick.side === "home" ? sb?.home.abbrev ?? g.homeTeam : sb?.away.abbrev ?? g.awayTeam;
  const awayLine = pick.awayLine ?? (def.vegasFallback && g.homeSpread != null ? -g.homeSpread : null);
  const ats = def.lineCol != null;
  const sideLine = ats && awayLine != null ? (pick.side === "away" ? awayLine : -awayLine) : null;
  const label = ats ? (sideLine == null ? `${abbr} ?` : `${abbr} ${sideLine > 0 ? "+" : ""}${sideLine === 0 ? "PK" : num(sideLine)}`) : `${abbr} ML`;

  const live = sb && sb.state !== "pre" && sb.home.score != null && sb.away.score != null;
  const score = live ? { home: sb!.home.score!, away: sb!.away.score! } : g.final;
  const final = sb?.state === "post" || (!live && g.final != null);
  let status: GradedPick["status"] = "pending";
  if (score && (!ats || sideLine != null)) {
    const margin = pick.side === "home" ? score.home - score.away : score.away - score.home;
    const d = margin + (sideLine ?? 0);
    status = d > 0 ? "up" : d < 0 ? "down" : "push";
  }
  return {
    pick,
    def,
    label,
    status,
    result: final && status !== "pending" ? (status === "up" ? "WON" : status === "down" ? "LOST" : "PUSH") : null,
    prob: sb?.state === "in" ? pickChance(sb, g.homeSpread, g.total, pick.side, ats ? sideLine : null) : null,
  };
}

// --- Pools full screen ----------------------------------------------------

export interface PoolPanel {
  def: PoolDef;
  picks: { graded: GradedPick; game: GameLite; sb: ScoreGame | undefined }[];
  record: { w: number; l: number; p: number; pending: number };
}

interface WeekGame extends GameLite {
  id: string;
  start: string | null;
}

/**
 * This week's picks for the selected pools, graded live. "This week" = the
 * week of the next college game (or the one just played, until Tuesday).
 */
export function usePoolsBoard(poolKeys: string[], active: boolean) {
  const [week, setWeek] = useState<{ season: number; week: number } | null>(null);
  const [picks, setPicks] = useState<PoolPick[]>([]);
  const [games, setGames] = useState<Record<string, WeekGame>>({});
  const [error, setError] = useState<string | null>(null);
  const key = poolKeys.join(",");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const since = new Date(Date.now() - 3.5 * 86400_000).toISOString();
        const { data: next, error: e1 } = await supabase.from("games").select("season, week").gte("start_date", since).order("start_date").limit(1);
        if (e1) throw e1;
        if (!next?.length) throw new Error("No college games this week");
        const wk = { season: next[0].season, week: next[0].week };
        const p = await fetchPicks(activePools(poolKeys), { col: "week", season: wk.season, week: wk.week });
        const ids = Array.from(new Set(p.map((x) => x.gameId)));
        const [g, l] = ids.length
          ? await Promise.all([
              supabase.from("games").select("id, start_date, home_team, away_team, completed, home_points, away_points").in("id", ids),
              supabase.from("betting_lines").select("*").in("game_id", ids),
            ])
          : [{ data: [] as any[], error: null }, { data: [] as any[], error: null }];
        if (g.error) throw g.error;
        const lines = (l.data ?? []) as BettingLineRow[];
        const map: Record<string, WeekGame> = {};
        for (const r of g.data ?? []) {
          const line = pickLine(lines.filter((x) => x.game_id === r.id), r.completed);
          map[r.id] = {
            id: r.id,
            start: r.start_date,
            homeTeam: r.home_team,
            awayTeam: r.away_team,
            homeSpread: line?.spread != null ? Number(line.spread) : null,
            total: line?.over_under != null ? Number(line.over_under) : null,
            final: r.completed && r.home_points != null && r.away_points != null ? { home: r.home_points, away: r.away_points } : null,
          };
        }
        if (cancelled) return;
        setWeek(wk);
        setPicks(p);
        setGames(map);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Couldn't load pools");
      }
    };
    load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);

  const dates = useMemo(() => {
    const d = Array.from(new Set(Object.values(games).map((g) => g.start).filter((s): s is string => !!s).map(espnDate))).sort();
    return d.length ? d.join(",") : null;
  }, [games]);
  const { games: scores } = useScoreboard(active && dates ? `dates=${dates}` : null, Object.keys(games));

  const panels = useMemo<PoolPanel[]>(() => {
    return activePools(poolKeys)
      .map((def) => {
        const mine = picks
          .filter((p) => p.pool === def.key && games[p.gameId])
          .map((p) => ({ graded: gradePick(p, games[p.gameId], scores[p.gameId]), game: games[p.gameId] as GameLite, sb: scores[p.gameId] }))
          .sort((a, b) => (games[a.graded.pick.gameId].start ?? "").localeCompare(games[b.graded.pick.gameId].start ?? ""));
        const record = { w: 0, l: 0, p: 0, pending: 0 };
        for (const x of mine) {
          if (x.graded.result === "WON") record.w++;
          else if (x.graded.result === "LOST") record.l++;
          else if (x.graded.result === "PUSH") record.p++;
          else record.pending++;
        }
        return { def, picks: mine, record };
      })
      .filter((p) => p.picks.length > 0);
  }, [picks, games, scores, key]);

  return { week, panels, error };
}
