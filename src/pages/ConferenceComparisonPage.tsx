import { useMemo, useRef, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import ExportPngButton from "../components/ExportPngButton";
import { conferencesForDivision, teamsForConference } from "../data/teams";
import { SOS_BY_TEAM } from "../data/sor";
import { RESUME_BY_TEAM } from "../data/resume";
import { spreadColor, spreadToWinPct } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";

function ConferencePicker({ label, division, conference, onDivision, onConference }: any) {
  const confOptions = conferencesForDivision(division);
  return (
    <div className="picker-card">
      <div className="picker-label">{label}</div>
      <div className="picker-row">
        <select
          className="filter picker-select"
          value={division}
          onChange={(e) => onDivision(e.target.value)}
        >
          <option value="FBS">FBS</option>
          <option value="FCS">FCS</option>
        </select>
      </div>
      <select
        className="filter picker-team-select"
        value={conference}
        onChange={(e) => onConference(e.target.value)}
      >
        <option value="">Select a conference…</option>
        {confOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatCard({ label, count, avgRating, avgSos, avgResume }: any) {
  return (
    <div className="spread-card conf-stat-card">
      <div className="spread-team">{label}</div>
      <div className="conf-stat-row">
        <span className="compare-row-label">Avg Power Rating</span>
        <span
          className="compare-value-wrap"
          style={avgRating != null ? { color: spreadColor(avgRating) } : undefined}
        >
          {avgRating != null ? (avgRating > 0 ? "+" : "") + avgRating.toFixed(2) : "–"}
        </span>
      </div>
      <div className="conf-stat-row">
        <span className="compare-row-label">Avg SOS</span>
        <span
          className="compare-value-wrap"
          style={avgSos != null ? { color: spreadColor(avgSos) } : undefined}
        >
          {avgSos != null ? (avgSos > 0 ? "+" : "") + avgSos.toFixed(2) : "–"}
        </span>
      </div>
      <div className="conf-stat-row">
        <span className="compare-row-label">Avg Resume Rating</span>
        <span
          className="compare-value-wrap"
          style={avgResume != null ? { color: spreadColor(avgResume) } : undefined}
        >
          {avgResume != null ? (avgResume > 0 ? "+" : "") + avgResume.toFixed(2) : "–"}
        </span>
      </div>
      <div className="footer-note conf-stat-note">{count} teams</div>
    </div>
  );
}

function LineupRow({ seed, left, right, onNavigateTeam }: any) {
  // Neutral site — no home-field edge either way. Convention matches the
  // rest of the site: rating is expressed from the left team's perspective,
  // negative = left favored.
  const leftSpread = left.liveRating - right.liveRating;
  const rightSpread = -leftSpread;
  const leftWinPct = spreadToWinPct(leftSpread);
  const favored = leftSpread < 0 ? "left" : leftSpread > 0 ? "right" : null;

  return (
    <tr>
      <td className="lineup-seed-cell">{seed}</td>
      <td className="matchup-team-cell lineup-team-cell">
        <button
          className="team-link matchup-team-btn"
          onClick={() => onNavigateTeam(left)}
        >
          <TeamLogo team={left} />
          {left.team}
        </button>
        <span
          className={`matchup-rating ${left.liveRating < 0 ? "rating-good" : "rating-bad"}`}
        >
          {left.liveRating > 0 ? "+" : ""}
          {left.liveRating.toFixed(2)}
        </span>
      </td>
      <td className="matchups-projected-cell" style={{ color: spreadColor(leftSpread) }}>
        {leftSpread > 0 ? "+" : ""}
        {leftSpread.toFixed(1)}
      </td>
      <td className="matchups-winpct-cell" style={{ color: spreadColor(leftSpread) }}>
        {(leftWinPct * 100).toFixed(1)}%
      </td>
      <td
        className="matchup-team-cell lineup-team-cell lineup-team-right"
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.6rem", paddingRight: "1.25rem" }}
      >
        <span
          className={`matchup-rating ${right.liveRating < 0 ? "rating-good" : "rating-bad"}`}
        >
          {right.liveRating > 0 ? "+" : ""}
          {right.liveRating.toFixed(2)}
        </span>
        <button
          className="team-link matchup-team-btn"
          onClick={() => onNavigateTeam(right)}
        >
          {right.team}
          <TeamLogo team={right} />
        </button>
      </td>
      <td className="matchups-winner-cell" style={{ paddingLeft: "1rem" }}>
        {favored === "left" ? left.team : favored === "right" ? right.team : "Pick'em"}
      </td>
    </tr>
  );
}

export default function ConferenceComparisonPage({ onNavigateTeam, onHome }: any) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [divA, setDivA] = useState("FBS");
  const [confA, setConfA] = useState("");
  const [divB, setDivB] = useState("FBS");
  const [confB, setConfB] = useState("");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const ratingFor = (teamName: string, staticRating: number) =>
    liveByTeam[teamName]?.rating ?? staticRating;

  const sosFor = (teamName: string) =>
    liveByTeam[teamName]?.sor ?? SOS_BY_TEAM[teamName] ?? null;

  const resumeFor = (teamName: string) =>
    liveByTeam[teamName]?.resume_rating ?? RESUME_BY_TEAM[teamName]?.rating ?? null;

  // Sorted best-to-worst by LIVE rating (not just whatever order
  // teamsForConference happened to return) — this is the fix for the
  // Clemson-below-Louisville bug: the list was being paired/displayed in
  // its original order, which doesn't reflect live rating updates, so a
  // team could have a better live rating than the team above it.
  const teamsA = useMemo(() => {
    const list = (confA ? teamsForConference(divA, confA) : []).map((t) => ({
      ...t,
      liveRating: ratingFor(t.team, t.rating),
      liveSos: sosFor(t.team),
      liveResume: resumeFor(t.team),
    }));
    return list.sort((a, b) => a.liveRating - b.liveRating);
  }, [divA, confA, liveByTeam]);

  const teamsB = useMemo(() => {
    const list = (confB ? teamsForConference(divB, confB) : []).map((t) => ({
      ...t,
      liveRating: ratingFor(t.team, t.rating),
      liveSos: sosFor(t.team),
      liveResume: resumeFor(t.team),
    }));
    return list.sort((a, b) => a.liveRating - b.liveRating);
  }, [divB, confB, liveByTeam]);

  const bothSelected = !!confA && !!confB;
  const sameConf = bothSelected && divA === divB && confA === confB;

  const avgOf = (list: number[]) =>
    list.length === 0 ? null : list.reduce((s, v) => s + v, 0) / list.length;

  const avgRatingA = avgOf(teamsA.map((t) => t.liveRating));
  const avgRatingB = avgOf(teamsB.map((t) => t.liveRating));
  const avgSosA = avgOf(teamsA.map((t) => t.liveSos).filter((v) => v != null) as number[]);
  const avgSosB = avgOf(teamsB.map((t) => t.liveSos).filter((v) => v != null) as number[]);
  const avgResumeA = avgOf(teamsA.map((t) => t.liveResume).filter((v) => v != null) as number[]);
  const avgResumeB = avgOf(teamsB.map((t) => t.liveResume).filter((v) => v != null) as number[]);

  const pairCount = Math.min(teamsA.length, teamsB.length);
  const pairs = Array.from({ length: pairCount }, (_, i) => ({
    left: teamsA[i],
    right: teamsB[i],
  }));
  const leftoverA = teamsA.slice(pairCount);
  const leftoverB = teamsB.slice(pairCount);

  let winsA = 0;
  let winsB = 0;
  pairs.forEach(({ left, right }) => {
    const spread = left.liveRating - right.liveRating;
    if (spread < 0) winsA += 1;
    else if (spread > 0) winsB += 1;
  });

  return (
    <div className="matchup-page" ref={exportRef}>
      <div className="team-hero">
        <button className="back-link" data-export-exclude="true" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">CONFERENCE COMPARISON</h1>
        <p className="subtitle team-subtitle">
          Pick two conferences to compare average power rating and strength
          of schedule, then see a projected lineup — each conference's teams
          matched up in rank order, #1 vs #1 through the bottom of the
          roster, on a neutral field.
        </p>
        {bothSelected && !sameConf && (
          <div style={{ marginTop: "0.75rem" }} data-export-exclude="true">
            <ExportPngButton
              targetRef={exportRef}
              filename={() => `conf-comparison-${confA}-vs-${confB}`.toLowerCase().replace(/\s+/g, "-")}
              showTweet={false}
            />
          </div>
        )}
      </div>

      <div className="matchup-body compare-body">
        <div className="picker-grid" data-export-exclude="true">
          <ConferencePicker
            label="Conference A"
            division={divA}
            conference={confA}
            onDivision={(v: string) => {
              setDivA(v);
              setConfA("");
            }}
            onConference={setConfA}
          />

          <div className="vs-divider">VS</div>

          <ConferencePicker
            label="Conference B"
            division={divB}
            conference={confB}
            onDivision={(v: string) => {
              setDivB(v);
              setConfB("");
            }}
            onConference={setConfB}
          />
        </div>

        {sameConf && (
          <div className="matchup-note">Pick two different conferences.</div>
        )}

        {!bothSelected && !sameConf && (
          <div className="matchup-note">
            Select two conferences to start comparing.
          </div>
        )}

        {bothSelected && !sameConf && (
          <>
            <div className="spread-cards conf-stat-cards">
              <StatCard label={confA} count={teamsA.length} avgRating={avgRatingA} avgSos={avgSosA} avgResume={avgResumeA} />
              <StatCard label={confB} count={teamsB.length} avgRating={avgRatingB} avgSos={avgSosB} avgResume={avgResumeB} />
            </div>

            <div className="table-wrap compare-table-wrap">
              <div className="section-label">Conference Lineup — Neutral Site</div>
              <div className="table-scroll">
                <table className="matchups-table lineup-table">
                  <thead>
                    <tr>
                      <th className="th">#</th>
                      <th className="th">{confA}</th>
                      <th className="th th-right">Spread</th>
                      <th className="th th-right">Win %</th>
                      <th className="th">{confB}</th>
                      <th className="th">Proj. Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((p, i) => (
                      <LineupRow
                        key={`${p.left.team}-${p.right.team}`}
                        seed={i + 1}
                        left={p.left}
                        right={p.right}
                        onNavigateTeam={onNavigateTeam}
                      />
                    ))}
                    {pairs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty">
                          No teams found for one of these conferences.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {(leftoverA.length > 0 || leftoverB.length > 0) && (
                <div className="footer-note">
                  No matchup (roster size mismatch):{" "}
                  {[...leftoverA, ...leftoverB].map((t) => t.team).join(", ")}
                </div>
              )}
            </div>

            <div className="conf-record-grid">
              <div className={`swap-summary-card ${winsA >= winsB ? "swap-summary-swapped" : ""}`}>
                <div className="swap-summary-label">{confA}</div>
                <div className="swap-summary-record">
                  {winsA}-{winsB}
                </div>
                <div className="swap-summary-sub">Projected Record</div>
              </div>
              <div className={`swap-summary-card ${winsB > winsA ? "swap-summary-swapped" : ""}`}>
                <div className="swap-summary-label">{confB}</div>
                <div className="swap-summary-record">
                  {winsB}-{winsA}
                </div>
                <div className="swap-summary-sub">Projected Record</div>
              </div>
            </div>

            <div className="footer-note">
              Spreads and win percentages are projected on a neutral field
              from each team's current power rating — no final scores, same
              as the rest of the site's matchup tools.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
