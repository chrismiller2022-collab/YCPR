import TeamLogo from "./TeamLogo";

export default function TeamCell({ team, onNavigateTeam }: any) {
  return (
    <td className="matchup-team-cell">
      <button
        className="team-link matchup-team-btn"
        onClick={() => onNavigateTeam(team)}
      >
        <TeamLogo team={team} />
        {team.team}
      </button>
      <span
        className={`matchup-rating ${
          team.rating < 0 ? "rating-good" : "rating-bad"
        }`}
      >
        {team.rating > 0 ? "+" : ""}
        {team.rating.toFixed(2)}
      </span>
    </td>
  );
}
