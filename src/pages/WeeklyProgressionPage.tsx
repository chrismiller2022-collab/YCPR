import { useEffect, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS } from "../data/teams";
import { fetchSeasonRatingsByWeeks } from "../lib/api/seasonWeeklyRatings";
import { fetchTeamSosByWeeks } from "../lib/api/ratingSystems";
import { fetchResumeRatingsByWeeks } from "../lib/api/resumeWeights";
import { fetchWinTotalsByWeeks } from "../lib/api/monteCarlo";

// Was reading weekly_team_stats (the same MUTABLE, label-based table
// behind the original ratings-drift bug — see chat, Sept 2026) for
// every metric, completely disconnected from the actual per-week
// archives (season_weekly_ratings, team_sos, team_resume_ratings) that
// "Save As Week"/"Save to Site" write to. That meant publishing a week
// from any of those admin pages didn't do anything to this page at
// all, and re-pushing an old week's live label could silently corrupt
// an already-shown progression column. Each metric now reads its own
// real archive directly.
const WEEKLY_PROGRESSION_META = {
  power: {
    eyebrow: "Weekly Power Ratings",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Power Rating",
    filterTeams: (t) => true,
    baseline: (t) => t.rating,
    fetchByWeeks: fetchSeasonRatingsByWeeks,
    higherIsBetter: false, // lower/more negative rating = stronger team, site-wide convention
  },
  resume: {
    eyebrow: "Resume Ratings",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Resume Rating",
    filterTeams: (t) => !!RESUME_BY_TEAM[t.team],
    baseline: (t) => RESUME_BY_TEAM[t.team]?.rating ?? null,
    fetchByWeeks: fetchResumeRatingsByWeeks,
    higherIsBetter: true,
  },
  sor: {
    eyebrow: "Strength of Schedule",
    title: "WEEKLY PROGRESSION",
    metricLabel: "SOR",
    filterTeams: (t) => SOS_BY_TEAM[t.team] != null,
    baseline: (t) => SOS_BY_TEAM[t.team] ?? null,
    fetchByWeeks: fetchTeamSosByWeeks,
    higherIsBetter: true,
  },
  wintotals: {
    eyebrow: "Win Totals",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Win Total",
    filterTeams: (t) => true,
    baseline: (t) => null, // no static preseason win-total baseline to fall back to
    fetchByWeeks: fetchWinTotalsByWeeks,
    higherIsBetter: true,
  },
};

/**
 * Loads every saved week's data for this metric ONCE, indexed by week
 * then team — a plain object read for any row/column lookup below,
 * not a request per team.
 */
function useAllWeeksData(metric: string, season: number) {
  const [weeks, setWeeks] = useState<number[]>([]);
  const [byWeek, setByWeek] = useState<Record<number, Record<string, number | null>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const meta = WEEKLY_PROGRESSION_META[metric];
    meta
      .fetchByWeeks(season)
      .then(({ weeks: w, byWeek: bw }: { weeks: number[]; byWeek: Record<number, Record<string, number | null>> }) => {
        if (cancelled) return;
        setWeeks(w);
        setByWeek(bw);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message ?? "Failed to load weekly progression data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric, season]);

  return { weeks, byWeek, loading, error };
}

function WeeklyProgressionRow({ team, meta, weeksAsc, byWeek, onNavigateTeam, onNavigateConference }: any) {
  const preseason = team.preseason;

  // Change is week-over-week now (most recent saved week vs. the one
  // before it) rather than vs. Preseason — a fixed baseline column
  // wasn't what "how did this week move" actually needs to answer.
  // Still walks from newest backward per-team (not just the newest
  // week overall) since a team can be missing from one week's save
  // while present in others.
  let latestValue: number | null = null;
  let latestIdx = -1;
  for (let i = weeksAsc.length - 1; i >= 0; i--) {
    const v = byWeek[weeksAsc[i]]?.[team.team];
    if (v != null) {
      latestValue = v;
      latestIdx = i;
      break;
    }
  }
  let previousValue: number | null = null;
  for (let i = latestIdx - 1; i >= 0; i--) {
    const v = byWeek[weeksAsc[i]]?.[team.team];
    if (v != null) {
      previousValue = v;
      break;
    }
  }
  const change = latestValue != null && previousValue != null ? latestValue - previousValue : null;

  return (
    <tr>
      <td>
        {onNavigateTeam ? (
          <button className="team-link" onClick={() => onNavigateTeam(team)}>
            {team.team}
          </button>
        ) : (
          <span className="team-name">{team.team}</span>
        )}
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
        const v = byWeek[w]?.[team.team];
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


export default function WeeklyProgressionPage({ metric, subLabel, defaultDivision, onNavigateTeam, onNavigateConference, onHome }: any) {
  const meta = WEEKLY_PROGRESSION_META[metric];
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(defaultDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("team");
  const [sortDir, setSortDir] = useState("asc");
  const season = new Date().getFullYear();

  const { weeks: weeksAsc, byWeek, loading, error } = useAllWeeksData(metric, season);

  const rows = useMemo(() => {
    const list = TEAMS.filter(meta.filterTeams)
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      })
      .map((t) => ({ ...t, preseason: meta.baseline(t) }));

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
          {meta.metricLabel} for every team, week by week across the season — each column is that
          week's own saved snapshot, permanently. "Change" compares the most recent saved week
          against the one before it.
        </p>
        {error && (
          <p style={{ fontSize: "0.8rem", color: "#a15c00" }}>
            Weekly data unavailable ({error}) — showing the preseason snapshot only.
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
                      {w === 0 ? "Pre" : `Wk ${w}`}
                    </th>
                  ))}
                  <th className="th th-right">Change (Week over Week)</th>
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
                    onNavigateTeam={onNavigateTeam}
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
          ? `Weekly ${meta.metricLabel} snapshots aren't in yet — this page is fully wired up and will populate automatically as each week gets published from admin.`
          : `${meta.metricLabel} shown for every week published so far. "–" means that team wasn't included in that week's publish.`}
      </div>
    </div>
  );
}
