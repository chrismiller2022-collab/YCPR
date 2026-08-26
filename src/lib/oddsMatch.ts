import { matchSchoolMascotName } from "./teamNameMatch";
import { fairMoneylineFromWinPct } from "./odds";
import type { OddsGame, OddsBookmaker } from "./api/oddsApi";
import type { KalshiGame } from "./api/kalshi";
import type { EnrichedGameRow } from "./gameTotalsEngine";

export interface BookOdds {
  spreadHome: number | null;
  spreadHomePrice: number | null;
  spreadAway: number | null;
  spreadAwayPrice: number | null;
  mlHome: number | null;
  mlAway: number | null;
  totalPoint: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

const EMPTY_BOOK_ODDS: BookOdds = {
  spreadHome: null,
  spreadHomePrice: null,
  spreadAway: null,
  spreadAwayPrice: null,
  mlHome: null,
  mlAway: null,
  totalPoint: null,
  overPrice: null,
  underPrice: null,
};

// The Odds API gives outcome names as the literal home_team/away_team
// strings from that same game object, so an exact match is enough here —
// no fuzzy matching needed (that's only for lining a game up against our
// own roster, done once per game, not per outcome).
function parseBookmaker(b: OddsBookmaker, homeTeam: string, awayTeam: string): BookOdds {
  const odds: BookOdds = { ...EMPTY_BOOK_ODDS };
  for (const m of b.markets) {
    if (m.key === "spreads") {
      for (const o of m.outcomes) {
        if (o.name === homeTeam) {
          odds.spreadHome = o.point ?? null;
          odds.spreadHomePrice = o.price ?? null;
        } else if (o.name === awayTeam) {
          odds.spreadAway = o.point ?? null;
          odds.spreadAwayPrice = o.price ?? null;
        }
      }
    } else if (m.key === "h2h") {
      for (const o of m.outcomes) {
        if (o.name === homeTeam) odds.mlHome = o.price ?? null;
        else if (o.name === awayTeam) odds.mlAway = o.price ?? null;
      }
    } else if (m.key === "totals") {
      for (const o of m.outcomes) {
        if (o.name === "Over") {
          odds.totalPoint = o.point ?? odds.totalPoint;
          odds.overPrice = o.price ?? null;
        } else if (o.name === "Under") {
          odds.totalPoint = o.point ?? odds.totalPoint;
          odds.underPrice = o.price ?? null;
        }
      }
    }
  }
  return odds;
}

export interface OddsMatchRow {
  game: EnrichedGameRow;
  commenceTime: string | null;
  books: Partial<Record<string, BookOdds>>; // keyed by bookmaker key: "novig" | "betonlineag" | "bovada" | "kalshi"
}

function findSiteGame(
  siteGames: EnrichedGameRow[],
  teamA: string,
  teamB: string,
  kickoffMs: number | null
): EnrichedGameRow | undefined {
  return siteGames.find((g) => {
    const teams = new Set([g.game.homeTeam, g.game.awayTeam]);
    if (!teams.has(teamA) || !teams.has(teamB)) return false;
    if (kickoffMs == null || !g.game.startDate) return true;
    const diffDays = Math.abs(new Date(g.game.startDate).getTime() - kickoffMs) / 86400000;
    return diffDays <= 3;
  });
}

/**
 * Matches The Odds API's games onto our own season, and merges in Kalshi
 * (fetched separately — it doesn't come through The Odds API for NCAAF)
 * on the moneyline side only, since Kalshi has no spread/total product.
 * Games that fail to line up with anything in our own schedule (small
 * schools we don't track, name-matching misses) are dropped rather than
 * guessed at, same policy as the standalone Kalshi page.
 */
export function matchOddsGames(oddsGames: OddsGame[], kalshiGames: KalshiGame[], siteGames: EnrichedGameRow[]): OddsMatchRow[] {
  const rowByGameId = new Map<string, OddsMatchRow>();

  for (const og of oddsGames) {
    const homeMatch = matchSchoolMascotName(og.homeTeam);
    const awayMatch = matchSchoolMascotName(og.awayTeam);
    if (!homeMatch || !awayMatch) continue;
    const kickoffMs = og.commenceTime ? new Date(og.commenceTime).getTime() : null;
    const site = findSiteGame(siteGames, homeMatch, awayMatch, kickoffMs);
    if (!site) continue;

    const homeIsA = homeMatch === site.game.homeTeam;
    const canonicalHome = homeIsA ? homeMatch : awayMatch;
    const canonicalAway = homeIsA ? awayMatch : homeMatch;

    const books: Partial<Record<string, BookOdds>> = {};
    for (const b of og.bookmakers) {
      books[b.key] = parseBookmaker(b, og.homeTeam, og.awayTeam);
    }
    // parseBookmaker matched against og.homeTeam/og.awayTeam (The Odds
    // API's own labels) — if our site's home/away are swapped relative to
    // that (rare, but neutral-site or data-entry mismatches happen), flip
    // every book's home/away fields so "home" always means our site's home.
    if (!homeIsA) {
      for (const key of Object.keys(books)) {
        const o = books[key]!;
        books[key] = {
          spreadHome: o.spreadAway,
          spreadHomePrice: o.spreadAwayPrice,
          spreadAway: o.spreadHome,
          spreadAwayPrice: o.spreadHomePrice,
          mlHome: o.mlAway,
          mlAway: o.mlHome,
          totalPoint: o.totalPoint,
          overPrice: o.overPrice,
          underPrice: o.underPrice,
        };
      }
    }

    rowByGameId.set(site.game.id, { game: site, commenceTime: og.commenceTime, books });
  }

  for (const kg of kalshiGames) {
    const teamAMatch = matchSchoolMascotName(kg.teamA.name);
    const teamBMatch = matchSchoolMascotName(kg.teamB.name);
    if (!teamAMatch || !teamBMatch) continue;
    const kickoffMs = kg.kickoff ? new Date(kg.kickoff).getTime() : null;
    const site = findSiteGame(siteGames, teamAMatch, teamBMatch, kickoffMs);
    if (!site) continue;

    const aIsHome = teamAMatch === site.game.homeTeam;
    const homeProb = aIsHome ? kg.teamAProb : kg.teamBProb;
    const awayProb = aIsHome ? kg.teamBProb : kg.teamAProb;
    const kalshiOdds: BookOdds = {
      ...EMPTY_BOOK_ODDS,
      mlHome: homeProb != null ? fairMoneylineFromWinPct(homeProb) : null,
      mlAway: awayProb != null ? fairMoneylineFromWinPct(awayProb) : null,
    };

    const existing = rowByGameId.get(site.game.id);
    if (existing) {
      existing.books["kalshi"] = kalshiOdds;
    } else {
      rowByGameId.set(site.game.id, { game: site, commenceTime: kg.kickoff, books: { kalshi: kalshiOdds } });
    }
  }

  return Array.from(rowByGameId.values());
}
