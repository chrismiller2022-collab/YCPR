// Live Totals v2 for one season: rebuilds the point-in-time ratings in the browser (same code as training), adds
// game-window weather from Open-Meteo, and applies the frozen layers from frozen.ts (trained on earlier seasons only,
// so every number for this season is out-of-sample).
import { useCallback, useEffect, useState } from "react";
import { fetchDrogbaPlays, fetchDrogbaPreseason, fetchDrogbaRaw, invalidateDrogbaCache } from "../api/drogbaData";
import { fetchSeasonGameVenues, fetchSeasonTeamTotalLines, fetchTotals2Adv, fetchTotals2Picks, fetchTotals2Tempo, invalidateTotals2Cache, type TeamTotalLineLite, type Totals2PickRow } from "../api/totals2Data";
import { fetchTeamVenues, fetchVenuesByIds } from "../api/gameWeather";
import { fetchGameProjectionLocks, type GameProjectionLockRow } from "../api/gameProjectionLocks";
import { fetchWeatherForKickoffs, summarizeGameWeather, type WeatherRequest } from "../weather";
import { buildGames, type DGame } from "../drogba/dataset";
import { applyMarketSplit, buildMarkets, buildSideRows, buildT2Ratings, pairGames, predictLayer1, predictLayer2, slateMeans, type GamePred, type Market, type SidePred } from "./model";
import { gameLocation, type GameWeatherInputs } from "./weatherFeatures";
import { T2_CONFIG, T2_LAYER1, T2_LAYER2_CLOSE, T2_LAYER2_MOVE, T2_LAYER2_OPEN } from "./frozen";

export interface Totals2State {
  loading: boolean;
  error: string | null;
  weatherNote: string | null;
  tempoNote: string | null; // set when this season has no tempo rows yet (plays pull not re-run since tempo was added)
  games: DGame[]; // this season's games
  markets: Map<string, Market>;
  preds: SidePred[];
  gps: GamePred[];
  weather: Map<string, GameWeatherInputs>;
  locks: Record<string, GameProjectionLockRow>; // v1 (site) locked total + YCPR spread, keyed by game id
  picks: Totals2PickRow[];
  ttLines: TeamTotalLineLite[];
  reload: () => void;
}

async function seasonWeather(season: number, games: DGame[]): Promise<{ map: Map<string, GameWeatherInputs>; note: string | null }> {
  const [venues, teamVenues] = await Promise.all([fetchSeasonGameVenues(season), fetchTeamVenues()]);
  const byId = await fetchVenuesByIds(venues.map((v) => v.venue_id).filter((v): v is number => v != null));
  const fbsIds = new Set(games.filter((g) => g.homeFbs && g.awayFbs).map((g) => g.id));
  const map = new Map<string, GameWeatherInputs>();
  const reqs: WeatherRequest[] = [];
  for (const v of venues) {
    if (!fbsIds.has(v.id) || !v.start_date || v.start_time_tbd) continue;
    const loc = gameLocation(v, byId as any, teamVenues as any);
    if (!loc) continue;
    if (loc.dome) map.set(v.id, { dome: true, avgWind: null, maxGust: null, precip: null, snow: null, temp: null });
    else reqs.push({ key: v.id, point: { latitude: loc.latitude, longitude: loc.longitude }, kickoff: v.start_date });
  }
  try {
    const got = await fetchWeatherForKickoffs(reqs);
    for (const r of reqs) {
      const hit = got.get(r.key);
      const s = hit ? summarizeGameWeather(hit.series, hit.source, r.kickoff) : null;
      if (s) map.set(r.key, { dome: false, avgWind: s.avgWind, maxGust: s.maxGust, precip: s.totalPrecip, snow: s.totalSnow, temp: s.kickoff.temp });
    }
    return { map, note: null };
  } catch (e: any) {
    return { map, note: `Weather unavailable (${e?.message ?? "Open-Meteo"}) — games are projected as ordinary conditions.` };
  }
}

export type Totals2Data = Omit<Totals2State, "reload" | "loading" | "error">;

/** Everything the page shows, for one season (also runnable outside React, e.g. from a bun check script). */
export async function loadTotals2(season: number): Promise<Totals2Data> {
  const [raw, adv, plays, preseason, locks, picks, ttLines, tempo] = await Promise.all([
    fetchDrogbaRaw(),
    fetchTotals2Adv(),
    fetchDrogbaPlays(),
    fetchDrogbaPreseason(),
    fetchGameProjectionLocks(season, Array.from({ length: 17 }, (_, i) => i + 1)),
    fetchTotals2Picks(season).catch(() => [] as Totals2PickRow[]),
    fetchSeasonTeamTotalLines(season).catch(() => [] as TeamTotalLineLite[]),
    fetchTotals2Tempo().catch(() => []),
  ]);
  const all = buildGames(raw.games, raw.lines);
  const games = all.filter((g) => g.season === season);
  const markets = buildMarkets(raw.lines);
  const wx = await seasonWeather(season, games);
  // Ratings are ~1-2s of solves; yield so the loading message paints first.
  await new Promise((r) => setTimeout(r, 20));
  const ratings = buildT2Ratings({ games: all.filter((g) => g.season <= season), adv, plays, preseason, tempo }, T2_CONFIG, season);
  const rows = buildSideRows(games, ratings, markets, wx.map);
  const l1 = new Map(rows.map((r) => [r, predictLayer1(T2_LAYER1, r)] as const));
  const slates = slateMeans(rows, (r) => l1.get(r));
  const preds: SidePred[] = rows.map((r) => ({
    row: r,
    l1: l1.get(r)!,
    resid: { close: predictLayer2(T2_LAYER2_CLOSE, r, l1.get(r)!, slates), open: predictLayer2(T2_LAYER2_OPEN, r, l1.get(r)!, slates) },
    move: predictLayer2(T2_LAYER2_MOVE, r, l1.get(r)!, slates),
  }));
  applyMarketSplit(preds);
  const ids = new Set(games.map((g) => g.id));
  const seasonTempo = tempo.filter((t) => ids.has(t.game_id)).length;
  const tempoNote =
    seasonTempo === 0
      ? `No tempo data for ${season} yet — re-run the plays pull for this season (DROGBA → Data) so the pace input isn't read as league-average for every team.`
      : null;
  return { weatherNote: wx.note, tempoNote, games, markets, preds, gps: pairGames(preds), weather: wx.map, locks, picks, ttLines };
}

export function useTotals2(season: number): Totals2State {
  const [state, setState] = useState<Omit<Totals2State, "reload">>({
    loading: true,
    error: null,
    weatherNote: null,
    tempoNote: null,
    games: [],
    markets: new Map(),
    preds: [],
    gps: [],
    weather: new Map(),
    locks: {},
    picks: [],
    ttLines: [],
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const d = await loadTotals2(season);
        if (!cancelled) setState({ loading: false, error: null, ...d });
      } catch (e: any) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e?.message ?? "Loading Totals v2 failed" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, nonce]);

  const reload = useCallback(() => {
    invalidateDrogbaCache();
    invalidateTotals2Cache();
    setNonce((n) => n + 1);
  }, []);

  return { ...state, reload };
}
