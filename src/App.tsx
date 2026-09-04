import "./styles/global.css";
import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import HomePage from "./pages/HomePage";
import TeamPage from "./pages/TeamPage";
import MatchupPage from "./pages/MatchupPage";
import ScheduleSwapPage from "./pages/ScheduleSwapPage";
import ResumeComparisonPage from "./pages/ResumeComparisonPage";
import ConferenceComparisonPage from "./pages/ConferenceComparisonPage";
import ToughestStretchPage from "./pages/ToughestStretchPage";
import MatchupsPage from "./pages/MatchupsPage";
import LiveWinTotalsPage from "./pages/LiveWinTotalsPage";
import ResumeRatingsPage from "./pages/ResumeRatingsPage";
import ResumeRatingsWeekPage from "./pages/ResumeRatingsWeekPage";
import StrengthOfSchedulePage from "./pages/StrengthOfSchedulePage";
import SosWeekPage from "./pages/SosWeekPage";
import WeeklyProgressionPage from "./pages/WeeklyProgressionPage";
import ConferenceWinTotalsPage from "./pages/ConferenceWinTotalsPage";
import PythagWinsPage from "./pages/PythagWinsPage";
import OtherFuturesPage from "./pages/OtherFuturesPage";
import SiteFooter from "./components/SiteFooter";
import ConferenceWinOddsPage from "./pages/ConferenceWinOddsPage";
import ConferencePreviewPage from "./pages/ConferencePreviewPage";
import ConferenceOverviewPage from "./pages/ConferenceOverviewPage";
import BracketPage from "./pages/BracketPage";
import FCSBracketPage from "./pages/FCSBracketPage";
import FCSRatingsPage from "./pages/FCSRatingsPage";
import Playoff24Page from "./pages/Playoff24Page";
import WeekReportPage from "./pages/WeekReportPage";
import PreseasonWeek1RatingsPage from "./pages/PreseasonWeek1RatingsPage";
import ComingSoon from "./pages/ComingSoon";
import TopNav from "./pages/TopNav";
import FAQPage from "./pages/FAQPage";
const AdminPage = lazy(() => import("./pages/AdminPage"));
import SurvivorPoolPublicPage from "./pages/SurvivorPoolPublicPage";
import SurvivorPoolStandingsPage from "./pages/SurvivorPoolStandingsPage";
import CfbSurvivorToolPage from "./pages/CfbSurvivorToolPage";
import WatchabilityPage from "./pages/WatchabilityPage";
import BetHistoryPage from "./pages/BetHistoryPage";
import { WEEKS } from "./data/games";
import { TEAMS_BY_NAME } from "./data/teams";
import { teamToSlug, slugToTeam, confToSlug, slugToConf } from "./lib/slugs";

// ---------------------------------------------------------------------
// Every page keeps its exact original prop interface (onNavigateTeam,
// onNavigateConference, onHome, etc.) — nothing in any individual page
// component changed. Only this file changed: those callbacks now call
// navigate(...) to a real URL instead of setting internal page-state,
// and the URL itself (via useParams, below) is what determines which
// page renders and with which props. This is what makes every page
// bookmarkable/shareable and makes the browser back button behave
// normally instead of exiting the whole app.
//
// Team/conference names go into the URL as readable slugs (texas-am,
// ohio-state) via lib/slugs.ts, not raw encodeURIComponent — see that
// file for the full reasoning and the handful of hand-picked overrides
// (Texas A&M, William & Mary, etc.) that needed one.
// ---------------------------------------------------------------------

function weekNumFromKey(key: string): string | null {
  const m = /^week(\d+)$/.exec(key);
  return m ? m[1] : null;
}

function weekLabelFor(n: string | undefined): string {
  if (!n) return "";
  const found = WEEKS.find((w) => w.key === `week${n}`);
  return found ? found.label : `Week ${n}`;
}

