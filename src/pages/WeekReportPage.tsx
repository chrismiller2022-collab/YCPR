import { useState } from "react";
import { WEEKS } from "../data/games";
import { useWeeklyChange } from "../lib/api/weeklyStats";
import {
  topGainersAndLosers,
  winsLossesLeft,
  allConferencePreviews,
  weekMatchups,
} from "../lib/reportData";

export default function WeekReportPage({ onHome }: any) {
  const [division, setDivision] = useState<"FBS" | "FCS">("FBS");
  const [week, setWeek] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { byTeam: sosChange, currentWeek, previousWeek } = useWeeklyChange("sor");
  const { byTeam: resumeChange } = useWeeklyChange("resume_rating");
  const { byTeam: ratingChange } = useWeeklyChange("rating");

  const hasWeeklyChangeData = !!(currentWeek && previousWeek);

  const handleGenerate = () => {
    setGenerating(true);
    setError(null);
    (async () => {
      try {
        const { buildWeekReportPdf } = await import("../lib/pdfReport");
        buildWeekReportPdf({
          division,
          week,
          sos: topGainersAndLosers(division, sosChange),
          resume: topGainersAndLosers(division, resumeChange),
          rating: topGainersAndLosers(division, ratingChange),
          winsLossesLeft: winsLossesLeft(division),
          conferencePreviews: allConferencePreviews(division),
          matchups: weekMatchups(division, week),
          hasWeeklyChangeData,
        });
      } catch (err: any) {
        setError(err?.message ?? "Something went wrong generating the report.");
      } finally {
        setGenerating(false);
      }
    })();
  };

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">WEEK REPORT (PDF)</h1>
        <p className="subtitle team-subtitle">
          Generates a PDF covering Top 25 gainers/losers for SOS, Resume, and
          Power Rating, wins/losses left, every conference preview, and that
          week's matchups — all for one division at a time.
        </p>
        {!hasWeeklyChangeData && (
          <p style={{ fontSize: "0.8rem", color: "#666" }}>
            Gainers/losers sections will be empty until at least two weeks of
            data have been saved through the admin page.
          </p>
        )}
      </div>

      <div className="picker-grid" style={{ maxWidth: 480, margin: "2rem auto 0" }}>
        <div className="picker-card">
          <div className="picker-label">Division</div>
          <div className="picker-row">
            <select
              className="filter picker-select"
              value={division}
              onChange={(e) => setDivision(e.target.value as "FBS" | "FCS")}
            >
              <option value="FBS">FBS</option>
              <option value="FCS">FCS</option>
            </select>
            <select
              className="filter picker-select"
              value={week}
              onChange={(e) => setWeek(parseInt(e.target.value, 10))}
            >
              {WEEKS.map((w, i) => (
                <option key={w.key} value={i + 1}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: "2rem" }}>
        <button
          className="mode-btn mode-btn-active"
          disabled={generating}
          onClick={handleGenerate}
          style={{ padding: "0.8rem 1.6rem", fontSize: "0.9rem" }}
        >
          {generating ? "Generating…" : `Generate ${division} Week ${week} Report`}
        </button>
        {error && (
          <p style={{ color: "crimson", marginTop: "1rem" }}>{error}</p>
        )}
      </div>

      <div className="footer-note">
        The PDF downloads directly in your browser — nothing is uploaded or
        stored anywhere.
      </div>
    </div>
  );
}
