// Read-only proxy to The Odds API (the-odds-api.com) and ESPN's public
// futures API. Three modes:
//   - Default (game odds): college football spread/moneyline/total
//     markets from Bovada, BetOnline, and Novig (plus whatever
//     mainstream US books come along for free in the same call —
//     DraftKings/FanDuel/BetMGM etc.).
//   - mode=futures: the NCAAF Championship Winner outrights market — a
//     separate sport from game-level americanfootball_ncaaf, confirmed
//     via their own widget builder's sport list ("American Football:
//     NCAAF Championship Winner"), following the same naming convention
//     as americanfootball_nfl_super_bowl_winner. Its sport_key is
//     resolved dynamically from the free, non-metered /v4/sports listing
//     by matching on title, rather than hardcoding a guessed key —
//     safer if it's ever renamed (breaks loudly/empty instead of
//     silently guessing wrong).
//   - mode=espn-futures: ESPN's own futures board (national championship,
//     conference winners, awards), same public core-api.espn.com
//     endpoint the cfbfastR R package wraps (sports.core.api.espn.com/
//     v2/sports/football/leagues/college-football/seasons/{year}/
//     futures) — no API key needed, it's the same public data ESPN's own
//     site reads. Lets us compare NCAAF Championship pricing across
//     Odds API's books AND ESPN's, not just one source.
// All proxied server-side, so ODDS_API_KEY never ships to the browser
// and this function controls exactly when a credit-metered request
// fires (on page open / manual refresh only — no polling, per Chris
// wanting to stay under quota). Kept as one function (not several) to
// stay within Vercel Hobby's 12-serverless-function limit.

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Bovada, BetOnline, Novig — the three books Chris wants alongside his
// own projections. Kalshi (also requested) doesn't come through this
// feed for NCAAF at all right now (confirmed live: present for other
// exchanges like Novig, absent for Kalshi specifically), so Kalshi stays
// on its own dedicated integration (src/lib/api/kalshi.ts) and gets
// merged in client-side on the moneyline view only.
const WANTED_BOOKMAKERS = new Set(["bovada", "betonlineag", "novig"]);

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}
interface OddsApiMarket {
  key: "spreads" | "h2h" | "totals" | "outrights";
  outcomes: OddsApiOutcome[];
}
interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}
interface OddsApiGame {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}
interface OddsApiSport {
  key: string;
  title: string;
  has_outrights: boolean;
}

// TEMPORARY — one-off diagnostic to answer "does The Odds API actually
// carry team_totals for NCAAF, and how far back does historical data go."
// Docs are inconclusive per-sport, so this hits the real historical
// endpoint for one event in each of the 2024/2025 seasons and reports
// whether a team_totals market came back. Delete this function and its
// dispatch branch once that question is answered — not meant to ship.
async function handleTestTeamTotals(res: any) {
  const testDates = ["2024-11-02T18:00:00Z", "2025-11-01T18:00:00Z"];
  const results: any[] = [];

  for (const date of testDates) {
    const eventsUrl = `${ODDS_API_BASE}/historical/sports/americanfootball_ncaaf/events?apiKey=${ODDS_API_KEY}&date=${date}`;
    const eventsRes = await fetch(eventsUrl);
    if (!eventsRes.ok) {
      results.push({ date, error: `events request failed: ${eventsRes.status} ${await eventsRes.text().catch(() => "")}` });
      continue;
    }
    const eventsBody = await eventsRes.json();
    const events = eventsBody.data ?? [];
    if (events.length === 0) {
      results.push({ date, error: "no events returned for this snapshot", snapshotTimestamp: eventsBody.timestamp });
      continue;
    }
    const event = events[0];

    const oddsUrl = `${ODDS_API_BASE}/historical/sports/americanfootball_ncaaf/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=team_totals&oddsFormat=american&date=${date}`;
    const oddsRes = await fetch(oddsUrl);
    if (!oddsRes.ok) {
      results.push({ date, event: `${event.away_team} @ ${event.home_team}`, error: `odds request failed: ${oddsRes.status} ${await oddsRes.text().catch(() => "")}` });
      continue;
    }
    const oddsBody = await oddsRes.json();
    const bookmakers = oddsBody.data?.bookmakers ?? [];
    const teamTotalsBooks = bookmakers.filter((b: any) => b.markets?.some((m: any) => m.key === "team_totals"));

    results.push({
      date,
      snapshotTimestamp: oddsBody.timestamp,
      event: `${event.away_team} @ ${event.home_team}`,
      commenceTime: event.commence_time,
      bookmakersReturned: bookmakers.map((b: any) => b.key),
      teamTotalsFound: teamTotalsBooks.length > 0,
      teamTotalsSample: teamTotalsBooks[0]?.markets?.find((m: any) => m.key === "team_totals") ?? null,
    });
  }

  res.status(200).json({ results });
}

