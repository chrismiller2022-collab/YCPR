import { TEAMS_BY_NAME } from "../data/teams";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { hfaFor, spreadToWinPct } from "./odds";
import { pickLine } from "./matchupsCompute";
import { computeBestWorst } from "./bestWorst";
import { type GameWithLines } from "./api/gamesLines";

export interface RawResumeMetrics {
  expWins: number | null;
  actWins: number;
  losses: number;
  // Rest of season only — the games not yet played, at each game's win
  // probability. Total = real record so far + that (a played game counts as
  // 1 or 0, never a probability).
  projWins: number;
  projLosses: number;
  totalProjWins: number;
  totalProjLosses: number;
  winLossDiff: number;
  // Wins Above Bubble: actual wins minus the wins a bubble team (the 12th-best FBS team by power rating) would expect
  // against the same schedule at the same sites. Projected mode adds the rest of the season at this team's own win
  // probability minus the bubble team's.
  wab: number | null;
  confChampWinPct: number | null;
  powerRating: number;
  srs: number | null;
  vsrs: number | null;
  avgProjLine: number | null;
  avgActLine: number | null;
  mov: number | null;
  atsMargin: number | null;
  // Season-long net success rate, in percentage points: mean over played
  // games of (offense success rate - success rate its defense allowed).
  netSr: number | null;
  avgOppPR: number | null;
  sos: number | null;
  bestWin: number | null;
  bestLoss: number | null;
  worstLoss: number | null;
}

export const METRIC_KEYS: (keyof RawResumeMetrics)[] = [
  "expWins",
  "actWins",
  "losses",
  "projWins",
  "projLosses",
  "totalProjWins",
  "totalProjLosses",
  "winLossDiff",
  "wab",
  "confChampWinPct",
  "powerRating",
  "srs",
  "vsrs",
  "avgProjLine",
  "avgActLine",
  "mov",
  "atsMargin",
  "netSr",
  "avgOppPR",
  "sos",
  "bestWin",
  "bestLoss",
  "worstLoss",
];

export const METRIC_LABELS: Record<keyof RawResumeMetrics, string> = {
  expWins: "Exp. Wins (PGWE)",
  actWins: "Actual Wins",
  losses: "Losses",
  projWins: "Projected Wins (Rest of Season)",
  projLosses: "Projected Losses (Rest of Season)",
  totalProjWins: "Total Projected Wins",
  totalProjLosses: "Total Projected Losses",
  winLossDiff: "W-L",
  wab: "Wins Above Bubble",
  confChampWinPct: "Conf. Champ Win %",
  powerRating: "Power Rating",
  srs: "SRS",
  vsrs: "VSRS",
  avgProjLine: "Avg. Projected Line",
  avgActLine: "Avg. Actual (Vegas) Line",
  mov: "Margin of Victory",
  atsMargin: "ATS Margin",
  netSr: "Net Success Rate",
  avgOppPR: "Avg. Opponent PR",
  sos: "Strength of Schedule",
  bestWin: "Best Win (Opp. PR)",
  bestLoss: "Best Loss (Opp. PR)",
  worstLoss: "Worst Loss (Opp. PR)",
};

// true = higher raw value is better; false = lower raw value is better.
// Most "lower is better" entries mirror the site's negative-is-good
// rating convention (Power Rating, opponent ratings in Best/Worst). SOS
// is the one exception — it uses the OPPOSITE sign convention (positive
// = harder), and a harder schedule is the better resume trait, so it's
// "higher is better" despite most other metrics here going the other way.
export const METRIC_HIGHER_IS_BETTER: Record<keyof RawResumeMetrics, boolean> = {
  expWins: true,
  actWins: true,
  losses: false,
  projWins: true,
  projLosses: false,
  totalProjWins: true,
  totalProjLosses: false,
  winLossDiff: true,
  wab: true,
  confChampWinPct: true,
  powerRating: false,
  srs: false,
  vsrs: false,
  avgProjLine: false,
  avgActLine: false,
  mov: true,
  atsMargin: true,
  netSr: true,
  avgOppPR: false,
  // SOS now comes from the saved SOS admin snapshot (blend, else SOS via SRS):
  // negative = tougher schedule, and a tougher schedule is the better resume
  // trait, so LOWER scores better here (same direction as Avg. Opponent PR).
  sos: false,
  bestWin: false,
  bestLoss: false,
  worstLoss: false,
};

