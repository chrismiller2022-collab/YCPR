// Fuzzy team-name matching for the multi-rating-system pulls — the
// published Google Sheet, the McIllece CSV, and the Massey CSV each use
// their own slightly different team naming (Texas St vs Texas State, Miami
// FL vs Miami, San Jose State vs San José State, UConn vs Connecticut,
// etc). This maps any of those onto this site's canonical TEAMS_BY_NAME
// keys, falling back to a normalized/alias match, then a nearest-match
// suggestion — never a silent guess past that point. Callers should show
// unmatched names to the admin for manual review (same pattern as Monte
// Carlo's unmatchedTeams handling).

import { TEAMS, TEAMS_BY_NAME } from "../data/teams";

// Hand-maintained aliases for names that show up across these specific
// sources and don't normalize cleanly on their own. Keyed by normalized
// form (see normalize()) -> canonical team name from data/teams.ts.
const ALIASES: Record<string, string> = {
  "ohio st": "Ohio State",
  "penn st": "Penn State",
  "miami fl": "Miami",
  "iowa st": "Iowa State",
  "texas st": "Texas State",
  "texas tech": "Texas Tech",
  "kansas st": "Kansas State",
  "arizona st": "Arizona State",
  "michigan st": "Michigan State",
  "mississippi st": "Mississippi State",
  "mississippi": "Ole Miss",
  "ole miss": "Ole Miss",
  "boise st": "Boise State",
  "fresno st": "Fresno State",
  "san diego st": "San Diego State",
  "sam houston st": "Sam Houston",
  "utah st": "Utah State",
  "washington st": "Washington State",
  "oregon st": "Oregon State",
  "colorado st": "Colorado State",
  "oklahoma st": "Oklahoma State",
  "florida st": "Florida State",
  "new mexico st": "New Mexico State",
  "jacksonville st": "Jacksonville State",
  "georgia st": "Georgia State",
  "kennesaw st": "Kennesaw State",
  "kennesaw": "Kennesaw State",
  "ga southern": "Georgia Southern",
  "app state": "App State",
  "appalachian st": "App State",
  "appalachian state": "App State",
  "coastal car": "Coastal Carolina",
  "cent michigan": "Central Michigan",
  "c michigan": "Central Michigan",
  "e michigan": "Eastern Michigan",
  "w michigan": "Western Michigan",
  "wku": "Western Kentucky",
  "mtsu": "Middle Tennessee",
  "middle tenn": "Middle Tennessee",
  "ul monroe": "UL Monroe",
  "louisiana monroe": "UL Monroe",
  "ulm": "UL Monroe",
  "louisiana": "Louisiana",
  "ul lafayette": "Louisiana",
  "fl atlantic": "Florida Atlantic",
  "florida intl": "Florida International",
  "florida international": "Florida International",
  "fiu": "Florida International",
  "san jose st": "San José State",
  "san josé st": "San José State",
  "san jose state": "San José State",
  "uconn": "UConn",
  "connecticut": "UConn",
  "hawaii": "Hawai'i",
  "hawai i": "Hawai'i",
  "utsa": "UTSA",
  "ut san antonio": "UTSA",
  "utep": "UTEP",
  "unlv": "UNLV",
  "ul monroe warhawks": "UL Monroe",
  "n illinois": "Northern Illinois",
  "n dakota st": "North Dakota State",
  "north dakota st": "North Dakota State",
  "s dakota st": "South Dakota State",
  "south dakota st": "South Dakota State",
  "e carolina": "East Carolina",
  "s florida": "South Florida",
  "south fl": "South Florida",
  "usf": "South Florida",
  "ucf": "UCF",
  "central florida": "UCF",
  "byu": "BYU",
  "smu": "SMU",
  "tcu": "TCU",
  "lsu": "LSU",
  "usc": "USC",
  "ucla": "UCLA",
  "nc state": "NC State",
  "n carolina": "North Carolina",
  "unc": "North Carolina",
  "virginia tech": "Virginia Tech",
  "vt": "Virginia Tech",
  "ga tech": "Georgia Tech",
  "georgia tech": "Georgia Tech",
  "old dominion": "Old Dominion",
  "fau": "Florida Atlantic",
  "james madison": "James Madison",
  "jmu": "James Madison",
  "n texas": "North Texas",
  "north texas": "North Texas",
  "s alabama": "South Alabama",
  "south alabama": "South Alabama",
  "arkansas st": "Arkansas State",
  "sacramento st": "Sacramento State",
  "cs sacramento": "Sacramento State",
  "sac state": "Sacramento State",
  "montana st": "Montana State",
  "n dakota": "North Dakota",
  "north dakota": "North Dakota",
  "s dakota": "South Dakota",
  "south dakota": "South Dakota",
  "s illinois": "Southern Illinois",
  "southern illinois": "Southern Illinois",
  "illinois st": "Illinois State",
  "tarleton st": "Tarleton State",
  "abilene chr": "Abilene Christian",
  "sf austin": "Stephen F. Austin",
  "stephen f austin": "Stephen F. Austin",
  "uc davis": "UC Davis",
  "uab": "UAB",
  "gardner webb": "Gardner-Webb",
  "monmouth nj": "Monmouth",
  "w carolina": "Western Carolina",
  "cal poly": "Cal Poly",
  "cent arkansas": "Central Arkansas",
  "central conn": "Central Connecticut",
  "ccsu": "Central Connecticut",
  "e kentucky": "Eastern Kentucky",
  "e washington": "Eastern Washington",
  "tn martin": "UT Martin",
  "ut martin": "UT Martin",
  "n arizona": "Northern Arizona",
  "northern arizona": "Northern Arizona",
  "e illinois": "Eastern Illinois",
  "w illinois": "Western Illinois",
  "st thomas mn": "St. Thomas (MN)",
  "st thomas": "St. Thomas (MN)",
  "n colorado": "Northern Colorado",
  "northern colorado": "Northern Colorado",
  "se missouri st": "Southeast Missouri State",
  "se louisiana": "SE Louisiana",
  "charleston so": "Charleston Southern",
  "west florida": "West Florida",
  "east texas a&m": "East Texas A&M",
  "prairie view": "Prairie View A&M",
  "prairie view a&m": "Prairie View A&M",
  "nc central": "North Carolina Central",
  "north carolina central": "North Carolina Central",
  "nc a&t": "North Carolina A&T",
  "north carolina a&t": "North Carolina A&T",
  "tx southern": "Texas Southern",
  "texas southern": "Texas Southern",
  "alabama a&m": "Alabama A&M",
  "ark pine bluff": "Arkansas-Pine Bluff",
  "arkansas pine bluff": "Arkansas-Pine Bluff",
  "houston chr": "Houston Christian",
  "houston christian": "Houston Christian",
  "ms valley st": "Mississippi Valley State",
  "mississippi valley st": "Mississippi Valley State",
  "miss valley state": "Mississippi Valley State",
  "liu post": "Long Island University",
  "liu": "Long Island University",
  "long island university": "Long Island University",
  "sacred heart": "Sacred Heart",
  "chicago st": "Chicago State",
  "utrgv": "UT Rio Grande Valley",
  "ut rio grande valley": "UT Rio Grande Valley",
  "suny albany": "UAlbany",
  "albany": "UAlbany",
  "citadel": "The Citadel",
  "the citadel": "The Citadel",
  "william & mary": "William & Mary",
  "william and mary": "William & Mary",
  "penn": "Pennsylvania",
  "pennsylvania": "Pennsylvania",
  "mcneese st": "McNeese",
  "mcneese": "McNeese",
  "nicholls st": "Nicholls",
  "nicholls": "Nicholls",
};

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (José -> Jose)
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[&]/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

