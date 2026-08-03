// P4 / G6 classification, shared across the site (Bet History filters,
// Toughest Game Stretch filters, and anywhere else this comes up).
//
// Notre Dame and UConn are both independents (same conference string in
// data/teams.ts), so this has to special-case by team name, not just by
// conference.

const P4_CONFERENCES = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);
const P4_INDEPENDENTS = new Set(["Notre Dame"]);

export function isP4(team: string, conference: string): boolean {
  if (P4_CONFERENCES.has(conference)) return true;
  if (P4_INDEPENDENTS.has(team)) return true;
  return false;
}

export function bucketFor(team: string, conference: string): "P4" | "G6" {
  return isP4(team, conference) ? "P4" : "G6";
}
