// Read-only proxy to The Odds API (the-odds-api.com), scoped to college
// football spread/moneyline/total markets from Bovada, BetOnline, and
// Novig (plus whatever mainstream US books come along for free in the
// same call — DraftKings/FanDuel/BetMGM etc.). Proxied server-side, same
// as every other external API in this repo, so ODDS_API_KEY never ships
// to the browser and this function controls exactly when a credit-metered
// request actually fires (on page open / manual refresh only — no
// polling, per Chris wanting to stay under quota).

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
  key: "spreads" | "h2h" | "totals";
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

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!ODDS_API_KEY) {
    res.status(500).json({ error: "ODDS_API_KEY is not configured on the server" });
    return;
  }

  try {
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
