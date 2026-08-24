import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import ConfLink from "../components/ConfLink";
import TeamLogo from "../components/TeamLogo";
import { TEAMS_BY_NAME } from "../data/teams";
import { fetchWeeklyPowerRatings } from "../lib/api/ratingSystems";
import { buildRankMap } from "../lib/ranks";

// ---------------------------------------------------------------------
// Merged "Preseason / Week 1" power ratings page (previously two separate
// "Coming Soon" nav placeholders). Reads the Week 1 snapshot Admin >
// Rating Systems saves into weekly_power_ratings, filtered to system_key
// "yc" — that's the only power rating that goes out to the public site,
// per Chris (not a blend of every input system, not the full FPI/SP+/
// Core/Elo/etc. breakdown Admin sees).
// ---------------------------------------------------------------------
interface Row {
  team: string;
  conf: string | null;
  div: string | null;
  rating: number;
}

export default function PreseasonWeek1RatingsPage({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const season = new Date().getFullYear();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [division, setDivision] = useState<"FBS" | "FCS" | "All">("FBS");
  const [sortKey, setSortKey] = useState<"rank" | "team" | "conf" | "rating">("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchWeeklyPowerRatings(season, 1)
      .then((all) => {
        const yc = all.filter((r) => r.system_key === "yc");
        setRows(yc.map((r) => ({ team: r.team, conf: r.conference, div: r.division, rating: r.value })));
      })
      .catch((err: any) => setError(err.message ?? "Failed to load Week 1 ratings"))
      .finally(() => setLoading(false));
  }, [season]);

  // negative = better, same convention as every rating on the site.
  const rankByTeam = useMemo(() => (rows ? buildRankMap(rows.map((r) => [r.team, r.rating]), false) : {}), [rows]);

  function handleSort(key: string) {
    const k = key as typeof sortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "rank" || k === "rating" ? "asc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    if (!rows) return [];
    const filtered = rows.filter((r) => division === "All" || r.div === division);
    return [...filtered].sort((a, b) => {
      const av = sortKey === "rank" ? rankByTeam[a.team] ?? 9999 : a[sortKey];
      const bv = sortKey === "rank" ? rankByTeam[b.team] ?? 9999 : b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, division, sortKey, sortDir, rankByTeam]);

  return (
    <div className="page preseason-ratings-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Weekly Power Ratings</div>
        <h1 className="title matchup-title">Preseason / Week 1</h1>
        <p className="subtitle team-subtitle">
          The YC power rating as saved for Week 1 in Admin &gt; Rating Systems — the site's one
          published power rating, snapshotted before Week 1 games kicked off. For the current live
          ratings, see the "Live" tab under Weekly Power Ratings.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["FBS", "FCS", "All"] as const).map((d) => (
          <button key={d} className={`mode-btn ${division === d ? "mode-btn-active" : ""}`} onClick={() => setDivision(d)}>
            {d}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading Week 1 ratings…</p>
      ) : error ? (
        <p style={{ color: "crimson" }}>{error}</p>
      ) : !rows || rows.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>
          No Week 1 power ratings have been saved yet this season — save a Week 1 snapshot from Admin
          &gt; Rating Systems &gt; Save As Week to populate this page.
        </p>
      ) : (
        <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader label="#" sortKey="rank" active={sortKey === "rank"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Power Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const staticTeam = TEAMS_BY_NAME[r.team];
                const navTeam = staticTeam ? { ...staticTeam, rating: r.rating } : { team: r.team, conf: r.conf, div: r.div, rating: r.rating };
                return (
                  <tr key={r.team}>
                    <td style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>{rankByTeam[r.team]}</td>
                    <td>
                      <button className="team-link" onClick={() => onNavigateTeam(navTeam)}>
                        <TeamLogo team={r.team} />
                        {r.team}
                      </button>
                      {r.div && <span className={`div-pill ${r.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{r.div}</span>}
                    </td>
                    <td className="conf-cell">
                      <ConfLink conf={r.conf ?? staticTeam?.conf ?? ""} onNavigateConference={onNavigateConference} />
                    </td>
                    <td className={`rating-cell ${r.rating < 0 ? "rating-good" : "rating-bad"}`}>
                      {r.rating > 0 ? "+" : ""}
                      {r.rating.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
