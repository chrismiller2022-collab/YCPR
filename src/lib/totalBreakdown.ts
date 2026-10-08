// Shared by the Hypothetical Matchup tab and the totals popups: loads this season's team inputs, builds the
// league pool, and runs the Ridge totals model with every intermediate number kept so the work can be shown.
import { useEffect, useMemo, useState } from "react";
import { fetchTeamSeasonInputs } from "./api/gameTotalsData";
import { buildRidgeTotalInput, computeLeagueAverages, resolveGameOdds, type LeagueAverages, type TeamSeasonInputs } from "./gameTotals";
import { explainGameTotalRidge, type RidgeFeatureStep, type RidgeTotalBreakdown } from "./totalModelRidge";

export function useSeasonPool(season: number) {
  const [teamInputs, setTeamInputs] = useState<Record<string, TeamSeasonInputs>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTeamSeasonInputs(season)
      .then((m) => {
        if (!cancelled) setTeamInputs(m);
      })
      .catch(() => {
        if (!cancelled) setTeamInputs({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);
  const league: LeagueAverages | null = useMemo(() => {
    const values = Object.values(teamInputs);
    return values.length > 0 ? computeLeagueAverages(values) : null;
  }, [teamInputs]);
  return { teamInputs, league, loading };
}

export interface TotalBreakdownInput {
  home: string;
  away: string;
  marketTotal: number | null; // null = the model's training-average market (53.3)
  neutral: boolean;
  homeRest: number;
  awayRest: number;
}

export interface TotalBreakdownResult {
  home: TeamSeasonInputs;
  away: TeamSeasonInputs;
  breakdown: RidgeTotalBreakdown; // with the market total (if any)
  noMarket: RidgeTotalBreakdown; // same stats, market input left blank — what the team stats alone say
}

export function computeTotalBreakdown(
  teamInputs: Record<string, TeamSeasonInputs>,
  league: LeagueAverages | null,
  input: TotalBreakdownInput
): TotalBreakdownResult | null {
  const home = teamInputs[input.home];
  const away = teamInputs[input.away];
  if (!league || !home || !away || input.home === input.away) return null;
  const ctx = { homeFlag: input.neutral ? 0.5 : 1.0, homeRestDays: input.homeRest, awayRestDays: input.awayRest };
  const withMarket = explainGameTotalRidge(buildRidgeTotalInput(home, away, league, resolveGameOdds(input.marketTotal, null), ctx));
  const noMarket = explainGameTotalRidge(buildRidgeTotalInput(home, away, league, resolveGameOdds(null, null), ctx));
  return { home, away, breakdown: withMarket, noMarket };
}

export function useTotalBreakdown(season: number, input: TotalBreakdownInput | null) {
  const { teamInputs, league, loading } = useSeasonPool(season);
  const result = useMemo(
    () => (input ? computeTotalBreakdown(teamInputs, league, input) : null),
    [teamInputs, league, input?.home, input?.away, input?.marketTotal, input?.neutral, input?.homeRest, input?.awayRest] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { result, league, loading };
}

// The inputs that moved the projection most (by points), excluding the intercept.
export function topDrivers(b: RidgeTotalBreakdown, n = 3): RidgeFeatureStep[] {
  return [...b.steps].sort((a, c) => Math.abs(c.contribution) - Math.abs(a.contribution)).slice(0, n);
}
