import TeamLogo from "./TeamLogo";
import { teamToSlug } from "../lib/slugs";

// Admin pages have no SPA onNavigateTeam callback (AdminPage isn't
// mounted with one — see App.tsx) — this opens the real public team
// page directly by URL instead, in a new tab so admin work in the
// current tab isn't lost. Public pages already navigate via
// onNavigateTeam and should keep doing that; this is admin-only.
export default function TeamLink({ team, size }: { team: string; size?: number }) {
  return (
    <a
      href={`/team/${teamToSlug(team)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="admin-team-link"
      onClick={(e) => e.stopPropagation()}
    >
      <TeamLogo team={team} size={size} />
      {team}
    </a>
  );
}
