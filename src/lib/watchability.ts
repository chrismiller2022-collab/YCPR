export interface WatchabilityInput {
  gameId: string;
  week: number;
  awayTeam: string;
  homeTeam: string;
  startDate: string | null;
  avgRating: number | null; // average of the two teams' own power ratings, YC convention (more negative = stronger)
  mySpread: number | null; // away-perspective projected spread
  myTotal: number | null; // projected total points
  isConferenceGame: boolean;
}

export interface WatchabilityScore extends WatchabilityInput {
  score: number; // 1-10
  qualityPctile: number | null;
  totalPctile: number | null;
  spreadPctile: number | null; // already inverted — higher pctile = closer game
}

function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5;
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  // Midpoint rule for ties, standard percentile-rank convention.
  return (below + equal / 2) / all.length;
}

export interface WatchabilityWeights {
  quality: number;
  total: number;
  spread: number;
  conferenceBonus: number;
}

export const DEFAULT_WEIGHTS: WatchabilityWeights = {
  quality: 0.5,
  total: 0.15,
  spread: 0.35,
  conferenceBonus: 0.5,
};

/**
 * Scores every game in `games` RELATIVE TO EACH OTHER — percentile rank
 * within this specific set, not against some fixed absolute scale. That
 * means a "10" in a Week 3 top-10 view and a "10" in a full-season view
 * aren't necessarily the same underlying game quality; each view's
 * population defines its own curve. This is deliberate: it keeps every
 * view's spread of scores meaningful (a top-10 list where everything
 * scored 9+ would defeat the point) without needing hand-picked
 * absolute cutoffs that would need recalibrating as ratings shift
 * season to season.
 */
export function scoreWatchability(games: WatchabilityInput[], weights: WatchabilityWeights = DEFAULT_WEIGHTS): WatchabilityScore[] {
  const ratings = games.map((g) => g.avgRating).filter((v): v is number => v != null).map((v) => -v); // negate: YC convention is lower = stronger
  const totals = games.map((g) => g.myTotal).filter((v): v is number => v != null);
  const absSpreads = games.map((g) => (g.mySpread != null ? -Math.abs(g.mySpread) : null)).filter((v): v is number => v != null); // negate abs spread: smaller = better, so rank ascending-good the same way as the others

  return games.map((g) => {
    const qualityPctile = g.avgRating != null ? percentileRank(-g.avgRating, ratings) : null;
    const totalPctile = g.myTotal != null ? percentileRank(g.myTotal, totals) : null;
    const spreadPctile = g.mySpread != null ? percentileRank(-Math.abs(g.mySpread), absSpreads) : null;

    const parts: { pctile: number; weight: number }[] = [];
    if (qualityPctile != null) parts.push({ pctile: qualityPctile, weight: weights.quality });
    if (totalPctile != null) parts.push({ pctile: totalPctile, weight: weights.total });
    if (spreadPctile != null) parts.push({ pctile: spreadPctile, weight: weights.spread });

    const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
    const blended = totalWeight > 0 ? parts.reduce((s, p) => s + p.pctile * p.weight, 0) / totalWeight : 0.5;

    let score = 1 + blended * 8; // 1-9 from the blended factors
    if (g.isConferenceGame) score = Math.min(10, score + weights.conferenceBonus);

    return { ...g, score: Math.round(score * 10) / 10, qualityPctile, totalPctile, spreadPctile };
  });
}

export type KickoffWindow = "early" | "afternoon" | "night";

/** Early < 2:01pm ET, Afternoon 2:01pm-6:59pm ET, Night >= 7:00pm ET — Chris's own contest-slate convention. */
export function kickoffWindowET(iso: string | null): KickoffWindow | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const totalMinutes = hour * 60 + minute;
  if (totalMinutes < 14 * 60 + 1) return "early";
  if (totalMinutes < 19 * 60) return "afternoon";
  return "night";
}

export function isSaturdayET(iso: string | null): boolean {
  if (!iso) return false;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(iso));
  return weekday === "Sat";
}
