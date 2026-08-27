import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { scoreWatchability, kickoffWindowET, isSaturdayET, type WatchabilityInput, type WatchabilityScore, type KickoffWindow } from "../lib/watchability";

const WINDOW_LABELS: Record<KickoffWindow, string> = {
  early: "Early Slate (before 2:01 PM ET)",
  afternoon: "Afternoon Slate (2:01 - 6:59 PM ET)",
  night: "Night Slate (7:00 PM ET or later)",
};

function fmtKickoff(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function GameRow({ g, rank }: { g: WatchabilityScore; rank: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.7rem 1rem",
        borderBottom: "1px solid var(--hash)",
      }}
    >
      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--gold)", width: 32, textAlign: "center" }}>{rank}</div>
      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: 800,
          width: 50,
          textAlign: "center",
          background: "rgba(255,200,87,0.12)",
          borderRadius: 6,
          padding: "0.2rem 0",
        }}
      >
        {g.score.toFixed(1)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700 }}>
          <TeamLogo team={g.awayTeam} size={22} /> {g.awayTeam}
          <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }}>@</span>
          <TeamLogo team={g.homeTeam} size={22} /> {g.homeTeam}
          {g.isConferenceGame && (
            <span style={{ fontSize: "0.68rem", padding: "0.1rem 0.4rem", borderRadius: 4, background: "rgba(143,211,154,0.15)", color: "#8fd39a" }}>
              CONF
            </span>
          )}
        </div>
        <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", marginTop: "0.15rem" }}>
          {fmtKickoff(g.startDate)} · Spread {fmtSpread(g.mySpread)} · Total {g.myTotal != null ? g.myTotal.toFixed(1) : "–"}
        </div>
      </div>
    </div>
  );
}

function useWatchabilityInputs(season: number) {
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [season]);

  const weekNumbers = useMemo(() => Array.from(new Set(games.map((g) => g.week))), [games]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbers, season);
  const { rows: totalsRows, loading: totalsLoading } = useGameTotalsEngine(season);

  const totalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsRows) {
      const t = r.projection?.projectedTotal;
      if (t != null) map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, t);
    }
    return map;
  }, [totalsRows]);

  const inputs: WatchabilityInput[] = useMemo(() => {
    return games
      .filter((g) => (g.home_classification ?? "").toLowerCase() === "fbs" && (g.away_classification ?? "").toLowerCase() === "fbs")
      .map((g) => {
        const computed = computeRow(g, ratingsByWeek[g.week] ?? {});
        const avgRating =
          computed.awayTeam && computed.homeTeam ? (computed.awayTeam.rating + computed.homeTeam.rating) / 2 : null;
        return {
          gameId: g.id,
          week: g.week,
          awayTeam: g.away_team,
          homeTeam: g.home_team,
          startDate: g.start_date,
          avgRating,
          mySpread: computed.projAwaySpread,
          myTotal: totalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
          isConferenceGame: g.conference_game,
        };
      });
  }, [games, ratingsByWeek, totalByGame]);

  return { inputs, weekNumbers, loading: loading || totalsLoading };
}

type TopView = "overall" | "windows";
type WeeklyOrSeason = "weekly" | "season";

export default function WatchabilityPage({ onHome }: { onHome?: () => void }) {
  const season = new Date().getFullYear();
  const { inputs, weekNumbers, loading } = useWatchabilityInputs(season);
  const [scope, setScope] = useState<WeeklyOrSeason>("weekly");
  const [week, setWeek] = useState<number | null>(null);
  const [topView, setTopView] = useState<TopView>("overall");
  const [saturdaysOnly, setSaturdaysOnly] = useState(false);

  useEffect(() => {
    if (week == null && weekNumbers.length > 0) setWeek(weekNumbers[0]);
  }, [weekNumbers, week]);

  const weeklyInputs = useMemo(() => {
    let list = week != null ? inputs.filter((i) => i.week === week) : [];
    if (saturdaysOnly) list = list.filter((i) => isSaturdayET(i.startDate));
    return list;
  }, [inputs, week, saturdaysOnly]);

  const weeklyScored = useMemo(() => scoreWatchability(weeklyInputs).sort((a, b) => b.score - a.score), [weeklyInputs]);
  const seasonScored = useMemo(() => scoreWatchability(inputs).sort((a, b) => b.score - a.score), [inputs]);

  const byWindow = useMemo(() => {
    const groups: Record<KickoffWindow, WatchabilityScore[]> = { early: [], afternoon: [], night: [] };
    for (const g of weeklyScored) {
      const w = kickoffWindowET(g.startDate);
      if (w) groups[w].push(g);
    }
    return groups;
  }, [weeklyScored]);

  return (
    <div className="page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All tools
        </button>
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">Watchability Chart</h1>
        <p className="subtitle team-subtitle">
          Which games are most worth your Saturday, ranked by team quality, projected total, spread closeness, and a
          bonus for conference stakes — scored 1-10 relative to whichever set of games you're looking at.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button className={`mode-btn ${scope === "weekly" ? "mode-btn-active" : ""}`} onClick={() => setScope("weekly")}>
          Weekly View
        </button>
        <button className={`mode-btn ${scope === "season" ? "mode-btn-active" : ""}`} onClick={() => setScope("season")}>
          Full Season View
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : scope === "season" ? (
        <div style={{ border: "1px solid var(--hash)", borderRadius: 8, overflow: "hidden" }}>
          {seasonScored.slice(0, 10).map((g, i) => (
            <GameRow key={g.gameId} g={g} rank={i + 1} />
          ))}
          {seasonScored.length === 0 && <p style={{ padding: "1rem", color: "var(--chalk-dim)" }}>No games yet.</p>}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
            <select value={week ?? ""} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
              {weekNumbers.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
            <button className={`mode-btn ${topView === "overall" ? "mode-btn-active" : ""}`} onClick={() => setTopView("overall")}>
              Overall Top 10
            </button>
            <button className={`mode-btn ${topView === "windows" ? "mode-btn-active" : ""}`} onClick={() => setTopView("windows")}>
              By Time Window
            </button>
            <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem", marginLeft: "0.5rem" }}>
              <input type="checkbox" checked={saturdaysOnly} onChange={(e) => setSaturdaysOnly(e.target.checked)} />
              Saturdays only
            </label>
          </div>

          {topView === "overall" ? (
            <div style={{ border: "1px solid var(--hash)", borderRadius: 8, overflow: "hidden" }}>
              {weeklyScored.slice(0, 10).map((g, i) => (
                <GameRow key={g.gameId} g={g} rank={i + 1} />
              ))}
              {weeklyScored.length === 0 && <p style={{ padding: "1rem", color: "var(--chalk-dim)" }}>No games this week.</p>}
            </div>
          ) : (
            (["early", "afternoon", "night"] as KickoffWindow[]).map((w) => (
              <div key={w} style={{ marginBottom: "1.5rem" }}>
                <div className="section-label" style={{ marginBottom: "0.5rem" }}>
                  {WINDOW_LABELS[w]}
                </div>
                <div style={{ border: "1px solid var(--hash)", borderRadius: 8, overflow: "hidden" }}>
                  {byWindow[w]
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 10)
                    .map((g, i) => (
                      <GameRow key={g.gameId} g={g} rank={i + 1} />
                    ))}
                  {byWindow[w].length === 0 && <p style={{ padding: "1rem", color: "var(--chalk-dim)" }}>No games in this window.</p>}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
