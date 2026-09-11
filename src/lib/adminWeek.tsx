import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useCurrentWeek } from "./currentWeek";

const STORAGE_KEY = "admin_selected_week";

function loadStoredWeek(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveStoredWeek(week: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(week));
  } catch {
    // Private browsing / storage disabled — the selection just won't
    // persist across reloads, not worth surfacing an error for.
  }
}

interface AdminWeekContextValue {
  week: number;
  setWeek: (week: number) => void;
  /** True once `week` reflects either a stored choice or the resolved live current week — see useDefaultToAdminWeek. */
  ready: boolean;
}

const AdminWeekContext = createContext<AdminWeekContextValue>({ week: 1, setWeek: () => {}, ready: true });

/**
 * Site-wide "which week am I working on" selector for the whole Admin
 * section — one manual choice every admin page defaults to, instead of
 * each page separately guessing / defaulting to Week 1. Persisted to
 * localStorage (single-user tool, same convention as everywhere else)
 * so it survives reloads; seeded once from the live current week (see
 * useCurrentWeek) the first time nothing has been picked yet.
 */
export function AdminWeekProvider({ season, children }: { season: number; children: ReactNode }) {
  const initialStored = useRef(loadStoredWeek());
  const [week, setWeekState] = useState<number>(initialStored.current ?? 1);
  const seeded = useRef(initialStored.current != null);
  const { currentWeek, loading } = useCurrentWeek(season);
  const ready = seeded.current || !loading;

  useEffect(() => {
    if (seeded.current || loading) return;
    seeded.current = true;
    setWeekState(currentWeek);
  }, [loading, currentWeek]);

  function setWeek(w: number) {
    setWeekState(w);
    saveStoredWeek(w);
  }

  return <AdminWeekContext.Provider value={{ week, setWeek, ready }}>{children}</AdminWeekContext.Provider>;
}

export function useAdminWeek(): AdminWeekContextValue {
  return useContext(AdminWeekContext);
}

/**
 * Drop-in "default this page's own week state to the site-wide Admin
 * week selector, once, without fighting the user's own later clicks" —
 * same pattern as useDefaultToCurrentWeek in currentWeek.ts, just
 * sourced from the manual admin-wide selection instead of a per-page
 * live-data guess. Call alongside your own useState for week/setWeek.
 */
export function useDefaultToAdminWeek(setWeek: (week: number) => void) {
  const { week: adminWeek, ready } = useAdminWeek();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current || !ready) return;
    applied.current = true;
    setWeek(adminWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, adminWeek]);
}
