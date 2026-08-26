import { useEffect, useState } from "react";
import { matchTeamName } from "./teamNameMatch";
import { moneylineToImpliedWinPct, fairMoneylineFromWinPct } from "./odds";
import { espnTeamIdToName } from "./espnTeamId";
import {
  fetchKalshiFutures,
  discoverKalshiNcaafSeries,
  KALSHI_FUTURES_SERIES,
  type KalshiFuturesEvent,
} from "./api/kalshi";
import { fetchOddsFutures, fetchEspnFutures, type EspnFuturesMarket } from "./api/oddsApi";

export interface FuturesSourcePrice {
  label: string; // "Kalshi", "Bovada", "ESPN BET", ...
  americanOdds: number | null;
  impliedProbPct: number | null; // 0-100, vig included where applicable
}
export interface FuturesOutcomeRow {
  team: string;
  sources: FuturesSourcePrice[];
  bestProbPct: number | null; // for sorting — highest confidence across sources
}
export interface FuturesMarketGroup {
  key: string;
  label: string;
  outcomes: FuturesOutcomeRow[];
}

// Kalshi quotes are yes-bid/yes-ask in dollars (0-1), i.e. a probability
// directly — same midpoint convention as the existing game-odds Kalshi
// integration (src/lib/api/kalshi.ts's impliedProb). A market with no
// trading yet (0/0) isn't a real price.
function kalshiMidProb(yesBid: number, yesAsk: number): number | null {
  if (yesBid === 0 && yesAsk === 0) return null;
  return (yesBid + yesAsk) / 2;
}

function addOutcome(byTeam: Map<string, FuturesOutcomeRow>, rawName: string, source: FuturesSourcePrice) {
  const matched = matchTeamName(rawName);
  const team = matched.matched ?? rawName;
  let row = byTeam.get(team);
  if (!row) {
    row = { team, sources: [], bestProbPct: null };
    byTeam.set(team, row);
  }
  row.sources.push(source);
  if (source.impliedProbPct != null && (row.bestProbPct == null || source.impliedProbPct > row.bestProbPct)) {
    row.bestProbPct = source.impliedProbPct;
  }
}

function finalizeGroup(key: string, label: string, byTeam: Map<string, FuturesOutcomeRow>): FuturesMarketGroup {
  const outcomes = Array.from(byTeam.values()).sort((a, b) => (b.bestProbPct ?? -1) - (a.bestProbPct ?? -1));
  return { key, label, outcomes };
}

function kalshiEventsToOutcomes(events: KalshiFuturesEvent[], byTeam: Map<string, FuturesOutcomeRow>) {
  for (const ev of events) {
    for (const o of ev.outcomes) {
      const prob = kalshiMidProb(o.yesBid, o.yesAsk);
      addOutcome(byTeam, o.name, {
        label: "Kalshi",
        americanOdds: prob != null ? fairMoneylineFromWinPct(prob) : null,
        impliedProbPct: prob != null ? prob * 100 : null,
      });
    }
  }
}

function espnMarketToOutcomes(market: EspnFuturesMarket | undefined, byTeam: Map<string, FuturesOutcomeRow>) {
  if (!market) return;
  for (const provider of market.providers) {
    for (const o of provider.outcomes) {
      const name = espnTeamIdToName(o.espnTeamId);
      if (!name) continue; // unresolvable id — skip rather than show a raw numeric id as a "team"
      const prob = moneylineToImpliedWinPct(o.price);
      addOutcome(byTeam, name, {
        label: provider.providerName ?? "ESPN",
        americanOdds: o.price,
        impliedProbPct: prob != null ? prob * 100 : null,
      });
    }
  }
}

/**
 * Loads every futures source once and builds the standard markets
 * (championship, playoff-tree qualifiers, undefeated) plus whatever
 * conference series were discovered/confirmed. Win totals are handled
 * separately (useFuturesWinTotals below) since they're a ladder per
 * team, not a single-outcome-per-team market like these.
 */
