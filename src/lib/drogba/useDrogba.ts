import { useCallback, useEffect, useState } from "react";
import { BET_HISTORY } from "../../data/betHistory.data";
import { fetchDrogbaAdv, fetchDrogbaLocks, fetchDrogbaPreseason, fetchDrogbaRaw, invalidateDrogbaCache, type DrogbaRaw } from "../api/drogbaData";
import { fetchBookSnapshots } from "../api/bookSnapshots";
import { buildEngine, type Engine } from "./engine";
import { buildGames, type DGame, type OpenMode } from "./dataset";
import { buildBookLines, type BookLine } from "./openers";
import type { RawAdvRow } from "./efficiencyRatings";
import type { RawPreseasonRow } from "./preseason";
import type { LockLike } from "./consensus";

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
  locks: LockLike[];
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
  const [openMode, setOpenModeState] = useState<OpenMode>(readMode);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchDrogbaRaw(), fetchDrogbaAdv(), fetchDrogbaPreseason(), fetchDrogbaLocks(), fetchBookSnapshots("fanduel")])
      .then(([raw, adv, pre, locks, fdRows]) => {
        if (cancelled) return;
        setLoaded({ raw, adv, pre, locks, fdRows });
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
        const g = buildGames(loaded.raw.games, loaded.raw.lines, fd, openMode);
        setGames(g);
        setEngine(buildEngine({ games: g, adv: loaded.adv, preseason: loaded.pre, history: BET_HISTORY, locks: loaded.locks }));
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

  return { loading, building, error, games, engine, openMode, setOpenMode, fanduelGames, fanduelLines, bovadaOpen, reload };
}