async function handleFutures(res: any) {
  const sportsRes = await fetch(`${ODDS_API_BASE}/sports/?apiKey=${ODDS_API_KEY}`);
  if (!sportsRes.ok) {
    const text = await sportsRes.text().catch(() => "");
    throw new Error(`The Odds API /sports request failed (${sportsRes.status}): ${text || sportsRes.statusText}`);
  }
  const sports = (await sportsRes.json()) as OddsApiSport[];
  const sport = sports.find((s) => s.title === "NCAAF Championship Winner" && s.has_outrights);
  if (!sport) {
    res.status(200).json({ outcomes: [], warning: "NCAAF Championship Winner sport not found in /v4/sports right now" });
    return;
  }

  const qs = new URLSearchParams({
    apiKey: ODDS_API_KEY!,
    regions: "us,us_ex",
    markets: "outrights",
    oddsFormat: "american",
  });
  const url = `${ODDS_API_BASE}/sports/${sport.key}/odds/?${qs.toString()}`;
  const upstream = await fetch(url);
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`The Odds API outrights request failed (${upstream.status}): ${text || upstream.statusText}`);
  }
  const events = (await upstream.json()) as { bookmakers: OddsApiBookmaker[] }[];

  // Outrights come back as a single "event" per bookmaker with one
  // outcome per team — flatten to {team, book, price} rows.
  const rows: { team: string; book: string; price: number }[] = [];
  for (const event of events) {
    for (const book of event.bookmakers ?? []) {
      const market = book.markets.find((m) => m.key === "outrights");
      if (!market) continue;
      for (const outcome of market.outcomes) {
        rows.push({ team: outcome.name, book: book.key, price: outcome.price });
      }
    }
  }
  res.status(200).json({ outcomes: rows });
}

const ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

interface EspnFuturesOutcome {
  team?: { $ref: string };
  athlete?: { $ref: string };
  value: string; // American odds as a string, e.g. "-400"
}
interface EspnFuturesBook {
  provider?: { id: string; name: string };
  outcomes?: EspnFuturesOutcome[];
}
interface EspnFuturesMarket {
  id: string;
  name: string;
  type?: { id: string; name: string };
  displayName: string;
  books?: EspnFuturesBook[];
}

// Parses the numeric ESPN team id out of a team $ref URL
// (".../teams/194?...") without a second network round trip — the
// client already has an id->name mapping for free via the numeric ids
// already embedded in every team's logo URL (src/data/logos.ts).
function parseEspnTeamId(ref: string | undefined): string | null {
  if (!ref) return null;
  const m = /\/teams\/(\d+)/.exec(ref);
  return m ? m[1] : null;
}

async function handleEspnFutures(res: any) {
  const season = new Date().getFullYear();
  const indexRes = await fetch(`${ESPN_CORE_BASE}/seasons/${season}/futures?lang=en&region=us`);
  if (!indexRes.ok) {
    const text = await indexRes.text().catch(() => "");
    throw new Error(`ESPN futures index request failed (${indexRes.status}): ${text || indexRes.statusText}`);
  }
  const index = await indexRes.json();
  const refs: string[] = (index.items ?? []).map((i: any) => i.$ref).filter(Boolean);

  // Cap how many markets get dereferenced — ESPN's futures board also
  // carries player awards (Heisman etc.) we don't need, and a hard cap
  // keeps one bad season from turning into 100+ requests.
  const capped = refs.slice(0, 40);
  const markets = await Promise.all(
    capped.map(async (ref) => {
      try {
        const r = await fetch(ref);
        if (!r.ok) return null;
        return (await r.json()) as EspnFuturesMarket;
      } catch {
        return null;
      }
    })
  );

  const teamMarkets = markets
    .filter((m): m is EspnFuturesMarket => m != null)
    .filter((m) => (m.books ?? []).some((b) => (b.outcomes ?? []).some((o) => o.team)))
    .map((m) => ({
      id: m.id,
      name: m.name,
      displayName: m.displayName,
      typeName: m.type?.name ?? null,
      providers: (m.books ?? []).map((b) => ({
        providerId: b.provider?.id ?? null,
        providerName: b.provider?.name ?? null,
        outcomes: (b.outcomes ?? [])
          .filter((o) => o.team)
          .map((o) => ({ espnTeamId: parseEspnTeamId(o.team?.$ref), price: parseInt(o.value, 10) }))
          .filter((o) => o.espnTeamId != null && !Number.isNaN(o.price)),
      })),
    }));

  res.status(200).json({ markets: teamMarkets });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (req.query?.mode === "espn-futures") {
      await handleEspnFutures(res);
      return;
    }

    if (!ODDS_API_KEY) {
      res.status(500).json({ error: "ODDS_API_KEY is not configured on the server" });
      return;
    }

    if (req.query?.mode === "futures") {
      await handleFutures(res);
      return;
    }

    if (req.query?.mode === "test-team-totals") {
      await handleTestTeamTotals(res);
      return;
    }

    const qs = new URLSearchParams({
      apiKey: ODDS_API_KEY,
      regions: "us,us_ex",
      markets: "spreads,h2h,totals",
      oddsFormat: "american",
      dateFormat: "iso",
    });
    const url = `${ODDS_API_BASE}/sports/americanfootball_ncaaf/odds/?${qs.toString()}`;
    const upstream = await fetch(url);
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`The Odds API request failed (${upstream.status}): ${text || upstream.statusText}`);
    }
    const remaining = upstream.headers.get("x-requests-remaining");
    const used = upstream.headers.get("x-requests-used");
    const games = (await upstream.json()) as OddsApiGame[];

    // Trim to just the books we care about, and only the fields the
    // client actually renders — the raw response also carries several
    // mainstream US books (DraftKings, FanDuel, BetMGM...) we don't show,
    // no sense shipping those bytes to the browser on every page open.
    const trimmed = games.map((g) => ({
      id: g.id,
      commenceTime: g.commence_time,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      bookmakers: g.bookmakers
        .filter((b) => WANTED_BOOKMAKERS.has(b.key))
        .map((b) => ({
          key: b.key,
          title: b.title,
          lastUpdate: b.last_update,
          markets: b.markets.map((m) => ({ key: m.key, outcomes: m.outcomes })),
        })),
    }));

    res.status(200).json({ games: trimmed, quota: { remaining, used } });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Odds feed fetch failed" });
  }
}
