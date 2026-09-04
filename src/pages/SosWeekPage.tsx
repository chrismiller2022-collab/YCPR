import { useEffect, useMemo, useState } from "react";
import ConfLink from "../components/ConfLink";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { CONFERENCES, TEAMS } from "../data/teams";
import { fetchTeamSosForWeek, type TeamSosRow } from "../lib/api/ratingSystems";

// A specific past week's SOS, exactly as it was saved via "Save to
// Site" on that week — never recomputed, never affected by anything
// saved for a later week. Deliberately a smaller column set than "SOS
// Live" (which computes several additional things fresh every time) —
// this only shows what actually got archived for the week: SOS via
// SRS, Avg Opponent Power Rating, and Best Win/Worst Loss, each split
// into overall and in-conference.
export default function SosWeekPage({ weekNum, subLabel, defaultDivision, onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(defaultDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("sosSrsTotal");
  const [sortDir, setSortDir] = useState("asc");
  const [sosByTeam, setSosByTeam] = useState<Record<string, TeamSosRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const season = new Date().getFullYear();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTeamSosForWeek(season, weekNum)
      .then((data) => {
        if (!cancelled) setSosByTeam(data);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message ?? "Failed to load SOS");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, weekNum]);

  const rows = useMemo(() => {
    const list = TEAMS.filter((t) => sosByTeam[t.team] != null)
      .filter((t) => {
        if (division !== "All" && t.div !== division) return false;
        if (conference !== "All" && t.conf !== conference) return false;
        if (query && !t.team.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      })
      .map((t) => {
        const s = sosByTeam[t.team];
        return {
          ...t,
          sosSrsTotal: s?.sos_srs_total ?? null,
          sosSrsConf: s?.sos_srs_conference ?? null,
          avgOppTotal: s?.avg_opp_pr_total ?? null,
          bestWinTotal: s?.best_win_pr_total ?? null,
          bestWinTotalOpp: s?.best_win_pr_total_opp ?? null,
          worstLossTotal: s?.worst_loss_pr_total ?? null,
          worstLossTotalOpp: s?.worst_loss_pr_total_opp ?? null,
        };
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
  }, [sosByTeam, division, conference, query, sortKey, sortDir]);

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
        <div className="eyebrow">Strength of Schedule</div>
        <h1 className="title matchup-title">{subLabel ?? `Week ${weekNum}`}</h1>
        <p className="subtitle team-subtitle">
          SOS exactly as saved for this week — permanent, unaffected by anything saved for a later week.
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
            No SOS snapshot saved for {season} week {weekNum} yet — save one from Admin → Strength of Schedule.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="SOS (SRS)" sortKey="sosSrsTotal" active={sortKey === "sosSrsTotal"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader
                    label="In-Conf SOS (SRS)"
                    sortKey="sosSrsConf"
                    active={sortKey === "sosSrsConf"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Avg Opp PR"
                    sortKey="avgOppTotal"
                    active={sortKey === "avgOppTotal"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <th className="th">Best Win</th>
                  <th className="th">Worst Loss</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
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
                    <td className="wintotals-total-cell">{t.sosSrsTotal != null ? t.sosSrsTotal.toFixed(2) : "–"}</td>
                    <td className="wintotals-total-cell">{t.sosSrsConf != null ? t.sosSrsConf.toFixed(2) : "–"}</td>
                    <td className="wintotals-total-cell">{t.avgOppTotal != null ? t.avgOppTotal.toFixed(2) : "–"}</td>
                    <td>
                      {t.bestWinTotalOpp ? (
                        <>
                          <TeamLogo team={t.bestWinTotalOpp} size={14} /> {t.bestWinTotalOpp}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td>
                      {t.worstLossTotalOpp ? (
                        <>
                          <TeamLogo team={t.worstLossTotalOpp} size={14} /> {t.worstLossTotalOpp}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
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