export default function App() {
  const navigate = useNavigate();

  // Backward-compat for bookmarks/links made before this change —
  // #admin and the old #survivorpool-* hash links redirect to their
  // real-path equivalents once, on load, then the hash is gone for
  // good (real paths from here on).
  useEffect(() => {
    if (window.location.hash === "#admin") {
      window.location.hash = "";
      navigate("/admin", { replace: true });
      return;
    }
    const poolMatch = window.location.hash.match(/^#survivorpool-(.+)$/);
    if (poolMatch) {
      window.location.hash = "";
      const standingsMatch = poolMatch[1].match(/^standings-(\d+)(?:-viewer-(.+))?$/);
      if (standingsMatch) {
        const path = standingsMatch[2]
          ? `/survivor-pool/standings/${standingsMatch[1]}/${standingsMatch[2]}`
          : `/survivor-pool/standings/${standingsMatch[1]}`;
        navigate(path, { replace: true });
      } else {
        navigate(`/survivor-pool/${poolMatch[1]}`, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onHome = () => navigate("/");
  // onNavigateTeam is called throughout the site with either a plain
  // team-name string OR a full Team object (t, opp, f.team, etc. —
  // wildly inconsistent across ~35 call sites) — TeamLogo.tsx already
  // has to handle this same ambiguity for the exact same reason. Every
  // one of those call sites is unchanged by this routing work, so this
  // has to accept both, same as TeamLogo does.
  const onNavigateTeam = (team: any) => {
    const name = typeof team === "string" ? team : team?.team;
    navigate(`/team/${teamToSlug(name)}`);
    window.scrollTo?.(0, 0);
  };
  // Conference previews are the same component/page regardless of
  // division (ConferencePreviewPage itself resolves FBS-vs-FCS from
  // the conference name) — one canonical URL for both, matching how
  // the old implementation already routed every onNavigateConference
  // call through the same FBS-labeled internal state regardless of
  // the conference's actual division.
  const onNavigateConference = (conf: string) => {
    navigate(`/conference/${confToSlug(conf)}`);
    window.scrollTo?.(0, 0);
  };

  // Matches TopNav's existing onNavigate(catKey, catLabel, subKey, subLabel)
  // call signature exactly — TopNav itself needed zero changes.
  const onNavigate = (catKey: string, _catLabel: string, subKey: string, _subLabel: string) => {
    const wk = weekNumFromKey(subKey);
    switch (catKey) {
      case "matchups":
        navigate(subKey === "all" ? "/matchups/all" : `/matchups/week/${wk}`);
        break;
      case "wintotals":
        if (subKey === "live") navigate("/futures/win-totals/live");
        else if (subKey === "weeklyprogression") navigate("/futures/win-totals/progression");
        else navigate(`/futures/win-totals/week/${wk}`);
        break;
      case "resume":
        if (subKey === "live") navigate("/resume-ratings/live");
        else if (subKey === "weeklyprogression") navigate("/resume-ratings/progression");
        else navigate(`/resume-ratings/week/${wk}`);
        break;
      case "sos":
        if (subKey === "live") navigate("/sos/live");
        else if (subKey === "weeklyprogression") navigate("/sos/progression");
        else navigate(`/sos/week/${wk}`);
        break;
      case "ratings":
        if (subKey === "live") navigate("/");
        else if (subKey === "week1") navigate("/power-ratings/week/1");
        else if (subKey === "weeklyprogression") navigate("/power-ratings/progression");
        else navigate(`/power-ratings/week/${wk}`);
        break;
      case "futures":
        if (subKey === "confwinodds") navigate("/futures/conference-win-odds");
        else if (subKey === "confwintotals") navigate("/futures/conference-win-totals");
        else if (subKey === "pythagwins") navigate("/futures/pythag-wins");
        break;
      case "otherfutures":
        navigate(subKey === "live" ? "/futures/other/live" : `/futures/other/week/${wk}`);
        break;
      case "confpreviews":
        navigate(subKey === "overview" ? "/conferences" : `/conference/${confToSlug(subKey)}`);
        break;
      case "bracket":
        navigate(subKey === "live" ? "/bracket/live" : `/bracket/week/${wk}`);
        break;
      case "fcsbracket":
        navigate(subKey === "live" ? "/fcs/bracket/live" : `/fcs/bracket/week/${wk}`);
        break;
      case "fcsratings":
        if (subKey === "live") navigate("/fcs/power-ratings/live");
        else if (subKey === "weeklyprogression") navigate("/fcs/power-ratings/progression");
        else if (subKey === "preseason") navigate("/fcs/power-ratings/preseason");
        else navigate(`/fcs/power-ratings/week/${wk}`);
        break;
      case "fcsconfpreviews":
        navigate(`/conference/${confToSlug(subKey)}`);
        break;
      case "fcswintotals":
        if (subKey === "live") navigate("/fcs/win-totals/live");
        else if (subKey === "weeklyprogression") navigate("/fcs/win-totals/progression");
        else navigate(`/fcs/win-totals/week/${wk}`);
        break;
      case "fcssos":
        if (subKey === "live") navigate("/fcs/sos/live");
        else if (subKey === "weeklyprogression") navigate("/fcs/sos/progression");
        else navigate(`/fcs/sos/week/${wk}`);
        break;
      case "modelresults":
        navigate(subKey === "all" ? "/model-results" : `/model-results/${subKey}`);
        break;
      default:
        navigate("/");
    }
    window.scrollTo?.(0, 0);
  };

  const onNavigateSingle = (pageType: string) => {
    const map: Record<string, string> = {
      faq: "/faq",
      matchup: "/tools/matchup",
      scheduleswap: "/tools/schedule-swap",
      resumecompare: "/tools/resume-comparison",
      confcompare: "/tools/conference-comparison",
      tougheststretch: "/tools/toughest-stretch",
      playoff24: "/tools/playoff-24",
      weekreport: "/tools/week-report",
      cfbsurvivor: "/tools/cfb-survivor",
      watchability: "/tools/watchability",
      home: "/",
    };
    navigate(map[pageType] ?? "/");
    window.scrollTo?.(0, 0);
  };

  // Admin quick-links — jump straight to a live public page and leave Admin.
  const goToLiveRatings = () => navigate("/");
  const goToLiveResume = () => navigate("/resume-ratings/live");
  const goToLiveSOS = () => navigate("/sos/live");

  return (
    <Routes>
      <Route path="/admin" element={
        <div className="page">
          <Suspense fallback={<div className="page-loading">Loading admin…</div>}>
            <AdminPage onHome={() => navigate("/")} onGoToRatings={goToLiveRatings} onGoToResume={goToLiveResume} onGoToSOS={goToLiveSOS} />
          </Suspense>
          <Analytics />
        </div>
      } />

      <Route path="/survivor-pool/standings/:season/:viewerSlug" element={<SurvivorPoolStandingsRoute onHome={() => navigate("/")} />} />
      <Route path="/survivor-pool/standings/:season" element={<SurvivorPoolStandingsRoute onHome={() => navigate("/")} />} />
      <Route path="/survivor-pool/:slug" element={<SurvivorPoolRoute onHome={() => navigate("/")} />} />

      <Route
        path="*"
        element={
          <div className="page">
            <TopNav onNavigate={onNavigate} onNavigateTeam={onNavigateTeam} onNavigateSingle={onNavigateSingle} onHome={onHome} />

            <Routes>
              <Route path="/" element={<HomePage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} />} />
              <Route path="/team/:team" element={<TeamRoute onNavigateTeam={onNavigateTeam} onHome={onHome} />} />
              <Route path="/faq" element={<FAQPage onHome={onHome} />} />

              <Route path="/conferences" element={<ConferenceOverviewPage onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/conference/:name" element={<ConferenceRoute onNavigateTeam={onNavigateTeam} onHome={onHome} />} />

              <Route path="/tools/matchup" element={<MatchupPage onHome={onHome} />} />
              <Route path="/tools/schedule-swap" element={<ScheduleSwapPage onNavigateTeam={onNavigateTeam} onHome={onHome} />} />
              <Route path="/tools/resume-comparison" element={<ResumeComparisonPage onNavigateTeam={onNavigateTeam} onHome={onHome} />} />
              <Route path="/tools/conference-comparison" element={<ConferenceComparisonPage onNavigateTeam={onNavigateTeam} onHome={onHome} />} />
              <Route path="/tools/toughest-stretch" element={<ToughestStretchPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/tools/playoff-24" element={<Playoff24Page onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/tools/week-report" element={<WeekReportPage onHome={onHome} />} />
              <Route path="/tools/cfb-survivor" element={<CfbSurvivorToolPage onHome={onHome} />} />
              <Route path="/tools/watchability" element={<WatchabilityPage onHome={onHome} />} />

              <Route path="/power-ratings/week/1" element={<PreseasonWeek1RatingsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/power-ratings/week/:n" element={<ComingSoonRoute catLabel="Weekly Power Ratings" />} />
              <Route path="/power-ratings/progression" element={<WeeklyProgressionPage metric="power" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />

              <Route path="/futures/win-totals/live" element={<LiveWinTotalsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/win-totals/week/:n" element={<WinTotalsWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/win-totals/progression" element={<WeeklyProgressionPage metric="wintotals" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/conference-win-odds" element={<ConferenceWinOddsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/conference-win-totals" element={<ConferenceWinTotalsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/other/live" element={<OtherFuturesPage subKey="live" subLabel="Live" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/other/week/:n" element={<OtherFuturesWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/futures/pythag-wins" element={<PythagWinsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />

              <Route path="/matchups/all" element={<MatchupsPage subKey="all" subLabel="All" onNavigateTeam={onNavigateTeam} onHome={onHome} />} />
              <Route path="/matchups/week/:n" element={<MatchupsWeekRoute onNavigateTeam={onNavigateTeam} onHome={onHome} />} />

              <Route path="/resume-ratings/live" element={<ResumeRatingsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/resume-ratings/progression" element={<WeeklyProgressionPage metric="resume" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/resume-ratings/week/:n" element={<ResumeRatingsWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />

              <Route path="/sos/live" element={<StrengthOfSchedulePage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/sos/progression" element={<WeeklyProgressionPage metric="sor" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/sos/toughest-stretch" element={<ToughestStretchPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/sos/week/:n" element={<SosWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />

              <Route path="/bracket/live" element={<BracketPage subLabel="Live" weekNum={null} onNavigateTeam={onNavigateTeam} onHome={onHome} />} />
              <Route path="/bracket/week/:n" element={<BracketWeekRoute onNavigateTeam={onNavigateTeam} onHome={onHome} />} />

              <Route path="/fcs/bracket/live" element={<FCSBracketPage weekNum={null} onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/bracket/week/:n" element={<FCSBracketWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/power-ratings/live" element={<FCSRatingsPage onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/power-ratings/progression" element={<WeeklyProgressionPage metric="power" defaultDivision="FCS" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/power-ratings/preseason" element={<ComingSoonRoute catLabel="FCS Power Ratings" />} />
              <Route path="/fcs/power-ratings/week/:n" element={<ComingSoonRoute catLabel="FCS Power Ratings" />} />
              <Route path="/fcs/win-totals/live" element={<LiveWinTotalsPage defaultDivision="FCS" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/win-totals/week/:n" element={<FCSWinTotalsWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/win-totals/progression" element={<WeeklyProgressionPage metric="wintotals" defaultDivision="FCS" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/sos/live" element={<StrengthOfSchedulePage forceDivision="FCS" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/sos/progression" element={<WeeklyProgressionPage metric="sor" defaultDivision="FCS" subLabel="Weekly Progression" onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />
              <Route path="/fcs/sos/week/:n" element={<FCSSosWeekRoute onNavigateTeam={onNavigateTeam} onNavigateConference={onNavigateConference} onHome={onHome} />} />

              <Route path="/model-results" element={<BetHistoryPage onHome={onHome} />} />
              <Route path="/model-results/:year" element={<ModelResultsYearRoute onHome={onHome} />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            <SiteFooter />
            <Analytics />
          </div>
        }
      />
    </Routes>
  );
}

// ---------------------------------------------------------------------
// Small route-param-reading wrappers — each just pulls the dynamic
// segment(s) out of the URL via useParams() and passes them into the
// unchanged underlying page component as ordinary props.
// ---------------------------------------------------------------------

function TeamRoute({ onNavigateTeam, onHome }: any) {
  const { team } = useParams();
  const teamName = slugToTeam(team ?? "");
  const teamObj = TEAMS_BY_NAME[teamName];
  // TeamPage indexes straight into team.div/team.conf — it has always
  // needed the full Team object, never just the name string. This was
  // the actual bug behind "team pages don't work at all": this line
  // was passing the bare name string, and TeamPage silently got
  // undefined back for every team.div/team.conf lookup.
  if (!teamObj) return <Navigate to="/" replace />;
  return <TeamPage team={teamObj} onNavigateTeam={onNavigateTeam} onHome={onHome} />;
}

function ConferenceRoute({ onNavigateTeam, onHome }: any) {
  const { name } = useParams();
  return <ConferencePreviewPage conference={slugToConf(name ?? "")} onNavigateTeam={onNavigateTeam} onHome={onHome} />;
}

function MatchupsWeekRoute({ onNavigateTeam, onHome }: any) {
  const { n } = useParams();
  return <MatchupsPage subKey={`week${n}`} subLabel={weekLabelFor(n)} onNavigateTeam={onNavigateTeam} onHome={onHome} />;
}

function OtherFuturesWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  return (
    <OtherFuturesPage
      subKey={`week${n}`}
      subLabel={weekLabelFor(n)}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function FCSBracketWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return (
    <FCSBracketPage
      weekNum={Number.isFinite(wk) ? wk : null}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function ResumeRatingsWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return (
    <ResumeRatingsWeekPage
      weekNum={Number.isFinite(wk) ? wk : 1}
      subLabel={weekLabelFor(n)}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function SosWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return (
    <SosWeekPage
      weekNum={Number.isFinite(wk) ? wk : 1}
      subLabel={weekLabelFor(n)}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function FCSSosWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return (
    <SosWeekPage
      defaultDivision="FCS"
      weekNum={Number.isFinite(wk) ? wk : 1}
      subLabel={weekLabelFor(n)}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function WinTotalsWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return (
    <LiveWinTotalsPage
      weekNum={Number.isFinite(wk) ? wk : null}
      subLabel={weekLabelFor(n)}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function FCSWinTotalsWeekRoute({ onNavigateTeam, onNavigateConference, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return (
    <LiveWinTotalsPage
      defaultDivision="FCS"
      weekNum={Number.isFinite(wk) ? wk : null}
      subLabel={weekLabelFor(n)}
      onNavigateTeam={onNavigateTeam}
      onNavigateConference={onNavigateConference}
      onHome={onHome}
    />
  );
}

function BracketWeekRoute({ onNavigateTeam, onHome }: any) {
  const { n } = useParams();
  const wk = parseInt(n ?? "", 10);
  return <BracketPage subLabel={weekLabelFor(n)} weekNum={Number.isFinite(wk) ? wk : null} onNavigateTeam={onNavigateTeam} onHome={onHome} />;
}

function ComingSoonRoute({ catLabel }: { catLabel: string }) {
  const { n } = useParams();
  return <ComingSoon categoryLabel={catLabel} subLabel={n ? weekLabelFor(n) : undefined} />;
}

function ModelResultsYearRoute({ onHome }: any) {
  const { year } = useParams();
  const parsed = parseInt(year ?? "", 10);
  return <BetHistoryPage onHome={onHome} lockedYear={Number.isFinite(parsed) ? parsed : undefined} />;
}

function SurvivorPoolRoute({ onHome }: any) {
  const { slug } = useParams();
  return <SurvivorPoolPublicPage slug={slug ?? ""} onHome={onHome} />;
}

function SurvivorPoolStandingsRoute({ onHome }: any) {
  const { season, viewerSlug } = useParams();
  return <SurvivorPoolStandingsPage season={parseInt(season ?? "0", 10)} viewerSlug={viewerSlug ?? null} onHome={onHome} />;
}
