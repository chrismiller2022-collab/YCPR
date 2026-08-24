import { useEffect, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { TEAMS } from "../data/teams";
import { fetchMonteCarloRuns, fetchMonteCarloRun, type MonteCarloRunSummary } from "../lib/api/monteCarlo";
import { undefeatedPct, winsAtLeastPct, type TeamSimResult } from "../lib/montecarlo/engine";
import { useRef } from "react";

function fmtPct(v: number | null | undefined) {
  return v == null ? "–" : `${v.toFixed(1)}%`;
}

function teamInfo(name: string) {
  return TEAMS.find((t) => t.team === name);
}

// Higher probability = better outcome for every column on this page (bowl,
// playoff, and each bracket round), so cells shade from the site's neutral
// chalk-dim toward green as the percentage climbs toward 100 — no red end,
// since a low % here just means "less likely," not "bad."
function pctColor(v: number | null | undefined): string | undefined {
  if (v == null) return undefined;
  const clamp = Math.max(0, Math.min(100, v));
  const k = clamp / 100;
  const neutral = [139, 171, 228];
  const green = [63, 185, 80];
  const rgb = neutral.map((n, i) => Math.round(n + (green[i] - n) * k));
  return `rgb(${rgb.join(", ")})`;
}

// ---------------------------------------------------------------------
// "Other Futures" — everything the main Win Totals page doesn't cover:
// bowl eligibility, playoff qualification, and the CFP bracket rounds.
// Sourced entirely from saved Monte Carlo runs, one per week (plus the
// most recent being "Live"), the same way Win Totals/Ratings/Resume/SOS
// already browse by week.
// ---------------------------------------------------------------------
export default function OtherFuturesPage({ subKey, subLabel, onNavigateTeam, onNavigateConference, onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [season] = useState(new Date().getFullYear());
  const [runs, setRuns] = useState<MonteCarloRunSummary[]>([]);
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [numTrials, setNumTrials] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<"team" | "conf" | "bowl" | "playoff" | "qf" | "sf" | "ncg" | "winncg">("winncg");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: string) {
    const k = key as typeof sortKey;
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "team" || k === "conf" ? "asc" : "desc");
    }
  }

  const isLive = subKey === "live";
  const weekNum = isLive ? null : parseInt(String(subKey).replace("week", ""), 10);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResults(null);
    fetchMonteCarloRuns(season).then(async (list) => {
      if (cancelled) return;
      setRuns(list);
      const target = isLive ? list[0] : list.find((r) => r.week === weekNum);
      if (target) {
        const run = await fetchMonteCarloRun(target.id);
        if (!cancelled && run) {
          setResults(run.results);
          setNumTrials(run.num_trials);
        }
      }
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [season, isLive, weekNum]);

  const rows = useMemo(() => {
    if (!results) return [];
    const withPct = results.map((r) => ({
      r,
      bowlPct: winsAtLeastPct(r, numTrials, 6),
      undefeatedPct: undefeatedPct(r, numTrials),
    }));

    const valueFor = (row: (typeof withPct)[number]) => {
      switch (sortKey) {
        case "team":
          return row.r.team;
        case "conf":
          return row.r.conf ?? "";
        case "bowl":
          return row.bowlPct;
        case "playoff":
          return row.r.playoffPct;
        case "qf":
          return row.r.quarterfinalPct;
        case "sf":
          return row.r.semifinalPct;
        case "ncg":
          return row.r.nattyGamePct;
        case "winncg":
        default:
          return row.r.nattyPct;
      }
    };

    return [...withPct].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [results, numTrials, sortKey, sortDir]);

  return (
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Futures</div>
        <h1 className="title matchup-title">OTHER FUTURES{isLive ? "" : ` — ${subLabel ?? ""}`}</h1>
        <p className="subtitle team-subtitle">
          Bowl eligibility, playoff qualification, and CFP bracket-round odds — from the Monte
          Carlo simulation saved for this week.
        </p>
      </div>

      <div className="export-toolbar" data-export-exclude="true">
        <ExportPngButton targetRef={exportRef} filename={`other-futures-${isLive ? "live" : subKey}`} />
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty matchups-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty matchups-empty">
            No Monte Carlo run saved for {isLive ? "the current week" : subLabel} yet — check back
            once it's been run and saved.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Bowl (6+ wins)" sortKey="bowl" active={sortKey === "bowl"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Make Playoff" sortKey="playoff" active={sortKey === "playoff"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Make Quarterfinals" sortKey="qf" active={sortKey === "qf"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Make Semifinals" sortKey="sf" active={sortKey === "sf"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Make NCG" sortKey="ncg" active={sortKey === "ncg"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Win NCG" sortKey="winncg" active={sortKey === "winncg"} dir={sortDir} onClick={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, bowlPct }) => {
                  const t = teamInfo(r.team);
                  return (
                    <tr key={r.team}>
                      <td>
                        <button className="team-link" onClick={() => t && onNavigateTeam(t)}>
                          {t && <TeamLogo team={t} />}
                          {r.team}
                        </button>
                      </td>
                      <td className="conf-cell">
                        <ConfLink conf={r.conf} onNavigateConference={onNavigateConference} />
                      </td>
                      <td className="wintotals-total-cell" style={{ color: pctColor(bowlPct) }}>{fmtPct(bowlPct)}</td>
                      <td className="wintotals-total-cell" style={{ color: pctColor(r.playoffPct) }}>{fmtPct(r.playoffPct)}</td>
                      <td className="wintotals-total-cell" style={{ color: pctColor(r.quarterfinalPct) }}>{fmtPct(r.quarterfinalPct)}</td>
                      <td className="wintotals-total-cell" style={{ color: pctColor(r.semifinalPct) }}>{fmtPct(r.semifinalPct)}</td>
                      <td className="wintotals-total-cell" style={{ color: pctColor(r.nattyGamePct) }}>{fmtPct(r.nattyGamePct)}</td>
                      <td className="wintotals-total-cell" style={{ color: pctColor(r.nattyPct) }}>{fmtPct(r.nattyPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note" data-export-exclude="true">
        Make Quarterfinals / Semifinals / NCG require a Monte Carlo run saved after bracket-round
        tracking was added — older saved weeks may show "–" for those columns. Based on{" "}
        {numTrials > 0 ? numTrials.toLocaleString() : "100,000"} simulations using our power ratings.
      </div>
    </div>
  );
}
