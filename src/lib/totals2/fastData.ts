// Fast data for the Totals page: only small queries (the stored v2 numbers, the log, team-total lines, locks, this
// season's scores and lines). Nothing is rebuilt in the browser — the scheduled job did that.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { fetchAllRows } from "../api/fetchAll";
import { cachedFetch, invalidateCacheKey } from "../api/cache";
import { fetchTotals2Projections, type Totals2ProjectionRow } from "../api/totals2Projections";
import { fetchSeasonTeamTotalLines, fetchTotals2Picks, type TeamTotalLineLite, type Totals2PickRow } from "../api/totals2Data";
import { fetchGameProjectionLocks, type GameProjectionLockRow } from "../api/gameProjectionLocks";
import { buildMarkets, type Market } from "./model";
import type { RawLineRow } from "../drogba/dataset";

export interface SeasonGame {
  id: string;
  week: number;
  start_date: string | null;
  home_team: string;
  away_team: string;
  home_points: number | null;
  away_points: number | null;
  completed: boolean | null;
}

export interface Totals2Fast {
  loading: boolean;
  error: string | null;
  proj: Totals2ProjectionRow[];
  picks: Totals2PickRow[];
  ttLines: TeamTotalLineLite[];
  locks: Record<string, GameProjectionLockRow>;
  games: Map<string, SeasonGame>;
  markets: Map<string, Market>; // open + close per game (same book choice as the model)
  lastComputed: string | null;
  reload: () => void;
}

async function seasonScoresAndLines(season: number) {
  return cachedFetch(`totals2-season:${season}`, async () => {
    const [games, lines] = await Promise.all([
      fetchAllRows<SeasonGame>((from, to) =>
        supabase.from("games").select("id, week, start_date, home_team, away_team, home_points, away_points, completed").eq("season", season).order("id").range(from, to)
      ),
      fetchAllRows<RawLineRow>((from, to) =>
        supabase.from("betting_lines").select("game_id, provider, spread, over_under, opening_spread, opening_over_under").eq("season", season).order("id").range(from, to)
      ),
    ]);
    return { games, lines };
  });
}

export function useTotals2Fast(season: number): Totals2Fast {
  const [st, setSt] = useState<Omit<Totals2Fast, "reload">>({
    loading: true,
    error: null,
    proj: [],
    picks: [],
    ttLines: [],
    locks: {},
    games: new Map(),
    markets: new Map(),
    lastComputed: null,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSt((s) => ({ ...s, loading: true, error: null }));
    Promise.all([
      fetchTotals2Projections(season),
      fetchTotals2Picks(season).catch(() => [] as Totals2PickRow[]),
      fetchSeasonTeamTotalLines(season).catch(() => [] as TeamTotalLineLite[]),
      fetchGameProjectionLocks(season, Array.from({ length: 17 }, (_, i) => i + 1)).catch(() => ({}) as Record<string, GameProjectionLockRow>),
      seasonScoresAndLines(season),
    ])
      .then(([proj, picks, ttLines, locks, sl]) => {
        if (cancelled) return;
        const lastComputed = proj.reduce<string | null>((m, r) => (m == null || r.computed_at > m ? r.computed_at : m), null);
        setSt({
          loading: false,
          error: null,
          proj,
          picks,
          ttLines,
          locks,
          games: new Map(sl.games.map((g) => [String(g.id), g])),
          markets: buildMarkets(sl.lines),
          lastComputed,
        });
      })
      .catch((e: any) => !cancelled && setSt((s) => ({ ...s, loading: false, error: e?.message ?? "Loading failed" })));
    return () => {
      cancelled = true;
    };
  }, [season, nonce]);
  const reload = useCallback(() => {
    invalidateCacheKey("totals2-", true);
    setNonce((n) => n + 1);
  }, []);
  return { ...st, reload };
}
