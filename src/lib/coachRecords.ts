// Pure helpers for "record under the current head coach": grading a game
// SU/ATS from the coach_game_log view and bucketing it by favorite/underdog,
// home/away and the four combinations. Shared by the all-teams Coach Records
// table, the admin team overview and the matchup preview popup.

import { supabase } from "./supabaseClient";
import { fetchAllRows } from "./api/fetchAll";

export interface LogRow {
  team: string;
  coach_name: string;
  first_year_at_school: number | null;
  game_id: string;
  season: number;
  week: number;
  season_type: string;
  location: "home" | "away" | "neutral";
  opponent: string;
  team_points: number;
  opp_points: number;
  close_spread: number | null;
  open_spread: number | null;
  line_provider: string | null;
}

export interface Rec {
  w: number;
  l: number;
  p: number;
}
export const empty = (): Rec => ({ w: 0, l: 0, p: 0 });

export const SPLITS = [
  { key: "all", label: "Overall" },
  { key: "fav", label: "Fav" },
  { key: "dog", label: "Dog" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "homeFav", label: "Home Fav" },
  { key: "homeDog", label: "Home Dog" },
  { key: "awayFav", label: "Away Fav" },
  { key: "awayDog", label: "Away Dog" },
] as const;
export type SplitKey = (typeof SPLITS)[number]["key"];

export type Outcome = "W" | "L" | "P" | null;

export function grade(g: LogRow, spread: number | null) {
  const margin = g.team_points - g.opp_points;
  const su: Outcome = margin > 0 ? "W" : margin < 0 ? "L" : "P";
  let ats: Outcome = null;
  if (spread != null) {
    const v = margin + spread;
    ats = v > 0 ? "W" : v < 0 ? "L" : "P";
  }
  return { su, ats };
}

// Which splits a game counts toward. Fav/dog needs a line (and a non-zero
// spread); home/away excludes neutral-site games.
export function splitsFor(g: LogRow, spread: number | null): SplitKey[] {
  const out: SplitKey[] = ["all"];
  const role = spread == null || spread === 0 ? null : spread < 0 ? "Fav" : "Dog";
  if (role) out.push(role === "Fav" ? "fav" : "dog");
  if (g.location === "home" || g.location === "away") {
    out.push(g.location);
    if (role) out.push(`${g.location}${role}` as SplitKey);
  }
  return out;
}

export function add(r: Rec, o: Outcome) {
  if (o === "W") r.w += 1;
  else if (o === "L") r.l += 1;
  else if (o === "P") r.p += 1;
}
export function fmtRec(r: Rec) {
  return r.w + r.l + r.p === 0 ? "–" : `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
}
export function winPct(r: Rec): number | null {
  return r.w + r.l === 0 ? null : r.w / (r.w + r.l);
}

export interface CoachBuckets {
  games: number;
  graded: number; // games with a line (ATS-gradable)
  su: Record<SplitKey, Rec>;
  ats: Record<SplitKey, Rec>;
}

/** Tally a set of coach_game_log rows into every split, SU and ATS. */
export function tallyCoachRows(rows: LogRow[], lineMode: "close" | "open"): CoachBuckets {
  const out: CoachBuckets = {
    games: 0,
    graded: 0,
    su: Object.fromEntries(SPLITS.map((s) => [s.key, empty()])) as Record<SplitKey, Rec>,
    ats: Object.fromEntries(SPLITS.map((s) => [s.key, empty()])) as Record<SplitKey, Rec>,
  };
  for (const g of rows) {
    const spread = lineMode === "open" ? g.open_spread : g.close_spread;
    const { su, ats } = grade(g, spread);
    out.games += 1;
    if (ats) out.graded += 1;
    for (const k of splitsFor(g, spread)) {
      add(out.su[k], su);
      if (ats) add(out.ats[k], ats);
    }
  }
  return out;
}

/** Every completed game since the team's current head coach arrived (one team), straight from the coach_game_log view. */
export async function fetchCoachGameLog(team: string): Promise<LogRow[]> {
  return fetchAllRows<LogRow>((from, to) =>
    supabase
      .from("coach_game_log")
      .select("team, coach_name, first_year_at_school, game_id, season, week, season_type, location, opponent, team_points, opp_points, close_spread, open_spread, line_provider")
      .eq("team", team)
      .order("game_id")
      .range(from, to)
  );
}
