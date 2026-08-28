import { useEffect, useMemo, useRef, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import ExportPngButton from "../components/ExportPngButton";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { useLatestMonteCarloRun } from "../lib/futuresData";
import {
  scoreWatchability,
  kickoffWindowET,
  isSaturdayET,
  DEFAULT_WEIGHTS,
  type WatchabilityInput,
  type WatchabilityScore,
  type WatchabilityWeights,
  type KickoffWindow,
} from "../lib/watchability";

const WINDOW_LABELS: Record<KickoffWindow, string> = {
  early: "Early Slate",
  afternoon: "Afternoon Slate",
  night: "Night Slate",
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
        gap: "0.75rem",
        padding: "0.6rem 0.85rem",
        borderBottom: "1px solid var(--hash)",
      }}
    >
      <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--gold)", width: 24, textAlign: "center" }}>{rank}</div>
      <div
        style={{
          fontSize: "1rem",
          fontWeight: 800,
          width: 44,
          textAlign: "center",
          background: "rgba(255,200,87,0.12)",
          borderRadius: 6,
          padding: "0.2rem 0",
          flexShrink: 0,
        }}
      >
        {g.score.toFixed(1)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, flexWrap: "wrap", fontSize: "0.92rem" }}>
          <TeamLogo team={g.awayTeam} size={20} /> {g.awayTeam}
          <span style={{ color: "var(--chalk-dim)", fontWeight: 400 }}>@</span>
          <TeamLogo team={g.homeTeam} size={20} /> {g.homeTeam}
          {g.isConferenceGame && (
            <span style={{ fontSize: "0.64rem", padding: "0.1rem 0.35rem", borderRadius: 4, background: "rgba(143,211,154,0.15)", color: "#8fd39a" }}>
              CONF
            </span>
          )}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginTop: "0.1rem" }}>
          {fmtKickoff(g.startDate)} · Spread {fmtSpread(g.mySpread)} · Total {g.myTotal != null ? g.myTotal.toFixed(1) : "–"}
        </div>
      </div>
    </div>
  );
}

function MobileGameRow({ g, rank }: { g: WatchabilityScore; rank: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#ffc857", width: 16, textAlign: "right", flexShrink: 0 }}>{rank}</div>
      <div style={{ fontSize: "0.82rem", fontWeight: 800, width: 30, textAlign: "center", background: "rgba(255,200,87,0.15)", borderRadius: 4, flexShrink: 0 }}>
        {g.score.toFixed(1)}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: "0.35rem", flexWrap: "wrap" }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.78rem" }}>
          <TeamLogo team={g.awayTeam} size={14} /> {g.awayTeam} @ <TeamLogo team={g.homeTeam} size={14} /> {g.homeTeam}
        </span>
        {g.isConferenceGame && (
          <span style={{ fontSize: "0.56rem", padding: "0.05rem 0.25rem", borderRadius: 3, background: "rgba(143,211,154,0.18)", color: "#8fd39a" }}>
            CONF
          </span>
        )}
        <span style={{ color: "#a3a8c3", fontSize: "0.66rem" }}>
          {fmtSpread(g.mySpread)} · {g.myTotal != null ? g.myTotal.toFixed(1) : "–"}
        </span>
      </div>
    </div>
  );
}

