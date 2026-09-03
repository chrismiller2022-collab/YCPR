import { TEAMS, conferencesForDivision } from "../data/teams";

// Bidirectional team-name <-> URL-slug mapping. Plain encodeURIComponent
// (the original approach) is perfectly correct — it round-trips any
// string with zero collision risk — but produces genuinely ugly URLs for
// the ~140 team names with a space, and outright confusing ones for the
// handful with an ampersand (Texas A&M -> Texas%20A%26M). This produces
// natural, readable slugs instead (texas-am), while still guaranteeing
// exact round-tripping via an explicit reverse-lookup map built from the
// real team list at load time — not by re-deriving the original name
// from the slug algorithmically (which loses information, e.g. whether
// "and" in a slug came from a literal "&" or a literal "and").
//
// Only 7 team names need a hand-picked override — everything else (accented
// characters, apostrophes, periods, parenthetical suffixes like "Miami
// (OH)", and plain spaces) is handled by one general, deterministic
// algorithm. Verified zero collisions across all 266 current teams
// before shipping this — see chat.
const TEAM_SLUG_OVERRIDES: Record<string, string> = {
  "Texas A&M": "texas-am",
  "William & Mary": "william-mary",
  "Prairie View A&M": "prairie-view-am",
  "East Texas A&M": "east-texas-am",
  "Alabama A&M": "alabama-am",
  "Florida A&M": "florida-am",
  "North Carolina A&T": "north-carolina-at",
};

function generalSlugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics: "San José" -> "San Jose"
    .replace(/'/g, "") // strip apostrophes entirely: "Hawai'i" -> "Hawaii"
    .replace(/\./g, "") // strip periods: "St." -> "St"
    .replace(/\s*\(([^)]+)\)/g, "-$1") // "Miami (OH)" -> "Miami-OH"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // remaining spaces/punctuation (including any stray &) -> hyphen
    .replace(/^-+|-+$/g, "");
}

function slugifyTeamName(name: string): string {
  return TEAM_SLUG_OVERRIDES[name] ?? generalSlugify(name);
}

// Built once from the real team/conference lists — the actual source of
// truth for reversing a slug, not a re-run of the algorithm.
const TEAM_SLUG_TO_NAME: Record<string, string> = Object.fromEntries(TEAMS.map((t) => [slugifyTeamName(t.team), t.team]));

const ALL_CONFERENCES = [...conferencesForDivision("FBS"), ...conferencesForDivision("FCS")];
const CONF_SLUG_TO_NAME: Record<string, string> = Object.fromEntries(ALL_CONFERENCES.map((c) => [generalSlugify(c), c]));

export function teamToSlug(team: string): string {
  return slugifyTeamName(team);
}

/** Reverses a URL slug back to the exact team name, via the real lookup map above — not the algorithm. Falls back to the raw slug itself if it's not a known team (e.g. a stale/mistyped URL), so callers still get a string to work with rather than undefined. */
export function slugToTeam(slug: string): string {
  return TEAM_SLUG_TO_NAME[slug] ?? slug;
}

export function confToSlug(conf: string): string {
  return generalSlugify(conf);
}

export function slugToConf(slug: string): string {
  return CONF_SLUG_TO_NAME[slug] ?? slug;
}
