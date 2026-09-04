import { useEffect, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { CONFERENCES, TEAMS } from "../data/teams";
import { fetchResumeRatingsForWeek } from "../lib/api/resumeWeights";

type Row = { score: number | null; act_wins: number | null; losses: number | null };

// A specific past week's Resume Rating, exactly as saved via "Save to
// Site" on that week — never recomputed, never affected by anything
// saved for a later week.
export default function ResumeRatingsWeekPage({ weekNum, subLabel, defaultDivision, onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(defaultDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("asc");
  const [byTeam, setByTeam] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const season = new Date().getFullYear();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchResumeRatingsForWeek(season, weekNum)
      .then((data) => {
        if (!cancelled) setByTeam(data);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message ?? "Failed to load Resume Ratings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, weekNum]);

  const rows = useMemo(() => {
    const list = TEAMS.filter((t) => byTeam[t.team] != null)
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      })
      .map((t) => {
        const r = byTeam[t.team];
        return { ...t, score: r?.score ?? null, actWins: r?.act_wins ?? null, losses: r?.losses ?? null };
      });

    return [...list].sort((a: any, b: any) => {
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
  }, [byTeam, division, conference, query, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
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
        <div className="eyebrow">Resume Ratings</div>
        <h1 className="title matchup-title">{subLabel ?? `Week ${weekNum}`}</h1>
        <p className="subtitle team-subtitle">
          Resume Rating exactly as saved for this week — permanent, unaffected by anything saved for a
          later week.
        </p>
        {error && <p style={{ fontSize: "0.8rem", color: "#a15c00" }}>{error}</p>}
      </div>

      <div className="controls matchups-controls">
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="filter" value={division} onChange={(e) => setDivision(e.target.value)}>
          <option value="All">All divisions</option>
          <option value="FBS">FBS</option>
          <option value="FCS">FCS</option>
        </select>
        <select className="filter" value={conference} onChange={(e) => setConference(e.target.value)}>
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
          <div className="empty matchups-empty">
            No Resume Ratings snapshot saved for {season} week {weekNum} yet — save one from Admin →
            Resume Rating.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <th className="th">Record</th>
                  <SortHeader label="Resume Rating" sortKey="score" active={sortKey === "score"} dir={sortDir} onClick={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t: any) => (
                  <tr key={t.team}>
                    <td>
                      <button className="team-link" onClick={() => onNavigateTeam(t)}>
                        <TeamLogo team={t} />
                        {t.team}
                      </button>
                      <span className={`div-pill ${t.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{t.div}</span>
                    </td>
                    <td className="conf-cell">
                      <ConfLink conf={t.conf} onNavigateConference={onNavigateConference} />
                    </td>
                    <td className="wintotals-record-cell">{t.actWins != null && t.losses != null ? `${t.actWins}-${t.losses}` : "–"}</td>
                    <td className="wintotals-total-cell">{t.score != null ? t.score.toFixed(2) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
