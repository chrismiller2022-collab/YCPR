import { matchTeamName } from "../teamNameMatch";
import { espnTeamIdToName } from "../espnTeamId";
import { POLL_LABELS, type PollKey } from "../pollComparison";

// AP / CFP committee / Coaches top 25 for one (season, week), via the
// admin-only /api/ratings "pollsProxy" action (CFBD /rankings, ESPN
// fallback). Poll week N = the poll released going into week N — same
// convention as the site's saved week N. School names are mapped onto
// canonical team names here (ESPN id first when present, then the fuzzy
// team-name matcher); anything that doesn't map is returned in `unmatched`
// rather than guessed.

export interface PollsProxyRow {
  poll: string;
  pollKey: PollKey | "other";
  rank: number;
  school: string;
  espnId?: string;
}

export interface FetchedPoll {
  key: PollKey;
  /** The source's own poll name, e.g. "AP Top 25" / "Playoff Committee Rankings". */
  sourceName: string;
  /** Display label, e.g. "AP Poll" / "CFP Committee". */
  label: string;
  /** canonical team -> rank (1..25) */
  ranks: Record<string, number>;
}

export interface FetchedPolls {
  source: "cfbd" | "espn";
  season: number;
  week: number;
  polls: Partial<Record<PollKey, FetchedPoll>>;
  unmatched: string[];
  notes: string[];
}

export async function fetchPolls(season: number, week: number, seasonType: "regular" | "postseason" = "regular"): Promise<FetchedPolls> {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, action: "pollsProxy", season, week, seasonType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Poll pull failed (${res.status})`);
  return mapPollRows(data.rows ?? [], { source: data.source ?? "cfbd", season, week, notes: data.notes ?? [] });
}

/** Pure: raw pollsProxy rows -> canonical-team polls. Exported for testing / other sources. */
export function mapPollRows(rows: PollsProxyRow[], meta: { source: "cfbd" | "espn"; season: number; week: number; notes?: string[] }): FetchedPolls {
  const polls: Partial<Record<PollKey, FetchedPoll>> = {};
  const unmatched: string[] = [];
  for (const r of rows) {
    if (r.pollKey === "other" || !(r.rank >= 1 && r.rank <= 25)) continue;
    const team = (r.espnId && espnTeamIdToName(r.espnId)) || matchTeamName(r.school).matched;
    if (!team) {
      unmatched.push(`${r.poll}: ${r.school}`);
      continue;
    }
    const p = (polls[r.pollKey] ??= { key: r.pollKey, sourceName: r.poll, label: POLL_LABELS[r.pollKey], ranks: {} });
    p.ranks[team] = r.rank;
  }
  return { source: meta.source, season: meta.season, week: meta.week, polls, unmatched, notes: meta.notes ?? [] };
}
