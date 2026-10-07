// Preseason inputs (CFBD returning production, talent composite, recruiting class, transfer portal) as
// within-season z-scores. They matter most in weeks 1-3, before in-season efficiency has any sample, so
// the model fades them out with `earlyWeight`.
export interface RawPreseasonRow {
  season: number;
  team: string;
  returning_ppa_pct: number | null;
  talent: number | null;
  recruiting_points: number | null;
  portal_in_rating_sum: number | null;
  portal_out_rating_sum: number | null;
}
export type PreseasonZ = [talent: number, returning: number, portal: number, recruiting: number];
export const PRESEASON_FEATURES = ["talentΔ", "returningΔ", "portalΔ", "recruitingΔ"];

function zscores(values: (number | null)[]): number[] {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 10) return values.map(() => 0);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
  return values.map((x) => (x == null || !Number.isFinite(x) ? 0 : (x - mean) / sd));
}

// "season|team" -> z-scores (a missing input counts as an average team, z = 0)
export function buildPreseasonMap(rows: RawPreseasonRow[]): Map<string, PreseasonZ> {
  const out = new Map<string, PreseasonZ>();
  const seasons = Array.from(new Set(rows.map((r) => r.season)));
  for (const season of seasons) {
    const rs = rows.filter((r) => r.season === season);
    const talent = zscores(rs.map((r) => (r.talent == null ? null : Number(r.talent))));
    const ret = zscores(rs.map((r) => (r.returning_ppa_pct == null ? null : Number(r.returning_ppa_pct))));
    const portal = zscores(rs.map((r) => (r.portal_in_rating_sum == null && r.portal_out_rating_sum == null ? null : Number(r.portal_in_rating_sum ?? 0) - Number(r.portal_out_rating_sum ?? 0))));
    const rec = zscores(rs.map((r) => (r.recruiting_points == null ? null : Number(r.recruiting_points))));
    rs.forEach((r, i) => out.set(`${season}|${r.team}`, [talent[i], ret[i], portal[i], rec[i]]));
  }
  return out;
}

// Weight on preseason information: 1.0 in week 1, halves by week 4, ~0.3 by week 8.
export const earlyWeight = (week: number) => 3 / (3 + Math.max(0, week - 1));
