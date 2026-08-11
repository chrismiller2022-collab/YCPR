import { useEffect, useMemo, useRef, useState } from "react";
import ChangeCell from "../components/ChangeCell";
import ConfLink from "../components/ConfLink";
import ExportPngButton from "../components/ExportPngButton";
import TeamLogo from "../components/TeamLogo";
import { SOS_BY_TEAM } from "../data/sor";
import { TEAMS, TEAMS_BY_NAME, conferencesForDivision } from "../data/teams";
import { hfaFor, spreadColor, spreadToWinPct } from "../lib/odds";
import { useWeeklyStats, useWeeklyChange } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { conferenceFilterOptions, teamMatchesConferenceFilter } from "../lib/conferenceBuckets";

const MODES = [
  { key: "sos", label: "SOS" },
  { key: "hypowins", label: "Hypothetical #12 Team Win Total" },
];

function SosRow({ rank, team, sos, change, onNavigateTeam, onNavigateConference }: any) {
  return (
    <tr>
      <td style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>{rank}</td>
      <td>
        <button className="team-link" onClick={() => onNavigateTeam(team)}>
          <TeamLogo team={team} />
          {team.team}
        </button>
        <span className={`div-pill ${team.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{team.div}</span>
      </td>
      <td className="conf-cell">
        <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
      </td>
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell" style={sos != null ? { color: spreadColor(-sos) } : undefined}>
        {sos != null ? (sos > 0 ? "+" : "") + sos.toFixed(2) : "–"}
      </td>
      <ChangeCell change={change} />
    </tr>
  );
}

function HypoWinsRow({ rank, team, hypoWins, gameCount, onNavigateTeam, onNavigateConference }: any) {
  return (
    <tr>
      <td style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>{rank}</td>
      <td>
        <button className="team-link" onClick={() => onNavigateTeam(team)}>
          <TeamLogo team={team} />
          {team.team}
        </button>
        <span className={`div-pill ${team.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{team.div}</span>
      </td>
      <td className="conf-cell">
        <ConfLink conf={team.conf} onNavigateConference={onNavigateConference} />
      </td>
      <td className={`rating-cell ${team.rating < 0 ? "rating-good" : "rating-bad"}`}>
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </td>
      <td className="wintotals-total-cell">{hypoWins != null ? hypoWins.toFixed(2) : "–"}</td>
      <td className="wintotals-record-cell">{gameCount ?? "–"} games</td>
    </tr>
  );
}

function RankedTable({ title, rows, mode, changeByTeam, onNavigateTeam, onNavigateConference }: any) {
  return (
    <div style={{ flex: 1, minWidth: 320 }}>
      <div className="section-label" style={{ textAlign: "center" }}>
        {title}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="th">#</th>
              <th className="th">Team</th>
              <th className="th">Conference</th>
              <th className="th th-right">Power Rating</th>
              {mode === "sos" ? (
                <>
                  <th className="th th-right">SOS</th>
                  <th className="th th-right">Change from Last Week</th>
                </>
              ) : (
                <>
                  <th className="th th-right">Hypothetical Wins</th>
                  <th className="th th-right">Schedule</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((t: any) =>
              mode === "sos" ? (
                <SosRow
                  key={t.team}
                  rank={t.trueRank}
                  team={t}
                  sos={t.sos}
                  change={changeByTeam[t.team]?.change ?? null}
                  onNavigateTeam={onNavigateTeam}
                  onNavigateConference={onNavigateConference}
                />
              ) : (
                <HypoWinsRow
                  key={t.team}
                  rank={t.trueRank}
                  team={t}
                  hypoWins={t.hypoWins}
                  gameCount={t.gameCount}
                  onNavigateTeam={onNavigateTeam}
                  onNavigateConference={onNavigateConference}
                />
              )
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No teams match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StrengthOfSchedulePage({ forceDivision, onNavigateTeam, onNavigateConference, onHome }: any) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState(forceDivision ?? "All");
  const [conference, setConference] = useState("All");
  const [mode, setMode] = useState("sos");
  const exportRef = useRef<HTMLDivElement>(null);

  const { byTeam: liveByTeam, loading: liveLoading, error: liveError } = useWeeklyStats("latest");
  const { byTeam: changeByTeam } = useWeeklyChange("sor");

  const season = new Date().getFullYear();
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);

  useEffect(() => {
    if (mode !== "hypowins" || games.length > 0) return;
    setGamesLoading(true);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setGamesLoading(false));
  }, [mode, season]);

  function sosFor(teamName: string): number | null {
    const live = liveByTeam[teamName]?.sor;
    if (live != null) return live;
    return SOS_BY_TEAM[teamName] ?? null;
  }

  const ratingFor = (name: string, fallback: number) => liveByTeam[name]?.rating ?? fallback;

  const top12Rating = useMemo(() => {
    const ratings = TEAMS.filter((t) => t.div === "FBS")
      .map((t) => ratingFor(t.team, t.rating))
      .sort((a, b) => a - b);
    return ratings.length >= 12 ? ratings[11] : null;
  }, [liveByTeam]);

  function computeHypoWins(team: any): { hypoWins: number | null; gameCount: number } {
    if (top12Rating == null) return { hypoWins: null, gameCount: 0 };
    const teamGames = games.filter((g) => g.home_team === team.team || g.away_team === team.team);
    let expWins = 0;
    for (const g of teamGames) {
      const isHome = g.home_team === team.team;
      const oppName = isHome ? g.away_team : g.home_team;
      const opp = TEAMS_BY_NAME[oppName];
      if (!opp) continue;
      const oppRating = ratingFor(oppName, opp.rating);
      const spread = isHome
        ? top12Rating - oppRating - hfaFor(team.team, liveByTeam)
        : top12Rating - oppRating + hfaFor(oppName, liveByTeam);
      expWins += spreadToWinPct(spread);
    }
    return { hypoWins: teamGames.length > 0 ? expWins : null, gameCount: teamGames.length };
  }

  const rankedPool = useMemo(() => {
    const pool = TEAMS.filter((t) => {
      if (forceDivision) return t.div === forceDivision;
      if (division === "All") return true;
      return t.div === division;
    })
      .map((t) => ({ ...t, rating: ratingFor(t.team, t.rating), sos: sosFor(t.team) }))
      .filter((t) => (forceDivision ? true : t.sos != null));

    if (mode === "sos") {
      const sorted = [...pool].sort((a, b) => {
        if (a.sos == null && b.sos == null) return 0;
        if (a.sos == null) return 1;
        if (b.sos == null) return -1;
        return b.sos - a.sos;
      });
      return sorted.map((t, i) => ({ ...t, trueRank: i + 1 }));
    }

    const withHypo = pool.map((t) => ({ ...t, ...computeHypoWins(t) }));
    const sorted = [...withHypo].sort((a, b) => {
      if (a.hypoWins == null && b.hypoWins == null) return 0;
      if (a.hypoWins == null) return 1;
      if (b.hypoWins == null) return -1;
      return a.hypoWins - b.hypoWins;
    });
    return sorted.map((t, i) => ({ ...t, trueRank: i + 1 }));
  }, [division, forceDivision, liveByTeam, mode, games, top12Rating]);

  const trueHalf = Math.ceil(rankedPool.length / 2);

  const displayedRows = useMemo(() => {
    return rankedPool.filter((t) => {
      if (conference !== "All" && !teamMatchesConferenceFilter(t.team, t.conf, conference)) return false;
      if (query && !t.team.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [rankedPool, conference, query]);

  const leftRows = displayedRows.filter((t) => t.trueRank <= trueHalf);
  const rightRows = displayedRows.filter((t) => t.trueRank > trueHalf);

  return (
    <div className="matchups-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">{forceDivision === "FCS" ? "FCS · " : ""}Strength of Schedule</div>
        <h1 className="title matchup-title">{forceDivision === "FCS" ? "FCS SOS · LIVE" : "SOS · LIVE"}</h1>
        <p className="subtitle team-subtitle">
          {mode === "sos"
            ? "SOS is Strength of Schedule, based on a number of things — including but not limited to average opponent power rating."
            : `How many games would the #12 power-rated FBS team (currently ${
                top12Rating != null ? (top12Rating > 0 ? "+" : "") + top12Rating.toFixed(2) : "–"
              }) win playing each team's actual schedule?`}
        </p>
        {forceDivision === "FCS" ? (
          <p style={{ fontSize: "0.8rem", color: "#666" }}>
            FCS strength-of-schedule data isn't calculated yet — this page is wired up and will
            populate once it is.
          </p>
        ) : (
          <>
            {liveError && (
              <p style={{ fontSize: "0.8rem", color: "#a15c00" }}>
                Live data unavailable ({liveError}) — showing last static snapshot.
              </p>
            )}
            {!liveError && !liveLoading && Object.keys(liveByTeam).length === 0 && (
              <p style={{ fontSize: "0.8rem", color: "#666" }}>No weekly data saved yet — showing the preseason snapshot.</p>
            )}
          </>
        )}
      </div>

      {!forceDivision && (
        <div className="mode-toggle" data-export-exclude="true">
          {MODES.map((m) => (
            <button key={m.key} className={`mode-btn ${mode === m.key ? "mode-btn-active" : ""}`} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="controls matchups-controls" data-export-exclude="true">
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {!forceDivision && (
          <select
            className="filter"
            value={division}
            onChange={(e) => {
              setDivision(e.target.value);
              setConference("All");
            }}
          >
            <option value="All">All divisions</option>
            <option value="FBS">FBS</option>
            <option value="FCS">FCS</option>
          </select>
        )}
        <select className="filter" value={conference} onChange={(e) => setConference(e.target.value)}>
          <option value="All">All conferences</option>
          {conferenceFilterOptions(
            (forceDivision ?? division) as "FBS" | "FCS" | "All",
            conferencesForDivision("FBS"),
            conferencesForDivision("FCS")
          ).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <ExportPngButton targetRef={exportRef} filename={`sos-${mode}`} />
      </div>

      <div className="table-wrap" style={{ maxWidth: 1400 }}>
        {mode === "hypowins" && gamesLoading ? (
          <div className="empty">Loading schedules…</div>
        ) : (
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <RankedTable
              title="Hardest"
              rows={leftRows}
              mode={mode}
              changeByTeam={changeByTeam}
              onNavigateTeam={onNavigateTeam}
              onNavigateConference={onNavigateConference}
            />
            <RankedTable
              title="Easiest"
              rows={rightRows}
              mode={mode}
              changeByTeam={changeByTeam}
              onNavigateTeam={onNavigateTeam}
              onNavigateConference={onNavigateConference}
            />
          </div>
        )}
      </div>

      <div className="footer-note" data-export-exclude="true">
        {mode === "sos"
          ? "SOS is Strength of Schedule, based on a number of things — including but not limited to average opponent power rating."
          : "This substitutes only the subject team's own rating with the #12 FBS team's current rating — opponents keep their real ratings, home/away, and home-field advantage. Expected wins are a sum of each game's win probability, the same underlying method used for the site's other win-total projections."}
      </div>
    </div>
  );
}
