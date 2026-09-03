import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import CompactPowerRatingsGraphic from "../components/CompactPowerRatingsGraphic";
import MatchupGridGraphic from "../components/MatchupGridGraphic";
import BracketPage from "./BracketPage";
import FCSBracketPage from "./FCSBracketPage";
import WatchabilityPage from "./WatchabilityPage";
import TvGuidePanel, { STREAMING_CHANNEL_KEY } from "./TvGuidePanel";
import { isSaturdayET, etDateString } from "../lib/watchability";
import ConferencePreviewPage from "./ConferencePreviewPage";
import { conferencesForDivision } from "../data/teams";
import { fetchAvailableWeeks, fetchWeeklyStats, weekLabel, type WeeklyTeamStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine, poolStdDevForTotal } from "../lib/gameTotalsEngine";
import { filterRowsByDivision } from "./GameTotalsAdminPanel";
import { classOf, isTracked, computeRow } from "../lib/matchupsCompute";
import { buildSlateRow, filterSlateRowsByDay, type SlateGameRow } from "../lib/matchupSlate";

// Shared by every Matchups target below — same filter+compute+shape
// pipeline the live Weekly Matchups page uses (classOf -> computeRow ->
// buildSlateRow), parameterized only by which division pairing to keep.
function buildDivisionSlateRows(
  games: GameWithLines[],
  ratings: Record<string, any>,
  projTotalByGame: Map<string, number>,
  matchupType: "FBSvFBS" | "FCSvFCS" | "Cross",
  poolStdForTotal?: number
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
    .map((c) => buildSlateRow(c, projTotalByGame.get(`${c.game.week}|${c.game.home_team}|${c.game.away_team}`) ?? null, poolStdForTotal));
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
  /** Which division's Generate ZIP run this belongs to — see
   * dumpDivision above. Cross-divisional matchups are tagged FBS (per
   * Chris) despite covering both divisions' teams. */
  division: "FBS" | "FCS";
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
  /** True only for the 25 auto-generated conference-preview targets —
   * handled by a dedicated second pass in handleGenerateZip instead of
   * the main loop, since they share one mounted component (swapped via
   * flushSync) rather than each having their own always-mounted node. */
  isConferencePreview?: boolean;
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
// Returns raw PNG bytes (not a base64 data URL) — pdf-lib's embedPng wants
// an ArrayBuffer/Uint8Array directly, and skipping the base64 round-trip
// avoids inflating each image ~33% and holding dozens of giant strings in
// memory at once, which is exactly what previously blew up jsPDF (see the
// PDF-assembly comment below).
function blobToImageData(blob: Blob): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = async () => {
      const { naturalWidth, naturalHeight } = img;
      URL.revokeObjectURL(url);
      try {
        const bytes = await blob.arrayBuffer();
        resolve({ bytes, width: naturalWidth, height: naturalHeight });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to measure image dimensions"));
    };
    img.src = url;
  });
}

