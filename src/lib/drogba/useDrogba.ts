import { useCallback, useEffect, useState } from "react";
import { fetchDrogbaAdv, fetchDrogbaCoaches, fetchDrogbaPlays, fetchDrogbaPreseason, fetchDrogbaRaw, invalidateDrogbaCache, type DrogbaRaw } from "../api/drogbaData";
import { fetchBookSnapshots } from "../api/bookSnapshots";
import { buildEngine, type Engine } from "./engine";
import { buildGames, type DGame, type OpenMode } from "./dataset";
import { buildBookLines, type BookLine } from "./openers";
import type { RawAdvRow, RawPlayAggRow } from "./efficiencyRatings";
import type { RawCoachSeason } from "./preseasonPrior";
import type { RawPreseasonRow } from "./preseason";

export interface DrogbaState {
  loading: boolean;
  building: boolean;
  error: string | null;
  games: DGame[];
  engine: Engine | null;
  openMode: OpenMode;
  setOpenMode: (m: OpenMode) => void;
  fanduelGames: number; // games with a FanDuel open on file
  fanduelLines: Map<string, BookLine>; // per game id: FanDuel's open and when it was first seen
  bovadaOpen: Map<string, number>; // Bovada's open per game id, for comparing books
  gameStats: Map<string, { adv: number; plays: number }>; // per game id: how many teams have per-game advanced rows / play-level rows on file
  reload: () => void;
}

const MODE_KEY = "drogba-open-mode";
function readMode(): OpenMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "fanduel_then_bovada" || v === "fanduel_only" || v === "bovada") return v;
  } catch {
    // storage unavailable — fall through to the default
  }
  return "fanduel_then_bovada";
}

interface Loaded {
  raw: DrogbaRaw;
  adv: RawAdvRow[];
  pre: RawPreseasonRow[];
  plays: RawPlayAggRow[];
  coaches: RawCoachSeason[];
  fdRows: Awaited<ReturnType<typeof fetchBookSnapshots>>;
}

// Loads everything DROGBA needs and builds the walk-forward ratings. Building is ~5s of pure computation
// (hundreds of small ridge solves), so it yields to the browser first to let the "Building ratings…"
// message paint instead of freezing on a blank page.
export function useDrogba(): DrogbaState {
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [games, setGames] = useState<DGame[]>([]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [fanduelGames, setFanduelGames] = useState(0);
  const [fanduelLines, setFanduelLines] = useState<Map<string, BookLine>>(new Map());
  const [bovadaOpen, setBovadaOpen] = useState<Map<string, number>>(new Map());
  const [gameStats, setGameStats] = useState<Map<string, { adv: number; plays: number }>>(new Map());
  const [openMode, setOpenModeState] = useState<OpenMode>(readMode);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchDrogbaRaw(), fetchDrogbaAdv(), fetchDrogbaPreseason(), fetchDrogbaPlays().catch(() => [] as RawPlayAggRow[]), fetchDrogbaCoaches().catch(() => [] as RawCoachSeason[]), fetchBookSnapshots("fanduel")])
      .then(([raw, adv, pre, plays, coaches, fdRows]) => {
        if (cancelled) return;
        setLoaded({ raw, adv, pre, plays, coaches, fdRows });
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? "Loading DROGBA data failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setBuilding(true);
    setTimeout(() => {
      if (cancelled) return;
      try {
        // Week anchors (which Saturday a week is) come from the games themselves, so build once without
        // FanDuel to get them, then rebuild with FanDuel's per-game open/last.
        const base = buildGames(loaded.raw.games, loaded.raw.lines);
        const fd: Map<string, BookLine> = buildBookLines(loaded.fdRows, base);
        setFanduelGames(fd.size);
        setFanduelLines(fd);
        setBovadaOpen(new Map(base.filter((b) => b.open != null).map((b) => [b.id, b.open as number])));
        const stats = new Map<string, { adv: number; plays: number }>();
        const bump = (id: string, k: "adv" | "plays") => {
          const e = stats.get(id) ?? { adv: 0, plays: 0 };
          e[k] += 1;
          stats.set(id, e);
        };
        for (const r of loaded.adv) if (r.off_ppa != null || r.off_success_rate != null) bump(r.game_id, "adv");
        for (const r of loaded.plays) if (r.f_plays != null && r.f_plays >= 20) bump(r.game_id, "plays");
        setGameStats(stats);
        const g = buildGames(loaded.raw.games, loaded.raw.lines, fd, openMode);
        setGames(g);
        setEngine(buildEngine({ games: g, adv: loaded.adv, preseason: loaded.pre, plays: loaded.plays, coaches: loaded.coaches }));
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Building DROGBA ratings failed");
      }
      setBuilding(false);
    }, 30);
    return () => {
      cancelled = true;
    };
  }, [loaded, openMode]);

  const setOpenMode = useCallback((m: OpenMode) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // not critical — the choice just won't persist
    }
    setOpenModeState(m);
  }, []);

  const reload = useCallback(() => {
    invalidateDrogbaCache();
    setNonce((n) => n + 1);
  }, []);

  return { loading, building, error, games, engine, openMode, setOpenMode, fanduelGames, fanduelLines, bovadaOpen, gameStats, reload };
}
