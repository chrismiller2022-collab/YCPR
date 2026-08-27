export interface WatchabilityInput {
  gameId: string;
  week: number;
  awayTeam: string;
  homeTeam: string;
  startDate: string | null;
  avgRating: number | null; // average of the two teams' own power ratings, YC convention (more negative = stronger)
  mySpread: number | null; // away-perspective projected spread
  myTotal: number | null; // projected total points
  combinedProjWins: number | null; // sum of both teams' Monte Carlo mean season win totals
  isConferenceGame: boolean;
}

export interface WatchabilityScore extends WatchabilityInput {
  score: number; // 1-10
  qualityPctile: number | null;
  totalPctile: number | null;
  spreadCloseness: number | null; // 0-1, absolute scale (not a population-relative percentile)
  winsPctile: number | null;
}

function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5;
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  // Midpoint rule for ties, standard percentile-rank convention.
  return (below + equal / 2) / all.length;
}

// Games with a 20+ point spread are never going to be a top-10 watch
// regardless of exactly how blown-out they are, and CFB's spread
// distribution has a long right tail (lots of real blowouts) that
// distorts population-relative ranking for the close games that
// actually matter: a 3.8 and a 4.9 point spread are both "close, good
// games" in real terms, but percentile rank against a population full
// of 30-40 point spreads can swing them several ranks apart just from
// how few other games happen to also be close that week. A fixed
// absolute-scale decay avoids that entirely — this specific pair
// (3.8 vs 4.9) scores 0.864 vs 0.825, a small, stable gap regardless
// of what else is on the slate.
const SPREAD_CLOSENESS_ZERO_AT = 28;
function spreadClosenessScore(spread: number): number {
  return Math.max(0, 1 - Math.abs(spread) / SPREAD_CLOSENESS_ZERO_AT);
}

export interface WatchabilityWeights {
  quality: number;
  total: number;
  spread: number;
  wins: number;
  conferenceBonus: number;
}

export const DEFAULT_WEIGHTS: WatchabilityWeights = {
  quality: 0.4,
  total: 0.15,
  spread: 0.3,
  wins: 0.15,
  conferenceBonus: 0.5,
};

/**
 * Scores every game in `games` relative to each other for the
 * percentile-based components (quality, total, wins — these don't have
 * spread's long-tail distortion problem, a normal win-total or rating
 * spread doesn't bunch up the way blowout spreads do). Spread closeness
 * uses a fixed absolute scale instead, for the reason above. After
 * blending, the whole population is re-scaled so the actual best game
 * in view lands at (or extremely close to) 10 and the worst at 1 —
 * blending several independently-scored components almost never
 * produces a game that's literally the best on every axis at once, so
 * without this rescale the ceiling quietly sits well below 10 even for
 * a genuinely great slate.
 */
export function scoreWatchability(games: WatchabilityInput[], weights: WatchabilityWeights = DEFAULT_WEIGHTS): WatchabilityScore[] {
  const ratings = games.map((g) => g.avgRating).filter((v): v is number => v != null).map((v) => -v); // negate: YC convention is lower = stronger
  const totals = games.map((g) => g.myTotal).filter((v): v is number => v != null);
  const winsAll = games.map((g) => g.combinedProjWins).filter((v): v is number => v != null);

  const raw = games.map((g) => {
    const qualityPctile = g.avgRating != null ? percentileRank(-g.avgRating, ratings) : null;
    const totalPctile = g.myTotal != null ? percentileRank(g.myTotal, totals) : null;
    const spreadCloseness = g.mySpread != null ? spreadClosenessScore(g.mySpread) : null;
    const winsPctile = g.combinedProjWins != null ? percentileRank(g.combinedProjWins, winsAll) : null;

    const parts: { pctile: number; weight: number }[] = [];
    if (qualityPctile != null) parts.push({ pctile: qualityPctile, weight: weights.quality });
    if (totalPctile != null) parts.push({ pctile: totalPctile, weight: weights.total });
    if (spreadCloseness != null) parts.push({ pctile: spreadCloseness, weight: weights.spread });
    if (winsPctile != null) parts.push({ pctile: winsPctile, weight: weights.wins });

    const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
    const blended = totalWeight > 0 ? parts.reduce((s, p) => s + p.pctile * p.weight, 0) / totalWeight : 0.5;

    const conferenceAdd = g.isConferenceGame ? weights.conferenceBonus : 0;

    return { g, qualityPctile, totalPctile, spreadCloseness, winsPctile, rawScore: blended + conferenceAdd };
  });

  const rawScores = raw.map((r) => r.rawScore);
  const min = Math.min(...rawScores);
  const max = Math.max(...rawScores);
  const range = max - min;

  return raw.map((r) => {
    const rescaled = range > 0 ? (r.rawScore - min) / range : 0.5;
    const score = 1 + rescaled * 9;
    return {
      ...r.g,
      score: Math.round(score * 10) / 10,
      qualityPctile: r.qualityPctile,
      totalPctile: r.totalPctile,
      spreadCloseness: r.spreadCloseness,
      winsPctile: r.winsPctile,
    };
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
