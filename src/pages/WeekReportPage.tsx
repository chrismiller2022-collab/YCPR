import { useEffect, useState } from "react";
import { WEEKS } from "../data/games";
import { fetchWeeklyReportUrl, type ReportDivision } from "../lib/api/weeklyReports";

// Used to live-generate a bespoke PDF client-side (see lib/pdfReport.ts +
// lib/reportData.ts — left in place but unused, since Chris didn't love
// that format). Now this just looks up whether that week+division's
// report has already been published (as a single PDF assembled from the
// Weekly Image Dump's own PNGs, one page each) and links to it — nothing
// is generated here anymore. See WeeklyImageDumpAdminPanel.tsx for the
// publish side. FBS and FCS are separate published reports (separate
// storage keys) — a division not yet generated for a given week just
// shows as unavailable, same as before the split.
const DIVISION_DESCRIPTIONS: Record<ReportDivision, string> = {
  FBS: "That week's full FBS graphics pack in one PDF — Power Ratings, Resume Ratings, SOS, Win Totals, the Playoff Bracket, FBS and FBS-vs-FCS Matchups, the Watchability Chart, TV Guide, and every FBS Conference Preview.",
  FCS: "That week's full FCS graphics pack in one PDF — Power Ratings, Win Totals, the Playoff Bracket, FCS Matchups, and every FCS Conference Preview.",
};

export default function WeekReportPage({ onHome }: any) {
  const [week, setWeek] = useState(WEEKS[0].key);
  const [division, setDivision] = useState<ReportDivision>("FBS");
  const [loading, setLoading] = useState(true);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWeeklyReportUrl(week, division)
      .then((url) => {
        if (!cancelled) setReportUrl(url);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? "Failed to check for this week's report.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [week, division]);

  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Tools</div>
        <h1 className="title matchup-title">WEEK REPORT (PDF)</h1>
        <p className="subtitle team-subtitle">{DIVISION_DESCRIPTIONS[division]}</p>
      </div>

      <div className="picker-grid" style={{ maxWidth: 480, margin: "2rem auto 0", display: "flex", gap: "1rem", justifyContent: "center" }}>
        <div className="picker-card">
          <div className="picker-label">Division</div>
          <div className="picker-row">
            <select className="filter picker-select" value={division} onChange={(e) => setDivision(e.target.value as ReportDivision)}>
              <option value="FBS">FBS</option>
              <option value="FCS">FCS</option>
            </select>
          </div>
        </div>
        <div className="picker-card">
          <div className="picker-label">Week</div>
          <div className="picker-row">
            <select className="filter picker-select" value={week} onChange={(e) => setWeek(e.target.value)}>
              {WEEKS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: "2rem" }}>
        {loading ? (
          <p>Checking for this week's report…</p>
        ) : error ? (
          <p style={{ color: "crimson" }}>{error}</p>
        ) : reportUrl ? (
          <a
            className="mode-btn mode-btn-active"
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "0.8rem 1.6rem", fontSize: "0.9rem", display: "inline-block", textDecoration: "none" }}
          >
            View / Download {division} Report
          </a>
        ) : (
          <p style={{ color: "#666" }}>This week's {division} report is currently unavailable.</p>
        )}
      </div>
    </div>
  );
}
