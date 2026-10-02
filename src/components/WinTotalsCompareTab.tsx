import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "./SortHeader";
import TeamLink from "./TeamLink";
import { TEAMS } from "../data/teams";
import { fetchGamesWithLines } from "../lib/api/gamesLines";
import { fetchAvailableWeeks } from "../lib/api/weeklyStats";
import { fetchLatestMonteCarloRunPerWeek, fetchMonteCarloRun } from "../lib/api/monteCarlo";
import { fetchPowerRatingWinTotals } from "../lib/api/powerWinTotals";
import type { ProjectedWins } from "../lib/reportOverlays";

const cell: CSSProperties = { padding: "0.3rem 0.55rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

function weekNumber(label: string): number {
  if (label === "preseason") return 0;
  const m = /^week(\d+)$/.exec(label);
  return m ? parseInt(m[1], 10) : -1;
}
const f2 = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(2));
const signed = (v: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);

interface McWeek {
  meanWins: Record<string, number>;
  currentWins: Record<string, number>;
}

/**
 * Win totals two ways, by week: the mean from that week's saved Monte Carlo
 * run, and the power-ratings projection (wins banked through that week + each
 * remaining game's win probability off that week's saved ratings). Single-week
 * view shows both side by side with the gap; All-weeks view lays one measure
 * out across every week.
 */
