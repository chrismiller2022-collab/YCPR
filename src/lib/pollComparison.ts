// "How did the AP poll / committee do?" — pure comparison of a human poll's
// top 25 against this site's own Resume rankings (Resume So Far or
// Projected Resume). No fetching here; see lib/api/polls.ts for the poll
// pull and lib/usePollComparison.ts for the hook that wires both together.
//
// Sign convention (matches the graphic): diff = myRank - pollRank.
//   diff > 0 — the poll has them HIGHER than the résumé says (over-ranked).
//   diff < 0 — the poll has them LOWER than the résumé says (under-ranked).

export type PollKey = "ap" | "cfp" | "coaches";

export const POLL_LABELS: Record<PollKey, string> = {
  ap: "AP Poll",
  cfp: "CFP Committee",
  coaches: "Coaches Poll",
};

export type CompareLabel = "Resume So Far" | "Projected Resume";

export interface PollComparisonRow {
  team: string;
  /** Rank in the poll's top 25, or null when unranked. */
  pollRank: number | null;
  /** Rank in my résumé (FBS), or null when the team has no résumé score. */
  myRank: number | null;
  /** myRank - pollRank; null unless both exist. Positive = poll over-ranks them. */
  diff: number | null;
  inPollTop25: boolean;
  inMyTop25: boolean;
  /** In my top N (default 12) but not the poll's top N — "deserves to be in, isn't". */
  myTopNotPollTop: boolean;
  /** In the poll's top N but not my top N — "is in, doesn't deserve it". */
  pollTopNotMyTop: boolean;
}

export interface PollComparison {
  /** Union of poll top 25 and my top 25, ordered by poll rank then my rank. */
  rows: PollComparisonRow[];
  /** Teams in both top 25s. */
  overlap: number;
  overlapTeams: string[];
  /** Spearman rank correlation over the union (unranked poll teams tied at the bottom), or null when < 3 teams. */
  spearman: number | null;
  spearmanN: number;
  /** Poll top-25 teams the poll has highest relative to me (largest positive diff first). */
  mostOverRanked: PollComparisonRow[];
  /** Poll top-25 teams the poll has lowest relative to me (most negative diff first). */
  mostUnderRanked: PollComparisonRow[];
  /** In my top 25, unranked by the poll (best my rank first). */
  myTop25NotInPoll: PollComparisonRow[];
  /** In the poll's top 25, outside my top 25 (best poll rank first). */
  pollTop25NotInMine: PollComparisonRow[];
  /** Mean absolute diff over poll top-25 teams that have a rank in mine. */
  meanAbsDiff: number | null;
  topN: number;
}

/** Ranks a {team: score} map, higher score = rank 1. Optional filter (e.g. FBS only). */
export function ranksFromScores(scores: Record<string, number | null | undefined>, include?: (team: string) => boolean): Record<string, number> {
  const list = Object.entries(scores)
    .filter((e): e is [string, number] => e[1] != null && Number.isFinite(e[1]) && (!include || include(e[0])))
    .sort((a, b) => b[1] - a[1]);
  const out: Record<string, number> = {};
  list.forEach(([team], i) => {
    out[team] = i + 1;
  });
  return out;
}

/** Fractional (average-of-ties) ranks of values, ascending = rank 1. */
function fractionalRanks(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1].v === idx[k].v) j++;
    const avg = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[idx[m].i] = avg;
    k = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/**
 * Spearman's rho over a set of teams, given each team's rank on both sides.
 * A null rank (poll-unranked, or no résumé score) is treated as tied for
 * last on that side — the standard way to handle a truncated top-25 list.
 */
export function spearmanRho(pairs: { a: number | null; b: number | null }[]): number | null {
  if (pairs.length < 3) return null;
  const BIG = 1e6;
  const ra = fractionalRanks(pairs.map((p) => p.a ?? BIG));
  const rb = fractionalRanks(pairs.map((p) => p.b ?? BIG));
  return pearson(ra, rb);
}

/**
 * @param pollRanks team -> poll rank (only the poll's top 25; canonical team names)
 * @param myRanks   team -> my résumé rank (the full FBS list — so poll teams outside my top 25 still get a real rank)
 * @param topN      the "playoff line" for the in/out markers (12 = 12-team CFP field)
 */
export function computePollComparison(pollRanks: Record<string, number>, myRanks: Record<string, number>, topN = 12): PollComparison {
  const pollTeams = Object.keys(pollRanks).filter((t) => pollRanks[t] <= 25);
  const myTop = Object.keys(myRanks).filter((t) => myRanks[t] <= 25);
  const union = Array.from(new Set([...pollTeams, ...myTop]));

  const rows: PollComparisonRow[] = union.map((team) => {
    const pollRank = pollRanks[team] != null && pollRanks[team] <= 25 ? pollRanks[team] : null;
    const myRank = myRanks[team] ?? null;
    return {
      team,
      pollRank,
      myRank,
      diff: pollRank != null && myRank != null ? myRank - pollRank : null,
      inPollTop25: pollRank != null,
      inMyTop25: myRank != null && myRank <= 25,
      myTopNotPollTop: myRank != null && myRank <= topN && !(pollRank != null && pollRank <= topN),
      pollTopNotMyTop: pollRank != null && pollRank <= topN && !(myRank != null && myRank <= topN),
    };
  });
  rows.sort((a, b) => (a.pollRank ?? 99) - (b.pollRank ?? 99) || (a.myRank ?? 999) - (b.myRank ?? 999));

  const overlapTeams = rows.filter((r) => r.inPollTop25 && r.inMyTop25).map((r) => r.team);
  const plotted = rows.filter((r) => r.diff != null);
  const spearman = spearmanRho(rows.map((r) => ({ a: r.pollRank, b: r.myRank })));
  const meanAbsDiff = plotted.length ? plotted.reduce((s, r) => s + Math.abs(r.diff as number), 0) / plotted.length : null;

  return {
    rows,
    overlap: overlapTeams.length,
    overlapTeams,
    spearman,
    spearmanN: rows.length,
    mostOverRanked: plotted.filter((r) => (r.diff as number) > 0).sort((a, b) => (b.diff as number) - (a.diff as number) || (a.pollRank as number) - (b.pollRank as number)),
    mostUnderRanked: plotted.filter((r) => (r.diff as number) < 0).sort((a, b) => (a.diff as number) - (b.diff as number) || (a.pollRank as number) - (b.pollRank as number)),
    myTop25NotInPoll: rows.filter((r) => r.inMyTop25 && !r.inPollTop25).sort((a, b) => (a.myRank as number) - (b.myRank as number)),
    pollTop25NotInMine: rows.filter((r) => r.inPollTop25 && !r.inMyTop25).sort((a, b) => (a.pollRank as number) - (b.pollRank as number)),
    meanAbsDiff,
    topN,
  };
}

/** Where a diff lands on the graphic's -14..+14 number line (beyond that clamps to the end column, labeled "14+"). */
export const POLL_DIFF_CLAMP = 14;
export function clampDiff(diff: number): number {
  return Math.max(-POLL_DIFF_CLAMP, Math.min(POLL_DIFF_CLAMP, diff));
}
