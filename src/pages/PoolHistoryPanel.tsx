import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { BET_HISTORY } from "../data/betHistory.data";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import {
  simulateTopNStrategy,
  contestWinPct,
  type ContestCandidate,
  type ContestStrategy,
  type ContestSeasonResult,
} from "../lib/contestSimulator";

const STRATEGIES: { key: ContestStrategy; label: string }[] = [
  { key: "amountOff", label: "Most Amount Off" },
  { key: "sigmaOff", label: "Most Sigma Off" },
  { key: "wfb", label: "WFB Priority" },
];

function candidatesFromBetHistory(season: number): ContestCandidate[] {
  return BET_HISTORY.filter((r) => r.season === season).map((r) => ({
    week: r.week,
    gameLabel: `${r.awayTeam} @ ${r.homeTeam}`,
    pick: r.everyBetTeam,
    grade: r.everyBetResult,
    absAmountOff: r.absAmountOff,
    qualifiesWfb: r.weightedFilteredBetTeam != null,
  }));
}

function candidatesFromLive(games: GameWithLines[], ratingsByWeek: Record<number, Record<string, any>>): ContestCandidate[] {
  return games
    .map((g) => {
      const computed = computeRow(g, ratingsByWeek[g.week] ?? {});
      if (computed.projCoverTeam == null || computed.line == null) return null;
      const pick = computed.projCoverTeam === "away" ? g.away_team : g.home_team;
      let grade: ContestCandidate["grade"] = null;
      if (computed.actCoverTeam != null) {
        grade = computed.actCoverTeam === "push" ? "push" : computed.actCoverTeam === computed.projCoverTeam ? "win" : "loss";
      }
      return {
        week: g.week,
        gameLabel: `${g.away_team} @ ${g.home_team}`,
        pick,
        grade,
        absAmountOff: computed.absAmountOff,
        qualifiesWfb: computed.weightedFilteredBetTeam != null,
      };
    })
    .filter((c): c is ContestCandidate => c != null);
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
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Every Bet (ATS)</div>
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

function StrategyResultCard({ result, onExpand, expanded }: { result: ContestSeasonResult; onExpand: () => void; expanded: boolean }) {
  const winPct = contestWinPct(result);
  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.85rem 1rem", marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={onExpand}>
        <div>
          <div style={{ fontWeight: 700 }}>
            Top {result.topN} · {STRATEGIES.find((s) => s.key === result.strategy)?.label}
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
            {result.weeks.length} weeks · avg{" "}
            {(result.weeks.reduce((s, w) => s + w.picks.length, 0) / (result.weeks.length || 1)).toFixed(1)} picks/week
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: winPct != null && winPct >= 52.4 ? "#8fd39a" : undefined }}>
            {result.totalWins}-{result.totalLosses}
            {result.totalPushes > 0 ? `-${result.totalPushes}` : ""}
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>{winPct != null ? `${winPct.toFixed(1)}%` : "–"}</div>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
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
                <tr key={w.week} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "0.3rem 0.5rem" }}>Wk {w.week}</td>
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
                          <TeamLogo team={p.pick} size={16} /> {p.pick}
                        </span>
                      ))
                    )}
                  </td>
                  <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                    {w.wins}-{w.losses}
                    {w.pushes > 0 ? `-${w.pushes}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function useLiveCandidates(season: number, currentSeason: number) {
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

  const candidates = useMemo(() => candidatesFromLive(games, ratingsByWeek), [games, ratingsByWeek]);
  return { candidates, loading };
}

export default function PoolHistoryPanel({ onBack }: { onBack: () => void }) {
  const currentSeason = new Date().getFullYear();
  const [season, setSeason] = useState(2025);
  const [topN, setTopN] = useState<5 | 7>(5);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const isLive = season === currentSeason;
  const staticCandidates = useMemo(() => (isLive ? [] : candidatesFromBetHistory(season)), [season, isLive]);
  const { candidates: liveCandidates, loading: liveLoading } = useLiveCandidates(season, currentSeason);
  const candidates = isLive ? liveCandidates : staticCandidates;

  const results = useMemo(() => STRATEGIES.map((s) => simulateTopNStrategy(candidates, topN, s.key)), [candidates, topN]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>
      <h2 style={{ marginTop: 0 }}>Pool History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        My own spread picks vs Vegas, by season — separate from the real Spread Bet History tracker, since these are
        for sizing up contest-style "pick N games a week" pools, not what's actually been bet. 2026 is computed live
        from this week's synced games/lines/ratings (same numbers as Admin Matchups) as the season plays out, so it's
        empty until real weeks exist.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {[2024, 2025, currentSeason].map((s) => (
          <button key={s} className={`mode-btn ${season === s ? "mode-btn-active" : ""}`} onClick={() => setSeason(s)}>
            {s}
          </button>
        ))}
      </div>

      {isLive && liveLoading && <p>Loading live season data…</p>}

      {candidates.length === 0 && !(isLive && liveLoading) ? (
        <p style={{ color: "var(--chalk-dim)" }}>No graded games for {season} yet.</p>
      ) : (
        <>
          <SeasonAtsRecord candidates={candidates} />

          <div className="section-label" style={{ marginBottom: "0.5rem" }}>
            Contest Simulator — top N picks per week
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: 0 }}>
            "Sigma Off" uses a flat league-wide standard deviation, so today it ranks identically to "Amount Off" —
            kept as a separate option since a per-game volatility model would make them diverge later. WFB Priority
            only selects games that actually clear the Weighted Filtered Bet threshold, so a week may show fewer
            than N picks — that's the real constraint Chris flagged, not a bug.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button className={`mode-btn ${topN === 5 ? "mode-btn-active" : ""}`} onClick={() => setTopN(5)}>
              Top 5
            </button>
            <button className={`mode-btn ${topN === 7 ? "mode-btn-active" : ""}`} onClick={() => setTopN(7)}>
              Top 7
            </button>
          </div>

          {results.map((r) => {
            const key = `${r.strategy}-${r.topN}`;
            return (
              <StrategyResultCard
                key={key}
                result={r}
                expanded={expandedKey === key}
                onExpand={() => setExpandedKey(expandedKey === key ? null : key)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
