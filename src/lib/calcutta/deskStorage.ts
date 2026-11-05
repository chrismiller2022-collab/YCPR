import { NFL_COMPOSITE_WEEK9_TEXT } from "../../data/nflCompositeRatings";
import { formatDef, type Sport } from "./formats";
import { parseFieldRatings, parseRatings } from "./ratings";
import type { CalcuttaAuction } from "./types";

// Where the Desk keeps its private inputs (this browser only).
export const ratingsKey = (sport: Sport) => (sport === "nfl" ? "calcutta:nfl-ratings-text" : `calcutta:${sport}-ratings-text`);
export const deskKey = (id: string) => `calcutta:desk:${id}`;

/** Your pasted ratings for this auction's sport, as the Desk would read them (null if none). */
export function savedRatings(a: CalcuttaAuction): Record<string, { rating: number }> | null {
  const sport = formatDef(a.format).sport;
  try {
    const text = localStorage.getItem(ratingsKey(sport)) ?? (sport === "nfl" ? NFL_COMPOSITE_WEEK9_TEXT : "");
    if (!text.trim()) return null;
    const desk = JSON.parse(localStorage.getItem(deskKey(a.id)) ?? "{}");
    const r = sport === "nfl" ? parseRatings(text) : parseFieldRatings(text, a.field, { lowerIsBetter: !!desk.lowerIsBetter, scale: desk.scale ?? 1 });
    return Object.keys(r.ratings).length ? r.ratings : null;
  } catch {
    return null;
  }
}
