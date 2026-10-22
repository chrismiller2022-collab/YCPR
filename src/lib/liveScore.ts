// Live score math shared by the TV score bug (src/lib/overlay.ts) and the bot dashboard's Scores tab
// (bundled into hub/live/score.js and hub/api/_bot.mjs at the ycpr-bot deploy). No imports, no React.
//
// ESPN publishes win probability but nothing against the spread, so this estimates it: final = current score +
// the pregame expectation for the time that's left, with the spread of outcomes shrinking as the clock runs down
// (sd × √fraction left). Full-game SDs are typical college values.

export const SD_MARGIN = 16;
export const SD_TOTAL = 15;
export const SD_TEAM = 10;

export function normCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7).
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** P(final > line) for a normal final with this mean and sd (sd 0 = already decided). */
export function probAbove(mean: number, sd: number, line: number): number {
  if (sd < 0.01) return mean > line ? 1 : mean < line ? 0 : 0.5;
  return 1 - normCdf((line - mean) / sd);
}

/** The parts of an ESPN scoreboard game the clock math reads. */
export interface ClockGame {
  state: "pre" | "in" | "post";
  period: number;
  clock: string | null;
}

/** Minutes of regulation played, or null before kickoff. OT counts as 60. */
export function minutesPlayed(g: ClockGame): number | null {
  if (g.state === "pre") return null;
  if (g.state === "post" || g.period > 4) return 60;
  const [m, s] = (g.clock ?? "15:00").split(":").map(Number);
  const left = (m || 0) + (s || 0) / 60;
  return (g.period - 1) * 15 + (15 - left);
}

export interface ScoredGame extends ClockGame {
  home: { score: number | null };
  away: { score: number | null };
}

/**
 * Where the final home margin (home − away) is heading: the score so far plus the pregame expected margin for the
 * time left, sd shrinking with the clock. Final: sd 0. Before kickoff: null (use the full pregame distribution).
 */
export function liveMargin(g: ScoredGame, pregameHomeMargin: number): { mean: number; sd: number; left: number; now: number } | null {
  if (g.state === "pre" || g.home.score == null || g.away.score == null) return null;
  const now = g.home.score - g.away.score;
  const played = minutesPlayed(g);
  const left = g.state === "post" || played == null ? 0 : Math.max(0, Math.min(1, (60 - played) / 60));
  return { mean: now + pregameHomeMargin * left, sd: SD_MARGIN * Math.sqrt(left), left, now };
}

/**
 * The normal(mean, sd) final margin as P(margin = m) for whole m in [−max, max], m ≠ 0 (no ties in college
 * football: a tie's half-point either side goes to ±1). sd 0 = all mass on round(mean).
 */
export function marginProbs(mean: number, sd: number, max = 80): { maxMargin: number; probs: number[] } {
  const probs = new Array(2 * max + 1).fill(0);
  if (sd < 0.01) {
    let m = Math.round(mean);
    if (m === 0) m = mean >= 0 ? 1 : -1;
    probs[Math.max(-max, Math.min(max, m)) + max] = 1;
    return { maxMargin: max, probs };
  }
  for (let m = -max; m <= max; m++) {
    const lo = m === -max ? 0 : normCdf((m - 0.5 - mean) / sd);
    const hi = m === max ? 1 : normCdf((m + 0.5 - mean) / sd);
    probs[m + max] = Math.max(0, hi - lo);
  }
  const tie = probs[max];
  probs[max] = 0;
  probs[max - 1] += tie / 2;
  probs[max + 1] += tie / 2;
  return { maxMargin: max, probs };
}

/**
 * One ESPN scoreboard event trimmed to what a scoreboard draws. Same shape as api/odds-feed.ts mode=scoreboard
 * (api/ files can't import from src/, so that file keeps its own copy).
 */
export function espnScoreGame(e: any) {
  const c = e.competitions?.[0] ?? {};
  const side = (homeAway: string) => {
    const t = (c.competitors ?? []).find((x: any) => x.homeAway === homeAway) ?? {};
    const rank = t.curatedRank?.current;
    return {
      espnId: t.team?.id ?? null,
      abbrev: t.team?.abbreviation ?? null,
      name: t.team?.shortDisplayName ?? null,
      color: t.team?.color ?? null,
      logo: t.team?.logo ?? null,
      score: t.score != null && t.score !== "" ? Number(t.score) : null,
      rank: rank && rank < 99 ? rank : null,
    };
  };
  const s = c.situation ?? {};
  return {
    id: String(e.id),
    start: e.date as string,
    state: (e.status?.type?.state ?? "pre") as "pre" | "in" | "post",
    detail: (e.status?.type?.shortDetail ?? "") as string,
    period: (e.status?.period ?? 0) as number,
    clock: (e.status?.displayClock ?? null) as string | null,
    home: side("home"),
    away: side("away"),
    possession: (s.possession ?? s.lastPlay?.end?.team?.id ?? null) as string | null,
    downDistance: (s.shortDownDistanceText ?? null) as string | null,
    redZone: !!s.isRedZone,
    lastPlay: (s.lastPlay?.text ?? null) as string | null,
    homeWinPct: typeof s.lastPlay?.probability?.homeWinPercentage === "number" ? (s.lastPlay.probability.homeWinPercentage as number) : null,
    network: (c.broadcast || (c.broadcasts ?? []).flatMap((b: any) => b.names ?? []).join("/") || null) as string | null,
  };
}
