import { parseCsv } from "../csvImport";
import { matchSchoolMascotName, matchTeamName } from "../teamNameMatch";
import { fairMoneylineFromWinPct } from "../odds";
import { fetchGamesWithLines, type GameWithLines } from "./gamesLines";
import type { BetBook, BetType, BetResult, NewPlacedBet } from "./placedBets";

// Expected columns (header names are case-insensitive, order doesn't
// matter): date, book, away_team, home_team, bet_type, side, line_value,
// price, stake, to_win, result.
//
// - date: anything Date.parse can read (e.g. 2026-08-15, 8/15/2026) —
//   used only to narrow which season's games to search, not stored.
// - book: bovada | betonline | novig | kalshi (case-insensitive, "bet
//   online"/"betonlineag" all accepted).
// - away_team / home_team: any reasonably recognizable team name —
//   matched against the site's canonical roster the same way The Odds
//   API's "School Mascot" names are (see teamNameMatch.ts). A row that
//   doesn't confidently match a real scheduled game is reported as an
//   error, never silently guessed.
// - bet_type: spread | moneyline | total | team_total (ml/ou/tt accepted
//   as shorthand).
// - side: team name for spread/moneyline/team_total, over/under (o/u)
//   for total/team_total.
// - price: American odds ("-110", "+230") OR a win% ("53%", "53") —
//   percentages are converted to a fair moneyline so CLV math has one
//   consistent unit regardless of which book quoted it.
// - stake: dollars risked.
// - to_win: dollars profit if it wins — optional, blank is fine.
// - result: win | loss | push | pending — optional, defaults to pending.
export const PLACED_BETS_CSV_TEMPLATE =
  "date,book,away_team,home_team,bet_type,side,line_value,price,stake,to_win,result\n" +
  "2026-08-15,bovada,Toledo,Michigan State,spread,Toledo,10.5,-110,1,0.91,win\n";

export interface PlacedBetImportError {
  line: number;
  raw: Record<string, string>;
  reason: string;
}

export interface PlacedBetImportResult {
  resolved: NewPlacedBet[];
  errors: PlacedBetImportError[];
}

const BOOK_ALIASES: Record<string, BetBook> = {
  bovada: "bovada",
  betonline: "betonlineag",
  betonlineag: "betonlineag",
  "bet online": "betonlineag",
  novig: "novig",
  kalshi: "kalshi",
};

const BET_TYPE_ALIASES: Record<string, BetType> = {
  spread: "spread",
  ats: "spread",
  moneyline: "moneyline",
  ml: "moneyline",
  total: "total",
  ou: "total",
  "o/u": "total",
  team_total: "team_total",
  teamtotal: "team_total",
  tt: "team_total",
};

function normalizeBook(raw: string): BetBook | null {
  return BOOK_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function normalizeBetType(raw: string): BetType | null {
  return BET_TYPE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

// Accepts either American odds ("-110", "+230") or a win% ("53%", "53")
// — anything with a % sign, or a bare number under 100 with no +/- sign,
// is treated as a percentage (real American odds are never in (-100,100)
// except exactly even money, which isn't how anyone writes "+100" as a
// bare "100").
function normalizePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed);
    return Number.isNaN(pct) ? null : fairMoneylineFromWinPct(pct / 100);
  }
  const n = parseFloat(trimmed);
  if (Number.isNaN(n)) return null;
  if (!trimmed.startsWith("+") && !trimmed.startsWith("-") && Math.abs(n) < 100) {
    return fairMoneylineFromWinPct(n / 100);
  }
  return n;
}

function normalizeResult(raw: string): BetResult {
  const r = raw.trim().toLowerCase();
  if (r === "win" || r === "won" || r === "w") return "win";
  if (r === "loss" || r === "lost" || r === "l") return "loss";
  if (r === "push" || r === "p") return "push";
  return "pending";
}

function findGame(awayCanonical: string, homeCanonical: string, games: GameWithLines[], dateMs: number | null): GameWithLines | null {
  const candidates = games.filter((g) => {
    const set = new Set([g.home_team, g.away_team]);
    return set.has(awayCanonical) && set.has(homeCanonical);
  });
  if (candidates.length <= 1) return candidates[0] ?? null;
  // More than one meeting between these two teams (rare, but possible
  // across a season) — pick whichever kicked off closest to the given
  // date rather than guessing the first one found.
  if (dateMs == null) return candidates[0];
  return candidates.reduce((best, g) => {
    const gTime = g.start_date ? new Date(g.start_date).getTime() : Infinity;
    const bestTime = best.start_date ? new Date(best.start_date).getTime() : Infinity;
    return Math.abs(gTime - dateMs) < Math.abs(bestTime - dateMs) ? g : best;
  });
}