function WeightSlider({
  label,
  leftLabel,
  rightLabel,
  value,
  onChange,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ fontSize: "0.8rem", minWidth: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.15rem" }}>
        <span style={{ color: "var(--chalk-dim)" }}>{label}</span>
        <span style={{ fontWeight: 700 }}>
          {value > 0 ? "+" : ""}
          {Math.round(value * 100)}%
        </span>
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.66rem", color: "var(--chalk-dim)" }}>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

function WeightsEditor({ weights, setWeights }: { weights: WatchabilityWeights; setWeights: (w: WatchabilityWeights) => void }) {
  return (
    <div
      style={{
        border: "1px solid var(--hash)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        marginBottom: "1rem",
      }}
    >
      <p style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", marginTop: 0, marginBottom: "0.75rem" }}>
        Each dial runs worst to best for that thing, not "how much it matters" — +100% weights fully toward the best
        possible on that dimension, -100% fully toward the worst, 0% has no effect either way. A -50% and a +50%
        pull equally hard, just toward opposite ends. They don't need to add up to anything in particular; each dial
        just adds its own pull in its own direction.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem 1.5rem", alignItems: "flex-start" }}>
        <WeightSlider
          label="Team quality"
          leftLabel="Worst teams"
          rightLabel="Best teams"
          value={weights.quality}
          onChange={(v) => setWeights({ ...weights, quality: v })}
        />
        <WeightSlider
          label="Spread closeness"
          leftLabel="Blowouts"
          rightLabel="Close games"
          value={weights.spread}
          onChange={(v) => setWeights({ ...weights, spread: v })}
        />
        <WeightSlider
          label="Proj. total"
          leftLabel="Low-scoring"
          rightLabel="High-scoring"
          value={weights.total}
          onChange={(v) => setWeights({ ...weights, total: v })}
        />
        <WeightSlider
          label="Combined win totals"
          leftLabel="Fewest wins"
          rightLabel="Most wins"
          value={weights.wins}
          onChange={(v) => setWeights({ ...weights, wins: v })}
        />
        <WeightSlider
          label="Conference bonus"
          leftLabel="Non-conference"
          rightLabel="Conference"
          value={weights.conferenceBonus}
          onChange={(v) => setWeights({ ...weights, conferenceBonus: v })}
        />
      </div>
      <button className="menu-btn" onClick={() => setWeights(DEFAULT_WEIGHTS)} style={{ marginTop: "0.75rem" }}>
        Reset to default
      </button>
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
  const { results: mcResults, loading: mcLoading } = useLatestMonteCarloRun(season);
  const meanWinsByTeam = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of mcResults ?? []) map.set(r.team, r.meanWins);
    return map;
  }, [mcResults]);

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
          combinedProjWins:
            meanWinsByTeam.has(g.away_team) && meanWinsByTeam.has(g.home_team)
              ? meanWinsByTeam.get(g.away_team)! + meanWinsByTeam.get(g.home_team)!
              : null,
          isConferenceGame: g.conference_game,
        };
      });
  }, [games, ratingsByWeek, totalByGame, meanWinsByTeam]);

  return { inputs, weekNumbers, loading: loading || totalsLoading || mcLoading };
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
  const [weights, setWeights] = useState<WatchabilityWeights>(DEFAULT_WEIGHTS);
  const exportRef = useRef<HTMLDivElement>(null);
  const mobileExportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (week == null && weekNumbers.length > 0) setWeek(weekNumbers[0]);
  }, [weekNumbers, week]);

  const weeklyInputs = useMemo(() => {
    let list = week != null ? inputs.filter((i) => i.week === week) : [];
    if (saturdaysOnly) list = list.filter((i) => isSaturdayET(i.startDate));
    return list;
  }, [inputs, week, saturdaysOnly]);

  const weeklyScored = useMemo(() => scoreWatchability(weeklyInputs, weights).sort((a, b) => b.score - a.score), [weeklyInputs, weights]);
  const seasonScored = useMemo(() => scoreWatchability(inputs, weights).sort((a, b) => b.score - a.score), [inputs, weights]);

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
        <button className="back-link" onClick={onHome} data-export-exclude="true">
          ‹ All tools
        </button>
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">Watchability Chart</h1>
        <p className="subtitle team-subtitle">
          Which games are most worth your Saturday, ranked by team quality, projected total, spread closeness, and a
          bonus for conference stakes — scored 1-10 relative to whichever set of games you're looking at.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }} data-export-exclude="true">
        <button className={`mode-btn ${scope === "weekly" ? "mode-btn-active" : ""}`} onClick={() => setScope("weekly")}>
          Weekly View
        </button>
        <button className={`mode-btn ${scope === "season" ? "mode-btn-active" : ""}`} onClick={() => setScope("season")}>
          Full Season View
        </button>
        <span style={{ marginLeft: "auto" }}>
          <ExportPngButton
            targetRef={mobileExportRef}
            filename={() => `watchability-${scope === "season" ? "season" : `week${week}`}`}
            tweetText="Watchability rankings for this week's college football slate 🏈"
          />
        </span>
      </div>

      <div data-export-exclude="true">
        <WeightsEditor weights={weights} setWeights={setWeights} />
      </div>

      <div ref={exportRef}>
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
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }} data-export-exclude="true">
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                {(["early", "afternoon", "night"] as KickoffWindow[]).map((w) => (
                  <div key={w}>
                    <div className="section-label" style={{ marginBottom: "0.5rem", fontSize: "0.72rem" }}>
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
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Hidden mobile-width export layout -- captured by html2canvas via
          mobileExportRef instead of the on-screen version, which is a
          wide 3-column grid for time-window view and doesn't include the
          page header. Chris exports from desktop but shares to mobile,
          so this is sized for a phone screen and includes its own title
          regardless of what's on screen, with tighter spacing than the
          interactive rows (less dead space between team names and the
          spread/total line). */}
      <div style={{ position: "absolute", top: -99999, left: -99999 }}>
        <div ref={mobileExportRef} style={{ background: "#1a1b2e", padding: "1.25rem 1rem", width: 480 }}>
          <div style={{ color: "#fff", fontSize: "1.1rem", fontWeight: 800, marginBottom: "0.2rem" }}>Watchability Chart</div>
          <div style={{ color: "#a3a8c3", fontSize: "0.72rem", marginBottom: "1rem" }}>
            {scope === "season" ? "Full Season" : `Week ${week}`}
            {scope === "weekly" && topView === "windows" ? " \u00b7 By Time Window" : ""}
            {scope === "weekly" && saturdaysOnly ? " \u00b7 Saturdays only" : ""}
          </div>

          {scope === "season"
            ? seasonScored.slice(0, 10).map((g, i) => <MobileGameRow key={g.gameId} g={g} rank={i + 1} />)
            : topView === "overall"
            ? weeklyScored.slice(0, 10).map((g, i) => <MobileGameRow key={g.gameId} g={g} rank={i + 1} />)
            : (["early", "afternoon", "night"] as KickoffWindow[]).map((w) => (
                <div key={w} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ color: "#ffc857", fontSize: "0.72rem", fontWeight: 700, marginBottom: "0.3rem" }}>{WINDOW_LABELS[w]}</div>
                  {byWindow[w]
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 10)
                    .map((g, i) => (
                      <MobileGameRow key={g.gameId} g={g} rank={i + 1} />
                    ))}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