export function useFuturesMarkets() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<FuturesMarketGroup[]>([]);
  const [conferenceSeries, setConferenceSeries] = useState<{ ticker: string; label: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const [discovered, championshipKalshi, espnMarkets, oddsApiOutrights] = await Promise.all([
        discoverKalshiNcaafSeries().catch(() => []),
        fetchKalshiFutures(KALSHI_FUTURES_SERIES.championship).catch(() => []),
        fetchEspnFutures().catch(() => []),
        fetchOddsFutures().catch(() => []),
      ]);

      // Every KXNCAAF<CONF> series except the ones that aren't actually
      // a single conference's own bracket (the umbrella/meta ones).
      const NON_CONFERENCE_SERIES = new Set([
        "KXNCAAF",
        "KXNCAAFGAME",
        "KXNCAAFCONF",
        "KXNCAAFPLAYOFF",
        "KXNCAAFFINALIST",
        "KXNCAAFSF",
        "KXNCAAFQF",
        "KXNCAAFUNDEFEATED",
        "KXNCAAFWINS",
      ]);
      const discoveredConfs = discovered
        .filter((s) => !NON_CONFERENCE_SERIES.has(s.ticker))
        .map((s) => ({ ticker: s.ticker, label: s.title }));
      // Always include Big 12 even if discovery comes back empty (e.g.
      // Kalshi's /series endpoint rejects the request for some reason) —
      // it's a confirmed-working ticker from Chris's own links.
      const confList = discoveredConfs.some((c) => c.ticker === KALSHI_FUTURES_SERIES.conferenceChampion.Big12)
        ? discoveredConfs
        : [...discoveredConfs, { ticker: KALSHI_FUTURES_SERIES.conferenceChampion.Big12, label: "Big 12" }];

      const nextGroups: FuturesMarketGroup[] = [];

      // National Championship — Kalshi + Odds API + ESPN together.
      const champByTeam = new Map<string, FuturesOutcomeRow>();
      kalshiEventsToOutcomes(championshipKalshi, champByTeam);
      for (const o of oddsApiOutrights) {
        const prob = moneylineToImpliedWinPct(o.price);
        addOutcome(champByTeam, o.team, {
          label: o.book,
          americanOdds: o.price,
          impliedProbPct: prob != null ? prob * 100 : null,
        });
      }
      const champEspn = espnMarkets.find((m) => /championship/i.test(m.displayName) && !/conference/i.test(m.displayName));
      espnMarketToOutcomes(champEspn, champByTeam);
      nextGroups.push(finalizeGroup("championship", "National Championship", champByTeam));

      // Playoff-tree qualifiers — Kalshi only, one series each.
      const simple: { key: string; label: string; ticker: string }[] = [
        { key: "playoff", label: "Playoff Qualifier", ticker: KALSHI_FUTURES_SERIES.playoffQualifier },
        { key: "finalist", label: "Finalist", ticker: KALSHI_FUTURES_SERIES.finalist },
        { key: "semifinalist", label: "Semifinalist", ticker: KALSHI_FUTURES_SERIES.semifinalist },
        { key: "quarterfinalist", label: "Quarterfinalist", ticker: KALSHI_FUTURES_SERIES.quarterfinalist },
        { key: "undefeated", label: "Undefeated Regular Season", ticker: KALSHI_FUTURES_SERIES.undefeatedRegularSeason },
      ];
      for (const s of simple) {
        const events = await fetchKalshiFutures(s.ticker).catch(() => []);
        const byTeam = new Map<string, FuturesOutcomeRow>();
        kalshiEventsToOutcomes(events, byTeam);
        nextGroups.push(finalizeGroup(s.key, s.label, byTeam));
      }

      // Each conference's own championship — Kalshi + ESPN's matching
      // conference-winner market where we can find one by name.
      for (const conf of confList) {
        const events = await fetchKalshiFutures(conf.ticker).catch(() => []);
        const byTeam = new Map<string, FuturesOutcomeRow>();
        kalshiEventsToOutcomes(events, byTeam);
        const espnMatch = espnMarkets.find(
          (m) => /conference/i.test(m.displayName) && conf.label && m.displayName.toLowerCase().includes(conf.label.toLowerCase().split(" ")[0])
        );
        espnMarketToOutcomes(espnMatch, byTeam);
        if (byTeam.size > 0) {
          nextGroups.push(finalizeGroup(`conf-${conf.ticker}`, conf.label, byTeam));
        }
      }

      if (!cancelled) {
        setGroups(nextGroups);
        setConferenceSeries(confList);
        setLoading(false);
      }
    })().catch((err) => {
      if (!cancelled) {
        setError(err.message ?? "Failed to load futures");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { groups, conferenceSeries, loading, error };
}

export interface FuturesWinTotalOutcome {
  team: string;
  ladder: { threshold: string; impliedProbPct: number | null }[]; // e.g. "6+ wins" -> 62%
}

/** Win totals are a ladder per team (multiple thresholds), not one outcome per team — kept separate from useFuturesMarkets' shape. */
export function useFuturesWinTotals() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<FuturesWinTotalOutcome[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchKalshiFutures(KALSHI_FUTURES_SERIES.winTotals)
      .then((events) => {
        if (cancelled) return;
        const rows = events.map((ev) => {
          // Each event is one team; its outcomes are the win-count rungs
          // (e.g. "6 or more wins", "9 or more wins"...), already sorted
          // by Kalshi's own market order.
          const teamNameRaw = ev.outcomes[0]?.name ?? ev.eventTicker;
          const matched = matchTeamName(teamNameRaw);
          return {
            team: matched.matched ?? teamNameRaw,
            ladder: ev.outcomes.map((o) => {
              const prob = kalshiMidProb(o.yesBid, o.yesAsk);
              return { threshold: o.title ?? o.name, impliedProbPct: prob != null ? prob * 100 : null };
            }),
          };
        });
        setOutcomes(rows.sort((a, b) => a.team.localeCompare(b.team)));
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load win totals");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { outcomes, loading, error };
}
