import { TEAMS_BY_NAME } from "../data/teams";
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
// rating convention (Power Rating, SOS, opponent ratings in Best/Worst).
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
  sos: false,
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
  liveByTeam: Record<string, any>,
  confChampWinPct: number | null
): RawResumeMetrics {
  const ratingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;
  const teamRating = ratingFor(team.team, team.rating);

  const completedGames = seasonGames.filter(
    (g) =>
      (g.home_team === team.team || g.away_team === team.team) &&
      g.completed &&
      g.home_points != null &&
      g.away_points != null
  );

  let actWins = 0;
  let losses = 0;
  let sumProjLine = 0;
  let projLineN = 0;
  let sumActLine = 0;
  let actLineN = 0;
  let sumMov = 0;
  let movN = 0;
  let sumAts = 0;
  let atsN = 0;
  let sumOppPR = 0;
  let oppPRN = 0;

  for (const g of completedGames) {
    const isHome = g.home_team === team.team;
    const oppName = isHome ? g.away_team : g.home_team;
    const opponent = TEAMS_BY_NAME[oppName];

    const teamScore = isHome ? g.home_points! : g.away_points!;
    const oppScore = isHome ? g.away_points! : g.home_points!;
    if (teamScore > oppScore) actWins++;
    else if (teamScore < oppScore) losses++;

    const mov = teamScore - oppScore;
    sumMov += mov;
    movN++;

    if (opponent) {
      const oppRating = ratingFor(oppName, opponent.rating);
      const projLine = isHome
        ? teamRating - oppRating - hfaFor(team.team, liveByTeam)
        : teamRating - oppRating + hfaFor(oppName, liveByTeam);
      sumProjLine += projLine;
      projLineN++;
      sumOppPR += oppRating;
      oppPRN++;
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

  return {
    expWins: null,
    actWins,
    losses,
    confChampWinPct,
    powerRating: teamRating,
    srs: null,
    vsrs: null,
    avgProjLine: projLineN > 0 ? sumProjLine / projLineN : null,
    avgActLine: actLineN > 0 ? sumActLine / actLineN : null,
    mov: movN > 0 ? sumMov / movN : null,
    atsMargin: atsN > 0 ? sumAts / atsN : null,
    avgOppPR: oppPRN > 0 ? sumOppPR / oppPRN : null,
    sos: liveByTeam[team.team]?.sor ?? null,
    bestWin: bw.bestWin.actual?.oppCurrentRating ?? null,
    bestLoss: bw.bestLoss.actual?.oppCurrentRating ?? null,
    worstLoss: bw.worstLoss.actual?.oppCurrentRating ?? null,
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
  return weightedSum / weightTotal;
}