// Reverse index: normalized canonical name -> canonical name, so an exact
// (post-normalization) match against the real roster works even without an
// explicit alias entry.
const NORMALIZED_CANONICAL: Record<string, string> = Object.fromEntries(
  TEAMS.map((t) => [normalize(t.team), t.team])
);

// General abbreviation expansion — covers the many "X St" / "N/S/E/W/C
// ___" school names without hand-listing every single one in ALIASES.
// Trailing "st" -> "state" (Ohio St -> Ohio State); leading direction
// initials -> full word (N Illinois -> North Illinois, C Michigan ->
// Central Michigan). Only applied as a fallback after exact/alias checks.
function expandAbbrevs(norm: string): string {
  const words = norm.split(" ");
  return words
    .map((w, i) => {
      if (i === words.length - 1 && w === "st") return "state";
      if (i === 0 && w === "n") return "north";
      if (i === 0 && w === "s") return "south";
      if (i === 0 && w === "e") return "east";
      if (i === 0 && w === "w") return "west";
      if (i === 0 && w === "c") return "central";
      return w;
    })
    .join(" ");
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export interface TeamMatchResult {
  input: string;
  matched: string | null; // canonical team name, or null if nothing close enough
  confidence: "exact" | "alias" | "fuzzy" | "none";
}

/** Best-effort match of an external source's team name onto this site's canonical roster. */
export function matchTeamName(input: string): TeamMatchResult {
  if (TEAMS_BY_NAME[input]) return { input, matched: input, confidence: "exact" };

  const norm = normalize(input);
  if (ALIASES[norm]) return { input, matched: ALIASES[norm], confidence: "alias" };
  if (NORMALIZED_CANONICAL[norm]) return { input, matched: NORMALIZED_CANONICAL[norm], confidence: "exact" };

  const expanded = expandAbbrevs(norm);
  if (expanded !== norm) {
    if (ALIASES[expanded]) return { input, matched: ALIASES[expanded], confidence: "alias" };
    if (NORMALIZED_CANONICAL[expanded]) return { input, matched: NORMALIZED_CANONICAL[expanded], confidence: "alias" };
  }

  // Fuzzy fallback — nearest canonical name by edit distance, only accepted
  // if it's close relative to the name's length (avoids matching two
  // short, unrelated names that happen to differ by 1-2 characters).
  let best: { team: string; dist: number } | null = null;
  for (const t of TEAMS) {
    const d = levenshtein(norm, normalize(t.team));
    if (best == null || d < best.dist) best = { team: t.team, dist: d };
  }
  if (best && best.dist <= Math.max(2, Math.floor(norm.length * 0.2))) {
    return { input, matched: best.team, confidence: "fuzzy" };
  }
  return { input, matched: null, confidence: "none" };
}

export interface BulkMatchResult<T> {
  matched: { row: T; team: string; confidence: "exact" | "alias" | "fuzzy" }[];
  unmatched: T[];
}

/** Matches a batch of external rows against the canonical roster, given a way to pull the raw name out of each row. */
export function matchTeamRows<T>(rows: T[], nameOf: (row: T) => string): BulkMatchResult<T> {
  const matched: BulkMatchResult<T>["matched"] = [];
  const unmatched: T[] = [];
  for (const row of rows) {
    const result = matchTeamName(nameOf(row));
    if (result.matched) matched.push({ row, team: result.matched, confidence: result.confidence as any });
    else unmatched.push(row);
  }
  return { matched, unmatched };
}