export default function WinTotalsCompareTab({ season }: { season: number }) {
  const [mcByWeek, setMcByWeek] = useState<Record<number, McWeek>>({});
  const [prByWeek, setPrByWeek] = useState<Record<number, Record<string, ProjectedWins>>>({});
  const [weeks, setWeeks] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"week" | "all">("week");
  const [week, setWeek] = useState<number | null>(null);
  const [measure, setMeasure] = useState<"mc" | "pr" | "diff">("diff");
  const [division, setDivision] = useState<"FBS" | "FCS" | "all">("FBS");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("diff");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [runs, labels, games] = await Promise.all([fetchLatestMonteCarloRunPerWeek(season), fetchAvailableWeeks(), fetchGamesWithLines(season)]);
        const mc: Record<number, McWeek> = {};
        for (const r of runs) {
          const run = await fetchMonteCarloRun(r.id);
          if (!run) continue;
          mc[r.week] = {
            meanWins: Object.fromEntries(run.results.map((x) => [x.team, x.meanWins])),
            currentWins: Object.fromEntries(run.results.map((x) => [x.team, x.currentWins])),
          };
        }
        const weekSet = new Set<number>([...Object.keys(mc).map(Number), ...labels.map(weekNumber).filter((n) => n >= 1)]);
        const sorted = Array.from(weekSet).sort((a, b) => a - b);
        const pr: Record<number, Record<string, ProjectedWins>> = {};
        for (const w of sorted) pr[w] = await fetchPowerRatingWinTotals(season, w, games);
        if (cancelled) return;
        setMcByWeek(mc);
        setPrByWeek(pr);
        setWeeks(sorted);
        setWeek((cur) => cur ?? sorted[sorted.length - 1] ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load win totals");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season]);

  const teams = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEAMS.filter((t) => (division === "all" || t.div === division) && (!q || t.team.toLowerCase().includes(q)));
  }, [division, query]);

  const rows = useMemo(() => {
    const out = teams.map((t) => {
      const mcVal = (w: number) => mcByWeek[w]?.meanWins[t.team] ?? null;
      const prVal = (w: number) => prByWeek[w]?.[t.team]?.projTotal ?? null;
      const base: Record<string, any> = { team: t.team, conf: t.conf, div: t.div };
      if (view === "week" && week != null) {
        const pr = prByWeek[week]?.[t.team];
        const mc = mcVal(week);
        base.mc = mc;
        base.pr = pr ? pr.projTotal : null;
        base.diff = mc != null && pr ? pr.projTotal - mc : null;
        base.record = pr ? `${pr.wins}-${pr.losses}` : "–";
        base.prLeft = pr ? pr.winsLeft : null;
        base.mcLeft = mc != null && pr ? mc - pr.wins : null;
      } else {
        for (const w of weeks) {
          const mc = mcVal(w);
          const pr = prVal(w);
          base[`w${w}`] = measure === "mc" ? mc : measure === "pr" ? pr : mc != null && pr != null ? pr - mc : null;
        }
      }
      return base;
    });
    return out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [teams, mcByWeek, prByWeek, view, week, weeks, measure, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team" || key === "conf" ? "asc" : "desc");
    }
  }

  const gap = (v: number | null) => ({ color: v == null ? undefined : v > 0.25 ? "#8fd39a" : v < -0.25 ? "#c45c52" : undefined });

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Two projections of each team's final win total, week by week. <b>Monte Carlo</b> = mean wins from that week's saved simulation run.{" "}
        <b>Power ratings</b> = wins already banked through that week + the sum of each remaining game's win probability from that week's saved ratings (the same
        number the public Win Totals page and weekly report use). Difference = power ratings − Monte Carlo.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        {(["week", "all"] as const).map((v) => (
          <button key={v} className={`mode-btn ${view === v ? "mode-btn-active" : ""}`} onClick={() => setView(v)}>
            {v === "week" ? "Single week" : "All weeks"}
          </button>
        ))}
        {view === "week" ? (
          <select className="filter" value={week ?? ""} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
                {mcByWeek[w] ? "" : " (no Monte Carlo run)"}
              </option>
            ))}
          </select>
        ) : (
          <select className="filter" value={measure} onChange={(e) => setMeasure(e.target.value as "mc" | "pr" | "diff")}>
            <option value="diff">Difference (PR − MC)</option>
            <option value="mc">Monte Carlo wins</option>
            <option value="pr">Power ratings wins</option>
          </select>
        )}
        {(["FBS", "FCS", "all"] as const).map((d) => (
          <button key={d} className={`mode-btn ${division === d ? "mode-btn-active" : ""}`} onClick={() => setDivision(d)}>
            {d === "all" ? "All" : d}
          </button>
        ))}
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 190 }} />
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p>Loading every week's run and ratings…</p>
      ) : weeks.length === 0 ? (
        <p>No saved Monte Carlo runs or weekly ratings for {season} yet.</p>
      ) : (
        <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 760, overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                {view === "week" ? (
                  <>
                    <SortHeader label="Monte Carlo" sortKey="mc" active={sortKey === "mc"} dir={sortDir} onClick={handleSort} align="right" />
                    <SortHeader label="Power Ratings" sortKey="pr" active={sortKey === "pr"} dir={sortDir} onClick={handleSort} align="right" />
                    <SortHeader label="Diff (PR − MC)" sortKey="diff" active={sortKey === "diff"} dir={sortDir} onClick={handleSort} align="right" />
                    <th className="th th-right">Record</th>
                    <SortHeader label="PR wins left" sortKey="prLeft" active={sortKey === "prLeft"} dir={sortDir} onClick={handleSort} align="right" />
                    <SortHeader label="MC wins left" sortKey="mcLeft" active={sortKey === "mcLeft"} dir={sortDir} onClick={handleSort} align="right" />
                  </>
                ) : (
                  weeks.map((w) => <SortHeader key={w} label={`Wk ${w}`} sortKey={`w${w}`} active={sortKey === `w${w}`} dir={sortDir} onClick={handleSort} align="right" />)
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team}>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    <TeamLink team={r.team} />
                  </td>
                  <td style={cell}>{r.conf}</td>
                  {view === "week" ? (
                    <>
                      <td style={num}>{f2(r.mc)}</td>
                      <td style={num}>{f2(r.pr)}</td>
                      <td style={{ ...num, ...gap(r.diff) }}>{signed(r.diff)}</td>
                      <td style={num}>{r.record}</td>
                      <td style={num}>{f2(r.prLeft)}</td>
                      <td style={num}>{f2(r.mcLeft)}</td>
                    </>
                  ) : (
                    weeks.map((w) => (
                      <td key={w} style={{ ...num, ...(measure === "diff" ? gap(r[`w${w}`]) : {}) }}>
                        {measure === "diff" ? signed(r[`w${w}`]) : f2(r[`w${w}`])}
                      </td>
                    ))
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    No teams match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
