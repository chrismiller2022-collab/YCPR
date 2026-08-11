import { useEffect, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS } from "../data/teams";
import { fetchAvailableWeeks, fetchWeeklyStats, weekLabel, type WeeklyTeamStats } from "../lib/api/weeklyStats";

const WEEKLY_PROGRESSION_META = {
  power: {
    eyebrow: "Weekly Power Ratings",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Power Rating",
    filterTeams: (t) => true,
    baseline: (t) => t.rating,
    field: "rating" as const,
  },
  resume: {
    eyebrow: "Resume Ratings",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Resume Rating",
    filterTeams: (t) => !!RESUME_BY_TEAM[t.team],
    baseline: (t) => RESUME_BY_TEAM[t.team]?.rating ?? null,
    field: "resume_rating" as const,
  },
  sor: {
    eyebrow: "Strength of Schedule",
    title: "WEEKLY PROGRESSION",
    metricLabel: "SOR",
    filterTeams: (t) => SOS_BY_TEAM[t.team] != null,
    baseline: (t) => SOS_BY_TEAM[t.team] ?? null,
    field: "sor" as const,
  },
};

/**
 * Loads every available week's data ONCE — one request per week that
 * actually has data saved (via fetchAvailableWeeks), not one request per
 * team — and indexes it by week, then by team, so any row/column lookup
 * below is just a plain object read. A season with 3 weeks saved makes 3
 * requests total, not 130+.
 */
function useAllWeeksData() {
  const [weeks, setWeeks] = useState<string[]>([]);
  const [byWeek, setByWeek] = useState<Record<string, Record<string, WeeklyTeamStats>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const availableWeeks = await fetchAvailableWeeks();
        const rowsPerWeek = await Promise.all(availableWeeks.map((w) => fetchWeeklyStats(w)));
        if (cancelled) return;
        const indexed: Record<string, Record<string, WeeklyTeamStats>> = {};
        availableWeeks.forEach((w, i) => {
          indexed[w] = Object.fromEntries(rowsPerWeek[i].map((r) => [r.team, r]));
        });
        setWeeks(availableWeeks);
        setByWeek(indexed);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load weekly progression data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { weeks, byWeek, loading, error };
}

function WeeklyProgressionRow({ team, meta, weeksAsc, byWeek, onNavigateConference }: any) {
  const preseason = team.preseason;

  // "Change from Preseason" compares against the team's own most recent
  // saved value — the latest week THIS team actually has a row for, not
  // just the latest week overall — since a team can be missing from one
  // week's paste while present in the others.
  let latestValue: number | null = null;
  for (let i = weeksAsc.length - 1; i >= 0; i--) {
    const v = byWeek[weeksAsc[i]]?.[team.team]?.[meta.field];
    if (v != null) {
      latestValue = v;
      break;
    }
  }
  const change = latestValue != null && preseason != null ? latestValue - preseason : null;

  return (
    <tr>
      <td>
        <span className="team-name">{team.team}</span>
        <span className={`div-pill ${team.div === "FBS" ? "div-fbs" : "div-fcs"}`}>
          {team.div}
        </span>
      </td>
      <td className="conf-cell">
        <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
      </td>
      <td className="wintotals-total-cell">
        {preseason != null ? preseason.toFixed(2) : "–"}
      </td>
      {weeksAsc.map((w) => {
        const v = byWeek[w]?.[team.team]?.[meta.field];
        return (
          <td key={w} className="wintotals-total-cell">
            {v != null ? v.toFixed(2) : "–"}
          </td>
        );
      })}
      <td className="wintotals-total-cell">
        {change != null ? `${change > 0 ? "+" : ""}${change.toFixed(2)}` : "–"}
      </td>
    </tr>
  );
}


export default function WeeklyProgressionPage({ metric, subLabel, defaultDivision, onNavigateConference, onHome }: any) {
  const meta = WEEKLY_PROGRESSION_META[metric];
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(defaultDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("team");
  const [sortDir, setSortDir] = useState("asc");

  const { weeks, byWeek, loading, error } = useAllWeeksData();

  // fetchAvailableWeeks returns most-recent-first; the table displays
  // columns oldest-to-newest left to right, and "Change from Preseason"
  // needs to walk backward from newest to find each team's latest row, so
  // keep an ascending, preseason-excluded copy around for both.
  const weeksAsc = useMemo(() => weeks.filter((w) => w !== "preseason").slice().reverse(), [weeks]);

  const rows = useMemo(() => {
    const list = TEAMS.filter(meta.filterTeams)
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      })
      .map((t) => {
        // The Preseason column itself is live-preferred too: if a
        // "preseason" week has been uploaded, use its saved value;
        // otherwise fall back to the static preseason snapshot.
        const preseasonLive = byWeek["preseason"]?.[t.team]?.[meta.field] ?? null;
        return { ...t, preseason: preseasonLive ?? meta.baseline(t) };
      });

    return [...list].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [metric, query, division, conference, sortKey, sortDir, byWeek]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">{meta.eyebrow} · {subLabel}</div>
        <h1 className="title matchup-title">{meta.title}</h1>
        <p className="subtitle team-subtitle">
          {meta.metricLabel} for every team, week by week across the season,
          plus the change from the Preseason projection. Weekly columns
          populate as each week is completed.
        </p>
        {error && (
          <p style={{ fontSize: "0.8rem", color: "#a15c00" }}>
            Live weekly data unavailable ({error}) — showing the preseason snapshot only.
          </p>
        )}
      </div>

      <div className="controls matchups-controls">
        <input
          className="search"
          placeholder="Search for a team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="filter"
          value={division}
          onChange={(e) => setDivision(e.target.value)}
        >
          <option value="All">All divisions</option>
          <option value="FBS">FBS</option>
          <option value="FCS">FCS</option>
        </select>
        <select
          className="filter"
          value={conference}
          onChange={(e) => setConference(e.target.value)}
        >
          <option value="All">All conferences</option>
          {CONFERENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="empty matchups-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty matchups-empty">No teams match that search.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Preseason" sortKey="preseason" active={sortKey === "preseason"} dir={sortDir} onClick={handleSort} align="right" />
                  {weeksAsc.map((w) => (
                    <th key={w} className="th th-right">
                      {weekLabel(w).replace("Week ", "Wk ")}
                    </th>
                  ))}
                  <th className="th th-right">Change from Preseason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <WeeklyProgressionRow
                    key={t.team}
                    team={t}
                    meta={meta}
                    weeksAsc={weeksAsc}
                    byWeek={byWeek}
                    onNavigateConference={onNavigateConference}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note">
        {weeksAsc.length === 0
          ? `Weekly ${meta.metricLabel} snapshots aren't in yet — this page is fully wired up and will populate automatically as each week's data comes in.`
          : `${meta.metricLabel} shown for every week uploaded so far. "–" means that team wasn't included in that particular week's upload.`}
      </div>
    </div>
  );
}
