// "Ratings: As rated | Standardized" switch shared by the bet-history pages
// (Spread History, Moneyline History). One remembered setting for all of
// them, so turning it on in one page turns it on in the others.

import { useEffect, useState } from "react";
import type { RatingMethod } from "../lib/standardizedYc";

const KEY = "betHistory.ratingMethod";
const EVENT = "rating-method-change";

function read(): RatingMethod {
  try {
    return localStorage.getItem(KEY) === "standardized" ? "standardized" : "asRated";
  } catch {
    return "asRated";
  }
}

export function useRatingMethodPref(): [RatingMethod, (m: RatingMethod) => void] {
  const [method, setMethod] = useState<RatingMethod>(read);
  useEffect(() => {
    const sync = () => setMethod(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  function set(m: RatingMethod) {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      // storage unavailable: still switches for this page view
    }
    setMethod(m);
    window.dispatchEvent(new Event(EVENT));
  }
  return [method, set];
}

export default function RatingMethodToggle({
  method,
  setMethod,
  season,
  loading,
  error,
  multiplier,
}: {
  method: RatingMethod;
  setMethod: (m: RatingMethod) => void;
  season: number;
  loading?: boolean;
  error?: string | null;
  multiplier?: number | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Ratings:</span>
      <button className={`mode-btn ${method === "asRated" ? "mode-btn-active" : ""}`} onClick={() => setMethod("asRated")}>
        As rated
      </button>
      <button className={`mode-btn ${method === "standardized" ? "mode-btn-active" : ""}`} onClick={() => setMethod("standardized")}>
        Standardized
      </button>
      <span style={{ fontSize: "0.76rem", color: error ? "var(--c-err)" : "var(--chalk-dim)" }}>
        {error
          ? `Couldn't load the rating snapshots: ${error}`
          : method === "asRated"
            ? "The real record: each game graded on the ratings you had that week."
            : loading
              ? "Loading every saved week's rating systems…"
              : `Backtest: ${season} re-graded as the standardized YC would have rated it each week (SDs from the FBS average × ${multiplier ?? "–"}, current weights), no locks. Earlier seasons have no saved rating systems, so they stay as rated. Applies to every tab here.`}
      </span>
    </div>
  );
}
