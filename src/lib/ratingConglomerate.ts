// Computes the conglomerated ratings table (YC + Consensus + every source
// system) from the live rating_pulls data + customizable weights. Pure
// functions — no fetching here, so this is easy to reuse for both the
// admin table view and (once a week is saved) the Matchups page's
// per-system projections.

import { TEAMS, TEAMS_BY_NAME } from "../data/teams";
import { CONSENSUS_INPUT_SYSTEMS, YC_INPUT_SYSTEMS } from "./ratingSystems";
import type { RatingPullRow } from "./api/ratingSystems";

export interface ConglomeratedRow {
  team: string;
  div: "FBS" | "FCS";
  conf: string;
  values: Record<string, number | null>; // every source system's value, null if not pulled for this team
  consensus: number | null;
  yc: number | null;
}

/** Weighted average over whatever inputs are actually present (renormalizes weights across available values — a team missing one system isn't penalized, it's just excluded from that average). */
function weightedAvg(entries: { value: number; weight: number }[]): number | null {
  const usable = entries.filter((e) => e.weight > 0);
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((s, e) => s + e.weight, 0);
  if (totalWeight === 0) return null;
  return usable.reduce((s, e) => s + e.value * e.weight, 0) / totalWeight;
}

function simpleAvg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function computeConglomeratedTable(
  pulls: RatingPullRow[],
  weights: Record<string, number>
): ConglomeratedRow[] {
  const byTeam = new Map<string, Record<string, number>>();
  for (const p of pulls) {
    const entry = byTeam.get(p.team) ?? {};
    entry[p.system_key] = p.value;
    byTeam.set(p.team, entry);
  }

  return TEAMS.map((t) => {
    const pulled = byTeam.get(t.team) ?? {};

    const values: Record<string, number | null> = {};
    for (const key of CONSENSUS_INPUT_SYSTEMS) {
      values[key] = pulled[key] ?? null;
    }

    const consensus = simpleAvg(CONSENSUS_INPUT_SYSTEMS.map((k) => pulled[k]).filter((v): v is number => v != null));

    const ycEntries: { value: number; weight: number }[] = [];
    for (const key of YC_INPUT_SYSTEMS) {
      const v = key === "consensus" ? consensus : pulled[key] ?? null;
      if (v == null) continue;
      const w = weights[key] ?? 0;
      if (w > 0) ycEntries.push({ value: v, weight: w });
    }
    const yc = weightedAvg(ycEntries);

    return {
      team: t.team,
      div: t.div,
      conf: t.conf,
      values,
      consensus,
      yc,
    };
  });
}

/** All (team -> {yc/consensus/system values}) rows worth saving for "Save As Week" — includes computed yc/consensus alongside every pulled system, keyed exactly like weekly_power_ratings expects. */
export function conglomeratedRowsToSaveFormat(
  rows: ConglomeratedRow[]
): { team: string; division: string; conference: string; values: Record<string, number> }[] {
  return rows.map((r) => {
    const values: Record<string, number> = {};
    for (const [key, v] of Object.entries(r.values)) {
      if (v != null) values[key] = v;
    }
    if (r.consensus != null) values.consensus = r.consensus;
    if (r.yc != null) values.yc = r.yc;
    return { team: r.team, division: r.div, conference: r.conf, values };
  });
}

export function teamDivConf(team: string): { div: "FBS" | "FCS"; conf: string } | null {
  const t = TEAMS_BY_NAME[team];
  return t ? { div: t.div, conf: t.conf } : null;
}
