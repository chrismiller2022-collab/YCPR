import { useState } from "react";
import MatchupPage from "./MatchupPage";
import ScheduleSwapPage from "./ScheduleSwapPage";
import ResumeComparisonPage from "./ResumeComparisonPage";
import ConferenceComparisonPage from "./ConferenceComparisonPage";
import ToughestStretchPage from "./ToughestStretchPage";
import Playoff24Page from "./Playoff24Page";
import WatchabilityPage from "./WatchabilityPage";
import { confToSlug, teamToSlug } from "../lib/slugs";

// The public site's tools, inside admin. Same components and data as the public pages; links to team and conference
// pages open the public page in a new tab so admin work isn't lost.
const TOOLS = [
  { key: "matchup", label: "Hypo Matchup" },
  { key: "swap", label: "Schedule Swap" },
  { key: "resume", label: "Resume Comparison" },
  { key: "conf", label: "Conference Comparison" },
  { key: "stretch", label: "Toughest Stretch" },
  { key: "playoff24", label: "24-Team Playoff" },
  { key: "watch", label: "Watchability" },
] as const;

const openTeam = (team: any) => {
  const name = typeof team === "string" ? team : team?.team;
  if (name) window.open(`/team/${teamToSlug(name)}`, "_blank", "noopener");
};
const openConference = (conf: any) => {
  const name = typeof conf === "string" ? conf : conf?.conf;
  if (name) window.open(`/conference/${confToSlug(name)}`, "_blank", "noopener");
};

export default function AdminToolsPanel({ onBack }: { onBack: () => void }) {
  const [tool, setTool] = useState<(typeof TOOLS)[number]["key"]>("matchup");
  const common = { onNavigateTeam: openTeam, onNavigateConference: openConference, onHome: onBack };
  return (
    <div>
      <h2>Public Tools</h2>
      <p>The public site's tools, using the same live data. Team and conference links open the public page in a new tab.</p>
      <nav className="admin-tabs" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.key} className={tool === t.key ? "on" : undefined} onClick={() => setTool(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="admin-embedded-tool">
        {tool === "matchup" && <MatchupPage {...common} />}
        {tool === "swap" && <ScheduleSwapPage {...common} />}
        {tool === "resume" && <ResumeComparisonPage {...common} />}
        {tool === "conf" && <ConferenceComparisonPage {...common} />}
        {tool === "stretch" && <ToughestStretchPage {...common} />}
        {tool === "playoff24" && <Playoff24Page {...common} />}
        {tool === "watch" && <WatchabilityPage {...common} />}
      </div>
    </div>
  );
}
