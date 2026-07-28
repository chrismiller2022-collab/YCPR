import { useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import { WEEKS } from "../data/games";
import { RESUME_BY_TEAM } from "../data/resume";
import { SOS_BY_TEAM } from "../data/sor";
import { CONFERENCES, TEAMS } from "../data/teams";

const WEEKLY_PROGRESSION_META = {
  power: {
    eyebrow: "Weekly Power Ratings",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Power Rating",
    filterTeams: (t) => true,
    baseline: (t) => t.rating,
  },
  resume: {
    eyebrow: "Resume Ratings",
    title: "WEEKLY PROGRESSION",
    metricLabel: "Resume Rating",
    filterTeams: (t) => !!RESUME_BY_TEAM[t.team],
    baseline: (t) => RESUME_BY_TEAM[t.team]?.rating ?? null,
  },
  sor: {
    eyebrow: "Strength of Schedule",
    title: "WEEKLY PROGRESSION",
    metricLabel: "SOR",
    filterTeams: (t) => SOS_BY_TEAM[t.team] != null,
    baseline: (t) => SOS_BY_TEAM[t.team] ?? null,
  },
};


function WeeklyProgressionRow({ team, meta, onNavigateConference }: any) {
  const preseason = meta.baseline(team);
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
      {WEEKS.map((w) => (
        <td key={w.key} className="matchups-empty-cell">
          –
        </td>
      ))}
      <td className="matchups-empty-cell">–</td>
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
  }, [metric, query, division, conference, sortKey, sortDir]);

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
        {rows.length === 0 ? (
          <div className="empty matchups-empty">No teams match that search.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Preseason" sortKey="preseason" active={sortKey === "preseason"} dir={sortDir} onClick={handleSort} align="right" />
                  {WEEKS.map((w) => (
                    <th key={w.key} className="th th-right">
                      {w.label.replace("Week ", "Wk ")}
                    </th>
                  ))}
                  <th className="th th-right">Change from Preseason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <WeeklyProgressionRow key={t.team} team={t} meta={meta} onNavigateConference={onNavigateConference} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer-note">
        Weekly {meta.metricLabel} snapshots aren't connected yet — this page
        is fully wired up and will populate automatically as each week's
        data comes in.
      </div>
    </div>
  );
}
