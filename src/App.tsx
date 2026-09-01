import "./styles/global.css";
import { useEffect, useState, lazy, Suspense } from "react";
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
import StrengthOfSchedulePage from "./pages/StrengthOfSchedulePage";
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
const AdminPage = lazy(() => import("./pages/AdminPage"));
import SurvivorPoolPublicPage from "./pages/SurvivorPoolPublicPage";
import SurvivorPoolStandingsPage from "./pages/SurvivorPoolStandingsPage";
import CfbSurvivorToolPage from "./pages/CfbSurvivorToolPage";
import WatchabilityPage from "./pages/WatchabilityPage";
import BetHistoryPage from "./pages/BetHistoryPage";

export default function App() {
  const [page, setPage] = useState<any>({ type: "home" });

  const handleNavigate = (catKey, catLabel, subKey, subLabel) => {
    setPage({ type: "sub", catKey, catLabel, subKey, subLabel });
  };

  const handleNavigateTeam = (team) => {
    setPage({ type: "team", team });
    window.scrollTo?.(0, 0);
  };

  const handleNavigateConference = (conf) => {
    setPage({
      type: "sub",
      catKey: "confpreviews",
      catLabel: "Conference Previews",
      subKey: conf,
      subLabel: conf,
    });
    window.scrollTo?.(0, 0);
  };

  const handleNavigateSingle = (pageType) => {
    setPage({ type: pageType });
    window.scrollTo?.(0, 0);
  };

  const handleHome = () => setPage({ type: "home" });

  useEffect(() => {
    function parseHash() {
      if (window.location.hash === "#admin") {
        setPage({ type: "admin" });
        return;
      }
      const poolMatch = window.location.hash.match(/^#survivorpool-(.+)$/);
      if (poolMatch) {
        const standingsMatch = poolMatch[1].match(/^standings-(\d+)(?:-viewer-(.+))?$/);
        if (standingsMatch) {
          setPage({
            type: "survivorpoolstandings",
            season: parseInt(standingsMatch[1], 10),
            viewerSlug: standingsMatch[2] || null,
          });
        } else {
          setPage({ type: "survivorpool", slug: poolMatch[1] });
        }
      }
    }

    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  // Quick links from the Admin dashboard — jump straight to a live public
  // page and leave the Admin area (clearing the #admin hash so a refresh
  // doesn't bounce back into Admin).
  const goToLiveRatings = () => {
    window.location.hash = "";
    handleHome();
  };

  const goToLiveResume = () => {
    window.location.hash = "";
    setPage({
      type: "sub",
      catKey: "resume",
      catLabel: "Resume Ratings",
      subKey: "live",
      subLabel: "Live",
    });
  };

  const goToLiveSOS = () => {
    window.location.hash = "";
    setPage({
      type: "sub",
      catKey: "sos",
      catLabel: "Strength of Schedule",
      subKey: "live",
      subLabel: "Live",
    });
  };

  if (page.type === "admin") {
    return (
      <div className="page">
        <Suspense fallback={<div className="page-loading">Loading admin…</div>}>
          <AdminPage
            onHome={() => {
              window.location.hash = "";
              handleHome();
            }}
            onGoToRatings={goToLiveRatings}
            onGoToResume={goToLiveResume}
            onGoToSOS={goToLiveSOS}
          />
        </Suspense>
        <Analytics />
      </div>
    );
  }

  if (page.type === "survivorpool") {
    return (
      <div className="page">
        <SurvivorPoolPublicPage
          slug={page.slug}
          onHome={() => {
            window.location.hash = "";
            handleHome();
          }}
        />
        <SiteFooter />
        <Analytics />
      </div>
    );
  }

  if (page.type === "survivorpoolstandings") {
    return (
      <div className="page">
        <SurvivorPoolStandingsPage
          season={page.season}
          viewerSlug={page.viewerSlug}
          onHome={() => {
            window.location.hash = "";
            handleHome();
          }}
        />
        <SiteFooter />
        <Analytics />
      </div>
    );
  }

  return (
    <div className="page">
      <TopNav
        onNavigate={handleNavigate}
        onNavigateTeam={handleNavigateTeam}
        onNavigateSingle={handleNavigateSingle}
        onHome={handleHome}
      />

      {page.type === "home" && (
        <HomePage
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
        />
      )}

      {page.type === "sub" && page.catKey === "matchups" && (
        <MatchupsPage
          subKey={page.subKey}
          subLabel={page.subLabel}
          onNavigateTeam={handleNavigateTeam}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" &&
        page.catKey === "wintotals" &&
        page.subKey === "live" && (
          <LiveWinTotalsPage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "resume" &&
        page.subKey === "live" && (
          <ResumeRatingsPage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "sos" &&
        page.subKey === "live" && (
          <StrengthOfSchedulePage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "ratings" &&
        page.subKey === "weeklyprogression" && (
          <WeeklyProgressionPage
            metric="power"
            subLabel={page.subLabel}
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" && page.catKey === "ratings" && page.subKey === "week1" && (
        <PreseasonWeek1RatingsPage
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" &&
        page.catKey === "resume" &&
        page.subKey === "weeklyprogression" && (
          <WeeklyProgressionPage
            metric="resume"
            subLabel={page.subLabel}
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "sos" &&
        page.subKey === "weeklyprogression" && (
          <WeeklyProgressionPage
            metric="sor"
            subLabel={page.subLabel}
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "futures" &&
        page.subKey === "confwinodds" && (
          <ConferenceWinOddsPage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "futures" &&
        page.subKey === "confwintotals" && (
          <ConferenceWinTotalsPage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" && page.catKey === "otherfutures" && (
        <OtherFuturesPage
          subKey={page.subKey}
          subLabel={page.subLabel}
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" &&
        page.catKey === "futures" &&
        page.subKey === "pythagwins" && (
          <PythagWinsPage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" && page.catKey === "confpreviews" && (
        <ConferencePreviewPage
          conference={page.subKey}
          onNavigateTeam={handleNavigateTeam}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" && page.catKey === "bracket" && (
        <BracketPage
          subLabel={page.subLabel}
          onNavigateTeam={handleNavigateTeam}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" && page.catKey === "fcsbracket" && (
        <FCSBracketPage
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" &&
        page.catKey === "fcsratings" &&
        page.subKey === "live" && (
          <FCSRatingsPage
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "fcsratings" &&
        page.subKey === "weeklyprogression" && (
          <WeeklyProgressionPage
            metric="power"
            defaultDivision="FCS"
            subLabel={page.subLabel}
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" && page.catKey === "fcsconfpreviews" && (
        <ConferencePreviewPage
          conference={page.subKey}
          onNavigateTeam={handleNavigateTeam}
          onHome={handleHome}
        />
      )}

      {page.type === "sub" &&
        page.catKey === "fcswintotals" &&
        page.subKey === "live" && (
          <LiveWinTotalsPage
            defaultDivision="FCS"
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "fcssos" &&
        page.subKey === "live" && (
          <StrengthOfSchedulePage
            forceDivision="FCS"
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" &&
        page.catKey === "fcssos" &&
        page.subKey === "weeklyprogression" && (
          <WeeklyProgressionPage
            metric="sor"
            defaultDivision="FCS"
            subLabel={page.subLabel}
            onNavigateTeam={handleNavigateTeam}
            onNavigateConference={handleNavigateConference}
            onHome={handleHome}
          />
        )}

      {page.type === "sub" && page.catKey === "modelresults" && page.subKey === "all" && (
        <BetHistoryPage onHome={handleHome} />
      )}

      {page.type === "sub" &&
        page.catKey === "modelresults" &&
        ["2024", "2025", "2026"].includes(page.subKey) && (
          <BetHistoryPage onHome={handleHome} lockedYear={parseInt(page.subKey, 10)} />
        )}

      {page.type === "sub" &&
        !(page.catKey === "matchups") &&
        !(page.catKey === "wintotals" && page.subKey === "live") &&
        !(page.catKey === "otherfutures") &&
        !(page.catKey === "resume" && page.subKey === "live") &&
        !(page.catKey === "sos" && page.subKey === "live") &&
        !(page.subKey === "weeklyprogression" &&
          (page.catKey === "ratings" || page.catKey === "resume" || page.catKey === "sos")) &&
        !(page.catKey === "ratings" && page.subKey === "week1") &&
        !(page.catKey === "confpreviews") &&
        !(page.catKey === "bracket") &&
        !(page.catKey === "fcsbracket") &&
        !(page.catKey === "fcsratings" && page.subKey === "live") &&
        !(page.catKey === "fcsconfpreviews") &&
        !(page.catKey === "fcswintotals" && page.subKey === "live") &&
        !(page.catKey === "fcssos" && page.subKey === "live") &&
        !(page.subKey === "weeklyprogression" &&
          (page.catKey === "fcsratings" || page.catKey === "fcssos")) &&
        !(
          page.catKey === "futures" &&
          (page.subKey === "confwinodds" ||
            page.subKey === "confwintotals" ||
            page.subKey === "pythagwins")
        ) &&
        !(page.catKey === "modelresults" && ["all", "2024", "2025", "2026"].includes(page.subKey)) && (
          <ComingSoon categoryLabel={page.catLabel} subLabel={page.subLabel} />
        )}

      {page.type === "team" && (
        <TeamPage
          team={page.team}
          onNavigateTeam={handleNavigateTeam}
          onHome={handleHome}
        />
      )}

      {page.type === "matchup" && <MatchupPage onHome={handleHome} />}

      {page.type === "scheduleswap" && (
        <ScheduleSwapPage onNavigateTeam={handleNavigateTeam} onHome={handleHome} />
      )}

      {page.type === "resumecompare" && (
        <ResumeComparisonPage onNavigateTeam={handleNavigateTeam} onHome={handleHome} />
      )}

      {page.type === "confcompare" && (
        <ConferenceComparisonPage onNavigateTeam={handleNavigateTeam} onHome={handleHome} />
      )}

      {page.type === "confoverview" && (
        <ConferenceOverviewPage onNavigateConference={handleNavigateConference} onHome={handleHome} />
      )}

      {page.type === "tougheststretch" && (
        <ToughestStretchPage
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
          onHome={handleHome}
        />
      )}

      {page.type === "playoff24" && (
        <Playoff24Page
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
          onHome={handleHome}
        />
      )}

      {page.type === "weekreport" && <WeekReportPage onHome={handleHome} />}

      {page.type === "cfbsurvivor" && <CfbSurvivorToolPage onHome={handleHome} />}
      {page.type === "watchability" && <WatchabilityPage onHome={handleHome} />}

      <SiteFooter />
      <Analytics />
    </div>
  );
}