// No real data source wired up yet. Weight sliders exist for these in the
// UI, but the value is always null until the upstream data exists: PGWE
// needs a CFBD sync change to pull postgame win probability (not built
// yet). SRS/VSRS now pull from the "YC SRS" snapshot in rating_pulls (see
// srsByTeam/vsrsByTeam below) — no longer stubbed.
export const STUBBED_METRICS: (keyof RawResumeMetrics)[] = [];

export function computeRawResumeMetrics(
  team: any,
  seasonGames: GameWithLines[],
  liveByTeam: Record<string, any>,
  // Sourced from rating_pulls' "yc_srs"/"yc_vsrs" system keys — the same
  // sign-flipped (negative = better), admin-refreshed snapshot the Monte
  // Carlo SRS tab's "Send to Rating Systems" button writes. Deliberately
  // NOT a live per-page-load re-simulation: that engine draws fresh random
  // margins for every uncompleted game, so a live number would jump around
  // on every render instead of being a stable resume input.
  srsByTeam: Record<string, number | null> = {},
  vsrsByTeam: Record<string, number | null> = {},
  // true = every "season-wide" metric below (avgProjLine, avgOppPR,
  // projWins/projLosses, mov, bestWin/bestLoss/worstLoss) is restricted to
  // games actually played so far — no rest-of-season projection blended
  // in. Per Chris: a simpler, no-forward-looking view of the resume as it
  // stands today. actWins/losses/avgActLine/atsMargin were already
  // completed-only in both modes, so those are unaffected.
  completedOnly = false,
  // team -> season net success rate (percentage points), from the per-game
  // advanced stats pull (Team Info).
  netSrByTeam: Record<string, number | null> = {},
  // team -> latest saved SOS value from the SOS admin page's Save to Site.
  sosByTeam: Record<string, number | null> = {},
  extra: ResumeExtraInputs = {}
): RawResumeMetrics {
  const ratingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;
  const teamRating = ratingFor(team.team, team.rating);

  const teamGames = seasonGames.filter((g) => g.home_team === team.team || g.away_team === team.team);
  const completedGames = teamGames.filter((g) => g.completed && g.home_points != null && g.away_points != null);
  const seasonWideGames = completedOnly ? completedGames : teamGames;

  // Avg Projected Line and Avg Opponent PR are season-wide — every game
  // on the schedule, played or not, using each opponent's CURRENT rating.
  //
  // Projected Wins/Losses is a rest-of-season blend: completed games
  // count as their real result (1 win or 1 loss), remaining games count
  // as that game's current win probability — so this starts the season
  // equal to a pure preseason projection and gradually converges toward
  // the real record as games are played.
  //
  // MOV is a TEMPORARY stand-in for now, per instruction: sum (not
  // average) of each game's projected margin of victory, across the
  // whole season — a rough proxy while there aren't enough real results
  // yet. Swap this back to a real completed-games average margin once
  // games start.
  let sumProjLine = 0;
  let projLineN = 0;
  let sumOppPR = 0;
  let oppPRN = 0;
  let sumProjMov = 0;
  let restProjWins = 0;
  let restProjLosses = 0;
  let expWins = 0;
  let pgweGames = 0;
  const bubble = extra.bubbleRating ?? null;
  let wab = 0;
  let wabN = 0;
  // Margin of victory: real margin for played games; projected mode also counts each remaining game's projected
  // margin. Averaged per game.
  let sumMargin = 0;
  let marginN = 0;

  for (const g of seasonWideGames) {
    const isHome = g.home_team === team.team;
    const oppName = isHome ? g.away_team : g.home_team;
    const opponent = TEAMS_BY_NAME[oppName];
    if (!opponent) continue;

    const oppRating = ratingFor(oppName, opponent.rating);
    const projLine = isHome
      ? teamRating - oppRating - hfaFor(team.team, liveByTeam)
      : teamRating - oppRating + hfaFor(oppName, liveByTeam);
    sumProjLine += projLine;
    projLineN++;
    sumOppPR += oppRating;
    oppPRN++;
    sumProjMov += -projLine; // negative spread = favored, so -projLine = this game's expected margin

    const isCompleted = g.completed && g.home_points != null && g.away_points != null;
    // The same game for a bubble team: its rating in place of this team's, same site.
    const bubbleLine =
      bubble == null ? null : isHome ? bubble - oppRating - hfaFor(team.team, liveByTeam) : bubble - oppRating + hfaFor(oppName, liveByTeam);
    if (!isCompleted) {
      const winPct = spreadToWinPct(projLine);
      restProjWins += winPct;
      restProjLosses += 1 - winPct;
      sumMargin += -projLine;
      marginN++;
      if (bubbleLine != null) {
        wab += winPct - spreadToWinPct(bubbleLine);
        wabN++;
      }
    } else if (bubbleLine != null) {
      const teamScore = isHome ? g.home_points! : g.away_points!;
      const oppScore = isHome ? g.away_points! : g.home_points!;
      wab += (teamScore > oppScore ? 1 : teamScore === oppScore ? 0.5 : 0) - spreadToWinPct(bubbleLine);
      wabN++;
    }
  }

  // Everything else here needs a real result, so completed games only.
  let actWins = 0;
  let losses = 0;
  let sumActLine = 0;
  let actLineN = 0;
  let sumAts = 0;
  let atsN = 0;

  for (const g of completedGames) {
    const isHome = g.home_team === team.team;

    const teamScore = isHome ? g.home_points! : g.away_points!;
    const oppScore = isHome ? g.away_points! : g.home_points!;
    if (teamScore > oppScore) actWins++;
    else if (teamScore < oppScore) losses++;

    // Real actual margin, still used for ATS margin below — once games
    // start, sum these (or average, matching the original design) and
    // return that as `mov` instead of the projected-sum stand-in above.
    const mov = teamScore - oppScore;
    sumMargin += mov;
    marginN++;

    // Postgame win expectancy (CFBD): the team's win probability given how
    // the game actually played out — summed over played games it's the wins
    // the season "deserved", vs. the real actWins.
    const pgwe = isHome ? g.home_postgame_win_probability : g.away_postgame_win_probability;
    if (pgwe != null) {
      expWins += pgwe;
      pgweGames++;
    }

    const line = pickLine(g.lines ?? []);
    if (line?.spread != null) {
      const teamLine = isHome ? line.spread : -line.spread;
      sumActLine += teamLine;
      actLineN++;
      sumAts += mov + teamLine;
      atsN++;
    }
  }

  const bw = computeBestWorst(team, seasonGames, liveByTeam);
  // .proj includes hypothetical results for games that haven't been played
  // yet (win/loss decided by which side the model favors); .actual is
  // real completed games only — the one completedOnly needs.
  const bwBestWin = completedOnly ? bw.bestWin.actual : bw.bestWin.proj;
  const bwBestLoss = completedOnly ? bw.bestLoss.actual : bw.bestLoss.proj;
  const bwWorstLoss = completedOnly ? bw.worstLoss.actual : bw.worstLoss.proj;

  // Projected finish: the latest Monte Carlo run's mean regular-season wins (real results so far plus the simulated
  // rest of the season) when the sim has this team; else each remaining game's win probability.
  const mc = extra.mc?.[team.team];
  const totalGames = actWins + losses + restProjWins + restProjLosses;
  const totalProjWins = mc?.meanWins != null ? mc.meanWins : actWins + restProjWins;
  const totalProjLosses = mc?.meanWins != null ? Math.max(0, totalGames - mc.meanWins) : losses + restProjLosses;

  return {
    expWins: pgweGames > 0 ? expWins : null,
    actWins,
    losses,
    projWins: Math.max(0, totalProjWins - actWins),
    projLosses: Math.max(0, totalProjLosses - losses),
    totalProjWins,
    totalProjLosses,
    winLossDiff: actWins - losses,
    wab: wabN > 0 ? wab : null,
    confChampWinPct: mc?.confTitlePct != null ? mc.confTitlePct / 100 : (liveByTeam[team.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[team.team]?.confWinPct ?? null),
    powerRating: teamRating,
    srs: srsByTeam[team.team] ?? null,
    vsrs: vsrsByTeam[team.team] ?? null,
    avgProjLine: projLineN > 0 ? sumProjLine / projLineN : null,
    avgActLine: actLineN > 0 ? sumActLine / actLineN : null,
    mov: marginN > 0 ? sumMargin / marginN : sumProjMov,
    atsMargin: atsN > 0 ? sumAts / atsN : null,
    netSr: netSrByTeam[team.team] ?? null,
    avgOppPR: oppPRN > 0 ? sumOppPR / oppPRN : null,
    sos: sosByTeam[team.team] ?? null,
    bestWin: bwBestWin?.oppCurrentRating ?? null,
    bestLoss: bwBestLoss?.oppCurrentRating ?? null,
    worstLoss: bwWorstLoss?.oppCurrentRating ?? null,
  };
}

export function normalize(value: number | null, allValues: (number | null)[], higherIsBetter: boolean): number | null {
  if (value == null) return null;
  const valid = allValues.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) return 5.5;
  const pct = (value - min) / (max - min);
  const directed = higherIsBetter ? pct : 1 - pct;
  return 1 + directed * 9;
}