// Wraps a single target's capture with a hard deadline — without this,
// one stuck capture (a slow/hanging logo fetch inside html-to-image's
// embed step, most likely) hangs the entire 58-target loop forever
// with zero feedback. On timeout the target is skipped, not fatal to
// the whole run — see handleGenerateZip's catch-per-target below.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
const CAPTURE_TIMEOUT_MS = 45000;
// No legitimate target here should ever need dimensions anywhere close
// to this — it exists purely as a tripwire. TV Guide's width bug (an
// ambiguous off-screen CSS auto-sizing chain inflating scrollWidth to
// the browser's canvas cap of 16384px, with real content squeezed into
// a sliver of that) produced a broken-but-technically-successful image
// with no error at all — and was very likely also *why* it and the
// biggest conference previews were timing out even at 45s, since
// rasterizing a canvas that size is real work regardless of how little
// of it has actual content. A sane upper bound turns any future
// instance of "the measured size is nonsense" into a loud, specific
// skip instead of a silently-broken multi-megabyte image.
const MAX_CAPTURE_DIMENSION = 6000;

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
  // Shows live progress during the 58-target capture loop, since it was
  // previously a totally silent "Building ZIP…" the whole time with no
  // way to tell if it was working or stuck.
  const [captureProgress, setCaptureProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  // Separate from zipDone on purpose — a publish failure was previously
  // appended onto the same green success string as "Downloaded N
  // images. ZIP is fine, but publishing... failed: ...", which reads as
  // a success message at a glance since it's still solid green. Chris
  // generated Week 1's report this way and never noticed publishing
  // had actually failed — the bucket had zero objects in it. This gets
  // its own red/green line so a failure can't hide inside a success.
  const [publishResult, setPublishResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Which division's ZIP/PDF Generate ZIP produces — FBS and FCS are now
  // fully separate downloads/publishes (separate storage keys, separate
  // public Week Report pages) instead of one combined 58-target run.
  // Splitting also roughly halves the per-run target count, which
  // directly helps the timeout/reliability problem on its own.
  const [dumpDivision, setDumpDivision] = useState<"FBS" | "FCS">("FBS");
  // Conference previews are the slowest part of a generate pass — one at a
  // time, ~25 per division, each a full mount+capture+unmount cycle (see
  // the flushSync pass in handleGenerateZip) — so they're skippable for a
  // quick iteration when Chris doesn't need them for this run. Defaults on
  // so a plain "Generate ZIP" still produces the full pack.
  const [includeConferencePreviews, setIncludeConferencePreviews] = useState(true);

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

  // Review graphic (see below) needs the previous week's games — Week 1
  // has no previous week, so it reviews its own completed-so-far games
  // instead (see reviewGames/reviewLabel).
  const previousWeekNum = scheduleWeekNum != null && scheduleWeekNum > 1 ? scheduleWeekNum - 1 : null;
  const [previousWeekGames, setPreviousWeekGames] = useState<GameWithLines[]>([]);
  useEffect(() => {
    if (previousWeekNum == null) {
      setPreviousWeekGames([]);
      return;
    }
    let cancelled = false;
    fetchGamesWithLines(season, previousWeekNum).then((games) => {
      if (!cancelled) setPreviousWeekGames(games);
    });
    return () => {
      cancelled = true;
    };
  }, [season, previousWeekNum]);

  // TV Guide's own week-based filter combines every day in the schedule
  // week onto one grid — fine normally, but CFBD's week numbering can
  // bundle a Week 0 slate (played a full week earlier) into "Week 1",
  // so the axis ends up spanning two different Saturdays' worth of
  // games instead of one. Picks the LATEST Saturday among this week's
  // TV games (the actual target week's slate, not the earlier leaked-in
  // one) and passes it as a specific date override instead of relying
  // on the week filter — same fix Chris already built into the live
  // page's own date-override input, just computed automatically here.
  const tvGuideDateOverride = useMemo(() => {
    const saturdays = scheduleGames
      .filter((g) => g.tv_outlet && g.start_date && isSaturdayET(g.start_date))
      .map((g) => etDateString(g.start_date!));
    if (saturdays.length === 0) return undefined;
    return [...new Set(saturdays)].sort().pop();
  }, [scheduleGames]);

  // Same "latest Saturday" concept as tvGuideDateOverride above, but
  // without requiring tv_outlet — Matchups needs every FBS-vs-FBS game
  // correctly bucketed, not just the ones with TV info. Used to split
  // the Saturday graphic into "the real target Saturday" (top) and
  // "anything dated later" (bottom, e.g. a genuine Sunday/Monday game),
  // so a leaked-in earlier Saturday from a CFBD week-numbering quirk
  // (Week 1 specifically, this season — see chat) doesn't get miscounted
  // as part of the real Saturday slate the way day-of-week-only
  // bucketing would.
  const matchupsSaturdayDate = useMemo(() => {
    const saturdays = scheduleGames.filter((g) => g.start_date && isSaturdayET(g.start_date)).map((g) => etDateString(g.start_date!));
    if (saturdays.length === 0) return undefined;
    return [...new Set(saturdays)].sort().pop();
  }, [scheduleGames]);

  // Requests the previous week too when there is one — the review
  // graphic grades last week's games using THAT week's own historical
  // ratings snapshot, not this week's.
  const ratingsWeeksNeeded = useMemo(() => {
    if (scheduleWeekNum == null) return [];
    return previousWeekNum != null ? [previousWeekNum, scheduleWeekNum] : [scheduleWeekNum];
  }, [scheduleWeekNum, previousWeekNum]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, ratingsWeeksNeeded, season);
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
  // Same pool-wide std dev the Totals admin page's own bet-row machinery
  // computes (poolStdDevForTotal) — season-wide within a division, not
  // scoped to just this week, matching how GameTotalsAdminPanel itself
  // calls it (filterRowsByDivision(allRows, division), not week-filtered
  // first). Cross-divisional games use the FBS pool's std dev — they
  // live in the FBS bucket everywhere else in this tool, and
  // filterRowsByDivision requires both teams match one division, so
  // there's no natural separate "cross" pool to compute against.
  const fbsTotalPoolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(totalsEngineRows, "FBS")), [totalsEngineRows]);
  const fcsTotalPoolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(totalsEngineRows, "FCS")), [totalsEngineRows]);
  const fbsFbsSlateRows = useMemo(
    () => (scheduleWeekNum == null ? [] : buildDivisionSlateRows(scheduleGames, matchupRatings, projTotalByGame, "FBSvFBS", fbsTotalPoolStd)),
    [scheduleWeekNum, scheduleGames, matchupRatings, projTotalByGame, fbsTotalPoolStd]
  );
  const fcsFcsSlateRows = useMemo(
    () => (scheduleWeekNum == null ? [] : buildDivisionSlateRows(scheduleGames, matchupRatings, projTotalByGame, "FCSvFCS", fcsTotalPoolStd)),
    [scheduleWeekNum, scheduleGames, matchupRatings, projTotalByGame, fcsTotalPoolStd]
  );
  // FBS vs FCS — "All" per Chris's category list, no Midweek/Saturday split.
  const crossSlateRows = useMemo(
    () => (scheduleWeekNum == null ? [] : buildDivisionSlateRows(scheduleGames, matchupRatings, projTotalByGame, "Cross", fbsTotalPoolStd)),
    [scheduleWeekNum, scheduleGames, matchupRatings, projTotalByGame, fbsTotalPoolStd]
  );

  const fbsFbsMidweekRows = useMemo(() => filterSlateRowsByDay(fbsFbsSlateRows, "midweek"), [fbsFbsSlateRows]);
  // Splits on the actual target Saturday date rather than day-of-week
  // alone (filterSlateRowsByDay's "saturday" bucket) — see
  // matchupsSaturdayDate above for why. "Later" catches a genuine
  // Sunday/Monday game; games dated BEFORE the target Saturday (the
  // Week 1 leak) are dropped from both, not shown in either section.
  const fbsFbsSaturdayTargetRows = useMemo(() => {
    if (!matchupsSaturdayDate) return filterSlateRowsByDay(fbsFbsSlateRows, "saturday");
    return fbsFbsSlateRows.filter((r) => r.kickoffIso && etDateString(r.kickoffIso) === matchupsSaturdayDate);
  }, [fbsFbsSlateRows, matchupsSaturdayDate]);
  const fbsFbsSaturdayLaterRows = useMemo(() => {
    if (!matchupsSaturdayDate) return [];
    return fbsFbsSlateRows.filter((r) => r.kickoffIso && etDateString(r.kickoffIso) > matchupsSaturdayDate);
  }, [fbsFbsSlateRows, matchupsSaturdayDate]);
  const fcsFcsMidweekRows = useMemo(() => filterSlateRowsByDay(fcsFcsSlateRows, "midweek"), [fcsFcsSlateRows]);
  const fcsFcsSaturdayRows = useMemo(() => filterSlateRowsByDay(fcsFcsSlateRows, "saturday"), [fcsFcsSlateRows]);
  // Cross-divisional (FBS vs FCS) previously wasn't split by day at all
  // (one combined "All" graphic) — now split the same way FBS-vs-FBS
  // and FCS-vs-FCS already are, so its midweek slice can combine into
  // the "upcoming midweek" graphic below and its Saturday slice can
  // stand as its own graphic alongside FBS-vs-FBS Saturday.
  const crossMidweekRows = useMemo(() => filterSlateRowsByDay(crossSlateRows, "midweek"), [crossSlateRows]);
  const crossSaturdayRows = useMemo(() => filterSlateRowsByDay(crossSlateRows, "saturday"), [crossSlateRows]);


  // "Upcoming Midweek" — FBS-vs-FBS midweek and FBS-vs-FCS midweek,
  // grouped into two labeled sections (not blended/interleaved) within
  // one graphic per Chris — see MatchupGridGraphic.tsx's sections prop.

  // "Review" — last week's FBS-vs-FBS + FBS-vs-FCS games (all days,
  // completed only), combined into one graphic. Week 1 has no previous
  // week to review, so it reviews its own completed-so-far games
  // instead — same shape, different source week and a distinctly-worded
  // label (reviewLabel below) so it's never confused with a genuine
  // previous-week review once Week 2's package also contains "Week 1"
  // games, just framed as the completed prior week rather than
  // "this week so far."
  const reviewWeekNum = previousWeekNum ?? scheduleWeekNum;
  const reviewGames = previousWeekNum != null ? previousWeekGames : scheduleGames;
  const reviewRatings = reviewWeekNum != null ? ratingsByWeek[reviewWeekNum] ?? {} : {};
  const reviewFbsFbsRows = useMemo(
    () => (reviewWeekNum == null ? [] : buildDivisionSlateRows(reviewGames, reviewRatings, projTotalByGame, "FBSvFBS", fbsTotalPoolStd)),
    [reviewWeekNum, reviewGames, reviewRatings, projTotalByGame, fbsTotalPoolStd]
  );
  const reviewCrossRows = useMemo(
    () => (reviewWeekNum == null ? [] : buildDivisionSlateRows(reviewGames, reviewRatings, projTotalByGame, "Cross", fbsTotalPoolStd)),
    [reviewWeekNum, reviewGames, reviewRatings, projTotalByGame, fbsTotalPoolStd]
  );
  const reviewRows = useMemo(
    () => [...reviewFbsFbsRows, ...reviewCrossRows].filter((r) => r.completed),
    [reviewFbsFbsRows, reviewCrossRows]
  );
  const reviewLabel =
    previousWeekNum != null
      ? `${weekLabel(`week${previousWeekNum}`).toUpperCase()} REVIEW`
      : `${weekLabel(currentWeek).toUpperCase()} RESULTS SO FAR`;

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

  // Power Ratings refs. Gainers/Losers merged into one combined
  // side-by-side graphic (was two separate images/targets each).
  const fbsFullRef = useRef<HTMLDivElement>(null);
  const fbsTopRef = useRef<HTMLDivElement>(null);
  const fbsG6Ref = useRef<HTMLDivElement>(null);
  const fbsGainersLosersRef = useRef<HTMLDivElement>(null);
  const fcsFullRef = useRef<HTMLDivElement>(null);
  const fcsTopRef = useRef<HTMLDivElement>(null);
  const fcsGainersLosersRef = useRef<HTMLDivElement>(null);
  // Resume Ratings refs. Gainers/Losers merged, same as Power Ratings above.
  const resumeFullRef = useRef<HTMLDivElement>(null);
  const resumeTopRef = useRef<HTMLDivElement>(null);
  const resumeGainersLosersRef = useRef<HTMLDivElement>(null);
  // SOS refs
  const sosFullRef = useRef<HTMLDivElement>(null);
  const sosHardEasyRef = useRef<HTMLDivElement>(null);
  const sosChangeRef = useRef<HTMLDivElement>(null);
  // Win Totals refs. Wins Left/Losses Left merged into one combined
  // side-by-side graphic (was two separate images/targets each) — see
  // the CompactPowerRatingsGraphic call below for why each side needs
  // its own higherIsBetter/valueLabel override to preserve the original
  // per-list coloring/labeling now that they share one component call.
  const fbsWinTotalFullRef = useRef<HTMLDivElement>(null);
  const fbsWinTotalTopRef = useRef<HTMLDivElement>(null);
  const fbsWinsLossesLeftRef = useRef<HTMLDivElement>(null);
  const fcsWinTotalFullRef = useRef<HTMLDivElement>(null);
  const fcsWinTotalTopRef = useRef<HTMLDivElement>(null);
  const fcsWinsLossesLeftRef = useRef<HTMLDivElement>(null);
  // Playoff Bracket refs — capture the existing BracketPage/FCSBracketPage
  // components wholesale, not a purpose-built graphic.
  const fbsBracketRef = useRef<HTMLDivElement>(null);
  const fcsBracketRef = useRef<HTMLDivElement>(null);
  // Matchups refs. Cross-divisional (FBS vs FCS) lives in the FBS
  // division bucket below, but stays its own separate image — not
  // merged into FBS-vs-FBS.
  const upcomingMidweekRef = useRef<HTMLDivElement>(null);
  const fbsMatchupsSaturdayRef = useRef<HTMLDivElement>(null);
  const fcsMatchupsMidweekRef = useRef<HTMLDivElement>(null);
  const fcsMatchupsSaturdayRef = useRef<HTMLDivElement>(null);
  const crossMatchupsSaturdayRef = useRef<HTMLDivElement>(null);
  const matchupsReviewRef = useRef<HTMLDivElement>(null);
  // Watchability / TV Guide refs — passed straight into the live pages as
  // shareRef, so these ARE the exact nodes their own Export PNG buttons
  // already target (see WatchabilityPage.tsx/TvGuidePanel.tsx). Both are
  // FBS-scoped (Watchability is FBS-vs-FBS only; TV Guide in practice
  // never has an FCS broadcast game), so both live in the FBS bucket.
  const watchabilityRef = useRef<HTMLDivElement>(null);
  const watchabilityByWindowRef = useRef<HTMLDivElement>(null);
  const tvGuideRef = useRef<HTMLDivElement>(null);
  // Conference Previews — one image per conference, FBS then FCS.
  // Independents excluded (conferencesForDivision() itself filters them
  // out now — see data/teams.ts — since they're not a conference).
  // Previously mounted all 25 simultaneously (each running its own SOS +
  // Monte Carlo fetch and holding a full team-logo table in the DOM at
  // once) for the whole duration of this tool being open. That's almost
  // certainly why they were the ones going missing from the ZIP/PDF —
  // by the time the sequential capture loop reached them (last, after
  // 33 other heavy captures), the tab was under enough memory/CPU
  // pressure that these were the likeliest to fail or hang. Since
  // ConferencePreviewPage's own data fetches depend only on the season,
  // not which conference is showing (its per-conference team list is a
  // synchronous filter of already-loaded data), one mounted instance
  // can be swapped through all conferences via flushSync — no re-fetch
  // delay, and only one conference's DOM exists at a time.
  const conferences = useMemo(
    () => [
      ...conferencesForDivision("FBS").map((conf) => ({ conf, div: "FBS" as const })),
      ...conferencesForDivision("FCS").map((conf) => ({ conf, div: "FCS" as const })),
    ],
    []
  );
  const [activeConferenceIdx, setActiveConferenceIdx] = useState<number | null>(null);
  const conferencePreviewRef = useRef<HTMLDivElement>(null);

  const targets: DumpTarget[] = [
    { key: "01-fbs-power-ratings-full", node: () => fbsFullRef.current, branding: false, division: "FBS" },
    { key: "02-fbs-power-ratings-top30", node: () => fbsTopRef.current, branding: false, division: "FBS" },
    { key: "03-fbs-power-ratings-top30-g6", node: () => fbsG6Ref.current, branding: false, division: "FBS" },
    { key: "04-fbs-power-ratings-gainers-losers", node: () => fbsGainersLosersRef.current, branding: false, division: "FBS" },
    { key: "05-fcs-power-ratings-full", node: () => fcsFullRef.current, branding: false, division: "FCS" },
    { key: "06-fcs-power-ratings-top30", node: () => fcsTopRef.current, branding: false, division: "FCS" },
    { key: "07-fcs-power-ratings-gainers-losers", node: () => fcsGainersLosersRef.current, branding: false, division: "FCS" },
    { key: "08-fbs-resume-ratings-full", node: () => resumeFullRef.current, branding: false, division: "FBS" },
    { key: "09-fbs-resume-ratings-top30", node: () => resumeTopRef.current, branding: false, division: "FBS" },
    { key: "10-fbs-resume-ratings-gainers-losers", node: () => resumeGainersLosersRef.current, branding: false, division: "FBS" },
    { key: "11-fbs-sos-full", node: () => sosFullRef.current, branding: false, division: "FBS" },
    { key: "12-fbs-sos-hardest-easiest", node: () => sosHardEasyRef.current, branding: false, division: "FBS" },
    { key: "13-fbs-sos-got-harder-got-easier", node: () => sosChangeRef.current, branding: false, division: "FBS" },
    { key: "14-fbs-win-totals-full", node: () => fbsWinTotalFullRef.current, branding: false, division: "FBS" },
    { key: "15-fbs-win-totals-top30", node: () => fbsWinTotalTopRef.current, branding: false, division: "FBS" },
    { key: "16-fbs-win-totals-wins-losses-left", node: () => fbsWinsLossesLeftRef.current, branding: false, division: "FBS" },
    { key: "17-fcs-win-totals-full", node: () => fcsWinTotalFullRef.current, branding: false, division: "FCS" },
    { key: "18-fcs-win-totals-top30", node: () => fcsWinTotalTopRef.current, branding: false, division: "FCS" },
    { key: "19-fcs-win-totals-wins-losses-left", node: () => fcsWinsLossesLeftRef.current, branding: false, division: "FCS" },
    { key: "20-fbs-playoff-bracket", node: () => fbsBracketRef.current, division: "FBS" },
    { key: "21-fcs-playoff-bracket", node: () => fcsBracketRef.current, division: "FCS" },
    // Review — last week's FBS-vs-FBS + FBS-vs-FCS (all days, completed
    // only); Week 1 reviews its own completed-so-far games instead of a
    // previous week (see reviewLabel/reviewRows above).
    { key: "22-matchups-review", node: () => matchupsReviewRef.current, branding: false, division: "FBS" },
    // Upcoming Midweek — FBS-vs-FBS midweek + FBS-vs-FCS midweek
    // combined into one graphic per Chris, replacing what used to be
    // FBS-vs-FBS midweek's own solo target.
    { key: "23-matchups-upcoming-midweek", node: () => upcomingMidweekRef.current, branding: false, division: "FBS" },
    { key: "24-fbs-matchups-saturday", node: () => fbsMatchupsSaturdayRef.current, branding: false, division: "FBS" },
    // Cross-divisional Saturday — previously cross-div wasn't split by
    // day at all (one combined "All" graphic); now split the same way
    // FBS-vs-FBS/FCS-vs-FCS already are, so this stands as its own
    // graphic alongside FBS-vs-FBS Saturday ("2 graphics like normal").
    { key: "25-fbs-vs-fcs-matchups-saturday", node: () => crossMatchupsSaturdayRef.current, branding: false, division: "FBS" },
    { key: "26-fcs-matchups-midweek", node: () => fcsMatchupsMidweekRef.current, branding: false, division: "FCS" },
    { key: "27-fcs-matchups-saturday", node: () => fcsMatchupsSaturdayRef.current, branding: false, division: "FCS" },
    { key: "28-watchability-saturday-overall", node: () => watchabilityRef.current, branding: false, division: "FBS" },
    { key: "29-watchability-saturday-by-slate", node: () => watchabilityByWindowRef.current, branding: false, division: "FBS" },
    {
      key: "30-tv-guide",
      node: () => tvGuideRef.current,
      division: "FBS",
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
  // length depends on how many conferences exist per division. node()
  // is never actually called for these — handleGenerateZip's dedicated
  // conference-preview pass below captures them directly — this is
  // here only so targets.length (button label, progress total) counts
  // them correctly.
  conferences.forEach((c, i) => {
    targets.push({
      key: `${31 + i}-conf-preview-${c.div.toLowerCase()}-${c.conf.toLowerCase().replace(/\s+/g, "-")}`,
      node: () => null,
      division: c.div,
      isConferencePreview: true,
    });
  });

  const divisionTargets = useMemo(
    () => targets.filter((t) => t.division === dumpDivision && (includeConferencePreviews || !t.isConferencePreview)),
    [targets, dumpDivision, includeConferencePreviews]
  );
  const divisionConferences = useMemo(() => conferences.filter((c) => c.div === dumpDivision), [conferences, dumpDivision]);

  async function handleGenerateZip() {
    setZipping(true);
    setZipError(null);
    setZipDone(null);
    setPublishResult(null);
    try {
      const zip = new JSZip();
      // Collected alongside each PNG so the combined PDF below can be
      // built in the same pass, in the same order, without re-capturing.
      const pdfImages: { bytes: ArrayBuffer; width: number; height: number }[] = [];
      // Targets that timed out, threw, or never had a node to capture —
      // surfaced to Chris afterward rather than silently missing from
      // the ZIP with no explanation (this used to be a real gap: a
      // missing node just hit `continue` with no record at all).
      const skippedTargets: string[] = [];
      const mainTargets = divisionTargets.filter((t) => !t.isConferencePreview);
      for (let i = 0; i < mainTargets.length; i++) {
        const target = mainTargets[i];
        const node = target.node();
        setCaptureProgress({ current: i + 1, total: divisionTargets.length, label: target.key });
        if (!node) {
          skippedTargets.push(`${target.key} (no node to capture)`);
          continue;
        }
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
        if (explicitSize.width > MAX_CAPTURE_DIMENSION || explicitSize.height > MAX_CAPTURE_DIMENSION) {
          restore?.();
          skippedTargets.push(`${target.key} (measured ${explicitSize.width}x${explicitSize.height}px — refusing, likely a layout bug)`);
          continue;
        }
        try {
          // branding defaults to true (see DumpTarget) — only the
          // CompactPowerRatingsGraphic targets opt out, since they bake in
          // their own header/footer.
          const blob = await withTimeout(
            exportNodeAsPngBlob(node, undefined, undefined, undefined, explicitSize, target.branding ?? true),
            CAPTURE_TIMEOUT_MS,
            target.key
          );
          restore?.();
          zip.file(`${target.key}.png`, blob);
          pdfImages.push(await blobToImageData(blob));
        } catch (captureErr: any) {
          restore?.();
          skippedTargets.push(`${target.key} (${captureErr.message ?? "unknown error"})`);
        }
      }

      // Conference previews — dedicated pass, one mounted instance
      // swapped through this division's conferences via flushSync
      // rather than all of them mounted at once (see the comment on
      // activeConferenceIdx above for why). flushSync forces the state
      // update and re-render to complete synchronously before it
      // returns, so conferencePreviewRef.current reflects the new
      // conference immediately — no extra wait needed since nothing
      // here re-fetches per conference, only re-filters already-loaded
      // data. activeConferenceIdx indexes into divisionConferences, not
      // the full FBS+FCS conferences list — must match the render below.
      const conferenceTargets = divisionTargets.filter((t) => t.isConferencePreview);
      for (let i = 0; i < conferenceTargets.length; i++) {
        const target = conferenceTargets[i];
        setCaptureProgress({ current: mainTargets.length + i + 1, total: divisionTargets.length, label: target.key });
        flushSync(() => setActiveConferenceIdx(i));
        const node = conferencePreviewRef.current;
        if (!node) {
          skippedTargets.push(`${target.key} (no node to capture)`);
          continue;
        }
        const explicitSize = { width: node.scrollWidth, height: node.scrollHeight };
        if (explicitSize.width > MAX_CAPTURE_DIMENSION || explicitSize.height > MAX_CAPTURE_DIMENSION) {
          skippedTargets.push(`${target.key} (measured ${explicitSize.width}x${explicitSize.height}px — refusing, likely a layout bug)`);
          continue;
        }
        try {
          const blob = await withTimeout(
            exportNodeAsPngBlob(node, undefined, undefined, undefined, explicitSize, true),
            CAPTURE_TIMEOUT_MS,
            target.key
          );
          zip.file(`${target.key}.png`, blob);
          pdfImages.push(await blobToImageData(blob));
        } catch (captureErr: any) {
          skippedTargets.push(`${target.key} (${captureErr.message ?? "unknown error"})`);
        }
      }
      flushSync(() => setActiveConferenceIdx(null));
      setCaptureProgress(null);

      // Combined PDF — every PNG above, one page each, in the same order.
      // Each page is sized to match its own image's pixel dimensions
      // (rather than a fixed letter/landscape frame) so nothing gets
      // letterboxed or cropped — the actual PNG's own aspect ratio, since
      // html-to-image renders at pixelRatio:2 (see exportPng.ts). This
      // becomes that week's public Week Report PDF, published below —
      // Chris wants the report to just be the dump's own graphics rather
      // than the old bespoke jsPDF layout in lib/pdfReport.ts.
      //
      // pdf-lib, not jsPDF: jsPDF builds the whole document as one big
      // string (Array.join under the hood), which blew past V8's max
      // string length once ~27+ full-resolution PNGs were embedded —
      // surfaced as an "Error in function Array.join: Invalid string
      // length" alert (jsPDF's own internal try/catch calls alert()
      // instead of throwing, so doc.output("blob") silently returned
      // undefined afterward, which is why the ZIP still downloaded fine
      // but publish reported "0 images captured" even though the images
      // were all there). pdf-lib works with raw byte buffers throughout
      // instead of one joined string, so it doesn't hit that ceiling.
      let pdfBlob: Blob | null = null;
      if (pdfImages.length > 0) {
        const pdfDoc = await PDFDocument.create();
        for (const img of pdfImages) {
          const pngImage = await pdfDoc.embedPng(img.bytes);
          const page = pdfDoc.addPage([img.width, img.height]);
          page.drawImage(pngImage, { x: 0, y: 0, width: img.width, height: img.height });
        }
        const pdfBytes = await pdfDoc.save();
        pdfBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
        zip.file("00-week-report.pdf", pdfBlob);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `yc-power-ratings-${currentWeek ?? "week"}-${dumpDivision.toLowerCase()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setZipDone(
        skippedTargets.length > 0
          ? `Downloaded ${divisionTargets.length - skippedTargets.length}/${divisionTargets.length} ${dumpDivision} images (${skippedTargets.length} skipped — see below).`
          : `Downloaded ${divisionTargets.length} ${dumpDivision} images.`
      );
      if (skippedTargets.length > 0) {
        setZipError(`Skipped: ${skippedTargets.join(", ")}`);
      }
      if (currentWeek) {
        if (pdfBlob) {
          try {
            const password = sessionStorage.getItem("admin_password") ?? "";
            await publishWeeklyReportPdf(currentWeek, dumpDivision, pdfBlob, password);
            setPublishResult({
              ok: true,
              message: includeConferencePreviews
                ? `Published as ${weekLabel(currentWeek)}'s public ${dumpDivision} Week Report.`
                : `Published as ${weekLabel(currentWeek)}'s public ${dumpDivision} Week Report — Conference Previews were skipped, so this report is missing those pages. Re-generate with the checkbox on before this is the final version.`,
            });
          } catch (publishErr: any) {
            setPublishResult({
              ok: false,
              message: `Publishing to the public Week Report FAILED: ${publishErr.message ?? "unknown error"}. The ZIP download is unaffected, but the public ${dumpDivision} Week Report page will show "unavailable" until this is retried successfully.`,
            });
          }
        } else {
          // No captured images at all means pdfImages stayed empty and
          // pdfBlob was never built — publish was never attempted, and
          // that's just as important to surface as an explicit failure,
          // since silence here previously looked identical to success.
          setPublishResult({
            ok: false,
            message: `No PDF was generated to publish — 0 ${dumpDivision} images were captured, so nothing was sent to the public Week Report.`,
          });
        }
      }
    } catch (err: any) {
      setZipError(err.message ?? "Failed to build ZIP");
    } finally {
      setZipping(false);
      setCaptureProgress(null);
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

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>Division:</span>
            <button
              className={`mode-btn ${dumpDivision === "FBS" ? "mode-btn-active" : ""}`}
              onClick={() => setDumpDivision("FBS")}
              disabled={zipping}
            >
              FBS
            </button>
            <button
              className={`mode-btn ${dumpDivision === "FCS" ? "mode-btn-active" : ""}`}
              onClick={() => setDumpDivision("FCS")}
              disabled={zipping}
            >
              FCS
            </button>
          </div>

          <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.75rem", fontSize: "0.82rem", color: "var(--chalk-dim)", cursor: zipping ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={includeConferencePreviews}
              onChange={(e) => setIncludeConferencePreviews(e.target.checked)}
              disabled={zipping}
            />
            Include Conference Previews ({divisionConferences.length} images — slowest part of the run, skip for a faster iteration)
          </label>

          <button className="menu-btn" onClick={handleGenerateZip} disabled={zipping || loadingCurrent}>
            {zipping ? "Building ZIP…" : `Generate ${dumpDivision} ZIP (${divisionTargets.length} images)`}
          </button>
          {captureProgress && (
            <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
              Capturing {captureProgress.current}/{captureProgress.total}: {captureProgress.label}
            </p>
          )}
          {zipDone && <p style={{ color: "green" }}>{zipDone}</p>}
          {zipError && <p style={{ color: "crimson" }}>{zipError}</p>}
          {publishResult && (
            <p style={{ color: publishResult.ok ? "green" : "crimson", fontWeight: publishResult.ok ? 400 : 700 }}>
              {publishResult.message}
            </p>
          )}

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
            <div ref={fbsGainersLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Power Ratings — Top 30 Gainers & Losers"
                sections={[
                  { title: "Top 30 Gainers", rows: fbsGainers },
                  { title: "Top 30 Losers", rows: fbsLosers },
                ]}
                targetRowsPerColumn={TOP_N}
                valueLabel="CHANGE"
                sideBySide
              />
            </div>

            {/* Power Ratings — FCS */}
            <div ref={fcsFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Power Ratings — Full List" sections={[{ title: "", rows: toRatingRows(fcsRows) }]} />
            </div>
            <div ref={fcsTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Power Ratings — Top 30" sections={[{ title: "", rows: toRatingRows(fcsTop) }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} />
            </div>
            <div ref={fcsGainersLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fcsEyebrow}
                header="Power Ratings — Top 30 Gainers & Losers"
                sections={[
                  { title: "Top 30 Gainers", rows: fcsGainers },
                  { title: "Top 30 Losers", rows: fcsLosers },
                ]}
                targetRowsPerColumn={TOP_N}
                valueLabel="CHANGE"
                sideBySide
              />
            </div>

            {/* Resume Ratings — FBS only */}
            <div ref={resumeFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Full List" sections={[{ title: "", rows: fbsResumeFull }]} valueLabel="RESUME" higherIsBetter colorScale="percentile" />
            </div>
            <div ref={resumeTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fbsEyebrow} header="Resume Ratings — Top 30" sections={[{ title: "", rows: fbsResumeTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="RESUME" higherIsBetter colorScale="percentile" />
            </div>
            <div ref={resumeGainersLosersRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Resume Ratings — Top 30 Gainers & Losers"
                sections={[
                  { title: "Top 30 Gainers", rows: fbsResumeGainers },
                  { title: "Top 30 Losers", rows: fbsResumeLosers },
                ]}
                targetRowsPerColumn={TOP_N}
                valueLabel="CHANGE"
                higherIsBetter
                sideBySide
              />
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
            <div ref={fbsWinsLossesLeftRef} style={CAPTURE_WRAP_STYLE}>
              {/* Per-section higherIsBetter/valueLabel overrides (see
                  CompactPowerRatingsGraphic) preserve each side's
                  original coloring/label — Wins Left keeps
                  higherIsBetter (more wins left is favorable, greener),
                  Losses Left keeps the default (more losses left reads
                  worse, redder) — now combined into one image instead
                  of two, without changing either side's meaning. */}
              <CompactPowerRatingsGraphic
                eyebrow={fbsEyebrow}
                header="Win Totals — Wins Left & Losses Left"
                sections={[
                  { title: "Top 30 Wins Left", rows: fbsWinsLeft, valueLabel: "WINS LEFT", higherIsBetter: true },
                  { title: "Top 30 Losses Left", rows: fbsLossesLeft, valueLabel: "LOSSES LEFT", higherIsBetter: false },
                ]}
                targetRowsPerColumn={TOP_N}
                colorScale="percentile"
                signed={false}
                sideBySide
              />
            </div>

            {/* Win Totals — FCS */}
            <div ref={fcsWinTotalFullRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Win Totals — Full List" sections={[{ title: "", rows: fcsWinTotalFull }]} valueLabel="WINS" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fcsWinTotalTopRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic eyebrow={fcsEyebrow} header="Win Totals — Top 30" sections={[{ title: "", rows: fcsWinTotalTop }]} targetRowsPerColumn={TOP_N_ROWS_PER_COLUMN} valueLabel="WINS" higherIsBetter colorScale="percentile" signed={false} />
            </div>
            <div ref={fcsWinsLossesLeftRef} style={CAPTURE_WRAP_STYLE}>
              <CompactPowerRatingsGraphic
                eyebrow={fcsEyebrow}
                header="Win Totals — Wins Left & Losses Left"
                sections={[
                  { title: "Top 30 Wins Left", rows: fcsWinsLeft, valueLabel: "WINS LEFT", higherIsBetter: true },
                  { title: "Top 30 Losses Left", rows: fcsLossesLeft, valueLabel: "LOSSES LEFT", higherIsBetter: false },
                ]}
                targetRowsPerColumn={TOP_N}
                colorScale="percentile"
                signed={false}
                sideBySide
              />
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

            {/* Matchups — MatchupGridGraphic (multi-column card grid),
                not MatchupSlateGraphic (tall single-column list, still
                used by the live Matchups page's own export) — a full
                Saturday slate read as too long scrolling down one
                column.

                Six graphics per Chris's spec:
                - Review: last week's FBS-vs-FBS + FBS-vs-FCS, all days,
                  completed only, combined into one graphic. Week 1 has
                  no previous week, so it reviews its own completed-so-far
                  games instead (reviewLabel makes this distinction
                  explicit rather than both cases just saying "Week 1").
                - Upcoming Midweek: FBS-vs-FBS midweek + FBS-vs-FCS
                  midweek combined into one graphic.
                - FBS vs FBS Saturday and FBS vs FCS Saturday: two
                  separate graphics, same as the original design.
                - FCS vs FCS Midweek and Saturday: unaffected by any of
                  the above — still their own separate graphics. */}
            <div ref={matchupsReviewRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={reviewLabel} header="FBS + FBS vs FCS — Review" rows={reviewRows} />
            </div>
            <div ref={upcomingMidweekRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic
                eyebrow={fbsEyebrow}
                header="Midweek Games"
                showDayOfWeek
                sections={[
                  { label: "FBS vs FBS", rows: fbsFbsMidweekRows },
                  { label: "FBS vs FCS", rows: crossMidweekRows },
                ]}
              />
            </div>
            <div ref={fbsMatchupsSaturdayRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic
                eyebrow={fbsEyebrow}
                header="FBS vs FBS — Saturday"
                sections={[
                  { label: null, rows: fbsFbsSaturdayTargetRows },
                  { label: null, rows: fbsFbsSaturdayLaterRows },
                ]}
              />
            </div>
            <div ref={crossMatchupsSaturdayRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fbsEyebrow} header="FBS vs FCS — Saturday" rows={crossSaturdayRows} />
            </div>
            <div ref={fcsMatchupsMidweekRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fcsEyebrow} header="FCS vs FCS — Midweek" rows={fcsFcsMidweekRows} />
            </div>
            <div ref={fcsMatchupsSaturdayRef} style={CAPTURE_WRAP_STYLE}>
              <MatchupGridGraphic eyebrow={fcsEyebrow} header="FCS vs FCS — Saturday" rows={fcsFcsSaturdayRows} />
            </div>

            {/* Watchability / TV Guide — the live pages themselves,
                pinned to this tool's selected week (see the weekOverride/
                forceSaturdaysOnly/shareRef props added to each). No outer
                capture wrapper needed: shareRef points straight at the
                page's own internal export-ready node. */}
            <WatchabilityPage
              onHome={() => {}}
              weekOverride={scheduleWeekNum ?? undefined}
              dateOverride={tvGuideDateOverride}
              topN={999}
              shareRef={watchabilityRef}
            />
            <WatchabilityPage
              onHome={() => {}}
              weekOverride={scheduleWeekNum ?? undefined}
              dateOverride={tvGuideDateOverride}
              topViewOverride="windows"
              topN={999}
              shareRef={watchabilityByWindowRef}
            />
            {/* Explicit width, not display:inline-block like every other
                target here — TvGuidePanel's shareRef attaches to its own
                internal overflowX:auto div (minWidth:100%, no definite
                width anywhere in its own markup, since on the live page
                it's constrained by the normal page layout around it).
                Off-screen (position:fixed, no page layout to constrain
                it), that div has nothing definite to size against and
                the browser's shrink-to-fit resolution inflated it far
                past any real content width — the captured PNG came back
                16384px wide (a hard browser canvas cap) with real
                content squeezed into a sliver of that. A definite-width
                ancestor here breaks the ambiguous auto-sizing chain and
                restores normal overflow-clipping, so scrollWidth
                correctly reports the true content width (a single
                Saturday's slate is comfortably under 3000px) instead of
                whatever the shrink-to-fit algorithm was computing. */}
            <div style={{ width: 3000 }}>
              <TvGuidePanel weekOverride={scheduleWeekNum ?? undefined} dateOverride={tvGuideDateOverride} shareRef={tvGuideRef} />
            </div>

            {/* Conference Previews — one instance, swapped through all
                conferences by handleGenerateZip's dedicated pass (see
                activeConferenceIdx above). Not mounted at all when idle. */}
            {activeConferenceIdx != null && (
              <div ref={conferencePreviewRef} style={CAPTURE_WRAP_STYLE}>
                <ConferencePreviewPage conference={divisionConferences[activeConferenceIdx].conf} onNavigateTeam={() => {}} onHome={() => {}} />
              </div>
            )}
          </OffscreenStage>
        </>
      )}
    </div>
  );
}
