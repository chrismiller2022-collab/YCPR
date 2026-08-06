import { TEAMS_BY_NAME } from "../data/teams";
import { CONF_FUTURES_BY_TEAM } from "../data/confFutures";
import { hfaFor } from "./odds";
import { pickLine } from "./matchupsCompute";
import { computeBestWorst } from "./bestWorst";
import { type GameWithLines } from "./api/gamesLines";

export interface RawResumeMetrics {
  expWins: number | null;
  actWins: number;
  losses: number;
  confChampWinPct: number | null;
  powerRating: number;
  srs: number | null;
  vsrs: number | null;
  avgProjLine: number | null;
  avgActLine: number | null;
  mov: number | null;
  atsMargin: number | null;
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
  "confChampWinPct",
  "powerRating",
  "srs",
  "vsrs",
  "avgProjLine",
  "avgActLine",
  "mov",
  "atsMargin",
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
  confChampWinPct: "Conf. Champ Win %",
  powerRating: "Power Rating",
  srs: "SRS",
  vsrs: "VSRS",
  avgProjLine: "Avg. Projected Line",
  avgActLine: "Avg. Actual (Vegas) Line",
  mov: "Margin of Victory",
  atsMargin: "ATS Margin",
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
  confChampWinPct: true,
  powerRating: false,
  srs: false,
  vsrs: false,
  avgProjLine: false,
  avgActLine: false,
  mov: true,
  atsMargin: true,
  avgOppPR: false,
  sos: true, // SOS uses the OPPOSITE sign convention from power rating: positive = harder. A harder schedule is the better resume trait, so higher scores better here.
  bestWin: false,
  bestLoss: false,
  worstLoss: false,
};

// No real data source wired up yet. Weight sliders exist for these in the
// UI, but the value is always null until the upstream data exists:
// SRS/VSRS wait on the Monte Carlo SRS build, PGWE needs a CFBD sync
// change to pull postgame win probability (neither built yet).
export const STUBBED_METRICS: (keyof RawResumeMetrics)[] = ["expWins", "srs", "vsrs"];

export function computeRawResumeMetrics(
  team: any,
  seasonGames: GameWithLines[],
  liveByTeam: Record<string, any>
): RawResumeMetrics {
  const ratingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;
  const teamRating = ratingFor(team.team, team.rating);

  const teamGames = seasonGames.filter((g) => g.home_team === team.team || g.away_team === team.team);
  const completedGames = teamGames.filter((g) => g.completed && g.home_points != null && g.away_points != null);

  // Avg Projected Line and Avg Opponent PR are season-wide — every game
  // on the schedule, played or not, using each opponent's CURRENT rating.
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

  for (const g of teamGames) {
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

  return {
    expWins: null,
    actWins,
    losses,
    confChampWinPct: liveByTeam[team.team]?.conf_win_pct ?? CONF_FUTURES_BY_TEAM[team.team]?.confWinPct ?? null,
    powerRating: teamRating,
    srs: null,
    vsrs: null,
    avgProjLine: projLineN > 0 ? sumProjLine / projLineN : null,
    avgActLine: actLineN > 0 ? sumActLine / actLineN : null,
    mov: sumProjMov, // TEMPORARY: sum of projected margins for now — swap to real completed-games average margin once games start
    atsMargin: atsN > 0 ? sumAts / atsN : null,
    avgOppPR: oppPRN > 0 ? sumOppPR / oppPRN : null,
    sos: liveByTeam[team.team]?.sor ?? null,
    bestWin: bw.bestWin.proj?.oppCurrentRating ?? null,
    bestLoss: bw.bestLoss.proj?.oppCurrentRating ?? null,
    worstLoss: bw.worstLoss.proj?.oppCurrentRating ?? null,
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
