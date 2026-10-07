import { useCallback, useEffect, useState } from "react";
import { BET_HISTORY } from "../../data/betHistory.data";
import { fetchDrogbaAdv, fetchDrogbaGames, fetchDrogbaLocks, fetchDrogbaPreseason, invalidateDrogbaCache } from "../api/drogbaData";
import { buildEngine, type Engine } from "./engine";
import type { DGame } from "./dataset";

export interface DrogbaState {
  loading: boolean;
  building: boolean;
  error: string | null;
  games: DGame[];
  engine: Engine | null;
  reload: () => void;
}

// Loads everything DROGBA needs and builds the walk-forward ratings once. Building is ~5s of pure
// computation (hundreds of small ridge solves), so it yields to the browser first to let the
// "Building ratings…" message paint instead of freezing on a blank page.
export function useDrogba(): DrogbaState {
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<DGame[]>([]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchDrogbaGames(), fetchDrogbaAdv(), fetchDrogbaPreseason(), fetchDrogbaLocks()])
      .then(([g, adv, pre, locks]) => {
        if (cancelled) return;
        setGames(g);
        setLoading(false);
        setBuilding(true);
        setTimeout(() => {
          if (cancelled) return;
          try {
            setEngine(buildEngine({ games: g, adv, preseason: pre, history: BET_HISTORY, locks }));
          } catch (e: any) {
            setError(e?.message ?? "Building DROGBA ratings failed");
          }
          setBuilding(false);
        }, 30);
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

  const reload = useCallback(() => {
    invalidateDrogbaCache();
    setNonce((n) => n + 1);
  }, []);

  return { loading, building, error, games, engine, reload };
}