// bestLoss/worstLoss can only be null for one reason: the team has no
// losses at all (see computeBestWorst — there's no other way to get
// null here). Having zero losses is strictly better than any possible
// "quality of loss," so it should score the maximum (10), not get
// excluded from the average like a genuinely missing value would.
export const NULL_MEANS_BEST: (keyof RawResumeMetrics)[] = ["bestLoss", "worstLoss"];

export function normalizeMetric(
  key: keyof RawResumeMetrics,
  value: number | null,
  allValues: (number | null)[],
  higherIsBetter: boolean
): number | null {
  if (value == null && NULL_MEANS_BEST.includes(key)) return 10;
  return normalize(value, allValues, higherIsBetter);
}

export type ResumeWeights = Record<string, number>;

export const DEFAULT_RESUME_WEIGHTS: ResumeWeights = Object.fromEntries(METRIC_KEYS.map((k) => [k, 1]));

export function computeConglomerateScore(
  normalizedMetrics: Partial<Record<keyof RawResumeMetrics, number | null>>,
  weights: ResumeWeights
): number | null {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of METRIC_KEYS) {
    const norm = normalizedMetrics[key];
    const w = weights[key] ?? 0;
    if (norm == null || w === 0) continue;
    weightedSum += norm * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return null;
  // Weighted average of 1-10 normalized metrics, times 10 — a 10-100
  // scale rather than 1-10, per instruction.
  return (weightedSum / weightTotal) * 10;
}


