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

// ---------------------------------------------------------------------
// Single source of truth for "what conferences should the filter
// dropdown show" — every page with a division + conference filter
// should use this instead of its own copy, so the division-awareness
// bug (showing FCS conferences while FBS is selected, or vice versa)
// and the Power 4 / Group of 6 options only need to exist in one place.
//
// "Power 4" and "Group of 6" only show for FBS specifically — G6 as a
// concept doesn't include FCS teams (isP4/bucketFor only classifies
// FBS conferences), so surfacing it under "FCS" or "All" would silently
// sweep every FCS team into "Group of 6," which is wrong.
// ---------------------------------------------------------------------
export const CONF_FILTER_SPECIAL = ["Power 4", "Group of 6"] as const;

export function conferenceFilterOptions(
  division: "FBS" | "FCS" | "All",
  fbsConferences: string[],
  fcsConferences: string[]
): string[] {
  if (division === "FBS") return [...CONF_FILTER_SPECIAL, ...fbsConferences];
  if (division === "FCS") return fcsConferences;
  return [...fbsConferences, ...fcsConferences];
}

export function teamMatchesConferenceFilter(team: string, conference: string, filterValue: string): boolean {
  if (filterValue === "All") return true;
  if (filterValue === "Power 4") return isP4(team, conference);
  if (filterValue === "Group of 6") return !isP4(team, conference);
  return conference === filterValue;
}
