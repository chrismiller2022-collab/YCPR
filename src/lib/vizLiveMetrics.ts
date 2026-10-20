import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { fetchGamesWithLines, type GameWithLines } from "./api/gamesLines";
import { fetchTeamSos } from "./api/ratingSystems";
import { fetchWinTotalLines } from "./api/winTotalLines";
import { fetchTeamGameAdvanced } from "./api/teamInfo";
import { pickVegasLine } from "./linePick";
import { HFA, spreadToWinPct } from "./odds";

// Team metrics for the Viz Builder computed from live data. The weekly stats table only carried these through week 1
// (later weeks hold ratings only), so reading them there came back empty.

export interface LiveTeamMetrics {
  sos: number | null; // saved SOS blend (SOS via SRS for weeks saved before the blend)
  projWins: number | null; // real wins + each remaining game's win probability from current ratings
  vegasWins: number | null; // saved Vegas win total line
  winsVsVegas: number | null; // projWins - vegasWins
  atsPct: number | null;
  atsMargin: number | null; // average (margin + line) per graded game
  hfa: number | null;
  netSr: number | null; // season average net success rate, percentage points
  avgPgwe: number | null; // average postgame win expectancy, 0-1
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function useVizLiveMetrics(season: number, ratingOf: (team: string) => number | null) {
  const [base, setBase] = useState<{
    games: GameWithLines[];
    sos: Record<string, number | null>;
    vegas: Record<string, number>;
    hfa: Record<string, number>;
    netSr: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchGamesWithLines(season),
      fetchTeamSos(season).catch(() => ({})),
      fetchWinTotalLines(season).catch(() => []),
      // Team HFA was last uploaded with the preseason/week 1 weekly stats; use each team's most recent value.
      supabase.from("weekly_team_stats").select("team, hfa, week_number").not("hfa", "is", null).order("week_number", { ascending: false }).limit(2000),
      fetchTeamGameAdvanced(season).catch(() => []),
    ])
      .then(([games, sosRows, lines, hfaRes, adv]) => {
        if (cancelled) return;
        const sos: Record<string, number | null> = {};
        for (const [team, row] of Object.entries(sosRows as Record<string, any>)) sos[team] = row.blend_score ?? row.sos_srs_total ?? null;
        const vegas: Record<string, number> = {};
        for (const l of lines as { team: string; line: number }[]) vegas[l.team] = l.line;
        const hfa: Record<string, number> = {};
        for (const r of (hfaRes.data ?? []) as { team: string; hfa: number }[]) if (hfa[r.team] == null) hfa[r.team] = Number(r.hfa);
        const acc = new Map<string, number[]>();
        for (const r of adv) if (r.net_success_rate != null) acc.set(r.team, [...(acc.get(r.team) ?? []), r.net_success_rate * 100]);
        const netSr: Record<string, number> = {};
        for (const [t, v] of acc) netSr[t] = mean(v)!;
        setBase({ games, sos, vegas, hfa, netSr });
      })
      .catch(() => !cancelled && setBase(null));
    return () => {
      cancelled = true;
    };
  }, [season]);

  if (!base) return {} as Record<string, LiveTeamMetrics>;
  const hfaOf = (t: string) => base.hfa[t] ?? HFA;
  const out: Record<string, LiveTeamMetrics> = {};
  const acc = new Map<string, { wins: number; rest: number; any: boolean; ats: number[]; atsW: number; atsL: number; pgwe: number[] }>();
  const get = (t: string) => {
    let a = acc.get(t);
    if (!a) acc.set(t, (a = { wins: 0, rest: 0, any: false, ats: [], atsW: 0, atsL: 0, pgwe: [] }));
    return a;
  };
  for (const g of base.games) {
    if (g.season_type && g.season_type !== "regular") continue;
    const final = g.completed && g.home_points != null && g.away_points != null;
    const line = pickVegasLine(g.lines ?? [], g.completed);
    for (const isHome of [true, false]) {
      const team = isHome ? g.home_team : g.away_team;
      const opp = isHome ? g.away_team : g.home_team;
      const a = get(team);
      if (final) {
        const margin = isHome ? g.home_points! - g.away_points! : g.away_points! - g.home_points!;
        if (margin > 0) a.wins++;
        a.any = true;
        const pg = isHome ? g.home_postgame_win_probability : g.away_postgame_win_probability;
        if (pg != null) a.pgwe.push(pg);
        if (line?.spread != null) {
          const teamLine = isHome ? line.spread : -line.spread;
          const cover = margin + teamLine;
          a.ats.push(cover);
          if (cover > 0) a.atsW++;
          else if (cover < 0) a.atsL++;
        }
      } else {
        const r = ratingOf(team);
        const o = ratingOf(opp);
        if (r == null || o == null) continue;
        // Negative spread = favored; the home side gets its own HFA.
        const spread = isHome ? r - o - (g.neutral_site ? 0 : hfaOf(team)) : r - o + (g.neutral_site ? 0 : hfaOf(opp));
        a.rest += spreadToWinPct(spread);
        a.any = true;
      }
    }
  }
  for (const [team, a] of acc) {
    const projWins = a.any ? a.wins + a.rest : null;
    const vegasWins = base.vegas[team] ?? null;
    out[team] = {
      sos: base.sos[team] ?? null,
      projWins,
      vegasWins,
      winsVsVegas: projWins != null && vegasWins != null ? projWins - vegasWins : null,
      atsPct: a.atsW + a.atsL > 0 ? a.atsW / (a.atsW + a.atsL) : null,
      atsMargin: mean(a.ats),
      hfa: base.hfa[team] ?? null,
      netSr: base.netSr[team] ?? null,
      avgPgwe: mean(a.pgwe),
    };
  }
  return out;
}
