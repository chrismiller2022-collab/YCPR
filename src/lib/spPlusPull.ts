import { TEAMS_BY_NAME } from "../data/teams";
import { matchTeamRows } from "./teamNameMatch";
import type { SpSheetResult, WeeklyPowerRatingRow } from "./api/ratingSystems";

// SP+ comes from CFBD when it has this week's numbers (FBS only), and otherwise from Bill Connelly's Google Sheet,
// which also carries FCS. The sheet's layouts sit on different scales, so each gets its own offset before the
// sign flip into this site's lower-is-better convention:
//   "TOP n WEEK w":                FBS → −(SP+ − 52.1)        FCS → −(SP+ − 19.1 − 33)
//   "FBS Week w" / "FCS Week w":   FBS → −SP+                 FCS → −(SP+ − 33)
// In the TOP tab an FCS team's SP+ is its FCS-tab number + 19.1 (South Dakota State 47.1 vs 28.0 in week 8), so
// taking off 19.1 lands on the FCS tab's scale and the FCS tab's own −33 still applies; that keeps both layouts
// giving the same number for the same team (South Dakota State +5.0 either way, not −28 next to Ohio State's −26.8).
//   CSV upload (template Team, Division, SP+):      same as the week tabs.

export const SP_TOP_FBS_OFFSET = 52.1;
export const SP_TOP_FCS_OFFSET = 19.1;
export const SP_SPLIT_FCS_OFFSET = 33;

export interface SpValue {
  team: string;
  division: "FBS" | "FCS";
  value: number;
}

/** Sheet rows → this site's FBS/FCS teams with the layout's offsets applied. Other divisions are dropped. */
export function spValuesFromSheet(sheet: SpSheetResult): { values: SpValue[]; unmatched: string[] } {
  // The TOP tab also lists D2, D3 and NAIA schools, so only exact and alias matches count there (a fuzzy match
  // could land a D2 school on an FCS team). The FBS/FCS tabs only hold their own division, so fuzzy is fine.
  // TOP-tab rows come first, so the FCS tab only fills FCS teams the TOP tab left out.
  const { matched, unmatched } = matchTeamRows(sheet.rows, (r) => r.team);
  const values: SpValue[] = [];
  const seen = new Set<string>();
  for (const m of matched) {
    if (sheet.mode === "top" && m.confidence === "fuzzy") continue;
    const div = TEAMS_BY_NAME[m.team]?.div;
    if (div !== "FBS" && div !== "FCS") continue;
    if (m.row.tab === "fbs" && div !== "FBS") continue;
    if (m.row.tab === "fcs" && div !== "FCS") continue;
    if (seen.has(m.team)) continue;
    seen.add(m.team);
    const sp = m.row.sp;
    const value =
      m.row.tab === "top" ? -(sp - (div === "FBS" ? SP_TOP_FBS_OFFSET : SP_TOP_FCS_OFFSET + SP_SPLIT_FCS_OFFSET)) : m.row.tab === "fbs" ? -sp : -(sp - SP_SPLIT_FCS_OFFSET);
    values.push({ team: m.team, division: div, value: Math.round(value * 100) / 100 });
  }
  // The TOP tab lists D2/D3/NAIA schools too, so its non-matches aren't worth reporting; the week tabs' are.
  return { values, unmatched: unmatched.filter((u) => u.tab !== "top").map((u) => u.team) };
}

/**
 * Proof the pull brought new numbers: compares against the SP+ saved for the previous week (Save as Week), per division.
 * Zero changed teams means the source hasn't updated yet.
 */
export function spFreshness(values: { team: string; division: "FBS" | "FCS"; value: number }[], previous: WeeklyPowerRatingRow[], prevWeek: number | null): string {
  if (prevWeek == null) return "No earlier saved week to compare against.";
  const prev = new Map(previous.filter((r) => r.system_key === "sp").map((r) => [r.team, Number(r.value)]));
  const parts: string[] = [];
  for (const div of ["FBS", "FCS"] as const) {
    const rows = values.filter((v) => v.division === div);
    if (rows.length === 0) continue;
    let compared = 0;
    let changed = 0;
    let sumAbs = 0;
    let maxAbs = 0;
    for (const r of rows) {
      const p = prev.get(r.team);
      if (p == null) continue;
      compared++;
      const d = Math.abs(r.value - p);
      if (d >= 0.05) changed++;
      sumAbs += d;
      maxAbs = Math.max(maxAbs, d);
    }
    if (compared === 0) parts.push(`${div}: ${rows.length} teams, none saved in week ${prevWeek} to compare`);
    else if (changed === 0) parts.push(`⚠ ${div}: identical to week ${prevWeek} for all ${compared} teams — not new numbers yet`);
    else parts.push(`${div}: ${changed} of ${compared} teams moved vs week ${prevWeek} (avg ${(sumAbs / compared).toFixed(2)}, max ${maxAbs.toFixed(2)})`);
  }
  return parts.join(" · ");
}

export const SP_CSV_TEMPLATE = "Team,Division,SP+\nOhio State,FBS,26.8\nGeorgia,FBS,26.5\nSouth Dakota State,FCS,28.0\nMontana State,FCS,24.8\n";