export async function parsePlacedBetsCsv(text: string): Promise<PlacedBetImportResult> {
  const rows = parseCsv(text);
  const resolved: NewPlacedBet[] = [];
  const errors: PlacedBetImportError[] = [];

  // Search the date's own year and the year before it — a game's
  // "season" is the fall it's played in, but this keeps working for a
  // January bowl/playoff game that belongs to the previous season.
  const seasonsNeeded = new Set<number>();
  const parsedDates = rows.map((r) => {
    const raw = r.date ?? r.Date ?? r.DATE ?? "";
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) {
      const y = new Date(ms).getFullYear();
      seasonsNeeded.add(y);
      seasonsNeeded.add(y - 1);
    }
    return Number.isNaN(ms) ? null : ms;
  });
  if (seasonsNeeded.size === 0) seasonsNeeded.add(new Date().getFullYear());

  const gamesBySeason = new Map<number, GameWithLines[]>();
  await Promise.all(
    Array.from(seasonsNeeded).map(async (season) => {
      gamesBySeason.set(season, await fetchGamesWithLines(season));
    })
  );
  const allCandidateGames = Array.from(gamesBySeason.values()).flat();

  rows.forEach((row, i) => {
    const lineNum = i + 2; // header is line 1
    const get = (key: string) => (row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()] ?? "").trim();

    const book = normalizeBook(get("book"));
    if (!book) {
      errors.push({ line: lineNum, raw: row, reason: `Unrecognized book "${get("book")}"` });
      return;
    }
    const betType = normalizeBetType(get("bet_type"));
    if (!betType) {
      errors.push({ line: lineNum, raw: row, reason: `Unrecognized bet_type "${get("bet_type")}"` });
      return;
    }
    const awayRaw = get("away_team");
    const homeRaw = get("home_team");
    const awayCanonical = matchSchoolMascotName(awayRaw) ?? matchTeamName(awayRaw).matched;
    const homeCanonical = matchSchoolMascotName(homeRaw) ?? matchTeamName(homeRaw).matched;
    if (!awayCanonical || !homeCanonical) {
      errors.push({
        line: lineNum,
        raw: row,
        reason: `Couldn't match team name(s): "${awayRaw}" / "${homeRaw}" — use a more complete school name`,
      });
      return;
    }

    const game = findGame(awayCanonical, homeCanonical, allCandidateGames, parsedDates[i]);
    if (!game) {
      errors.push({ line: lineNum, raw: row, reason: `No scheduled game found for ${awayCanonical} @ ${homeCanonical}` });
      return;
    }

    const priceRaw = get("price");
    const price = normalizePrice(priceRaw);
    if (price == null) {
      errors.push({ line: lineNum, raw: row, reason: `Couldn't read price "${priceRaw}"` });
      return;
    }

    let side = get("side");
    if (betType === "total") {
      const s = side.trim().toLowerCase();
      side = s.startsWith("o") ? "over" : s.startsWith("u") ? "under" : "";
      if (side === "") {
        errors.push({ line: lineNum, raw: row, reason: `Side must be over/under for a total, got "${get("side")}"` });
        return;
      }
    } else if (betType === "team_total") {
      // "<team> over" / "<team> under" — team_total needs both which
      // team of the two the total is for. Stored as "team|over" so the
      // panel can split it back out for display without a schema change.
      const m = /^(.*?)\s+(over|under|o|u)$/i.exec(side.trim());
      if (!m) {
        errors.push({ line: lineNum, raw: row, reason: `team_total side must be "<team> over" or "<team> under", got "${get("side")}"` });
        return;
      }
      const teamSide = matchSchoolMascotName(m[1]) ?? matchTeamName(m[1]).matched;
      if (!teamSide) {
        errors.push({ line: lineNum, raw: row, reason: `Couldn't match team_total team "${m[1]}"` });
        return;
      }
      side = `${teamSide}|${/^o/i.test(m[2]) ? "over" : "under"}`;
    } else {
      const teamSide = matchSchoolMascotName(side) ?? matchTeamName(side).matched;
      if (!teamSide) {
        errors.push({ line: lineNum, raw: row, reason: `Couldn't match side team "${side}"` });
        return;
      }
      side = teamSide;
    }

    const lineValueRaw = get("line_value");
    const lineValue = lineValueRaw === "" ? null : parseFloat(lineValueRaw);
    const stakeRaw = get("stake");
    const stake = stakeRaw === "" ? null : parseFloat(stakeRaw);
    const toWinRaw = get("to_win");
    const toWin = toWinRaw === "" ? null : parseFloat(toWinRaw);

    resolved.push({
      gameId: game.id,
      season: game.season,
      week: game.week,
      awayTeam: game.away_team,
      homeTeam: game.home_team,
      book,
      betType,
      side,
      lineValue: Number.isNaN(lineValue as number) ? null : lineValue,
      price,
      stake: stake != null && Number.isNaN(stake) ? null : stake,
      toWin: toWin != null && Number.isNaN(toWin) ? null : toWin,
      result: normalizeResult(get("result")),
    });
  });

  return { resolved, errors };
}
