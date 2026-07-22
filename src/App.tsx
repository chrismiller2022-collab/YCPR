import "./styles/global.css";
import { useState } from "react";
import HomePage from "./pages/HomePage";
import TeamPage from "./pages/TeamPage";
import MatchupPage from "./pages/MatchupPage";
import ScheduleSwapPage from "./pages/ScheduleSwapPage";
import ResumeComparisonPage from "./pages/ResumeComparisonPage";
import MatchupsPage from "./pages/MatchupsPage";
import LiveWinTotalsPage from "./pages/LiveWinTotalsPage";
import ResumeRatingsPage from "./pages/ResumeRatingsPage";
import StrengthOfSchedulePage from "./pages/StrengthOfSchedulePage";
import WeeklyProgressionPage from "./pages/WeeklyProgressionPage";
import ConferenceWinTotalsPage from "./pages/ConferenceWinTotalsPage";
import ConferenceWinOddsPage from "./pages/ConferenceWinOddsPage";
import ConferencePreviewPage from "./pages/ConferencePreviewPage";
import BracketPage from "./pages/BracketPage";
import Playoff24Page from "./pages/Playoff24Page";
import ComingSoon from "./pages/ComingSoon";
import TopNav from "./pages/TopNav";

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

      {page.type === "sub" &&
        !(page.catKey === "matchups") &&
        !(page.catKey === "wintotals" && page.subKey === "live") &&
        !(page.catKey === "resume" && page.subKey === "live") &&
        !(page.catKey === "sos" && page.subKey === "live") &&
        !(page.subKey === "weeklyprogression" &&
          (page.catKey === "ratings" || page.catKey === "resume" || page.catKey === "sos")) &&
        !(page.catKey === "confpreviews") &&
        !(page.catKey === "bracket") &&
        !(
          page.catKey === "futures" &&
          (page.subKey === "confwinodds" || page.subKey === "confwintotals")
        ) && (
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

      {page.type === "playoff24" && (
        <Playoff24Page
          onNavigateTeam={handleNavigateTeam}
          onNavigateConference={handleNavigateConference}
          onHome={handleHome}
        />
      )}
    </div>
  );
}
