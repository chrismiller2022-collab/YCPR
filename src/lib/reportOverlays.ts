import { supabase } from "./supabaseClient";
import { fetchAllRows } from "./api/fetchAll";
import { TEAMS_BY_NAME } from "../data/teams";
import { computeRow } from "./matchupsCompute";
import type { GameWithLines } from "./api/gamesLines";

// ---------------------------------------------------------------------
// Data the weekly report needs that the legacy weekly_team_stats upload no
// longer carries. weekly_team_stats only has resume / SOS / win totals for
// preseason and week 1; from week 2 on, resume lives in team_resume_ratings,
// SOS in team_sos (blend_score), and win totals aren't stored at all. These
// helpers layer the saved/computed values on top of the report's per-team
// rows so the report doesn't read zeros.
// ---------------------------------------------------------------------

export interface SavedMetricOverlay {
  week: number | null; // the saved week actually used (latest saved at or before the report week)
  byTeam: Record<string, number>;
  rankByTeam: Record<string, number>; // 1 = best; resume only (FBS teams ranked among FBS)
  baselineWeek: number | null; // earliest saved week for this metric (null when it IS the current week, or only one exists)
  baselineByTeam: Record<string, number>;
  // Every saved week at or before the report week, for week-over-week changes.
  byWeek: Record<number, Record<string, number>>;
}

export interface ReportOverlay {
  resume: SavedMetricOverlay;
  sos: SavedMetricOverlay;
}

const EMPTY_METRIC: SavedMetricOverlay = { week: null, byTeam: {}, rankByTeam: {}, baselineWeek: null, baselineByTeam: {}, byWeek: {} };

function pickWeeks(rows: { week: number; team: string; value: number }[], throughWeek: number): SavedMetricOverlay {
  const eligible = rows.filter((r) => r.week <= throughWeek);
  if (eligible.length === 0) return EMPTY_METRIC;
  const weeks = Array.from(new Set(eligible.map((r) => r.week))).sort((a, b) => a - b);
  const latest = weeks[weeks.length - 1];
  const earliest = weeks[0];
  const byTeam: Record<string, number> = {};
  for (const r of eligible) if (r.week === latest) byTeam[r.team] = r.value;
  const baselineByTeam: Record<string, number> = {};
  if (earliest !== latest) for (const r of eligible) if (r.week === earliest) baselineByTeam[r.team] = r.value;
  const byWeek: Record<number, Record<string, number>> = {};
  for (const r of eligible) (byWeek[r.week] ??= {})[r.team] = r.value;
  return { week: latest, byTeam, rankByTeam: {}, baselineWeek: earliest !== latest ? earliest : null, baselineByTeam, byWeek };
}

/** team -> (value at `curWeek`) - (value at `cmpWeek`), each resolved to the latest saved snapshot at or before that week. Empty when either side has no snapshot, or both resolve to the same one. */
export function savedChangeBetween(m: SavedMetricOverlay, curWeek: number, cmpWeek: number): Record<string, { change: number | null }> {
  const weeks = Object.keys(m.byWeek).map(Number).sort((a, b) => a - b);
  const at = (w: number) => [...weeks].reverse().find((x) => x <= w) ?? null;
  const cur = at(curWeek);
  const cmp = at(cmpWeek);
  if (cur == null || cmp == null || cur === cmp) return {};
  const out: Record<string, { change: number | null }> = {};
  for (const [team, v] of Object.entries(m.byWeek[cur])) {
    const prev = m.byWeek[cmp][team];
    out[team] = { change: prev != null ? v - prev : null };
  }
  return out;
}

/** team -> change since the earliest saved snapshot (empty when only one snapshot exists). */
export function savedChangeSinceStart(m: SavedMetricOverlay): Record<string, { change: number | null }> {
  const out: Record<string, { change: number | null }> = {};
  if (m.baselineWeek == null) return out;
  for (const [team, v] of Object.entries(m.byTeam)) {
    const base = m.baselineByTeam[team];
    out[team] = { change: base != null ? v - base : null };
  }
  return out;
}