// ---------------------------------------------------------------------
// Two résumés, scored by buckets.
//   "sofar"     — completed games only: what the team has accomplished.
//   "projected" — every completed game plus the rest of the season simulated (latest Monte Carlo run).
// Metrics are normalized 1–10 across the division, averaged inside their bucket (each metric with its own weight),
// then the buckets are combined with the bucket weights. Bucketing stops a family of near-duplicate metrics (seven
// flavors of record, eight of team strength) from outweighing schedule just by count.
// ---------------------------------------------------------------------

export interface ResumeExtraInputs {
  /** Power rating of the bubble team (12th-best FBS), for Wins Above Bubble. */
  bubbleRating?: number | null;
  /** Latest Monte Carlo run by team: mean regular-season wins and conference title % (0–100). */
  mc?: Record<string, { meanWins: number | null; confTitlePct: number | null }>;
}

export type ResumeMode = "sofar" | "projected";
export type BucketKey = "record" | "quality" | "schedule" | "control" | "strength" | "title";

// Rest-of-season metrics only exist in the projected résumé.
const PROJECTED_ONLY: (keyof RawResumeMetrics)[] = ["projWins", "projLosses", "totalProjWins", "totalProjLosses"];

export const RESUME_BUCKETS: { key: BucketKey; label: string; metrics: (keyof RawResumeMetrics)[] }[] = [
  { key: "record", label: "Record", metrics: ["actWins", "losses", "winLossDiff", "wab", "projWins", "projLosses", "totalProjWins", "totalProjLosses"] },
  { key: "quality", label: "Quality results", metrics: ["bestWin", "bestLoss", "worstLoss"] },
  { key: "schedule", label: "Schedule", metrics: ["sos", "avgOppPR"] },
  { key: "control", label: "Game control", metrics: ["mov", "netSr", "expWins", "atsMargin"] },
  { key: "strength", label: "Team strength", metrics: ["powerRating", "srs", "vsrs", "avgActLine", "avgProjLine"] },
  { key: "title", label: "Title path", metrics: ["confChampWinPct"] },
];

