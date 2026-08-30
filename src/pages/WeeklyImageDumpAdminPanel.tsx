import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import CompactPowerRatingsGraphic from "../components/CompactPowerRatingsGraphic";
import { fetchAvailableWeeks, fetchWeeklyStats, weekLabel, type WeeklyTeamStats } from "../lib/api/weeklyStats";
import {
  buildDivisionResolvedTeams,
  metricGainersLosers,
  toRatingRows,
  toResumeRows,
  toSosRows,
  topG6,
  useWeekPairChange,
} from "../lib/imageDump";
import { exportNodeAsPngBlob } from "../lib/exportPng";

// Weekly Post/Image Dump tool. Currently covers Power Ratings (FBS + FCS)
// and, new in this pass, Resume Ratings and SOS (both FBS-only, per
// Chris's category list — Resume Ratings/SOS were never listed under FCS).
// Still to come: Win Totals (FBS + FCS, needs a wins-left/losses-left
// computation this tool doesn't have yet), FBS/FCS Playoff Brackets,
// Matchups, Watchability Chart, and TV Guide — those need genuinely new
// pieces (bracket rendering, the slate/watchability/TV Guide graphics
// already built for other parts of the site) rather than being a
// mechanical copy of this Power-Ratings-shaped pattern, so they're being
// tackled as their own follow-up passes.
//
// Every image is the same compact multi-column grid
// (CompactPowerRatingsGraphic): Full List at its original ~34-rows-per-
// column density, Top 30/Gainers/Losers (and Power Ratings' Top 30 G6)
// forced to 15 rows per column — a 2-columns-of-15 layout for a 30-team
// list, per Chris's reference image. An earlier version used 25-team
// lists in a 5x5 grid and, before that, tried to replicate the live
// site's wide sortable table off-screen (which doesn't capture reliably —
// see imageDump.ts's file header) before landing on this shape.
//
// Every graphic renders off-screen (not display:none — html-to-image needs
// real layout to capture), gets zipped client-side with JSZip, and the zip
// downloads as a single file. Nothing here writes to Supabase; it only
// reads whatever week(s) are already saved.

const TOP_N = 30;
const TOP_N_ROWS_PER_COLUMN = 15; // 2 columns of 15 for a 30-team list

interface DumpTarget {
  key: string;
  node: () => HTMLElement | null;
}

// Rendered off-screen (never display:none — html-to-image needs real
// layout to capture). Each captured node also gets display:"inline-block"
// on its own ref'd wrapper (see the refs below) rather than relying on the
// stage's own shrink-to-fit sizing — a position:fixed ancestor with only
// `left` set resolves width via shrink-to-fit, which turned out to size
// wildly wrong here (huge blank canvas, content pinned to one edge).
// inline-block unambiguously hugs its child's own width no matter what the
// ancestor chain does, which is the fix.
function OffscreenStage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1, pointerEvents: "none" }}>
      {children}
    </div>
  );
}

const CAPTURE_WRAP_STYLE: React.CSSProperties = { display: "inline-block" };

