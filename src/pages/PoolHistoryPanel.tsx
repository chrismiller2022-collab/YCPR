import { useEffect, useMemo, useState, Fragment } from "react";
import TeamLogo from "../components/TeamLogo";
import { BET_HISTORY } from "../data/betHistory.data";
import { computeCustomGrading, DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { TEAMS_BY_NAME } from "../data/teams";
import {
  simulateTier,
  simulateBestBets,
  contestWinPct,
  type ContestCandidate,
  type ContestTier,
  type ContestSeasonResult,
} from "../lib/contestSimulator";

const MAX_WEEK = 13; // per Chris — Pool History only goes through Week 13
const TIER_LABELS: Record<ContestTier, string> = { filtered: "Filtered", wfb: "WFB", nwfb: "NWFB", bestBets: "Best Bets" };

function isFbsGame(homeTeam: string, awayTeam: string): boolean {
  return TEAMS_BY_NAME[homeTeam]?.div === "FBS" && TEAMS_BY_NAME[awayTeam]?.div === "FBS";
}

// Filtered/WFB/NWFB are pure rankings now (no threshold gate, no
// editable parameters) — every week always gets its top N by whichever
// metric. Best Bets is the one place real threshold gating still
// happens (via qualifiesFiltered/Wfb/Nwfb, always at DEFAULT_CUSTOM_PARAMS).
function candidatesFromBetHistory(season: number): ContestCandidate[] {
  return BET_HISTORY.filter((r) => r.season === season && r.week <= MAX_WEEK && isFbsGame(r.homeTeam, r.awayTeam)).map((r) => {
    const graded = computeCustomGrading(r, DEFAULT_CUSTOM_PARAMS);
    return {
      week: r.week,
      awayTeam: r.awayTeam,
      homeTeam: r.homeTeam,
      pick: graded.everyBetTeam,
      grade: graded.everyBetResult,
      absAmountOff: graded.absAmountOff,
      absRelativeOff: graded.relativeAmountOff != null ? Math.abs(graded.relativeAmountOff) : null,
      myAwaySpread: r.prediction != null ? -r.prediction : null, // BET_HISTORY is home-perspective; site convention is away-perspective
      vegasAwaySpread: r.spread != null ? -r.spread : null,
      awayScore: r.awayScore,
      homeScore: r.homeScore,
      qualifiesFiltered: graded.filteredBetTeam != null,
      qualifiesWfb: graded.weightedFilteredBetTeam != null,
      qualifiesNwfb: graded.nwfbTeam != null,
    };
  });
}

function candidatesFromLive(games: GameWithLines[], ratingsByWeek: Record<number, Record<string, any>>): ContestCandidate[] {
  return games
    .filter((g) => g.week <= MAX_WEEK && isFbsGame(g.home_team, g.away_team))
    .map((g) => {
      const computed = computeRow(g, ratingsByWeek[g.week] ?? {}, "team", DEFAULT_CUSTOM_PARAMS);
      if (computed.projCoverTeam == null || computed.line == null) return null;
      const pick = computed.projCoverTeam === "away" ? g.away_team : g.home_team;
      let grade: ContestCandidate["grade"] = null;
      if (computed.actCoverTeam != null) {
        grade = computed.actCoverTeam === "push" ? "push" : computed.actCoverTeam === computed.projCoverTeam ? "win" : "loss";
      }
      return {
        week: g.week,
        awayTeam: g.away_team,
        homeTeam: g.home_team,
        pick,
        grade,
        absAmountOff: computed.absAmountOff,
        absRelativeOff: computed.absRelativeOff,
        myAwaySpread: computed.projAwaySpread,
        vegasAwaySpread: computed.vegasAwaySpread,
        awayScore: g.away_points,
        homeScore: g.home_points,
        qualifiesFiltered: computed.filteredBetTeam != null,
        qualifiesWfb: computed.weightedFilteredBetTeam != null,
        qualifiesNwfb: computed.nwfbTeam != null,
      } as ContestCandidate;
    })
    .filter((c): c is ContestCandidate => c != null);
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function SeasonAtsRecord({ candidates }: { candidates: ContestCandidate[] }) {
  const graded = candidates.filter((c) => c.grade != null);
  const wins = graded.filter((c) => c.grade === "win").length;
  const losses = graded.filter((c) => c.grade === "loss").length;
  const pushes = graded.filter((c) => c.grade === "push").length;
  const winPct = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;

  return (
    <div style={{ display: "flex", gap: "2rem", alignItems: "baseline", marginBottom: "1.5rem" }}>
      <div>
        <div style={{ fontSize: "2rem", fontWeight: 800 }}>
          {wins}-{losses}
          {pushes > 0 ? `-${pushes}` : ""}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Every Bet (ATS, FBS vs FBS)</div>
      </div>
      <div>
        <div style={{ fontSize: "2rem", fontWeight: 800 }}>{winPct != null ? `${winPct.toFixed(1)}%` : "–"}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Win %</div>
      </div>
      <div>
        <div style={{ fontSize: "2rem", fontWeight: 800 }}>{graded.length}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Games Graded</div>
      </div>
    </div>
  );
}

function WeekDetailTable({ picks }: { picks: ContestSeasonResult["weeks"][number]["picks"] }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem", marginTop: "0.4rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Pick</th>
          <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Opponent</th>
          <th style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}>Vegas (Away)</th>
          <th style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}>Mine (Away)</th>
          <th style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}>Final</th>
          <th style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}>Margin</th>
        </tr>
      </thead>
      <tbody>
        {picks.map((p, i) => (
          <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <td style={{ padding: "0.25rem 0.5rem" }}>
              <TeamLogo team={p.pick!} size={16} /> {p.pick}
            </td>
            <td style={{ padding: "0.25rem 0.5rem", color: "var(--chalk-dim)" }}>
              {p.pick === p.awayTeam ? `@ ${p.opponent}` : `vs ${p.opponent}`}
            </td>
            <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>{fmtSpread(p.vegasAwaySpread)}</td>
            <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>{fmtSpread(p.myAwaySpread)}</td>
            <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>
              {p.awayScore != null && p.homeScore != null ? `${p.awayTeam} ${p.awayScore} - ${p.homeScore} ${p.homeTeam}` : "–"}
            </td>
            <td
              style={{
                padding: "0.25rem 0.5rem",
                textAlign: "right",
                color: p.finalMargin == null ? undefined : p.finalMargin > 0 ? "#8fd39a" : "#c45c52",
              }}
            >
              {p.finalMargin != null ? `${p.finalMargin > 0 ? "+" : ""}${p.finalMargin}` : "–"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StrategyResultCard({
  result,
  showAvgPicks,
  expandedWeek,
  onExpandWeek,
}: {
  result: ContestSeasonResult;
  showAvgPicks: boolean;
  expandedWeek: number | null;
  onExpandWeek: (week: number | null) => void;
}) {
  const winPct = contestWinPct(result);
  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.85rem 1rem", marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            Top {result.topN} · {TIER_LABELS[result.tier]}
          </div>
          {showAvgPicks && (
            <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
              {result.weeks.length} weeks · avg{" "}
              {(result.weeks.reduce((s, w) => s + w.picks.length, 0) / (result.weeks.length || 1)).toFixed(1)} picks/week
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: winPct != null && winPct >= 52.4 ? "#8fd39a" : undefined }}>
            {result.totalWins}-{result.totalLosses}
            {result.totalPushes > 0 ? `-${result.totalPushes}` : ""}
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>{winPct != null ? `${winPct.toFixed(1)}%` : "–"}</div>
        </div>
      </div>
      <div style={{ marginTop: "0.6rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
              <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>Picks</th>
              <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
            </tr>
          </thead>
          <tbody>
            {result.weeks.map((w) => (
              <Fragment key={w.week}>
                <tr
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}
                  onClick={() => onExpandWeek(expandedWeek === w.week ? null : w.week)}
                >
                  <td style={{ padding: "0.3rem 0.5rem", color: "var(--gold)" }}>Wk {w.week}</td>
                  <td style={{ padding: "0.3rem 0.5rem" }}>
                    {w.picks.length === 0 ? (
                      <span style={{ color: "var(--chalk-dim)" }}>none</span>
                    ) : (
                      w.picks.map((p, i) => (
                        <span
                          key={i}
                          style={{
                            marginRight: "0.6rem",
                            color: p.grade === "win" ? "#8fd39a" : p.grade === "loss" ? "#c45c52" : "var(--chalk-dim)",
                          }}
                        >
                          <TeamLogo team={p.pick!} size={16} /> {p.pick}
                        </span>
                      ))
                    )}
                  </td>
                  <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                    {w.wins}-{w.losses}
                    {w.pushes > 0 ? `-${w.pushes}` : ""}
                  </td>
                </tr>
                {expandedWeek === w.week && (
                  <tr>
                    <td colSpan={3} style={{ padding: "0 0.5rem 0.6rem" }}>
                      <WeekDetailTable picks={w.picks} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function useLiveGames(season: number, currentSeason: number) {
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (season !== currentSeason) return;
    let cancelled = false;
    setLoading(true);
    fetchGamesWithLines(season)
      .then((rows) => {
        if (!cancelled) setGames(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, currentSeason]);

  const weekNumbers = useMemo(() => Array.from(new Set(games.map((g) => g.week))), [games]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbers, currentSeason);

  return { games, ratingsByWeek, loading };
}

export default function PoolHistoryPanel({ onBack }: { onBack: () => void }) {
  const currentSeason = new Date().getFullYear();
  const [season, setSeason] = useState(2025);
  const [topN, setTopN] = useState<5 | 7>(5);
  const [tier, setTier] = useState<ContestTier>("filtered");
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);

  const isLive = season === currentSeason;
  const { games, ratingsByWeek, loading: liveLoading } = useLiveGames(season, currentSeason);

  const candidates = useMemo(
    () => (isLive ? candidatesFromLive(games, ratingsByWeek) : candidatesFromBetHistory(season)),
    [isLive, games, ratingsByWeek, season]
  );

  const result = useMemo(() => {
    if (tier === "bestBets") return simulateBestBets(candidates, topN);
    return simulateTier(candidates, topN, tier);
  }, [tier, topN, candidates]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>
      <h2 style={{ marginTop: 0 }}>Pool History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        My own spread picks vs Vegas, by season — FBS vs FBS only, through Week 13 — separate from the real Spread
        Bet History tracker, since these are for sizing up contest-style "pick N games a week" pools, not what's
        actually been bet. 2026 is computed live from this week's synced games/lines/ratings (same numbers as Admin
        Matchups) as the season plays out, so it's empty until real weeks exist.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {[2024, 2025, currentSeason].map((s) => (
          <button key={s} className={`mode-btn ${season === s ? "mode-btn-active" : ""}`} onClick={() => setSeason(s)}>
            {s}
          </button>
        ))}
      </div>

      {isLive && liveLoading ? (
        <p>Loading live season data…</p>
      ) : candidates.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No graded games for {season} yet.</p>
      ) : (
        <>
          <SeasonAtsRecord candidates={candidates} />

          <div className="section-label" style={{ marginBottom: "0.5rem" }}>
            Contest Simulator — top N picks per week
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
            Filtered and NWFB rank by amount off (Sigma Off is amount off divided by a fixed constant, so it's the
            same order) — no qualifying bar, every week gets its top {topN} however far off that Nth game actually
            is. WFB ranks by |relative off| instead. Best Bets is the one tab with a real bar: NWFB games first, then
            WFB, then Filtered if still short of {topN} — always at the real site-wide default parameters (same as
            Bet History/Admin Matchups), so it can come up short of {topN} in a given week.
          </p>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button className={`mode-btn ${topN === 5 ? "mode-btn-active" : ""}`} onClick={() => setTopN(5)}>
              Top 5
            </button>
            <button className={`mode-btn ${topN === 7 ? "mode-btn-active" : ""}`} onClick={() => setTopN(7)}>
              Top 7
            </button>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            {(["filtered", "nwfb", "wfb", "bestBets"] as ContestTier[]).map((t) => (
              <button key={t} className={`mode-btn ${tier === t ? "mode-btn-active" : ""}`} onClick={() => setTier(t)}>
                {TIER_LABELS[t]}
              </button>
            ))}
          </div>

          <StrategyResultCard
            result={result}
            showAvgPicks={tier === "wfb"}
            expandedWeek={expandedWeek}
            onExpandWeek={setExpandedWeek}
          />
        </>
      )}
    </div>
  );
}
