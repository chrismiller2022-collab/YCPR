import { useEffect, useMemo, useRef, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import TeamLink from "../components/TeamLink";
import { SURVIVOR_WEEKS, availableConferences, DEFAULT_CONFERENCES, teamsUsedElsewhere, allUsedTeams, type SurvivorWeek } from "../lib/survivor";
import { Board, buildBoardGames, projectChampGames, isEligible, rowTeamsFor, type ProjectionSource, type SurvivorRules } from "../lib/survivorBoard";
import { fairMoneylineFromWinPct } from "../lib/odds";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { fetchWorkingPicks, saveWorkingPicks } from "../lib/api/survivorWorkingPicks";
import { fetchSavedPaths, saveSurvivorPath, deleteSurvivorPath } from "../lib/api/survivorPaths";
import { fetchSplashSavedPaths, saveSplashSurvivorPath, deleteSplashSurvivorPath } from "../lib/api/splashSurvivorPaths";
import { fetchExcludedTeams, setTeamExcluded } from "../lib/api/survivorExcludedTeams";
import { fetchSplashExcludedTeams, setSplashTeamExcluded } from "../lib/api/splashSurvivorExcludedTeams";
import { exportNodeAsPng } from "../lib/exportPng";
import { optimizeSurvivorPath, type SurvivorObjective, type OptimizerResult } from "../lib/survivorOptimizer";
import { useLatestMonteCarloRun } from "../lib/futuresData";

// Admin Survivor: one board for both pools. Survivor (conference filter, both teams' conferences selected) and Splash
// (any FBS game except G6 vs G6) differ only in eligibility; saved paths and the don't-use list stay separate per pool.
// Games come from the synced schedule: played weeks show the frozen pregame projection and are read-only, current and
// future weeks show YC (default) or the Vegas line. Picks save to the database.

const SEASON = new Date().getFullYear();
const POOL_URL: Record<SurvivorRules, string | null> = {
  survivor: "https://app.splashsports.com/contest/fd3afd3f-9fe8-4d70-a68f-085efb6c99b2/entries/overall",
  splash: null,
};
const PATHS = {
  survivor: { fetch: fetchSavedPaths, save: saveSurvivorPath, del: deleteSurvivorPath },
  splash: { fetch: fetchSplashSavedPaths, save: saveSplashSurvivorPath, del: deleteSplashSurvivorPath },
};
const EXCLUDED = {
  survivor: { fetch: fetchExcludedTeams, set: setTeamExcluded },
  splash: { fetch: fetchSplashExcludedTeams, set: setSplashTeamExcluded },
};

type SavedPath = { id: number; name: string; picks: Record<string, string[]>; created_at: string };

function heatBg(winPct: number | null, isOptimal: boolean): string {
  if (isOptimal) return "rgba(168, 85, 247, 0.45)";
  if (winPct == null) return "transparent";
  const t = Math.max(0, Math.min(1, (winPct - 0.5) / 0.45));
  return `rgba(230, 185, 60, ${(0.08 + t * 0.5).toFixed(2)})`;
}

type CellStatus = "bye" | "ineligible" | "team-used" | "week-locked" | "selected" | "open" | "played";

export default function SurvivorBoardPanel({ initialRules = "survivor" }: { initialRules?: SurvivorRules; onBack?: () => void }) {
  const [rules, setRules] = useState<SurvivorRules>(initialRules);
  const [source, setSource] = useState<ProjectionSource>("yc");
  const [view, setView] = useState<"spread" | "moneyline" | "winpct">("spread");
  const [selectedConfs, setSelectedConfs] = useState<Set<string>>(new Set(DEFAULT_CONFERENCES));
  const [hideUsed, setHideUsed] = useState(false);
  const [sortWeekKey, setSortWeekKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [sortByPicks, setSortByPicks] = useState(false);
  const [editPlayed, setEditPlayed] = useState(false);

  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [picksLoaded, setPicksLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);
  const dirty = useRef(false);

  const [savedPaths, setSavedPaths] = useState<SavedPath[]>([]);
  const [showSavedPaths, setShowSavedPaths] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [excludedTeams, setExcludedTeams] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedSearch, setExcludedSearch] = useState("");
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [objective, setObjective] = useState<SurvivorObjective>("maxSurvivalProb");
  const [optimizerResult, setOptimizerResult] = useState<OptimizerResult | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // ---- Data ----
  const [games, setGames] = useState<GameWithLines[]>([]);
  useEffect(() => {
    fetchGamesWithLines(SEASON).then(setGames).catch(() => setGames([]));
  }, []);
  const weeks = useMemo(() => Array.from(new Set(games.map((g) => g.week))), [games]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(SEASON, weeks, SEASON);
  const { locks } = useGameProjectionLocks(SEASON, weeks);
  const { results: mcResults } = useLatestMonteCarloRun(SEASON);
  // Conf Championship week: real title games once scheduled, else the two likeliest finalists per conference from
  // the latest Monte Carlo run, rated with the most recent saved ratings.
  const board = useMemo(() => {
    const real = buildBoardGames(games, ratingsByWeek, locks);
    const champWeek = SURVIVOR_WEEKS.find((w) => w.key === "champ")?.dataWeek ?? 14;
    const scheduled = new Set(real.filter((g) => g.week === champWeek).flatMap((g) => [g.home, g.away]));
    const latestWeek = Math.max(0, ...Object.keys(ratingsByWeek).map(Number).filter((w) => Object.keys(ratingsByWeek[w] ?? {}).length > 0));
    return new Board([...real, ...projectChampGames(mcResults, ratingsByWeek[latestWeek] ?? {}, champWeek, scheduled)]);
  }, [games, ratingsByWeek, locks, mcResults]);

  // ---- Picks: load per pool, save on change (debounced) ----
  useEffect(() => {
    let cancelled = false;
    setPicksLoaded(false);
    dirty.current = false;
    setOptimizerResult(null);
    fetchWorkingPicks(SEASON, rules)
      .then(({ picks: p, fromLegacy }) => {
        if (cancelled) return;
        setPicks(p);
        setPicksLoaded(true);
        if (fromLegacy) {
          dirty.current = true; // copy the old browser-only picks into the database
          setNote("Loaded your picks from this browser and saved them to the database.");
        }
      })
      .catch((e) => !cancelled && setNote(`Couldn't load saved picks: ${e.message}`));
    PATHS[rules].fetch().then(setSavedPaths).catch((e) => setPathError(e.message));
    EXCLUDED[rules].fetch().then(setExcludedTeams).catch(() => setExcludedTeams(new Set()));
    return () => {
      cancelled = true;
    };
  }, [rules]);

  useEffect(() => {
    if (!picksLoaded || !dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      saveWorkingPicks(SEASON, rules, picks)
        .then(() => {
          dirty.current = false;
          setSaveState("saved");
        })
        .catch((e) => {
          setSaveState("error");
          setNote(`Picks not saved: ${e.message}`);
        });
    }, 700);
    return () => clearTimeout(t);
  }, [picks, picksLoaded, rules]);

  function updatePicks(fn: (prev: Record<string, string[]>) => Record<string, string[]>) {
    dirty.current = true;
    setPicks(fn);
  }

  // ---- Board helpers ----
  const allConfs = useMemo(() => availableConferences(), []);
  const champTeams = useMemo(() => {
    const champ = SURVIVOR_WEEKS.find((w) => w.key === "champ");
    return new Set(champ ? board.games.filter((g) => g.week === champ.dataWeek).flatMap((g) => [g.home, g.away]) : []);
  }, [board]);
  const teams = useMemo(() => rowTeamsFor(rules, selectedConfs, champTeams), [rules, selectedConfs, champTeams]);
  const usedTeams = useMemo(() => allUsedTeams(picks), [picks]);
  const played = useMemo(() => new Set(SURVIVOR_WEEKS.filter((w) => board.isPlayed(w)).map((w) => w.key)), [board]);

  function cellInfo(teamName: string, week: SurvivorWeek) {
    const team = teams.find((t) => t.team === teamName);
    const g = board.game(teamName, week);
    const opp = g ? board.opponent(g, teamName) : undefined;
    const eligible = !!team && !!g && isEligible(rules, team, opp, selectedConfs, week);
    return { g, opp, eligible };
  }

  function status(teamName: string, week: SurvivorWeek, g: ReturnType<typeof cellInfo>["g"], eligible: boolean): CellStatus {
    if (!g) return "bye";
    const weekPicks = picks[week.key] || [];
    if (weekPicks.includes(teamName)) return "selected";
    if (played.has(week.key) && !editPlayed) return "played";
    if (!eligible) return "ineligible";
    if (teamsUsedElsewhere(picks, week.key).has(teamName)) return "team-used";
    if (weekPicks.length >= 2) return "week-locked";
    return "open";
  }

  // Ranks: biggest favorite of the week, and this team's biggest favorite of the season, among eligible games.
  const ranks = useMemo(() => {
    const entries: { team: string; week: string; spread: number }[] = [];
    for (const t of teams)
      for (const w of SURVIVOR_WEEKS) {
        const g = board.game(t.team, w);
        if (!g || !isEligible(rules, t, board.opponent(g, t.team), selectedConfs, w)) continue;
        const s = board.spread(t.team, g, source);
        if (s) entries.push({ team: t.team, week: w.key, spread: s.value });
      }
    const out = new Map<string, { weekRank: number; weekPool: number; seasonRank: number; seasonPool: number }>();
    const group = (keyOf: (e: (typeof entries)[number]) => string) => {
      const m = new Map<string, typeof entries>();
      for (const e of entries) m.set(keyOf(e), [...(m.get(keyOf(e)) ?? []), e]);
      return m;
    };
    const wk = group((e) => e.week);
    const yr = group((e) => e.team);
    for (const e of entries) {
      const wl = [...wk.get(e.week)!].sort((a, b) => a.spread - b.spread);
      const yl = [...yr.get(e.team)!].sort((a, b) => a.spread - b.spread);
      out.set(`${e.team}::${e.week}`, { weekRank: wl.indexOf(e) + 1, weekPool: wl.length, seasonRank: yl.indexOf(e) + 1, seasonPool: yl.length });
    }
    return out;
  }, [teams, board, rules, selectedConfs, source]);

  const pickOrder = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const w of SURVIVOR_WEEKS) for (const t of picks[w.key] || []) m.set(t, i++);
    return m;
  }, [picks]);

  const visible = useMemo(() => teams.filter((t) => !hideUsed || !usedTeams.has(t.team)), [teams, hideUsed, usedTeams]);
  const sorted = useMemo(() => {
    if (sortByPicks)
      return [...visible].sort((a, b) => {
        const ia = pickOrder.get(a.team);
        const ib = pickOrder.get(b.team);
        if (ia == null && ib == null) return a.team.localeCompare(b.team);
        if (ia == null) return 1;
        if (ib == null) return -1;
        return ia - ib;
      });
    if (!sortWeekKey) return visible;
    const week = SURVIVOR_WEEKS.find((w) => w.key === sortWeekKey)!;
    const val = (t: string) => {
      const g = board.game(t, week);
      return g ? board.spread(t, g, source)?.value ?? null : null;
    };
    return [...visible].sort((a, b) => {
      const sa = val(a.team);
      const sb = val(b.team);
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sortDir === "asc" ? sa - sb : sb - sa;
    });
  }, [visible, sortByPicks, pickOrder, sortWeekKey, sortDir, board, source]);

  function clickCell(teamName: string, week: SurvivorWeek, st: CellStatus) {
    if (st !== "open" && st !== "selected") return;
    if (st === "selected" && played.has(week.key) && !editPlayed) return;
    updatePicks((prev) => {
      const wp = prev[week.key] || [];
      if (wp.includes(teamName)) return { ...prev, [week.key]: wp.filter((t) => t !== teamName) };
      if (teamsUsedElsewhere(prev, week.key).has(teamName) || wp.length >= 2) return prev;
      return { ...prev, [week.key]: [...wp, teamName] };
    });
  }

  // ---- Optimizer ----
  const openWeeks = useMemo(() => SURVIVOR_WEEKS.filter((w) => !played.has(w.key) && (picks[w.key] || []).length < 2), [played, picks]);

  function runOptimizer() {
    const teamByName = new Map(teams.map((t) => [t.team, t]));
    const result = optimizeSurvivorPath(
      picks,
      objective,
      openWeeks,
      teams.map((t) => t.team).filter((t) => !excludedTeams.has(t)),
      {
        winProb: (team, week) => {
          const g = board.game(team, week);
          const t = teamByName.get(team);
          if (!g || !t || !isEligible(rules, t, board.opponent(g, team), selectedConfs, week)) return null;
          const wp = board.winPct(team, g, source);
          // A projected title game only counts as often as the team actually gets there.
          if (wp != null && g.projected) return wp * ((g.home === team ? g.madeHome : g.madeAway) ?? 0);
          return wp;
        },
        areOpponents: (a, b, week) => {
          const g = board.game(a, week);
          return !!g && (g.home === b || g.away === b);
        },
      }
    );
    setOptimizerResult(result);
  }

  async function applyOptimizer() {
    if (!optimizerResult) return;
    const willReplace = optimizerResult.picks.some((p) => p.team && (picks[p.weekKey] || []).length > 0);
    if (Object.values(picks).some((t) => t.length > 0)) {
      const msg = willReplace
        ? "Applying replaces the picks you've made in weeks that aren't full yet. Save your current picks as a path first?"
        : "Save your current picks as a path before applying?";
      if (window.confirm(msg)) {
        const saved = await savePath();
        if (!saved) return;
      }
    }
    updatePicks((prev) => {
      const next = { ...prev };
      const touched = new Set(optimizerResult.picks.map((p) => p.weekKey));
      for (const wk of touched) next[wk] = [];
      for (const p of optimizerResult.picks) if (p.team) next[p.weekKey] = [...(next[p.weekKey] ?? []), p.team];
      return next;
    });
    setOptimizerResult(null);
  }

  // ---- Paths / excluded / export ----
  async function savePath(): Promise<boolean> {
    const name = window.prompt('Name this path (e.g. "Safe start", "Save Ohio State for champ week"):');
    if (!name) return false;
    setPathError(null);
    try {
      await PATHS[rules].save(name, picks);
      setSavedPaths(await PATHS[rules].fetch());
      return true;
    } catch (e: any) {
      setPathError(e.message);
      return false;
    }
  }

  async function toggleExcluded(team: string) {
    const now = !excludedTeams.has(team);
    setExcludedTeams((prev) => {
      const n = new Set(prev);
      if (now) n.add(team);
      else n.delete(team);
      return n;
    });
    try {
      await EXCLUDED[rules].set(team, now);
    } catch {
      EXCLUDED[rules].fetch().then(setExcludedTeams).catch(() => {});
    }
  }

  async function exportPng() {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      await exportNodeAsPng(exportRef.current, `${rules}-path`);
    } finally {
      setExporting(false);
    }
  }

  const fullWeeks = SURVIVOR_WEEKS.filter((w) => (picks[w.key] || []).length === 2).length;
  const btn = (on: boolean) => `mode-btn ${on ? "mode-btn-active" : ""}`;
  const panelBox = { marginBottom: "1rem", padding: "0.75rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8 } as const;

  return (
    <div style={{ padding: "1rem 0 3rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0 }}>Survivor</h2>
          <p style={{ margin: "0.25rem 0 0", color: "var(--chalk-dim)", fontSize: "0.9rem" }}>
            {fullWeeks} of {SURVIVOR_WEEKS.length} weeks set · {usedTeams.size} teams used ·{" "}
            {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : saveState === "error" ? <span style={{ color: "var(--c-err)" }}>not saved</span> : "picks saved to the database"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button className={btn(rules === "survivor")} onClick={() => setRules("survivor")}>Survivor</button>
          <button className={btn(rules === "splash")} onClick={() => setRules("splash")}>Splash</button>
          <span style={{ width: 8 }} />
          <button className={btn(source === "yc")} onClick={() => setSource("yc")} title="YC projection; played games use the frozen pregame lock">YC</button>
          <button className={btn(source === "vegas")} onClick={() => setSource("vegas")} title="Vegas line where one is posted, else YC">Vegas</button>
          <span style={{ width: 8 }} />
          <button className={btn(view === "spread")} onClick={() => setView("spread")}>Spread</button>
          <button className={btn(view === "moneyline")} onClick={() => setView("moneyline")}>Moneyline</button>
          <button className={btn(view === "winpct")} onClick={() => setView("winpct")}>Win %</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <button className="menu-btn" onClick={() => setHideUsed((v) => !v)} style={{ opacity: hideUsed ? 1 : 0.7 }}>
          {hideUsed ? "Showing eligible only" : "Hide used teams"}
        </button>
        <button className={btn(sortByPicks)} onClick={() => setSortByPicks((v) => !v)}>Sort by picks</button>
        <button className={btn(editPlayed)} onClick={() => setEditPlayed((v) => !v)} title="Played weeks are read-only; turn this on to correct a past pick">
          Edit played weeks
        </button>
        <button className="menu-btn" onClick={() => window.confirm("Clear every pick in this pool? Played weeks too.") && updatePicks(() => ({}))}>Reset all</button>
        <button className="menu-btn" onClick={savePath}>Save path</button>
        <button className="menu-btn" onClick={() => setShowSavedPaths((v) => !v)}>
          {showSavedPaths ? "Hide" : "Show"} saved paths ({savedPaths.length})
        </button>
        <button className="menu-btn" onClick={exportPng} disabled={exporting}>{exporting ? "Exporting…" : "Export as PNG"}</button>
        <button className="menu-btn" onClick={() => setShowOptimizer((v) => !v)}>{showOptimizer ? "Hide" : "Show"} optimizer</button>
        {POOL_URL[rules] && (
          <a href={POOL_URL[rules]!} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
            Open pool ↗
          </a>
        )}
      </div>

      <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "rgba(230, 185, 60, 0.55)" }} /> Brighter = safer
        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "rgba(168, 85, 247, 0.45)", marginLeft: "0.5rem" }} /> Biggest favorite of the week
        <span style={{ marginLeft: "0.5rem" }}>
          {rules === "survivor" ? "Eligible: both teams in a selected conference." : "Eligible: any FBS game except Group of 6 vs Group of 6."} Win % is Bill R's curve on the spread
          shown, so the views agree. No home field at neutral sites.
        </span>
      </div>

      {note && <p style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>{note}</p>}
      {pathError && <p style={{ color: "var(--c-err)", fontSize: "0.82rem" }}>{pathError}</p>}

      {showOptimizer && (
        <div style={panelBox}>
          <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>Optimizer</div>
          <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: 0 }}>
            Fills the {openWeeks.length} weeks that aren't played and don't have 2 picks yet, using the {source === "yc" ? "YC projections" : "Vegas lines (YC where no line yet)"} on
            the board and the same eligibility rule. Conference Championship week uses each team's Monte Carlo odds to win its conference. Applying offers to save
            your current picks as a path first.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <button className={btn(objective === "maxSurvivalProb")} onClick={() => setObjective("maxSurvivalProb")}>Maximize full-season survival odds</button>
            <button className={btn(objective === "maxExpectedWeeks")} onClick={() => setObjective("maxExpectedWeeks")}>Maximize expected weeks survived</button>
            <button className="menu-btn" onClick={runOptimizer}>Run optimizer</button>
            <button className="menu-btn" onClick={() => setShowExcluded((v) => !v)}>
              {showExcluded ? "Hide" : "Show"} don't-use list ({excludedTeams.size})
            </button>
          </div>
          {showExcluded && (
            <div style={{ marginBottom: "0.75rem", padding: "0.6rem", background: "rgba(0,0,0,0.15)", borderRadius: 6, maxHeight: 260, overflowY: "auto" }}>
              <input type="text" placeholder="Search teams…" value={excludedSearch} onChange={(e) => setExcludedSearch(e.target.value)} style={{ width: 200, marginBottom: "0.5rem" }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.3rem" }}>
                {teams
                  .filter((t) => t.team.toLowerCase().includes(excludedSearch.trim().toLowerCase()))
                  .map((t) => (
                    <label key={t.team} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
                      <input type="checkbox" checked={excludedTeams.has(t.team)} onChange={() => toggleExcluded(t.team)} />
                      <TeamLogo team={t.team} size={16} /> {t.team}
                    </label>
                  ))}
              </div>
            </div>
          )}
          {optimizerResult && (
            <div>
              <div style={{ marginBottom: "0.5rem" }}>
                {optimizerResult.survivalProb != null && (
                  <span style={{ marginRight: "1.5rem" }}>
                    <strong>{(optimizerResult.survivalProb * 100).toFixed(2)}%</strong> <span style={{ color: "var(--chalk-dim)" }}>chance of clearing every optimized week</span>
                  </span>
                )}
                {optimizerResult.expectedWeeksAdded != null && (
                  <span>
                    <strong>{optimizerResult.expectedWeeksAdded.toFixed(2)}</strong> <span style={{ color: "var(--chalk-dim)" }}>expected weeks added</span>
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.6rem" }}>
                {SURVIVOR_WEEKS.map((week) => {
                  const wp = optimizerResult.picks.filter((p) => p.weekKey === week.key);
                  if (wp.length === 0) return null;
                  return (
                    <div key={week.key} style={{ display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.85rem" }}>
                      <span style={{ width: 130, color: "var(--chalk-dim)" }}>{week.label}</span>
                      {wp.map((p, i) => (
                        <span key={i} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                          {p.team ? (
                            <>
                              <TeamLink team={p.team} size={18} /> <span style={{ color: "var(--chalk-dim)" }}>{p.winProb != null ? `(${(p.winProb * 100).toFixed(1)}%)` : ""}</span>
                            </>
                          ) : (
                            <span style={{ color: "var(--chalk-dim)" }}>no eligible team</span>
                          )}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <button className="menu-btn" onClick={applyOptimizer}>Apply to working picks</button>
            </div>
          )}
        </div>
      )}

      {showSavedPaths && (
        <div style={panelBox}>
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Saved paths ({rules === "survivor" ? "Survivor" : "Splash"})</div>
          {savedPaths.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", margin: 0 }}>No paths saved yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {savedPaths.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span>
                    <strong>{p.name}</strong>{" "}
                    <span style={{ color: "var(--chalk-dim)", fontSize: "0.8rem" }}>
                      · {Object.values(p.picks).filter((t) => t.length > 0).length} weeks set · {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="menu-btn" onClick={() => window.confirm(`Load "${p.name}"? This replaces your working picks.`) && updatePicks(() => p.picks)}>Load</button>
                    <button
                      className="menu-btn"
                      onClick={async () => {
                        if (!window.confirm("Delete this saved path?")) return;
                        try {
                          await PATHS[rules].del(p.id);
                          setSavedPaths(await PATHS[rules].fetch());
                        } catch (e: any) {
                          setPathError(e.message);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rules === "survivor" && (
        <div style={{ ...panelBox, display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginRight: "0.5rem", alignSelf: "center" }}>Conferences:</span>
          {allConfs.map((conf) => {
            const active = selectedConfs.has(conf);
            return (
              <button
                key={conf}
                onClick={() =>
                  setSelectedConfs((prev) => {
                    const n = new Set(prev);
                    if (n.has(conf)) n.delete(conf);
                    else n.add(conf);
                    return n;
                  })
                }
                style={{
                  fontSize: "0.78rem",
                  padding: "0.3rem 0.6rem",
                  borderRadius: 6,
                  border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
                  background: active ? "var(--gold-dim)" : "transparent",
                  color: active ? "var(--chalk)" : "var(--chalk-dim)",
                  cursor: "pointer",
                }}
              >
                {conf}
              </button>
            );
          })}
        </div>
      )}

      <div ref={exportRef} style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, background: "var(--turf)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--turf-panel-2)", padding: "0.5rem 0.75rem", textAlign: "left", minWidth: 150, borderBottom: "1px solid var(--hash)" }}>
                Team
              </th>
              {SURVIVOR_WEEKS.map((w) => {
                const full = (picks[w.key] || []).length === 2;
                const isPlayed = played.has(w.key);
                const isSorted = sortWeekKey === w.key;
                return (
                  <th
                    key={w.key}
                    onClick={() => {
                      if (sortWeekKey === w.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      else {
                        setSortWeekKey(w.key);
                        setSortDir("asc");
                      }
                    }}
                    style={{
                      padding: "0.4rem 0.5rem",
                      textAlign: "center",
                      minWidth: 92,
                      borderBottom: "1px solid var(--hash)",
                      background: full || isPlayed ? "var(--a-tint-2)" : "var(--turf-panel-2)",
                      color: full || isPlayed ? "var(--chalk-dim)" : "var(--chalk)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}>
                      {w.label}
                      <span style={{ fontSize: "0.6rem", opacity: isSorted ? 1 : 0.35 }}>{isSorted ? (sortDir === "asc" ? "▲" : "▼") : "—"}</span>
                    </div>
                    <div style={{ fontWeight: 400, fontSize: "0.68rem", opacity: 0.7 }}>{isPlayed ? "played" : w.lockLabel}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((team) => (
              <tr key={team.team}>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    background: "var(--turf-panel)",
                    padding: "0.4rem 0.75rem",
                    borderBottom: "1px solid var(--hash)",
                    textDecoration: usedTeams.has(team.team) ? "line-through" : "none",
                    opacity: usedTeams.has(team.team) ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <TeamLogo team={team} />
                    {team.team}
                  </span>
                </td>
                {SURVIVOR_WEEKS.map((week) => {
                  const { g, opp, eligible } = cellInfo(team.team, week);
                  if (!g) {
                    return (
                      <td key={week.key} style={{ textAlign: "center", padding: "0.4rem", borderBottom: "1px solid var(--hash)", color: "var(--chalk-dim)" }}>
                        –
                      </td>
                    );
                  }
                  const st = status(team.team, week, g, eligible);
                  const sp = board.spread(team.team, g, source);
                  const wp = board.winPct(team.team, g, source);
                  const rank = ranks.get(`${team.team}::${week.key}`);
                  const dim = st === "ineligible" || st === "team-used" || st === "week-locked" || st === "played";
                  const res = st === "selected" ? board.result(team.team, g) : null;
                  const bg = st === "selected" ? (res === "won" ? "rgba(34,197,94,0.35)" : res === "lost" ? "rgba(239,68,68,0.35)" : "var(--gold-dim)") : dim ? "var(--a-tint-1)" : heatBg(wp, rank?.weekRank === 1);
                  const tip =
                    st === "ineligible"
                      ? rules === "survivor"
                        ? "Opponent's conference isn't selected"
                        : "Group of 6 vs Group of 6, or not an FBS opponent"
                      : st === "team-used"
                        ? "Team already used in another week"
                        : st === "week-locked"
                          ? "Both picks already made for this week"
                          : st === "played"
                            ? "Played week (read-only)"
                            : undefined;
                  const clickable = st === "open" || (st === "selected" && (!played.has(week.key) || editPlayed));
                  return (
                    <td
                      key={week.key}
                      onClick={() => clickable && clickCell(team.team, week, st)}
                      className={tip ? "cell-tip" : undefined}
                      data-tip={tip}
                      style={{
                        textAlign: "center",
                        padding: "0.35rem 0.4rem",
                        borderBottom: "1px solid var(--hash)",
                        background: bg,
                        cursor: clickable ? "pointer" : "not-allowed",
                        opacity: dim ? 0.4 : 1,
                        textDecoration: st === "ineligible" || st === "team-used" ? "line-through" : "none",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {g.neutral ? "vs " : g.home === team.team ? "" : "@"}
                        {opp ? opp.team : g.home === team.team ? g.away : g.home}
                        {res && <span style={{ marginLeft: 3 }}>{res === "won" ? "✓" : res === "lost" ? "✗" : "="}</span>}
                      </div>
                      {g.projected && (
                        <div
                          className="cell-tip"
                          data-tip={`Projected title game from the latest Monte Carlo run. ${team.team} makes it ${Math.round(((g.home === team.team ? g.madeHome : g.madeAway) ?? 0) * 100)}% of the time; the optimizer counts win % × that.`}
                          style={{ fontSize: "0.6rem", opacity: 0.7 }}
                        >
                          proj · {Math.round(((g.home === team.team ? g.madeHome : g.madeAway) ?? 0) * 100)}% to make
                        </div>
                      )}
                      {view === "spread" && sp && (
                        <div style={{ fontSize: "0.68rem", opacity: 0.75 }} title={sp.source === "vegas" ? "Vegas line" : g.locked ? "Frozen pregame YC projection" : "YC projection"}>
                          {sp.value > 0 ? "+" : ""}
                          {sp.value.toFixed(1)}
                          {source === "vegas" && sp.source === "yc" ? "*" : ""}
                        </div>
                      )}
                      {view === "moneyline" && wp != null && (
                        <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                          {(() => {
                            const ml = fairMoneylineFromWinPct(wp);
                            return ml == null ? "–" : `${ml > 0 ? "+" : ""}${Math.round(ml)}`;
                          })()}
                        </div>
                      )}
                      {view === "winpct" && wp != null && <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>{(wp * 100).toFixed(1)}%</div>}
                      {rank && !dim && (
                        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.15rem", fontSize: "0.6rem", fontWeight: 700 }}>
                          <span className="cell-tip" data-tip={`${rank.weekRank} biggest favorite of ${rank.weekPool} pickable games this week`} style={{ padding: "0.05rem 0.3rem", borderRadius: 999, background: "var(--a-tint-3)", color: "var(--chalk-dim)" }}>
                            Wk #{rank.weekRank}
                          </span>
                          <span
                            className="cell-tip"
                            data-tip={`${team.team}'s ${rank.seasonRank} biggest favorite of ${rank.seasonPool} pickable games this season`}
                            style={{ padding: "0.05rem 0.3rem", borderRadius: 999, background: rank.seasonRank === 1 ? "var(--gold-dim)" : "var(--a-tint-3)", color: rank.seasonRank === 1 ? "var(--chalk)" : "var(--chalk-dim)" }}
                          >
                            Yr #{rank.seasonRank}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {source === "vegas" && <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>* No Vegas line posted yet, so the YC projection is shown.</p>}
    </div>
  );
}
