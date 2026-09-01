import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import jsPDF from "jspdf";
import CompactPowerRatingsGraphic from "../components/CompactPowerRatingsGraphic";
import MatchupGridGraphic from "../components/MatchupGridGraphic";
import BracketPage from "./BracketPage";
import FCSBracketPage from "./FCSBracketPage";
import WatchabilityPage from "./WatchabilityPage";
import TvGuidePanel, { STREAMING_CHANNEL_KEY } from "./TvGuidePanel";
import ConferencePreviewPage from "./ConferencePreviewPage";
import { conferencesForDivision } from "../data/teams";
import { fetchAvailableWeeks, fetchWeeklyStats, weekLabel, type WeeklyTeamStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { classOf, isTracked, computeRow } from "../lib/matchupsCompute";
import { buildSlateRow, filterSlateRowsByDay, type SlateGameRow } from "../lib/matchupSlate";

// Shared by every Matchups target below — same filter+compute+shape
// pipeline the live Weekly Matchups page uses (classOf -> computeRow ->
// buildSlateRow), parameterized only by which division pairing to keep.
function buildDivisionSlateRows(
  games: GameWithLines[],
  ratings: Record<string, any>,
  projTotalByGame: Map<string, number>,
  matchupType: "FBSvFBS" | "FCSvFCS" | "Cross"
): SlateGameRow[] {
  return games
    .filter((g) => {
      const home = classOf(g, "home");
      const away = classOf(g, "away");
      if (matchupType === "FBSvFBS") return home === "fbs" && away === "fbs";
      if (matchupType === "FCSvFCS") return home === "fcs" && away === "fcs";
      return isTracked(home) && isTracked(away) && home !== away;
    })
    .map((g) => computeRow(g, ratings))
    .filter((c) => c.vegasAwaySpread != null) // hide games with no Vegas line, matching the live page's default
    .map((c) => buildSlateRow(c, projTotalByGame.get(`${c.game.week}|${c.game.home_team}|${c.game.away_team}`) ?? null));
}
import {
  buildDivisionResolvedTeams,
  metricGainersLosers,
  toLossesLeftRows,
  toRatingRows,
  toResumeRows,
  toSosRows,
  toWinsLeftRows,
  toWinTotalRows,
  topG6,
  useWeekPairChange,
} from "../lib/imageDump";
import { exportNodeAsPngBlob } from "../lib/exportPng";
import { publishWeeklyReportPdf } from "../lib/api/weeklyReports";

// Weekly Post/Image Dump tool. Covers every category on Chris's list:
// Power Ratings and Win Totals (FBS + FCS), Resume Ratings and SOS (both
// FBS-only — never listed under FCS), the FBS/FCS Playoff Brackets,
// Matchups (FBS vs FBS and FCS vs FCS, each Midweek/Saturday; FBS vs FCS
// as one "All" image), the Watchability Chart (Saturday only), and the
// TV Guide.
//
// Matchups reuses the live Weekly Matchups page's own pipeline
// (fetchGamesWithLines -> useWeekAccurateRatings -> computeRow ->
// buildSlateRow -> filterSlateRowsByDay) and its MatchupSlateGraphic
// component, scoped to the schedule week matching whichever weekly
// snapshot is selected above (currentWeek "week3" -> schedule week 3;
// "preseason" has no schedule week, so Matchups renders empty for it).
//
// Watchability and TV Guide are the live pages themselves (WatchabilityPage/
// TvGuidePanel), not bespoke graphics — same lesson as the brackets: check
// for an existing page before building a new one. Neither page originally
// had a way to be pointed at a specific week from outside (they each pick
// their own default), so both gained a small weekOverride prop (plus
// forceSaturdaysOnly on WatchabilityPage, and a shareRef prop on both so
// this tool can grab the exact node their own Export PNG button already
// targets) — see the file-header comments on those two files.
//
// Brackets are NOT rebuilt here — BracketPage (FBS) and FCSBracketPage
// (FCS) already exist as full, self-contained site pages (their own
// seeding, live-rating resolution, and bracket-tree rendering) and are
// simply rendered off-screen and captured, same as everything else in this
// file. (Earlier working notes in this file assumed bracket logic didn't
// exist yet and would need to be built from scratch — that was wrong;
// always check for an existing page/component before assuming new logic
// is needed. Apply that same check before building Matchups/Watchability/
// TV Guide too — MatchupSlateGraphic and a TV Guide export already exist
// elsewhere in the codebase.)
//
// Every Power Ratings/Resume/SOS/Win Totals image is the same compact
// multi-column grid (CompactPowerRatingsGraphic): Full List at its
// original ~34-rows-per-column density, Top 30/Gainers/Losers (and Power
// Ratings' Top 30 G6) forced to 15 rows per column — a 2-columns-of-15
// layout for a 30-team list, per Chris's reference image. An earlier
// version used 25-team lists in a 5x5 grid and, before that, tried to
// replicate the live site's wide sortable table off-screen (which doesn't
// capture reliably — see imageDump.ts's file header) before landing on
// this shape. The bracket pages instead reuse the site's own markup/CSS
// as-is and rely on the same off-screen-capture safety net (explicitSize
// from scrollWidth/scrollHeight, see handleGenerateZip) rather than a
// bespoke compact layout — they don't self-brand like
// CompactPowerRatingsGraphic does, so they keep the generic branding
// footer exportPng.ts adds by default (see DumpTarget.branding below).
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
  /** false for every CompactPowerRatingsGraphic target — those bake in
   * their own header/footer branding, so the generic branding bar
   * exportPng.ts adds by default would double it up. Omitted (defaults to
   * true) for the bracket pages, which don't self-brand and should get
   * the same branding bar their on-page Export button already adds. */
  branding?: boolean;
  /** Runs immediately before this target is measured/captured; the
   * returned function runs right after. Used by TV Guide to hide the
   * Streaming/ESPN+ row — that channel alone can run a dozen-plus
   * overlapping games and dominates the image, so it's left out here,
   * matching the live page's own "Include Streaming? No" export choice. */
  beforeCapture?: (node: HTMLElement) => () => void;
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

// Reads a captured PNG blob back as a data URL (for jsPDF's addImage,
// which wants a data URL/base64 string, not a Blob) plus its actual
// pixel dimensions (via Image.naturalWidth/Height, rather than assuming
// 2x the DOM node's scrollWidth/scrollHeight — trusts what was actually
// rasterized instead of re-deriving it).
function blobToImageData(blob: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image blob"));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Failed to measure image dimensions"));
      img.src = dataUrl;
    };
    reader.readAsDataURL(blob);
  });
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
  const { byTeam: ratingChangeByTeam } = useWeekPairChange("rating", currentWeek, compareWeek);
  const { byTeam: resumeChangeByTeam } = useWeekPairChange("resume_rating", currentWeek, compareWeek);
  const { byTeam: sosChangeByTeam } = useWeekPairChange("sor", currentWeek, compareWeek);

  // --- Matchups (schedule week, not the weekly power-ratings snapshot
  // picked above) --- "week3" -> 3; "preseason" (or no week picked yet)
  // has no schedule week, so matchups just render empty. Reuses the same
  // pipeline as the live Weekly Matchups page (fetchGamesWithLines ->
  // useWeekAccurateRatings -> computeRow -> buildSlateRow ->
  // filterSlateRowsByDay) and its MatchupSlateGraphic, rather than a
  // bespoke graphic — matches the public site by construction.
  const season = new Date().getFullYear();
  const scheduleWeekNum = useMemo(() => {
    const m = currentWeek ? /^week(\d+)$/.exec(currentWeek) : null;
    return m ? parseInt(m[1], 10) : null;
  }, [currentWeek]);

  const [scheduleGames, setScheduleGames] = useState<GameWithLines[]>([]);
  useEffect(() => {
    if (scheduleWeekNum == null) {
      setScheduleGames([]);
      return;
    }
    let cancelled = false;
    fetchGamesWithLines(season, scheduleWeekNum).then((games) => {
      if (!cancelled) setScheduleGames(games);
    });
    return () => {
      cancelled = true;
    };
  }, [season, scheduleWeekNum]);

  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, scheduleWeekNum != null ? [scheduleWeekNum] : [], season);
  const { rows: totalsEngineRows } = useGameTotalsEngine(season);
  const projTotalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsEngineRows]);

  const matchupRatings = scheduleWeekNum != null ? ratingsByWeek[scheduleWeekNum] ?? {} : {};
  const fbsFbsSlateRows = useMemo(
    () => (scheduleWeekNum == null ? [] : buildDivisionSlateRows(scheduleGames, matchupRatings, projTotalByGame, "FBSvFBS")),
    [scheduleWeekNum, scheduleGames, matchupRatings, projTotalByGame]
  );
  const fcsFcsSlateRows = useMemo(
    () => (scheduleWeekNum == null ? [] : buildDivisionSlateRows(scheduleGames, matchupRatings, projTotalByGame, "FCSvFCS")),
    [scheduleWeekNum, scheduleGames, matchupRatings, projTotalByGame]
  );
  // FBS vs FCS — "All" per Chris's category list, no Midweek/Saturday split.
  const crossSlateRows = useMemo(
    () => (scheduleWeekNum == null ? [] : buildDivisionSlateRows(scheduleGames, matchupRatings, projTotalByGame, "Cross")),
    [scheduleWeekNum, scheduleGames, matchupRatings, projTotalByGame]
  );

  const fbsFbsMidweekRows = useMemo(() => filterSlateRowsByDay(fbsFbsSlateRows, "midweek"), [fbsFbsSlateRows]);
  const fbsFbsSaturdayRows = useMemo(() => filterSlateRowsByDay(fbsFbsSlateRows, "saturday"), [fbsFbsSlateRows]);
  const fcsFcsMidweekRows = useMemo(() => filterSlateRowsByDay(fcsFcsSlateRows, "midweek"), [fcsFcsSlateRows]);
  const fcsFcsSaturdayRows = useMemo(() => filterSlateRowsByDay(fcsFcsSlateRows, "saturday"), [fcsFcsSlateRows]);

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
  // SOS convention: positive = harder schedule, negative = easier (see
  // imageDump.ts's toSosRows). "Top 30 Hardest"/"Top 30 Easiest" are two
  // independent ranked lists of equal length (rank 1 = hardest on the
  // left, rank 1 = easiest on the right), not two halves of one list —
  // each gets its own rank computed fresh here rather than reusing
  // sosRank (which is a single ascending-only rank across the whole
  // division and would show confusing high numbers at the top of the
  // Hardest side). Equal length matters for more than symmetry: a
  // shorter Easiest column read as visually lopsided next to the full
  // Hardest column.
  const fbsSosFull = toSosRows(fbsRows);

  const fbsSosValues = fbsRows
    .map((r) => ({ team: r.team, conf: r.conf, sos: r.sos }))
    .filter((r): r is { team: string; conf: string; sos: number } => r.sos != null);
  const fbsSosHardest = fbsSosValues
    .filter((r) => r.sos > 0)
    .sort((a, b) => b.sos - a.sos)
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, team: r.team, conf: r.conf, rating: r.sos }));
  const fbsSosEasiest = fbsSosValues
    .filter((r) => r.sos < 0)
    .sort((a, b) => a.sos - b.sos)
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, team: r.team, conf: r.conf, rating: r.sos }));

  const fbsSosChanges = fbsRows
    .map((r) => ({ team: r.team, conf: r.conf, change: sosChangeByTeam[r.team]?.change ?? null }))
    .filter((r): r is { team: string; conf: string; change: number } => r.change != null);
  const fbsSosGotHarder = fbsSosChanges
    .filter((r) => r.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, team: r.team, conf: r.conf, rating: r.change }));
  const fbsSosGotEasier = fbsSosChanges
    .filter((r) => r.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, team: r.team, conf: r.conf, rating: r.change }));

  // --- Win Totals (FBS + FCS) ---
  // No Gainers/Losers here — Chris's category list only asked for Full
  // List, Top 30, Wins Left, Losses Left (unlike PR/Resume/SOS, which all
  // have a gainers/losers pair too).
  const fbsWinTotalFull = toWinTotalRows(fbsRows);
  const fbsWinTotalTop = fbsWinTotalFull.slice(0, TOP_N);
  const fbsWinsLeft = toWinsLeftRows(fbsRows, TOP_N);
  const fbsLossesLeft = toLossesLeftRows(fbsRows, TOP_N);

  const fcsWinTotalFull = toWinTotalRows(fcsRows);
  const fcsWinTotalTop = fcsWinTotalFull.slice(0, TOP_N);
  const fcsWinsLeft = toWinsLeftRows(fcsRows, TOP_N);
  const fcsLossesLeft = toLossesLeftRows(fcsRows, TOP_N);

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
  const sosHardEasyRef = useRef<HTMLDivElement>(null);
  const sosChangeRef = useRef<HTMLDivElement>(null);
  // Win Totals refs
  const fbsWinTotalFullRef = useRef<HTMLDivElement>(null);
  const fbsWinTotalTopRef = useRef<HTMLDivElement>(null);
  const fbsWinsLeftRef = useRef<HTMLDivElement>(null);
  const fbsLossesLeftRef = useRef<HTMLDivElement>(null);
  const fcsWinTotalFullRef = useRef<HTMLDivElement>(null);
  const fcsWinTotalTopRef = useRef<HTMLDivElement>(null);
  const fcsWinsLeftRef = useRef<HTMLDivElement>(null);
  const fcsLossesLeftRef = useRef<HTMLDivElement>(null);
  // Playoff Bracket refs — capture the existing BracketPage/FCSBracketPage
  // components wholesale, not a purpose-built graphic.
  const fbsBracketRef = useRef<HTMLDivElement>(null);
  const fcsBracketRef = useRef<HTMLDivElement>(null);
  // Matchups refs
  const fbsMatchupsMidweekRef = useRef<HTMLDivElement>(null);
  const fbsMatchupsSaturdayRef = useRef<HTMLDivElement>(null);
  const fcsMatchupsMidweekRef = useRef<HTMLDivElement>(null);
  const fcsMatchupsSaturdayRef = useRef<HTMLDivElement>(null);
  const crossMatchupsAllRef = useRef<HTMLDivElement>(null);
  // Watchability / TV Guide refs — passed straight into the live pages as
  // shareRef, so these ARE the exact nodes their own Export PNG buttons
  // already target (see WatchabilityPage.tsx/TvGuidePanel.tsx).
  const watchabilityRef = useRef<HTMLDivElement>(null);
  const tvGuideRef = useRef<HTMLDivElement>(null);
  // Conference Previews — one image per conference, FBS then FCS. A
  // dynamic-length list, unlike everything above, so refs live in a Map
  // keyed by conference name instead of individual named useRefs.
  const conferences = useMemo(
    () => [
      ...conferencesForDivision("FBS").map((conf) => ({ conf, div: "FBS" as const })),
      ...conferencesForDivision("FCS").map((conf) => ({ conf, div: "FCS" as const })),
    ],
    []
  );
  const conferenceRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const targets: DumpTarget[] = [
    { key: "01-fbs-power-ratings-full", node: () => fbsFullRef.current, branding: false },
    { key: "02-fbs-power-ratings-top30", node: () => fbsTopRef.current, branding: false },
    { key: "03-fbs-power-ratings-top30-g6", node: () => fbsG6Ref.current, branding: false },
    { key: "04-fbs-power-ratings-gainers", node: () => fbsGainersRef.current, branding: false },
    { key: "05-fbs-power-ratings-losers", node: () => fbsLosersRef.current, branding: false },
    { key: "06-fcs-power-ratings-full", node: () => fcsFullRef.current, branding: false },
    { key: "07-fcs-power-ratings-top30", node: () => fcsTopRef.current, branding: false },
    { key: "08-fcs-power-ratings-gainers", node: () => fcsGainersRef.current, branding: false },
    { key: "09-fcs-power-ratings-losers", node: () => fcsLosersRef.current, branding: false },
    { key: "10-fbs-resume-ratings-full", node: () => resumeFullRef.current, branding: false },
    { key: "11-fbs-resume-ratings-top30", node: () => resumeTopRef.current, branding: false },
    { key: "12-fbs-resume-ratings-gainers", node: () => resumeGainersRef.current, branding: false },
    { key: "13-fbs-resume-ratings-losers", node: () => resumeLosersRef.current, branding: false },
    { key: "14-fbs-sos-full", node: () => sosFullRef.current, branding: false },
    { key: "15-fbs-sos-hardest-easiest", node: () => sosHardEasyRef.current, branding: false },
    { key: "16-fbs-sos-got-harder-got-easier", node: () => sosChangeRef.current, branding: false },
    { key: "17-fbs-win-totals-full", node: () => fbsWinTotalFullRef.current, branding: false },
    { key: "18-fbs-win-totals-top30", node: () => fbsWinTotalTopRef.current, branding: false },
    { key: "19-fbs-win-totals-wins-left", node: () => fbsWinsLeftRef.current, branding: false },
    { key: "20-fbs-win-totals-losses-left", node: () => fbsLossesLeftRef.current, branding: false },
    { key: "21-fcs-win-totals-full", node: () => fcsWinTotalFullRef.current, branding: false },
    { key: "22-fcs-win-totals-top30", node: () => fcsWinTotalTopRef.current, branding: false },
    { key: "23-fcs-win-totals-wins-left", node: () => fcsWinsLeftRef.current, branding: false },
    { key: "24-fcs-win-totals-losses-left", node: () => fcsLossesLeftRef.current, branding: false },
    { key: "25-fbs-playoff-bracket", node: () => fbsBracketRef.current },
    { key: "26-fcs-playoff-bracket", node: () => fcsBracketRef.current },
    { key: "27-fbs-matchups-midweek", node: () => fbsMatchupsMidweekRef.current, branding: false },
    { key: "28-fbs-matchups-saturday", node: () => fbsMatchupsSaturdayRef.current, branding: false },
    { key: "29-fcs-matchups-midweek", node: () => fcsMatchupsMidweekRef.current, branding: false },
    { key: "30-fcs-matchups-saturday", node: () => fcsMatchupsSaturdayRef.current, branding: false },
    { key: "31-fbs-vs-fcs-matchups-all", node: () => crossMatchupsAllRef.current, branding: false },
    { key: "32-watchability-saturday", node: () => watchabilityRef.current, branding: false },
    {
      key: "33-tv-guide",
      node: () => tvGuideRef.current,
      beforeCapture: (node) => {
        const el = node.querySelector<HTMLElement>(`[data-tvguide-channel="${STREAMING_CHANNEL_KEY}"]`);
        if (!el) return () => {};
        const prevDisplay = el.style.display;
        el.style.display = "none";
        return () => {
          el.style.display = prevDisplay;
        };
      },
    },
  ];

  // Appended rather than baked into the array literal above since its
  // length depends on how many conferences exist per division.
  conferences.forEach((c, i) => {
    targets.push({
      key: `${34 + i}-conf-preview-${c.div.toLowerCase()}-${c.conf.toLowerCase().replace(/\s+/g, "-")}`,
      node: () => conferenceRefs.current.get(c.conf) ?? null,
    });
  });

  async function handleGenerateZip() {
    setZipping(true);
    setZipError(null);
    setZipDone(null);
    try {
      const zip = new JSZip();
      // Collected alongside each PNG so the combined PDF below can be
      // built in the same pass, in the same order, without re-capturing.
      const pdfImages: { dataUrl: string; width: number; height: number }[] = [];
      for (const target of targets) {
        const node = target.node();
        if (!node) continue;
        const restore = target.beforeCapture?.(node);
        // Forced explicitly rather than trusting the node's own
        // getBoundingClientRect() — every capture here is rendered
        // off-screen (position:fixed, far outside the viewport) for the
        // batch, and that combination was measuring wildly wrong widths
        // even with the inline-block wrapper fix. scrollWidth/scrollHeight
        // read the node's actual laid-out box directly (measured after
        // beforeCapture, so a hidden row doesn't leave dead space), same
        // fix TV Guide uses for its horizontally-scrollable export.
        const explicitSize = { width: node.scrollWidth, height: node.scrollHeight };
        // branding defaults to true (see DumpTarget) — only the
        // CompactPowerRatingsGraphic targets opt out, since they bake in
        // their own header/footer.
        const blob = await exportNodeAsPngBlob(node, undefined, undefined, undefined, explicitSize, target.branding ?? true);
        restore?.();
        zip.file(`${target.key}.png`, blob);
        pdfImages.push(await blobToImageData(blob));
      }

      // Combined PDF — every PNG above, one page each, in the same order.
      // Each page is sized to match its own image's pixel dimensions
      // (rather than a fixed letter/landscape frame) so nothing gets
      // letterboxed or cropped — the actual PNG's own aspect ratio, since
      // html-to-image renders at pixelRatio:2 (see exportPng.ts). This
      // becomes that week's public Week Report PDF, published below —
      // Chris wants the report to just be the dump's own graphics rather
      // than the old bespoke jsPDF layout in lib/pdfReport.ts.
      let pdfBlob: Blob | null = null;
      if (pdfImages.length > 0) {
        const first = pdfImages[0];
        const doc = new jsPDF({
          unit: "px",
          format: [first.width, first.height],
          orientation: first.width >= first.height ? "landscape" : "portrait",
        });
        pdfImages.forEach((img, i) => {
          if (i > 0) doc.addPage([img.width, img.height], img.width >= img.height ? "landscape" : "portrait");
          doc.addImage(img.dataUrl, "PNG", 0, 0, img.width, img.height);
        });
        pdfBlob = doc.output("blob");
        zip.file("00-week-report.pdf", pdfBlob);
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

      let doneMsg = `Downloaded ${targets.length} images.`;
      if (pdfBlob && currentWeek) {
        try {
          const password = sessionStorage.getItem("admin_password") ?? "";
          await publishWeeklyReportPdf(currentWeek, pdfBlob, password);
          doneMsg += ` Published as ${weekLabel(currentWeek)}'s public Week Report.`;
        } catch (publishErr: any) {
          doneMsg += ` ZIP is fine, but publishing to the public Week Report failed: ${publishErr.message ?? "unknown error"}.`;
        }
      }
      setZipDone(doneMsg);
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
        Power Ratings and Win Totals (FBS + FCS), Resume Ratings (FBS) — Full List, Top 30,
        Gainers/Losers (Power Ratings also gets Top 30 Group of 6; Win Totals gets Wins Left/
        Losses Left instead of Gainers/Losers). SOS (FBS) — Full List, plus a Hardest/Easiest split
        and a Got Harder/Got Easier split. FBS and FCS Playoff Brackets. Matchups — FBS vs FBS and
        FCS vs FCS (each Midweek/Saturday), FBS vs FCS (All). Watchability Chart (Saturday only),
        TV Guide, and a Conference Preview for every conference. Nothing here is saved — it only
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
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Full List" sections={[{ title: "", rows: fbsResumeFull }]} valueLabel="RESUME" higherIsBetter colorScale="percentile" />
            </div>
            <div ref={resumeTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30" sections={[{ title: "", rows: fbsResumeTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="RESUME" higherIsBetter colorScale="percentile" />
            </div>
            <div ref={resumeGainersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30 Gainers" sections={[{ title: "", rows: fbsResumeGainers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" higherIsBetter />
            </div>
            <div ref={resumeLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30 Losers" sections={[{ title: "", rows: fbsResumeLosers }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="CHANGE" higherIsBetter />
            </div>

            {/* SOS — FBS only */}
            <div ref={sosFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Strength of Schedule — Full List" sections={[{ title: "", rows: fbsSosFull }]} valueLabel="SOS" />
            </div>
            <div ref={sosHardEasyRef} style={CAPTURE_WRAP_STYLE}>
              {/* Two independent lists side by side, not one list split in
                  half — left is the 30 toughest schedules (positive SOS),
                  right is the 25 easiest (negative SOS). Each section is
                  its own single column (targetRowsPerColumn=30 keeps both
                  under one column since neither list exceeds 30 rows). */}
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Strength of Schedule — Hardest & Easiest"
                sections={[
                  { title: "Top 30 Hardest", rows: fbsSosHardest },
                  { title: "Top 30 Easiest", rows: fbsSosEasiest },
                ]}
                targetRowsPerColumn={TOP_N}
                valueLabel="SOS"
                sideBySide
              />
            </div>
            <div ref={sosChangeRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Strength of Schedule — Got Harder & Got Easier"
                sections={[
                  { title: "Top 30 Got Harder", rows: fbsSosGotHarder },
                  { title: "Top 30 Got Easier", rows: fbsSosGotEasier },
                ]}
                targetRowsPerColumn={TOP_N}
                valueLabel="CHANGE"
                sideBySide
              />
            </div>

            {/* Win Totals — FBS. signed=false: these are plain counts
                (8 wins, 3 losses left), not deltas — a leading "+" read
                like a week-over-week change and was misleading. */}
            <div ref={fbsWinTotalFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Win Totals — Full List" sections={[{ title: "", rows: fbsWinTotalFull }]} valueLabel="WINS" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fbsWinTotalTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Win Totals — Top 30" sections={[{ title: "", rows: fbsWinTotalTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="WINS" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fbsWinsLeftRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Win Totals — Top 30 Wins Left" sections={[{ title: "", rows: fbsWinsLeft }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="WINS LEFT" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fbsLossesLeftRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Win Totals — Top 30 Losses Left" sections={[{ title: "", rows: fbsLossesLeft }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="LOSSES LEFT" colorScale="percentile" signed={false} />
            </div>

            {/* Win Totals — FCS */}
            <div ref={fcsWinTotalFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Win Totals — Full List" sections={[{ title: "", rows: fcsWinTotalFull }]} valueLabel="WINS" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fcsWinTotalTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Win Totals — Top 30" sections={[{ title: "", rows: fcsWinTotalTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="WINS" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fcsWinsLeftRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Win Totals — Top 30 Wins Left" sections={[{ title: "", rows: fcsWinsLeft }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="WINS LEFT" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fcsLossesLeftRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Win Totals — Top 30 Losses Left" sections={[{ title: "", rows: fcsLossesLeft }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="LOSSES LEFT" colorScale="percentile" signed={false} />
            </div>

            {/* Playoff Brackets — the existing site pages, captured as-is.
                No-op nav callbacks: this render is never interacted with,
                only captured. */}
            <div ref={fbsBracketRef} style={CAPTURE_WRAP_STYLE}>
              <BracketPage subLabel={wLabel} onNavigateTeam={() => {}} onHome={() => {}} />
            </div>
            <div ref={fcsBracketRef} style={CAPTURE_WRAP_STYLE}>
              <FCSBracketPage onNavigateTeam={() => {}} onNavigateConference={() => {}} onHome={() => {}} />
            </div>

            {/* Matchups — FBS vs FBS, Midweek/Saturday split. Uses
                MatchupGridGraphic (multi-column card grid), not
                MatchupSlateGraphic (tall single-column list, still used
                by the live Matchups page's own export) — a full Saturday
                slate read as too long scrolling down one column. */}
            <div ref={fbsMatchupsMidweekRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fbsEyebrow} header="FBS vs FBS — Midweek" rows={fbsFbsMidweekRows} />
            </div>
            <div ref={fbsMatchupsSaturdayRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fbsEyebrow} header="FBS vs FBS — Saturday" rows={fbsFbsSaturdayRows} />
            </div>
            <div ref={fcsMatchupsMidweekRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fcsEyebrow} header="FCS vs FCS — Midweek" rows={fcsFcsMidweekRows} />
            </div>
            <div ref={fcsMatchupsSaturdayRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fcsEyebrow} header="FCS vs FCS — Saturday" rows={fcsFcsSaturdayRows} />
            </div>
            <div ref={crossMatchupsAllRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={wLabel.toUpperCase()} header="FBS vs FCS" rows={crossSlateRows} />
            </div>

            {/* Watchability / TV Guide — the live pages themselves,
                pinned to this tool's selected week (see the weekOverride/
                forceSaturdaysOnly/shareRef props added to each). No outer
                capture wrapper needed: shareRef points straight at the
                page's own internal export-ready node. */}
            <WatchabilityPage onHome={() => {}} weekOverride={scheduleWeekNum ?? undefined} forceSaturdaysOnly shareRef={watchabilityRef} />
            <TvGuidePanel weekOverride={scheduleWeekNum ?? undefined} shareRef={tvGuideRef} />

            {/* Conference Previews — the existing page, once per
                conference. Always "latest" week internally (same as the
                live page), not scoped to this tool's week picker. */}
            {conferences.map((c) => (
              <div
                key={c.conf}
                ref={(el) => {
                  if (el) conferenceRefs.current.set(c.conf, el);
                  else conferenceRefs.current.delete(c.conf);
                }}
                style={CAPTURE_WRAP_STYLE}
              >
                <ConferencePreviewPage conference={c.conf} onNavigateTeam={() => {}} onHome={() => {}} />
              </div>
            ))}
          </OffscreenStage>
        </>
      )}
    </div>
  );
}
