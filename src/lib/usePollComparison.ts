import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { TEAMS_BY_NAME } from "../data/teams";
import { fetchPolls, type FetchedPolls } from "./api/polls";
import { computePollComparison, ranksFromScores, type PollComparison, type PollKey } from "./pollComparison";

// Loads one week's polls plus both of my résumé rankings and compares them.
//   Resume So Far    — team_resume_ratings_finished for exactly `week` (what the image dump's soFarFull uses).
//   Projected Resume — team_resume_ratings, latest saved week at or before `week` (what fetchReportOverlay ranks).
// Both are ranked among FBS teams, higher score = better. A caller that
// already has its own ranks (e.g. the image dump's live resume_rank) can
// pass them in `opts` to skip those reads and guarantee the graphic matches
// the rest of its report.

export interface UsePollComparisonOptions {
  /** Which poll to compare. Default: CFP committee when that week has one, else AP. */
  poll?: PollKey;
  /** team -> rank overrides (full FBS list ideally, so poll teams outside my top 25 still get a diff). */
  soFarRanks?: Record<string, number> | null;
  projectedRanks?: Record<string, number> | null;
  /** "In/out" line for the markers. Default 12. */
  topN?: number;
  enabled?: boolean;
}

export interface UsePollComparisonResult {
  loading: boolean;
  error: string | null;
  polls: FetchedPolls | null;
  pollKey: PollKey | null;
  /** Display label of the compared poll, e.g. "AP Poll" — pass as the graphic's pollName. */
  pollName: string | null;
  availablePolls: PollKey[];
  soFar: PollComparison | null;
  projected: PollComparison | null;
  /** Which saved résumé weeks were actually used (null when overridden or missing). */
  soFarWeek: number | null;
  projectedWeek: number | null;
}

const isFbs = (team: string) => TEAMS_BY_NAME[team]?.div === "FBS";

async function fetchSoFarScores(season: number, week: number) {
  const { data, error } = await supabase.from("team_resume_ratings_finished").select("team, score").eq("season", season).eq("week", week);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { team: string; score: number | null }[]).map((r) => [r.team, r.score]));
}

async function fetchProjectedScores(season: number, week: number): Promise<{ week: number | null; scores: Record<string, number | null> }> {
  const { data: latest, error: e1 } = await supabase
    .from("team_resume_ratings")
    .select("week")
    .eq("season", season)
    .lte("week", week)
    .order("week", { ascending: false })
    .limit(1);
  if (e1) throw e1;
  const w = (latest?.[0] as { week: number } | undefined)?.week ?? null;
  if (w == null) return { week: null, scores: {} };
  const { data, error } = await supabase.from("team_resume_ratings").select("team, score").eq("season", season).eq("week", w);
  if (error) throw error;
  return { week: w, scores: Object.fromEntries(((data ?? []) as { team: string; score: number | null }[]).map((r) => [r.team, r.score])) };
}

export function usePollComparison(season: number, week: number | null, opts: UsePollComparisonOptions = {}): UsePollComparisonResult {
  const { poll, soFarRanks, projectedRanks, topN = 12, enabled = true } = opts;
  const [polls, setPolls] = useState<FetchedPolls | null>(null);
  const [soFarOwn, setSoFarOwn] = useState<Record<string, number> | null>(null);
  const [projOwn, setProjOwn] = useState<{ week: number | null; ranks: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needSoFar = !soFarRanks;
  const needProj = !projectedRanks;

  useEffect(() => {
    if (!enabled || week == null) {
      setPolls(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPolls(season, week),
      needSoFar ? fetchSoFarScores(season, week).then((s) => ranksFromScores(s, isFbs)) : Promise.resolve(null),
      needProj ? fetchProjectedScores(season, week).then((p) => ({ week: p.week, ranks: ranksFromScores(p.scores, isFbs) })) : Promise.resolve(null),
    ])
      .then(([p, sf, pr]) => {
        if (cancelled) return;
        setPolls(p);
        setSoFarOwn(sf);
        setProjOwn(pr);
      })
      .catch((e) => !cancelled && setError(e?.message ?? String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, week, enabled, needSoFar, needProj]);

  const availablePolls = useMemo(() => (polls ? (["cfp", "ap", "coaches"] as PollKey[]).filter((k) => polls.polls[k]) : []), [polls]);
  const pollKey: PollKey | null = poll && polls?.polls[poll] ? poll : availablePolls.includes("cfp") ? "cfp" : availablePolls.includes("ap") ? "ap" : availablePolls[0] ?? null;
  const pollRanks = pollKey ? polls?.polls[pollKey]?.ranks ?? null : null;

  const soFarMine = soFarRanks ?? soFarOwn;
  const projMine = projectedRanks ?? projOwn?.ranks ?? null;
  const soFar = useMemo(() => (pollRanks && soFarMine && Object.keys(soFarMine).length ? computePollComparison(pollRanks, soFarMine, topN) : null), [pollRanks, soFarMine, topN]);
  const projected = useMemo(() => (pollRanks && projMine && Object.keys(projMine).length ? computePollComparison(pollRanks, projMine, topN) : null), [pollRanks, projMine, topN]);

  return {
    loading,
    error,
    polls,
    pollKey,
    pollName: pollKey ? polls?.polls[pollKey]?.label ?? null : null,
    availablePolls,
    soFar,
    projected,
    soFarWeek: soFarRanks ? null : week,
    projectedWeek: projectedRanks ? null : projOwn?.week ?? null,
  };
}
