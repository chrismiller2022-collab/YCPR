import { useState } from "react";
import { TEAM_LOGOS } from "../data/logos";

export default function TeamLogo({ team, size }: any) {
  const [failed, setFailed] = useState(false);
  const name = typeof team === "string" ? team : team?.team;
  const src = name ? TEAM_LOGOS[name] : null;

  if (!src || failed) {
    return null;
  }

  return (
    <img
      src={src}
      alt=""
      className="team-logo"
      style={size ? { width: size, height: size } : undefined}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
