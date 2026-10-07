import { PERIOD_MODEL_VERSION, buildPeriodDistribution, summarize } from "./periodSim";

/**
 * A period_projection_locks row for one game, built from the same "my" spread and
 * total the game lock stores — used so freezing a game from Freeze Week locks its
 * 1H/2H/quarter projections in the same step (the Period Projections page's own
 * Lock button builds identical rows).
 */
export function buildPeriodLockCandidate(g: {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  homeSpread: number; // negative = home favored
  total: number;
}): Record<string, unknown> {
  const dist = buildPeriodDistribution({ homeSpread: g.homeSpread, total: g.total, neutralSite: g.neutralSite });
  const one = (k: "h1" | "h2" | "q1" | "q2" | "q3" | "q4") => {
    const s = summarize(dist, k);
    return { spread: s.meanAwaySpread, total: s.meanTotal };
  };
  const h1 = one("h1");
  const h2 = one("h2");
  const q1 = one("q1");
  const q2 = one("q2");
  const q3 = one("q3");
  const q4 = one("q4");
  return {
    game_id: g.gameId,
    season: g.season,
    week: g.week,
    home_team: g.homeTeam,
    away_team: g.awayTeam,
    neutral_site: g.neutralSite,
    game_home_spread: g.homeSpread,
    game_total: g.total,
    ridge_model_version: PERIOD_MODEL_VERSION,
    h1_away_spread: h1.spread,
    h1_total: h1.total,
    h2_away_spread: h2.spread,
    h2_total: h2.total,
    q1_away_spread: q1.spread,
    q1_total: q1.total,
    q2_away_spread: q2.spread,
    q2_total: q2.total,
    q3_away_spread: q3.spread,
    q3_total: q3.total,
    q4_away_spread: q4.spread,
    q4_total: q4.total,
  };
}
