import { supabase } from "../supabaseClient";
import { matchSchoolMascotName } from "../teamNameMatch";
import { fetchGamesWithLines, type GameWithLines } from "./gamesLines";
import { invalidateCache } from "./cache";
import type { OddsGame } from "./oddsApi";

// "Refresh Vegas lines": pulls every US sportsbook from The Odds API (one request), takes the median spread, total and
// moneylines per game across books, matches each game to its CFBD game and saves it as betting_lines provider
// "market_median" — the line every page prefers (see linePick.ts). The first median saved for a game also becomes
// its opening line and is never overwritten.

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Spreads and totals land on half points; a median of an even count can fall on a quarter, so snap to the nearest half.
const toHalf = (v: number | null) => (v == null ? null : Math.round(v * 2) / 2);

interface MedianLine {
  homeSpread: number | null;
  total: number | null;
  homeMl: number | null;
  awayMl: number | null;
  books: number;
}

function medianFor(og: OddsGame): MedianLine {
  const spreads: number[] = [];
  const totals: number[] = [];
  const homeMls: number[] = [];
  const awayMls: number[] = [];
  for (const b of og.bookmakers) {
    for (const m of b.markets) {
      if (m.key === "spreads") {
        const h = m.outcomes.find((o) => o.name === og.homeTeam);
        if (h?.point != null) spreads.push(h.point);
      } else if (m.key === "totals") {
        const o = m.outcomes.find((x) => x.name === "Over");
        if (o?.point != null) totals.push(o.point);
      } else if (m.key === "h2h") {
        const h = m.outcomes.find((o) => o.name === og.homeTeam);
        const a = m.outcomes.find((o) => o.name === og.awayTeam);
        if (h && a) {
          homeMls.push(h.price);
          awayMls.push(a.price);
        }
      }
    }
  }
  const ml = (xs: number[]) => {
    const v = median(xs);
    return v == null ? null : Math.round(v);
  };
  return { homeSpread: toHalf(median(spreads)), total: toHalf(median(totals)), homeMl: ml(homeMls), awayMl: ml(awayMls), books: og.bookmakers.length };
}

function findGame(games: GameWithLines[], a: string, b: string, kickoffMs: number | null): { game: GameWithLines; flipped: boolean } | null {
  let best: { game: GameWithLines; flipped: boolean; gap: number } | null = null;
  for (const g of games) {
    const same = g.home_team === a && g.away_team === b;
    const flipped = g.home_team === b && g.away_team === a;
    if (!same && !flipped) continue;
    const gap = kickoffMs != null && g.start_date ? Math.abs(new Date(g.start_date).getTime() - kickoffMs) : 0;
    if (gap > 36 * 3600 * 1000) continue;
    if (!best || gap < best.gap) best = { game: g, flipped, gap };
  }
  return best;
}

export interface MarketRefreshResult {
  oddsGames: number;
  matched: number;
  saved: number;
  unmatched: string[];
}

export async function refreshMarketLines(season: number): Promise<MarketRefreshResult> {
  const res = await fetch("/api/odds-feed?books=all");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Odds feed failed (${res.status})`);
  const oddsGames = (data.games ?? []) as OddsGame[];
  const games = await fetchGamesWithLines(season);

  const rows: Record<string, unknown>[] = [];
  const unmatched: string[] = [];
  for (const og of oddsGames) {
    const home = matchSchoolMascotName(og.homeTeam);
    const away = matchSchoolMascotName(og.awayTeam);
    const hit = home && away ? findGame(games, home, away, og.commenceTime ? new Date(og.commenceTime).getTime() : null) : null;
    if (!hit) {
      unmatched.push(`${og.awayTeam} @ ${og.homeTeam}`);
      continue;
    }
    if (hit.game.completed) continue;
    const m = medianFor(og);
    if (m.homeSpread == null && m.total == null && m.homeMl == null) continue;
    // The Odds API's home team is the CFBD away team for a flipped match: the home spread changes sign and the two
    // moneylines swap.
    rows.push({
      game_id: hit.game.id,
      season: hit.game.season,
      week: hit.game.week,
      spread: m.homeSpread == null ? null : hit.flipped ? -m.homeSpread : m.homeSpread,
      over_under: m.total,
      home_moneyline: hit.flipped ? m.awayMl : m.homeMl,
      away_moneyline: hit.flipped ? m.homeMl : m.awayMl,
    });
  }

  const save = await fetch("/api/admin-bets-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: sessionStorage.getItem("admin_password") ?? "", action: "saveMarketLines", rows }),
  });
  const saved = await save.json().catch(() => ({}));
  if (!save.ok) throw new Error(saved.error ?? `Saving lines failed (${save.status})`);
  invalidateCache();
  return { oddsGames: oddsGames.length, matched: rows.length, saved: saved.saved ?? rows.length, unmatched };
}

/** When Refresh Vegas lines last saved anything this season (null if never). */
export async function fetchMarketLinesUpdatedAt(season: number): Promise<string | null> {
  const { data, error } = await supabase
    .from("betting_lines")
    .select("pulled_at")
    .eq("season", season)
    .eq("provider", "market_median")
    .order("pulled_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as { pulled_at: string } | undefined)?.pulled_at ?? null;
}