/**
 * Saved Resume Rating and SOS Blend for the report week: the latest snapshot
 * saved at or before `weekNum`, plus the earliest saved one as the baseline
 * for "since the start" gainers/losers. The baseline is the earliest snapshot
 * IN THE SAME TABLE on purpose — the preseason resume/SOS in weekly_team_stats
 * was computed a different way, so differences against it wouldn't mean
 * anything.
 */
export async function fetchReportOverlay(season: number, weekNum: number): Promise<ReportOverlay> {
  const [resumeRows, sosRows] = await Promise.all([
    fetchAllRows<{ week: number; team: string; score: number | null }>((from, to) =>
      supabase.from("team_resume_ratings").select("week, team, score").eq("season", season).lte("week", weekNum).order("id").range(from, to)
    ),
    fetchAllRows<{ week: number; team: string; blend_score: number | null }>((from, to) =>
      supabase.from("team_sos").select("week, team, blend_score").eq("season", season).lte("week", weekNum).not("blend_score", "is", null).order("id").range(from, to)
    ),
  ]);

  const resume = pickWeeks(
    resumeRows.filter((r) => r.score != null).map((r) => ({ week: r.week, team: r.team, value: r.score as number })),
    weekNum
  );
  // Rank FBS teams among FBS teams (higher score = better); weeks 3-4 also saved FCS rows.
  const fbs = Object.entries(resume.byTeam).filter(([team]) => TEAMS_BY_NAME[team]?.div === "FBS").sort((a, b) => b[1] - a[1]);
  fbs.forEach(([team], i) => {
    resume.rankByTeam[team] = i + 1;
  });

  const sos = pickWeeks(
    sosRows.filter((r) => r.blend_score != null).map((r) => ({ week: r.week, team: r.team, value: r.blend_score as number })),
    weekNum
  );
  return { resume, sos };
}

export interface ProjectedWins {
  wins: number; // real wins so far (games completed through the report week)
  losses: number;
  winsLeft: number; // sum of win probabilities over every game not yet decided as of the report week
  gamesLeft: number;
  projTotal: number; // wins + winsLeft — projected end-of-season wins
  projLosses: number; // losses + (gamesLeft - winsLeft)
}

/**
 * Win totals straight from power ratings: games already played count as full
 * wins/losses, every remaining game counts as its win probability (the site's
 * Bill R win % off the report week's ratings, with team home-field values).
 * Games after `throughWeek` count as remaining even if they have since been
 * played, so regenerating an older week's report doesn't leak results.
 * Games involving a team with no rating (e.g. a non-FBS/FCS opponent) can't be
 * projected and are left out of the remaining count.
 */
export function computeProjectedWins(
  games: GameWithLines[],
  ratingsByTeam: Record<string, any>,
  throughWeek: number | null
): Record<string, ProjectedWins> {
  const acc: Record<string, { wins: number; losses: number; winsLeft: number; gamesLeft: number }> = {};
  const rec = (team: string) => (acc[team] ??= { wins: 0, losses: 0, winsLeft: 0, gamesLeft: 0 });

  for (const g of games) {
    const decided = g.completed && g.home_points != null && g.away_points != null && g.home_points !== g.away_points && (throughWeek == null || g.week <= throughWeek);
    if (decided) {
      const homeWon = (g.home_points as number) > (g.away_points as number);
      const h = rec(g.home_team);
      const a = rec(g.away_team);
      if (homeWon) {
        h.wins++;
        a.losses++;
      } else {
        a.wins++;
        h.losses++;
      }
      continue;
    }
    const row = computeRow(g, ratingsByTeam, "team", undefined, null);
    if (row.projWinPct == null) continue;
    const away = rec(g.away_team);
    const home = rec(g.home_team);
    away.winsLeft += row.projWinPct;
    away.gamesLeft++;
    home.winsLeft += 1 - row.projWinPct;
    home.gamesLeft++;
  }

  const out: Record<string, ProjectedWins> = {};
  for (const [team, r] of Object.entries(acc)) {
    out[team] = {
      wins: r.wins,
      losses: r.losses,
      winsLeft: r.winsLeft,
      gamesLeft: r.gamesLeft,
      projTotal: r.wins + r.winsLeft,
      projLosses: r.losses + (r.gamesLeft - r.winsLeft),
    };
  }
  return out;
}
