import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import CompactPowerRatingsGraphic from "../components/CompactPowerRatingsGraphic";
import type { CompactRatingRow } from "../lib/compactPowerRatings";
import { fetchAvailableWeeks, fetchWeeklyStats, weekLabel, type WeeklyTeamStats } from "../lib/api/weeklyStats";
import { buildDivisionResolvedTeams, sortByChange, topG6, useWeekPairChange, type ImageDumpTeamRow } from "../lib/imageDump";
import { exportNodeAsPngBlob } from "../lib/exportPng";

// Phase 1 of the Weekly Post/Image Dump tool: Power Ratings only (9 images
// — Full List, Top 25, Top 25 G6, Top 25 Gainers, Top 25 Losers for FBS;
// Full List, Top 25, Top 25 Gainers, Top 25 Losers for FCS). This is the
// proof-of-pattern Chris asked to see reviewed before the same shell gets
// replicated for Resume Ratings, SOS, Win Totals, and the FCS/Matchups/
// Bracket/Watchability/TV Guide sections.
//
// Every image is the same compact multi-column grid (CompactPowerRatingsGraphic):
// Full List at its original ~34-rows-per-column density, Top 25/G6/Gainers/
// Losers forced to 5 rows per column (5x5 for a 25-team list). An earlier
// version tried to replicate the live site's wide sortable table for
// Top 25/G6/Gainers/Losers (RankedTeamsTableGraphic) — that table relies on
// page-width-relative CSS (a site-wide `table { width: 100% }` rule anchored
// against .table-wrap's max-width) that has nothing to anchor against when
// captured off-screen, and kept rendering wide and blank. The compact grid
// has no such dependency, so it was switched to for all five list types.
//
// Every graphic renders off-screen (not display:none — html-to-image needs
// real layout to capture), gets zipped client-side with JSZip, and the zip
// downloads as a single file. Nothing here writes to Supabase; it only
// reads whatever week(s) are already saved.

interface DumpTarget {
  key: string;
  label: string;
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

// Gainers/Losers show how much a team's rating MOVED, not its current
// rating — so the compact grid's value column is repurposed to show
// `change` instead of `rating` (same shape, different number and column
// label — see valueLabel="CHANGE" below).
function toChangeRows(rows: ImageDumpTeamRow[]): CompactRatingRow[] {
  return rows.map((r) => ({ rank: r.rank, team: r.team, conf: r.conf, rating: r.change ?? 0 }));
}

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
  const { byTeam: changeByTeam } = useWeekPairChange("rating", currentWeek, compareWeek);

  const fbsRows = useMemo(
    () => buildDivisionResolvedTeams("FBS", liveByTeam, changeByTeam),
    [liveByTeam, changeByTeam]
  );
  const fcsRows = useMemo(
    () => buildDivisionResolvedTeams("FCS", liveByTeam, changeByTeam),
    [liveByTeam, changeByTeam]
  );

  const fbsTop25 = fbsRows.slice(0, 25);
  const fbsTop25G6 = topG6(fbsRows, 25);
  const fbsGainers = sortByChange(fbsRows, "gainers", 25);
  const fbsLosers = sortByChange(fbsRows, "losers", 25);

  const fcsTop25 = fcsRows.slice(0, 25);
  const fcsGainers = sortByChange(fcsRows, "gainers", 25);
  const fcsLosers = sortByChange(fcsRows, "losers", 25);

  const wLabel = weekLabel(currentWeek);
  const fbsEyebrow = `${wLabel.toUpperCase()} · FBS`;
  const fcsEyebrow = `${wLabel.toUpperCase()} · FCS`;

  const fbsFullRef = useRef<HTMLDivElement>(null);
  const fbsTop25Ref = useRef<HTMLDivElement>(null);
  const fbsG6Ref = useRef<HTMLDivElement>(null);
  const fbsGainersRef = useRef<HTMLDivElement>(null);
  const fbsLosersRef = useRef<HTMLDivElement>(null);
  const fcsFullRef = useRef<HTMLDivElement>(null);
  const fcsTop25Ref = useRef<HTMLDivElement>(null);
  const fcsGainersRef = useRef<HTMLDivElement>(null);
  const fcsLosersRef = useRef<HTMLDivElement>(null);