export function bucketMetrics(bucket: BucketKey, mode: ResumeMode): (keyof RawResumeMetrics)[] {
  const b = RESUME_BUCKETS.find((x) => x.key === bucket)!;
  return mode === "sofar" ? b.metrics.filter((m) => !PROJECTED_ONLY.includes(m)) : b.metrics;
}

export interface ResumeWeightConfig {
  buckets: Record<BucketKey, number>;
  metrics: Record<string, number>;
}

export const DEFAULT_BUCKET_WEIGHTS: Record<ResumeMode, Record<BucketKey, number>> = {
  sofar: { record: 30, quality: 25, schedule: 20, control: 15, strength: 10, title: 0 },
  projected: { record: 30, quality: 15, schedule: 15, control: 10, strength: 20, title: 10 },
};

export function defaultResumeConfig(mode: ResumeMode): ResumeWeightConfig {
  return { buckets: { ...DEFAULT_BUCKET_WEIGHTS[mode] }, metrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, 1])) };
}

/** Saved weights (resume_rating_weights.weights) for one mode; anything missing falls back to the defaults. */
export function resumeConfigFrom(saved: any, mode: ResumeMode): ResumeWeightConfig {
  const base = defaultResumeConfig(mode);
  const m = saved?.v === 2 ? saved[mode] : null;
  if (!m) return base;
  return { buckets: { ...base.buckets, ...(m.buckets ?? {}) }, metrics: { ...base.metrics, ...(m.metrics ?? {}) } };
}

/** Per-bucket 1–10 scores and the overall 10–100 score. */
export function computeBucketedScore(
  normalized: Partial<Record<keyof RawResumeMetrics, number | null>>,
  config: ResumeWeightConfig,
  mode: ResumeMode
): { score: number | null; buckets: Record<BucketKey, number | null> } {
  const buckets = {} as Record<BucketKey, number | null>;
  let sum = 0;
  let total = 0;
  for (const b of RESUME_BUCKETS) {
    let bs = 0;
    let bw = 0;
    for (const m of bucketMetrics(b.key, mode)) {
      const v = normalized[m];
      const w = config.metrics[m] ?? 0;
      if (v == null || w <= 0) continue;
      bs += v * w;
      bw += w;
    }
    const bucketScore = bw > 0 ? bs / bw : null;
    buckets[b.key] = bucketScore;
    const W = config.buckets[b.key] ?? 0;
    if (bucketScore != null && W > 0) {
      sum += bucketScore * W;
      total += W;
    }
  }
  return { score: total > 0 ? (sum / total) * 10 : null, buckets };
}
