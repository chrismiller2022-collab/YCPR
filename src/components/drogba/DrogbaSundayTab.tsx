import { useEffect, useMemo, useState } from "react";
import { fetchDrogbaPicks, type DrogbaPickRow } from "../../lib/api/drogbaData";
import { fetchGameProjectionLocks, type GameProjectionLockRow } from "../../lib/api/gameProjectionLocks";
import { buildHealth, type Check, type Status } from "../../lib/drogba/health";
import { currentWeekSplit, DEFAULT_MIN_EDGE, fitForWeek, projectWeek } from "../../lib/drogba/weekPlan";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import SundayBetList from "./SundayBetList";
import SundayReports from "./SundayReports";
import SundayRunner, { type RunDiff } from "./SundayRunner";
import { DIM, H3, P } from "./shared";

const COLORS: Record<Status, string> = { ok: "#8fd39a", warn: "#e8c84a", bad: "#e07a7a", info: "var(--chalk-dim)" };
const MARK: Record<Status, string> = { ok: "✓", warn: "!", bad: "✗", info: "·" };

function CheckRow({ c }: { c: Check }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0.45rem 0" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline" }}>
        <span style={{ color: COLORS[c.status], fontWeight: 700, width: "1rem", textAlign: "center" }}>{MARK[c.status]}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{c.label}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>{c.summary}</div>
          {open && c.items.length > 0 && (
            <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem", fontSize: "0.78rem" }}>
              {c.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
        </div>
        {c.items.length > 0 && (
          <button className="menu-btn" onClick={() => setOpen(!open)} style={{ fontSize: "0.72rem", padding: "0.1rem 0.5rem" }}>
            {open ? "Hide" : `Show ${c.items.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

// Read-only checklist for the Sunday routine. It changes nothing: it reads what is in the database and what the
// model says now, and says what is missing before any betting decision gets made on it.
export default function DrogbaSundayTab({ state }: { state: DrogbaState }) {
  const split = useMemo(() => currentWeekSplit(state.games), [state.games]);
  const [weekOverride, setWeekOverride] = useState<number | null>(null);
  const [picks, setPicks] = useState<DrogbaPickRow[] | null>(null);
  const [locks, setLocks] = useState<Record<string, GameProjectionLockRow>>({});
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [minEdge, setMinEdge] = useState(DEFAULT_MIN_EDGE);
  const [diff, setDiff] = useState<RunDiff | null>(null);

  const effective = useMemo(() => {
    if (!split) return null;
    if (weekOverride == null) return split;
    return { ...split, upcoming: weekOverride, last: weekOverride - 1 };
  }, [split, weekOverride]);

  useEffect(() => {
    if (!effective) return;
    let cancelled = false;
    setError(null);
    Promise.all([fetchDrogbaPicks(), fetchGameProjectionLocks(effective.season, [effective.last, effective.upcoming].filter((w) => w >= 1))])
      .then(([p, l]) => {
        if (cancelled) return;
        setPicks(p);
        setLocks(l);
      })
      .catch((e: any) => !cancelled && setError(e?.message ?? "Loading the picks log failed"));
    return () => {
      cancelled = true;
    };
  }, [effective?.season, effective?.last, effective?.upcoming, nonce, state.games]);

  const upcomingRows = useMemo(() => {
    if (!state.engine || !effective) return [];
    return projectWeek(state.engine, fitForWeek(state.engine, effective.season, effective.upcoming), effective.season, effective.upcoming);
  }, [state.engine, effective]);

  const checks = useMemo(() => {
    if (!state.engine || !effective || !picks) return null;
    return buildHealth({
      split: effective,
      games: state.games,
      gameStats: state.gameStats,
      hasPlays: state.engine.hasPlays,
      hasSt: state.engine.hasSt,
      upcomingRows,
      fanduel: state.fanduelLines,
      picks,
      locks,
      nowMs: Date.now(),
    });
  }, [state.engine, state.games, state.gameStats, state.fanduelLines, effective, picks, locks, upcomingRows]);

  // Only block the whole tab on the very first load: during a reload the run's progress has to stay on screen.
  if (!state.engine && (state.loading || state.building)) return <p style={DIM}>{state.loading ? "Loading data…" : "Building walk-forward ratings (about 5 seconds)…"}</p>;
  if (state.error && !state.engine) return <p style={{ color: "crimson" }}>{state.error}</p>;
  if (!effective) return <p style={DIM}>No games loaded.</p>;

  const bad = checks?.filter((c) => c.status === "bad").length ?? 0;
  const warn = checks?.filter((c) => c.status === "warn").length ?? 0;
  const verdict = !checks ? "Loading…" : bad ? `${bad} problem${bad > 1 ? "s" : ""} to fix before betting` : warn ? `Ready, with ${warn} thing${warn > 1 ? "s" : ""} to look at` : "Everything is in place";
  const verdictColor = bad ? COLORS.bad : warn ? COLORS.warn : COLORS.ok;

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Sunday check</h2>
      <p style={P}>
        One place for the Sunday routine. <strong>Run Sunday routine</strong> pulls last week's results, advanced stats and play-by-play, this week's schedule and lines, and FanDuel's openers, then rebuilds the ratings and shows what moved. <strong>Fill gaps only</strong> fetches
        just what the checklist says is missing (a game whose stats hadn't arrived yet, openers FanDuel hadn't posted). Everything below the buttons updates from the fresh data: the checklist, this week's bet list, last week's report and the season so far.
      </p>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.9rem" }}>
          {effective.season} · last week {effective.last || "–"} · betting week
        </span>
        <select className="filter" value={effective.upcoming} onChange={(e) => setWeekOverride(Number(e.target.value))}>
          {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        {weekOverride != null && (
          <button className="menu-btn" onClick={() => setWeekOverride(null)}>Use current week</button>
        )}
        <button
          className="menu-btn"
          onClick={() => {
            state.reload();
            setNonce((n) => n + 1);
          }}
        >
          Re-check
        </button>
      </div>
      <SundayRunner state={state} split={effective} onDiff={setDiff} />
      {(state.loading || state.building) && <p style={{ ...DIM, color: "#e8c84a" }}>{state.loading ? "Reloading data…" : "Rebuilding ratings…"}</p>}
      <div style={{ fontSize: "1rem", fontWeight: 700, color: verdictColor, margin: "0.8rem 0 0.2rem" }}>{verdict}</div>
      {error && <p style={{ color: "crimson", fontSize: "0.85rem" }}>{error}</p>}
      {checks && (
        <>
          {effective.last >= 1 && (
            <>
              <h3 style={H3}>Last week (week {effective.last})</h3>
              {checks.filter((c) => c.group === "last").map((c) => <CheckRow key={c.id} c={c} />)}
            </>
          )}
          <h3 style={H3}>This week (week {effective.upcoming})</h3>
          {checks.filter((c) => c.group === "upcoming").map((c) => <CheckRow key={c.id} c={c} />)}
          <SundayBetList state={state} split={effective} picks={picks ?? []} minEdge={minEdge} setMinEdge={setMinEdge} diff={diff} onSaved={() => setNonce((n) => n + 1)} />
          <SundayReports state={state} split={effective} picks={picks ?? []} minEdge={minEdge} />
          <p style={DIM}>
            Stats for a game can arrive from CFBD a day or more after it ends; re-run the pull and click Re-check. Ratings for the betting week only use games whose stats are on file, so a missing game above makes the numbers below slightly less sharp until it's pulled.
          </p>
        </>
      )}
    </div>
  );
}