export default function WeeklyImageDumpAdminPanel({ onBack }: { onBack: () => void }) {
  const [weeks, setWeeks] = useState<string[]>([]);
  const [currentWeek, setCurrentWeek] = useState<string | null>(null);
  const [compareWeek, setCompareWeek] = useState<string | null>(null);
  const [loadingWeeks, setLoadingWeeks] = useState(true);
  const [currentRows, setCurrentRows] = useState<WeeklyTeamStats[]>([]);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipDone, setZipDone] = useState<string | null>(null);

  useEffect(() => {
    fetchAvailableWeeks()
      .then((w) => {
        setWeeks(w);
        setCurrentWeek(w[0] ?? null);
        setCompareWeek(w[1] ?? null);
      })
      .finally(() => setLoadingWeeks(false));
  }, []);

  useEffect(() => {
    if (!currentWeek) {
      setCurrentRows([]);
      return;
    }
    let cancelled = false;
    setLoadingCurrent(true);
    fetchWeeklyStats(currentWeek)
      .then((rows) => {
        if (!cancelled) setCurrentRows(rows);
      })
      .finally(() => {
        if (!cancelled) setLoadingCurrent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentWeek]);

  const liveByTeam = useMemo(() => Object.fromEntries(currentRows.map((r) => [r.team, r])), [currentRows]);
  const { byTeam: ratingChangeByTeam } = useWeekPairChange("rating", currentWeek, compareWeek);
  const { byTeam: resumeChangeByTeam } = useWeekPairChange("resume_rating", currentWeek, compareWeek);
  const { byTeam: sosChangeByTeam } = useWeekPairChange("sor", currentWeek, compareWeek);

  const fbsRows = useMemo(
    () => buildDivisionResolvedTeams("FBS", liveByTeam, ratingChangeByTeam),
    [liveByTeam, ratingChangeByTeam]
  );
  const fcsRows = useMemo(
    () => buildDivisionResolvedTeams("FCS", liveByTeam, ratingChangeByTeam),
    [liveByTeam, ratingChangeByTeam]
  );

  // --- Power Ratings (FBS + FCS) ---
  const fbsTop = fbsRows.slice(0, TOP_N);
  const fbsTopG6 = topG6(fbsRows, TOP_N);
  const fbsGainers = metricGainersLosers(fbsRows, (r) => r.rank, ratingChangeByTeam, "gainers", false, TOP_N);
  const fbsLosers = metricGainersLosers(fbsRows, (r) => r.rank, ratingChangeByTeam, "losers", false, TOP_N);

  const fcsTop = fcsRows.slice(0, TOP_N);
  const fcsGainers = metricGainersLosers(fcsRows, (r) => r.rank, ratingChangeByTeam, "gainers", false, TOP_N);
  const fcsLosers = metricGainersLosers(fcsRows, (r) => r.rank, ratingChangeByTeam, "losers", false, TOP_N);

  // --- Resume Ratings (FBS only) ---
  const fbsResumeFull = toResumeRows(fbsRows);
  const fbsResumeTop = fbsResumeFull.slice(0, TOP_N);
  const fbsResumeGainers = metricGainersLosers(fbsRows, (r) => r.resumeRank, resumeChangeByTeam, "gainers", true, TOP_N);
  const fbsResumeLosers = metricGainersLosers(fbsRows, (r) => r.resumeRank, resumeChangeByTeam, "losers", true, TOP_N);

  // --- SOS (FBS only) ---
  const fbsSosFull = toSosRows(fbsRows);
  const fbsSosTop = fbsSosFull.slice(0, TOP_N);
  const fbsSosGainers = metricGainersLosers(fbsRows, (r) => r.sosRank, sosChangeByTeam, "gainers", false, TOP_N);
  const fbsSosLosers = metricGainersLosers(fbsRows, (r) => r.sosRank, sosChangeByTeam, "losers", false, TOP_N);

  const wLabel = weekLabel(currentWeek);
  const fbsEyebrow = `${wLabel.toUpperCase()} · FBS`;
  const fcsEyebrow = `${wLabel.toUpperCase()} · FCS`;

  // Power Ratings refs
  const fbsFullRef = useRef<HTMLDivElement>(null);
  const fbsTopRef = useRef<HTMLDivElement>(null);
  const fbsG6Ref = useRef<HTMLDivElement>(null);
  const fbsGainersRef = useRef<HTMLDivElement>(null);
  const fbsLosersRef = useRef<HTMLDivElement>(null);
  const fcsFullRef = useRef<HTMLDivElement>(null);
  const fcsTopRef = useRef<HTMLDivElement>(null);
  const fcsGainersRef = useRef<HTMLDivElement>(null);
  const fcsLosersRef = useRef<HTMLDivElement>(null);
  // Resume Ratings refs
  const resumeFullRef = useRef<HTMLDivElement>(null);
  const resumeTopRef = useRef<HTMLDivElement>(null);
  const resumeGainersRef = useRef<HTMLDivElement>(null);
  const resumeLosersRef = useRef<HTMLDivElement>(null);
  // SOS refs
  const sosFullRef = useRef<HTMLDivElement>(null);
  const sosTopRef = useRef<HTMLDivElement>(null);
  const sosGainersRef = useRef<HTMLDivElement>(null);
  const sosLosersRef = useRef<HTMLDivElement>(null);

  const targets: DumpTarget[] = [
    { key: "01-fbs-power-ratings-full", node: () => fbsFullRef.current },
    { key: "02-fbs-power-ratings-top30", node: () => fbsTopRef.current },
    { key: "03-fbs-power-ratings-top30-g6", node: () => fbsG6Ref.current },
    { key: "04-fbs-power-ratings-gainers", node: () => fbsGainersRef.current },
    { key: "05-fbs-power-ratings-losers", node: () => fbsLosersRef.current },
    { key: "06-fcs-power-ratings-full", node: () => fcsFullRef.current },
    { key: "07-fcs-power-ratings-top30", node: () => fcsTopRef.current },
    { key: "08-fcs-power-ratings-gainers", node: () => fcsGainersRef.current },
    { key: "09-fcs-power-ratings-losers", node: () => fcsLosersRef.current },
    { key: "10-fbs-resume-ratings-full", node: () => resumeFullRef.current },
    { key: "11-fbs-resume-ratings-top30", node: () => resumeTopRef.current },
    { key: "12-fbs-resume-ratings-gainers", node: () => resumeGainersRef.current },
    { key: "13-fbs-resume-ratings-losers", node: () => resumeLosersRef.current },
    { key: "14-fbs-sos-full", node: () => sosFullRef.current },
    { key: "15-fbs-sos-top30", node: () => sosTopRef.current },
    { key: "16-fbs-sos-gainers", node: () => sosGainersRef.current },
    { key: "17-fbs-sos-losers", node: () => sosLosersRef.current },
  ];

  async function handleGenerateZip() {
    setZipping(true);
    setZipError(null);
    setZipDone(null);
    try {
      const zip = new JSZip();
      for (const target of targets) {
        const node = target.node();
        if (!node) continue;
        // Forced explicitly rather than trusting the node's own
        // getBoundingClientRect() — every capture here is rendered
        // off-screen (position:fixed, far outside the viewport) for the
        // batch, and that combination was measuring wildly wrong widths
        // even with the inline-block wrapper fix. scrollWidth/scrollHeight
        // read the node's actual laid-out box directly, same fix TV Guide
        // uses for its horizontally-scrollable export.
        const explicitSize = { width: node.scrollWidth, height: node.scrollHeight };
        // includeBranding:false — these graphics bake in their own
        // header/footer, so the generic branding bar exportPng.ts adds by
        // default would double it up.
        const blob = await exportNodeAsPngBlob(node, undefined, undefined, undefined, explicitSize, false);
        zip.file(`${target.key}.png`, blob);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `yc-power-ratings-${currentWeek ?? "week"}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setZipDone(`Downloaded ${targets.length} images.`);
    } catch (err: any) {
      setZipError(err.message ?? "Failed to build ZIP");
    } finally {
      setZipping(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Weekly Image Dump</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", maxWidth: 640 }}>
        Power Ratings (FBS + FCS), Resume Ratings (FBS), and SOS (FBS) — Full List, Top 30,
        Gainers, Losers (Power Ratings also gets Top 30 Group of 6). Still to come: Win Totals,
        Playoff Brackets, Matchups, Watchability, and TV Guide. Nothing here is saved — it only
        reads weeks you've already uploaded.
      </p>

      {loadingWeeks ? (
        <p>Loading weeks…</p>
      ) : weeks.length === 0 ? (
        <p style={{ color: "crimson" }}>No weekly data has been uploaded yet.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", margin: "1rem 0 1.5rem" }}>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.25rem" }}>
                Week to generate
              </div>
              <select value={currentWeek ?? ""} onChange={(e) => setCurrentWeek(e.target.value)}>
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {weekLabel(w)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.25rem" }}>
                Compare against (for Gainers/Losers)
              </div>
              <select value={compareWeek ?? ""} onChange={(e) => setCompareWeek(e.target.value)}>
                <option value="">— none —</option>
                {weeks
                  .filter((w) => w !== currentWeek)
                  .map((w) => (
                    <option key={w} value={w}>
                      {weekLabel(w)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <button className="menu-btn" onClick={handleGenerateZip} disabled={zipping || loadingCurrent}>
            {zipping ? "Building ZIP…" : `Generate ZIP (${targets.length} images)`}
          </button>
          {zipDone && <p style={{ color: "green" }}>{zipDone}</p>}
          {zipError && <p style={{ color: "crimson" }}>{zipError}</p>}

          <OffscreenStage>
            {/* Power Ratings — FBS */}
            <div ref={fbsFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Power Ratings — Full List" sections={[{ title: "", rows: toRatingRows(fbsRows) }]} />
            </div>
            <div ref={fbsTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Power Ratings — Top 30" sections={[{ title: "", rows: toRatingRows(fbsTop) }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} />
            </div>
            <div ref={fbsG6Ref} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Power Ratings — Top 30 Group of 6" sections={[{ title: "", rows: toRatingRows(fbsTopG6) }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} />
            </div>
            <div ref={fbsGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Power Ratings — Top 30 Gainers" sections={[{ title: "", rows: fbsGainers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>
            <div ref={fbsLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Power Ratings — Top 30 Losers" sections={[{ title: "", rows: fbsLosers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>

            {/* Power Ratings — FCS */}
            <div ref={fcsFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Power Ratings — Full List" sections={[{ title: "", rows: toRatingRows(fcsRows) }]} />
            </div>
            <div ref={fcsTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Power Ratings — Top 30" sections={[{ title: "", rows: toRatingRows(fcsTop) }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} />
            </div>
            <div ref={fcsGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Power Ratings — Top 30 Gainers" sections={[{ title: "", rows: fcsGainers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>
            <div ref={fcsLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Power Ratings — Top 30 Losers" sections={[{ title: "", rows: fcsLosers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>

            {/* Resume Ratings — FBS only */}
            <div ref={resumeFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Full List" sections={[{ title: "", rows: fbsResumeFull }]} valueLabel="RESUME" />
            </div>
            <div ref={resumeTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30" sections={[{ title: "", rows: fbsResumeTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="RESUME" />
            </div>
            <div ref={resumeGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30 Gainers" sections={[{ title: "", rows: fbsResumeGainers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>
            <div ref={resumeLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30 Losers" sections={[{ title: "", rows: fbsResumeLosers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>

            {/* SOS — FBS only */}
            <div ref={sosFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Strength of Schedule — Full List" sections={[{ title: "", rows: fbsSosFull }]} valueLabel="SOS" />
            </div>
            <div ref={sosTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Strength of Schedule — Top 30" sections={[{ title: "", rows: fbsSosTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="SOS" />
            </div>
            <div ref={sosGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Strength of Schedule — Top 30 Gainers" sections={[{ title: "", rows: fbsSosGainers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>
            <div ref={sosLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Strength of Schedule — Top 30 Losers" sections={[{ title: "", rows: fbsSosLosers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" />
            </div>
          </OffscreenStage>
        </>
      )}
    </div>
  );
}
