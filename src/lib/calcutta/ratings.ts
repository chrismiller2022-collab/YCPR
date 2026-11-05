import { NFL_TEAMS } from "../../data/nflTeams";

// Turns pasted power ratings into { team → rating }. Built for the composite
// table format (rank, team, composite, std dev, then each source with its
// rank in parentheses), but tolerant of anything with a team name or
// abbreviation followed by a number:
//   "1 Los Angeles Rams 5.5 1.1 3.8 (5) 5.7 (1) …"   → LAR 5.5, sd 1.1
//   "LAR, 5.5"  ·  "Rams\t5.5"  ·  "49ers -1.5"
// The FIRST number after the team is the rating; the second (if it looks
// like a std dev, 0–6) is kept as source disagreement.

export interface ParsedRating {
  abbr: string;
  rating: number;
  sd: number | null;
  line: number;
}

export interface ParseResult {
  ratings: Record<string, ParsedRating>;
  unmatched: { line: number; text: string }[];
  duplicates: string[];
}

const NICK_ALIASES: Record<string, string[]> = {
  WSH: ["WAS", "Washington", "Commanders"],
  JAX: ["JAC"],
  LAR: ["LA Rams"],
  LAC: ["LA Chargers"],
  LV: ["LVR", "OAK", "Las Vegas"],
  SF: ["SFO", "Niners", "Forty Niners"],
  NE: ["NWE"],
  NO: ["NOR"],
  GB: ["GNB"],
  KC: ["KAN"],
  TB: ["TAM"],
  NYG: ["NY Giants"],
  NYJ: ["NY Jets"],
};

interface Matcher {
  abbr: string;
  re: RegExp;
  len: number;
}

const MATCHERS: Matcher[] = (() => {
  const out: Matcher[] = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const t of NFL_TEAMS) {
    const nick = t.name.split(" ").slice(-1)[0];
    const names = [t.name, nick, ...(NICK_ALIASES[t.abbr] ?? [])];
    for (const n of names) out.push({ abbr: t.abbr, re: new RegExp(`(^|[^A-Za-z0-9])${esc(n)}(?![A-Za-z])`, "i"), len: n.length });
    // Abbreviations only match as a standalone, case-sensitive token.
    out.push({ abbr: t.abbr, re: new RegExp(`(^|[^A-Za-z])${t.abbr}(?![A-Za-z])`), len: t.abbr.length });
  }
  return out.sort((a, b) => b.len - a.len);
})();

const NUM = /[-+−–]?\d+(?:\.\d+)?/g;

export function parseRatings(text: string): ParseResult {
  const ratings: Record<string, ParsedRating> = {};
  const unmatched: ParseResult["unmatched"] = [];
  const duplicates: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let hit: { abbr: string; end: number } | null = null;
    for (const m of MATCHERS) {
      const r = m.re.exec(line);
      if (r) {
        hit = { abbr: m.abbr, end: r.index + r[0].length };
        break;
      }
    }
    const nums = (hit ? line.slice(hit.end) : "").match(NUM)?.map((n) => Number(n.replace(/[−–]/, "-"))) ?? [];
    if (!hit || nums.length === 0) {
      if (/\d/.test(line) && !/^(rank|week|team|table|data|based|source|\d+\s*a combination)/i.test(line)) unmatched.push({ line: i + 1, text: line });
      return;
    }
    if (ratings[hit.abbr]) duplicates.push(hit.abbr);
    const sd = nums.length > 1 && nums[1] >= 0 && nums[1] <= 6 ? nums[1] : null;
    ratings[hit.abbr] = { abbr: hit.abbr, rating: nums[0], sd, line: i + 1 };
  });
  return { ratings, unmatched, duplicates };
}

/** Prompt for turning a screenshot of a ratings table into paste-ready text with any Claude chat. */
export const RATINGS_IMAGE_PROMPT = `Transcribe this NFL power ratings table into plain text, one team per line, in this exact format and nothing else:
<rank> <full team name> <composite> <std dev>
Example: 1 Los Angeles Rams 5.5 1.1
Use the Composite and Std Dev columns only, keep minus signs, include all 32 teams in table order.`;
