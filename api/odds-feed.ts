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
//   - mode=team-totals-events: the free, non-metered upcoming-events list
//     (id/team names/kickoff only, no odds) — used to match Odds API's
//     "School Mascot" naming against this site's own game list BEFORE
//     spending any credits, so mode=team-totals below only ever gets
//     asked for events we actually need.
//   - mode=team-totals&eventIds=a,b,c: the team_totals ("Additional
//     Markets") data for specific events, fetched one at a time per The
//     Odds API's own requirement — costs 1 credit per event per region,
//     so the caller (useAutoSyncTeamTotals) is expected to have already
//     narrowed eventIds down via team-totals-events first, not fetch
//     every upcoming game. Team-name matching to this site's canonical
//     roster happens client-side (teamNameMatch.ts) rather than here —
//     api/ functions aren't part of the src/ TypeScript program and no
//     other function here imports across that boundary, so this keeps
//     that precedent rather than being the first to break it.
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

interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

// Free, non-metered — the "index" of upcoming events with no odds
// attached, purely so the client can figure out which event ids it
// actually needs before spending any team_totals credits on them.
async function handleTeamTotalsEvents(res: any) {
  const url = `${ODDS_API_BASE}/sports/americanfootball_ncaaf/events?apiKey=${ODDS_API_KEY}`;
  const upstream = await fetch(url);
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`The Odds API events request failed (${upstream.status}): ${text || upstream.statusText}`);
  }
  const events = (await upstream.json()) as OddsApiEvent[];
  res.status(200).json({
    events: events.map((e) => ({ id: e.id, homeTeam: e.home_team, awayTeam: e.away_team, commenceTime: e.commence_time })),
  });
}

// Metered — 1 credit per event per region (team_totals is an "additional
// market," fetched one event at a time per The Odds API's own design,
// not batchable like spreads/h2h/totals above). Caller is expected to
// have already trimmed eventIds down via mode=team-totals-events.
const MAX_TEAM_TOTALS_EVENTS = 90; // a full FBS+FCS week is ~100-110 games; this is a hard stop against a caller bug turning into a runaway bill, not a real week-size cap
async function handleTeamTotals(req: any, res: any) {
  const raw = typeof req.query?.eventIds === "string" ? req.query.eventIds : "";
  const eventIds = raw
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_TEAM_TOTALS_EVENTS);
  if (eventIds.length === 0) {
    res.status(400).json({ error: "eventIds is required (comma-separated The Odds API event ids)" });
    return;
  }

  const results = await Promise.all(
    eventIds.map(async (eventId: string) => {
      const url = `${ODDS_API_BASE}/sports/americanfootball_ncaaf/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=team_totals&oddsFormat=american`;
      const r = await fetch(url);
      if (!r.ok) return { eventId, error: `${r.status} ${await r.text().catch(() => "")}` };
      const body = await r.json();
      const bookmakers = (body.bookmakers ?? []) as OddsApiBookmaker[];
      // Prefer whichever wanted book has it, else take whatever's there —
      // team_totals isn't consistently on Bovada/BetOnline/Novig (this
      // site's usual three) for NCAAF, confirmed live 2026-09-04: only
      // FanDuel carried it in a spot check, so this can't insist on the
      // same WANTED_BOOKMAKERS set the featured-markets fetch above uses.
      const book =
        bookmakers.find((b) => WANTED_BOOKMAKERS.has(b.key) && b.markets.some((m) => m.key === "team_totals")) ??
        bookmakers.find((b) => b.markets.some((m) => m.key === "team_totals"));
      const market = book?.markets.find((m) => m.key === "team_totals");
      if (!market) return { eventId, homeTeam: body.home_team, awayTeam: body.away_team, teams: [] };

      // Outcomes come as {name: "Over"|"Under", description: "<team name>",
      // point, price} — one Over and one Under per team, same point.
      const byTeam = new Map<string, { point: number; overPrice: number | null; underPrice: number | null }>();
      for (const o of market.outcomes as any[]) {
        const team = o.description as string;
        const entry = byTeam.get(team) ?? { point: o.point, overPrice: null, underPrice: null };
        entry.point = o.point;
        if (o.name === "Over") entry.overPrice = o.price;
        if (o.name === "Under") entry.underPrice = o.price;
        byTeam.set(team, entry);
      }

      return {
        eventId,
        homeTeam: body.home_team,
        awayTeam: body.away_team,
        provider: book?.key ?? null,
        teams: Array.from(byTeam.entries()).map(([team, v]) => ({ team, ...v })),
      };
    })
  );

  res.status(200).json({ results });
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

    if (req.query?.mode === "team-totals-events") {
      await handleTeamTotalsEvents(res);
      return;
    }

    if (req.query?.mode === "team-totals") {
      await handleTeamTotals(req, res);
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