  const targets: DumpTarget[] = [
    { key: "01-fbs-power-ratings-full", label: "FBS Power Ratings — Full List", node: () => fbsFullRef.current },
    { key: "02-fbs-power-ratings-top25", label: "FBS Power Ratings — Top 25", node: () => fbsTop25Ref.current },
    { key: "03-fbs-power-ratings-top25-g6", label: "FBS Power Ratings — Top 25 G6", node: () => fbsG6Ref.current },
    { key: "04-fbs-power-ratings-gainers", label: "FBS Power Ratings — Top 25 Gainers", node: () => fbsGainersRef.current },
    { key: "05-fbs-power-ratings-losers", label: "FBS Power Ratings — Top 25 Losers", node: () => fbsLosersRef.current },
    { key: "06-fcs-power-ratings-full", label: "FCS Power Ratings — Full List", node: () => fcsFullRef.current },
    { key: "07-fcs-power-ratings-top25", label: "FCS Power Ratings — Top 25", node: () => fcsTop25Ref.current },
    { key: "08-fcs-power-ratings-gainers", label: "FCS Power Ratings — Top 25 Gainers", node: () => fcsGainersRef.current },
    { key: "09-fcs-power-ratings-losers", label: "FCS Power Ratings — Top 25 Losers", node: () => fcsLosersRef.current },
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
        Phase 1: Power Ratings. Renders a compact spreadsheet-style grid for each list (Full List,
        Top 25, Top 25 G6, Top 25 Gainers, Top 25 Losers), then bundles them into one ZIP. Nothing
        here is saved — it only reads weeks you've already uploaded.
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
            {zipping ? "Building ZIP…" : "Generate ZIP (Power Ratings, 9 images)"}
          </button>
          {zipDone && <p style={{ color: "green" }}>{zipDone}</p>}
          {zipError && <p style={{ color: "crimson" }}>{zipError}</p>}

          <OffscreenStage>
            <div ref={fbsFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Power Ratings — Full List"
                sections={[{ title: "", rows: fbsRows }]}
              />
            </div>
            <div ref={fbsTop25Ref} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Power Ratings — Top 25"
                sections={[{ title: "", rows: fbsTop25 }]}
                targetRowsPerColumn={5}
              />
            </div>
            <div ref={fbsG6Ref} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Power Ratings — Top 25 Group of 6"
                sections={[{ title: "", rows: fbsTop25G6 }]}
                targetRowsPerColumn={5}
              />
            </div>
            <div ref={fbsGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Power Ratings — Top 25 Gainers"
                sections={[{ title: "", rows: toChangeRows(fbsGainers) }]}
                targetRowsPerColumn={5}
                valueLabel="CHANGE"
              />
            </div>
            <div ref={fbsLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Power Ratings — Top 25 Losers"
                sections={[{ title: "", rows: toChangeRows(fbsLosers) }]}
                targetRowsPerColumn={5}
                valueLabel="CHANGE"
              />
            </div>
            <div ref={fcsFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fcsEyebrow}
                header="Power Ratings — Full List"
                sections={[{ title: "", rows: fcsRows }]}
              />
            </div>
            <div ref={fcsTop25Ref} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fcsEyebrow}
                header="Power Ratings — Top 25"
                sections={[{ title: "", rows: fcsTop25 }]}
                targetRowsPerColumn={5}
              />
            </div>
            <div ref={fcsGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fcsEyebrow}
                header="Power Ratings — Top 25 Gainers"
                sections={[{ title: "", rows: toChangeRows(fcsGainers) }]}
                targetRowsPerColumn={5}
                valueLabel="CHANGE"
              />
            </div>
            <div ref={fcsLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fcsEyebrow}
                header="Power Ratings — Top 25 Losers"
                sections={[{ title: "", rows: toChangeRows(fcsLosers) }]}
                targetRowsPerColumn={5}
                valueLabel="CHANGE"
              />
            </div>
          </OffscreenStage>
        </>
      )}
    </div>
  );
}
