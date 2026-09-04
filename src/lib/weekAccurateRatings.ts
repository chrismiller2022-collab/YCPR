import { useEffect, useState } from "react";
import { fetchAvailableWeeks, fetchWeeklyStats, type WeeklyTeamStats } from "./api/weeklyStats";
import { fetchSeasonAvailableWeeks, fetchSeasonWeeklyRatingsForWeeks } from "./api/seasonWeeklyRatings";

// This is the fix for the "Iowa State's rating is static all season" bug:
// every per-game projection on the site used to ask for "latest" ratings
// regardless of which week the game was actually in, so a Week 3 game's
// numbers kept silently changing every time Week 4, 5, 6... got uploaded.
// The rule here instead: a game in week N always uses the LATEST
// available snapshot with week_number <= N — so it locks in permanently
// once week N's own snapshot exists, and never jumps ahead to a future
// week even mid-week before that week's upload lands.
//
// Works for both the live current season (weekly_team_stats, keyed by
// week label) and any archived past season (season_weekly_ratings, keyed
// by season + week_number) — same resolution rule either way, just a
// different backing table.
//
// SECOND fix, layered on top of the first (see chat, Sept 2026): for the
// CURRENT season specifically, a week that's been explicitly "Saved As
// Week N" (season_weekly_ratings has a real row for season+that exact
// week_number) is now checked FIRST and used unconditionally — before
// this fix, the current season NEVER consulted the archive at all,
// always reading the live, mutable weekly_team_stats table regardless of
// whether that week had already been "saved." That meant re-pushing an
// updated snapshot under the same week label (exactly what incorporating
// actual results mid-week requires) silently changed every already-
// finalized week's numbers too — the archive existed and the save button
// worked, but nothing downstream ever actually looked at what it saved
// for the season that mattered most. Any week NOT yet explicitly saved
// (the current, actively-being-tuned week) still falls through to the
// existing live-label resolution below, unchanged.

export interface WeekAccurateRatingRow {
  rating: number | null;
}

function weekLabelToNumber(w: string): number {
  if (w === "preseason") return 0;
  const m = /^week(\d+)$/.exec(w);
  return m ? parseInt(m[1], 10) : -1;
}

function resolveLabelForWeek(availableWeeks: string[], targetWeekNumber: number): string | null {
  const withNumbers = availableWeeks.map((w) => ({ w, n: weekLabelToNumber(w) })).filter((x) => x.n >= 0);
  const atOrBefore = withNumbers.filter((x) => x.n <= targetWeekNumber).sort((a, b) => b.n - a.n);
  if (atOrBefore.length > 0) return atOrBefore[0].w;
  const earliest = [...withNumbers].sort((a, b) => a.n - b.n)[0];
  return earliest ? earliest.w : null;
}

/**
 * Given a season and a list of game-week numbers currently in view,
 * resolves the correct ratings-by-team snapshot for EACH week — not one
 * shared "latest" map for everything. Pass `game.week` per game when
 * looking up a team's rating for that specific game.
 */
export function useWeekAccurateRatings(season: number, weekNumbers: number[], currentSeason: number) {
  const [byWeek, setByWeek] = useState<Record<number, Record<string, WeekAccurateRatingRow>>>({});
  const [loading, setLoading] = useState(true);
  const key = Array.from(new Set(weekNumbers)).sort((a, b) => a - b).join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      const uniqueWeeks = Array.from(new Set(weekNumbers));
      const result: Record<number, Record<string, WeekAccurateRatingRow>> = {};

      if (uniqueWeeks.length === 0) {
        if (!cancelled) {
          setByWeek({});
          setLoading(false);
        }
        return;
      }

      if (season === currentSeason) {
        // Explicitly-saved weeks (via "Save As Week" on Rating Systems)
        // win unconditionally, regardless of anything pushed to the live
        // table afterward.
        const archivedWeekNumbers = new Set(await fetchSeasonAvailableWeeks(season));
        const explicitlyArchivedTargets = uniqueWeeks.filter((wn) => archivedWeekNumbers.has(wn));
        const needsLiveResolution = uniqueWeeks.filter((wn) => !archivedWeekNumbers.has(wn));

        let archivedResult: Record<number, Record<string, { rating: number | null }>> = {};
        if (explicitlyArchivedTargets.length > 0) {
          // Every target here is itself in archivedWeekNumbers, so this
          // function's own "closest saved week <= target" resolution
          // always resolves to exactly that week, never an earlier one.
          archivedResult = await fetchSeasonWeeklyRatingsForWeeks(season, explicitlyArchivedTargets);
        }

        let liveResult: Record<number, Record<string, WeekAccurateRatingRow>> = {};
        if (needsLiveResolution.length > 0) {
          const available = await fetchAvailableWeeks();
          const labelForWeek: Record<number, string | null> = {};
          const labelsNeeded = new Set<string>();
          for (const wn of needsLiveResolution) {
            const label = resolveLabelForWeek(available, wn);
            labelForWeek[wn] = label;
            if (label) labelsNeeded.add(label);
          }
          const statsByLabel: Record<string, WeeklyTeamStats[]> = {};
          await Promise.all(
            Array.from(labelsNeeded).map(async (label) => {
              statsByLabel[label] = await fetchWeeklyStats(label);
            })
          );
          for (const wn of needsLiveResolution) {
            const label = labelForWeek[wn];
            const rows = label ? statsByLabel[label] ?? [] : [];
            const map: Record<string, WeekAccurateRatingRow> = {};
            for (const r of rows) map[r.team] = { rating: r.rating };
            liveResult[wn] = map;
          }
        }

        for (const wn of uniqueWeeks) {
          result[wn] = archivedWeekNumbers.has(wn) ? archivedResult[wn] ?? {} : liveResult[wn] ?? {};
        }
      } else {
        const bySeasonWeek = await fetchSeasonWeeklyRatingsForWeeks(season, uniqueWeeks);
        for (const wn of uniqueWeeks) {
          result[wn] = bySeasonWeek[wn] ?? {};
        }
      }

      if (!cancelled) {
        setByWeek(result);
        setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, key, currentSeason]);

  return { byWeek, loading };
}
