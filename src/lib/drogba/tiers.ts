// Where DROGBA's edge lives. Over 2023-26 the model's disagreements with the open only paid off in games between
// two power-conference teams (63.6% ATS, +1.4 points of closing-line value at 6+ point edges vs FanDuel's open); in
// every other game it was at or below break-even. So picks are shown in two groups — power vs power first, other games
// separately but still tracked.
import type { DGame } from "./dataset";

export type Tier = "power" | "other";
export const TIER_LABELS: Record<Tier, string> = { power: "Power vs power", other: "Other games" };

const POWER_CONFS = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);

// A "power" team is a member of the SEC / Big Ten / Big 12 / ACC, Notre Dame, or a Pac-12 team in 2023. The Pac-12 label in
// 2024-26 covers former Mountain West schools and two leftovers, and "FBS Independents" includes UConn and UMass, so
// neither counts.
export function isPowerTeam(conf: string | null | undefined, team: string, season: number): boolean {
  if (team === "Notre Dame") return true;
  if (!conf) return false;
  return POWER_CONFS.has(conf) || (conf === "Pac-12" && season === 2023);
}

export function gameTier(g: Pick<DGame, "home" | "away" | "homeConf" | "awayConf" | "season">): Tier {
  return isPowerTeam(g.homeConf, g.home, g.season) && isPowerTeam(g.awayConf, g.away, g.season) ? "power" : "other";
}
