import { useEffect, useMemo, useState } from "react";
import { useWeeklyStats } from "../api/weeklyStats";
import { fetchHfaSettings, fetchTeamHfa, indexTeamHfa, type HfaBySource } from "../api/teamHfa";
import { DEFAULT_HFA_SETTINGS, teamHfa, type HfaSettings } from "../hfaBacktest";
import type { FieldTeam } from "./types";

// This site's own CFB numbers for the Calcutta Desk and practice bots:
//   rating — the latest saved week's power rating (spread-style, lower =
//            better, so it's flipped to "points better than average")
//   hfa    — the site's Team HFA blend (Massey / TR / blue-chip, with the
//            season's saved weights), the same number the Conferences page
//            uses; weekly_team_stats.hfa is empty, so it's read from team_hfa.

/** The CFB season a date belongs to (a January playoff is the previous fall's season). */
export function cfbSeasonFor(d = new Date()): number {
  return d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
}

export interface SiteCfb {
  ratings: Record<string, { rating: number; sd: null }>;
  hfaByTeam: Record<string, number>;
  week: string | null;
  loading: boolean;
  error: string | null;
  missing: string[];
}

export function useSiteCfb(field: FieldTeam[], enabled: boolean): SiteCfb {
  const { byTeam, resolvedWeek, loading, error } = useWeeklyStats(enabled ? "latest" : "none");
  const [hfaIndex, setHfaIndex] = useState<HfaBySource | null>(null);
  const [hfaSettings, setHfaSettings] = useState<HfaSettings>(DEFAULT_HFA_SETTINGS);
  const season = cfbSeasonFor();
  useEffect(() => {
    if (!enabled) return;
    fetchTeamHfa(season)
      .then((r) => setHfaIndex(indexTeamHfa(r)))
      .catch(() => setHfaIndex({}));
    fetchHfaSettings(season)
      .then((x) => x && setHfaSettings({ ...DEFAULT_HFA_SETTINGS, ...x, weights: { ...DEFAULT_HFA_SETTINGS.weights, ...(x.weights ?? {}) } } as HfaSettings))
      .catch(() => {});
  }, [enabled, season]);

  const fieldKey = field.map((t) => t.id).join("|");
  const weekNum = Number(/^week(\d+)$/.exec(resolvedWeek ?? "")?.[1] ?? 99);
  return useMemo(() => {
    const ratings: SiteCfb["ratings"] = {};
    const hfaByTeam: Record<string, number> = {};
    const missing: string[] = [];
    if (enabled) {
      for (const t of field) {
        const row: any = (byTeam as any)?.[t.name];
        if (row?.rating != null && Number.isFinite(Number(row.rating))) ratings[t.id] = { rating: -Number(row.rating), sd: null };
        else missing.push(t.name);
        if (hfaIndex) {
          const v = teamHfa({ index: hfaIndex, elevationM: {} }, hfaSettings, t.name, weekNum);
          if (Number.isFinite(v)) hfaByTeam[t.id] = v;
        }
      }
    }
    return { ratings, hfaByTeam, week: resolvedWeek, loading, error, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fieldKey, byTeam, hfaIndex, hfaSettings, resolvedWeek, loading, error]);
}
