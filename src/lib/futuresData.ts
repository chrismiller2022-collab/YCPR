import { useEffect, useState } from "react";
import { matchTeamName } from "./teamNameMatch";
import { moneylineToImpliedWinPct, fairMoneylineFromWinPct, fairYesNoPct } from "./odds";
import { espnTeamIdToName } from "./espnTeamId";
import { fetchMonteCarloRuns, fetchMonteCarloRun } from "./api/monteCarlo";
import { undefeatedPct, winsAtLeastPct, type TeamSimResult } from "./montecarlo/engine";
import {
  fetchKalshiFutures,
  discoverKalshiNcaafSeries,
  KALSHI_FUTURES_SERIES,
  type KalshiFuturesEvent,
} from "./api/kalshi";
import { fetchOddsFutures, fetchEspnFutures, type EspnFuturesMarket } from "./api/oddsApi";

// ---------------------------------------------------------------------
// Our own fair price, from the most recently saved Monte Carlo run —
// same run/fields PmAdminPanel's Prediction Markets tool already uses,
// so this stays consistent with that page rather than a second
// definition of "our fair price."
// ---------------------------------------------------------------------
export function useLatestMonteCarloRun(season: number) {
  const [results, setResults] = useState<TeamSimResult[] | null>(null);
  const [numTrials, setNumTrials] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMonteCarloRuns(season)
      .then(async (runs) => {
        if (runs.length === 0) {
          if (!cancelled) {
            setResults(null);
            setLoading(false);
          }
          return;
        }
        const run = await fetchMonteCarloRun(runs[0].id);
        if (!cancelled) {
          setResults(run?.results ?? null);
          setNumTrials(run?.num_trials ?? 0);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  return { results, numTrials, loading };
}

// Maps each simple (non-win-total, non-conference) futures market key to
// the matching TeamSimResult field from the latest Monte Carlo run.
function myFairPctFor(marketKey: string, r: TeamSimResult, numTrials: number): number | null {
  switch (marketKey) {
    case "championship":
      return r.nattyPct ?? null;
    case "playoff":
      return r.playoffPct ?? null;
    case "finalist":
      return r.nattyGamePct ?? null;
    case "semifinalist":
      return r.semifinalPct ?? null;
    case "quarterfinalist":
      return r.quarterfinalPct ?? null;
    case "undefeated":
      return undefeatedPct(r, numTrials);
    default:
      if (marketKey.startsWith("conf-")) return r.confTitlePct ?? null;
      return null;
  }
}

export interface FuturesSourcePrice {
  label: string; // "FanDuel", "ESPN BET", ...
  americanOdds: number | null;
  impliedProbPct: number | null;
}
export interface FuturesOutcomeRow {
  team: string;
  myYesPct: number | null;
  myNoPct: number | null;
  kalshiYesPct: number | null;
  kalshiNoPct: number | null;
  valuePct: number | null; // myYesPct - kalshiYesPct, in percentage points. Positive = buying Yes has an edge; negative = buying No does.
  otherSources: FuturesSourcePrice[]; // bookmaker American-odds columns, where this market has any (championship/conference only)
  bestProbPct: number | null; // highest confidence across every source, for default sort
}
export interface FuturesMarketGroup {
  key: string;
  label: string;
  outcomes: FuturesOutcomeRow[];
  hasBookmakers: boolean;
}

// Kalshi quotes are yes-bid/yes-ask in dollars (0-1), i.e. a probability
// directly — same midpoint convention as the existing game-odds Kalshi
// integration (src/lib/api/kalshi.ts's impliedProb). A market with no
// trading yet (0/0) isn't a real price.
function kalshiMidProb(yesBid: number, yesAsk: number): number | null {
  if (yesBid === 0 && yesAsk === 0) return null;
  return (yesBid + yesAsk) / 2;
}

function buildRow(
  team: string,
  myPct: number | null,
  kalshiPct: number | null,
  otherSources: FuturesSourcePrice[]
): FuturesOutcomeRow {
  const myYn = fairYesNoPct(myPct);
  const kalshiYn = fairYesNoPct(kalshiPct);
  const value = myYn && kalshiYn ? myYn.yes - kalshiYn.yes : null;
  const probs = [myYn?.yes, kalshiYn?.yes, ...otherSources.map((s) => s.impliedProbPct ?? undefined)].filter(
    (v): v is number => v != null
  );
  return {
    team,
    myYesPct: myYn?.yes ?? null,
    myNoPct: myYn?.no ?? null,
    kalshiYesPct: kalshiYn?.yes ?? null,
    kalshiNoPct: kalshiYn?.no ?? null,
    valuePct: value,
    otherSources,
    bestProbPct: probs.length > 0 ? Math.max(...probs) : null,
  };
}

function espnMarketOutcomes(market: EspnFuturesMarket | undefined): Map<string, FuturesSourcePrice[]> {
  const byTeam = new Map<string, FuturesSourcePrice[]>();
  if (!market) return byTeam;
  for (const provider of market.providers) {
    for (const o of provider.outcomes) {
      const name = espnTeamIdToName(o.espnTeamId);
      if (!name) continue;
      const matched = matchTeamName(name).matched ?? name;
      const prob = moneylineToImpliedWinPct(o.price);
      const list = byTeam.get(matched) ?? [];
      list.push({ label: provider.providerName ?? "ESPN", americanOdds: o.price, impliedProbPct: prob != null ? prob * 100 : null });
      byTeam.set(matched, list);
    }
  }
  return byTeam;
}

/**
 * Loads every futures source once and builds the standard markets
 * (championship, playoff-tree qualifiers, undefeated) plus whatever
 * conference series were discovered/confirmed, each row carrying our
 * own Monte-Carlo-derived fair Yes/No alongside Kalshi's and any
 * bookmakers available for that market. Win totals are handled
 * separately (useFuturesWinTotals below) since they're a ladder per
 * team, not a single-outcome-per-team market like these.
 */
export function useFuturesMarkets(season: number) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<FuturesMarketGroup[]>([]);
  const { results: mcResults, numTrials: mcNumTrials, loading: mcLoading } = useLatestMonteCarloRun(season);

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
      const confList = discoveredConfs.some((c) => c.ticker === KALSHI_FUTURES_SERIES.conferenceChampion.Big12)
        ? discoveredConfs
        : [...discoveredConfs, { ticker: KALSHI_FUTURES_SERIES.conferenceChampion.Big12, label: "Big 12" }];

      const mcByTeam = new Map<string, TeamSimResult>();
      for (const r of mcResults ?? []) mcByTeam.set(r.team, r);

      function buildGroup(key: string, label: string, kalshiByTeam: Map<string, number>, otherByTeam: Map<string, FuturesSourcePrice[]>) {
        const teams = new Set([...kalshiByTeam.keys(), ...otherByTeam.keys()]);
        for (const r of mcByTeam.values()) {
          const mine = myFairPctFor(key, r, mcNumTrials);
          if (mine != null && mine > 0.05) teams.add(r.team);
        }
        const outcomes = Array.from(teams).map((team) => {
          const mc = mcByTeam.get(team);
          const myPct = mc ? myFairPctFor(key, mc, mcNumTrials) : null;
          return buildRow(team, myPct, kalshiByTeam.get(team) ?? null, otherByTeam.get(team) ?? []);
        });
        outcomes.sort((a, b) => (b.bestProbPct ?? -1) - (a.bestProbPct ?? -1));
        return { key, label, outcomes, hasBookmakers: otherByTeam.size > 0 };
      }

      function kalshiEventsToProbByTeam(events: KalshiFuturesEvent[]): Map<string, number> {
        const map = new Map<string, number>();
        for (const ev of events) {
          for (const o of ev.outcomes) {
            const prob = kalshiMidProb(o.yesBid, o.yesAsk);
            if (prob == null) continue;
            const team = matchTeamName(o.name).matched ?? o.name;
            map.set(team, prob * 100);
          }
        }
        return map;
      }

      const nextGroups: FuturesMarketGroup[] = [];

      // National Championship — Kalshi + Odds API bookmakers + ESPN.
      const champKalshi = kalshiEventsToProbByTeam(championshipKalshi);
      const champOther = new Map<string, FuturesSourcePrice[]>();
      for (const o of oddsApiOutrights) {
        const team = matchTeamName(o.team).matched ?? o.team;
        const prob = moneylineToImpliedWinPct(o.price);
        const list = champOther.get(team) ?? [];
        list.push({ label: o.book, americanOdds: o.price, impliedProbPct: prob != null ? prob * 100 : null });
        champOther.set(team, list);
      }
      const champEspn = espnMarkets.find((m) => /championship/i.test(m.displayName) && !/conference/i.test(m.displayName));
      for (const [team, list] of espnMarketOutcomes(champEspn)) {
        champOther.set(team, [...(champOther.get(team) ?? []), ...list]);
      }
      nextGroups.push(buildGroup("championship", "National Championship", champKalshi, champOther));

      // Playoff-tree qualifiers + undefeated — Kalshi only.
      const simple: { key: string; label: string; ticker: string }[] = [
        { key: "playoff", label: "Playoff Qualifier", ticker: KALSHI_FUTURES_SERIES.playoffQualifier },
        { key: "finalist", label: "Finalist", ticker: KALSHI_FUTURES_SERIES.finalist },
        { key: "semifinalist", label: "Semifinalist", ticker: KALSHI_FUTURES_SERIES.semifinalist },
        { key: "quarterfinalist", label: "Quarterfinalist", ticker: KALSHI_FUTURES_SERIES.quarterfinalist },
        { key: "undefeated", label: "Undefeated Regular Season", ticker: KALSHI_FUTURES_SERIES.undefeatedRegularSeason },
      ];
      for (const s of simple) {
        const events = await fetchKalshiFutures(s.ticker).catch(() => []);
        nextGroups.push(buildGroup(s.key, s.label, kalshiEventsToProbByTeam(events), new Map()));
      }

      // Each conference's own championship — Kalshi + ESPN's matching
      // conference-winner market where we can find one by name.
      for (const conf of confList) {
        const events = await fetchKalshiFutures(conf.ticker).catch(() => []);
        const kalshiByTeam = kalshiEventsToProbByTeam(events);
        const espnMatch = espnMarkets.find(
          (m) => /conference/i.test(m.displayName) && conf.label && m.displayName.toLowerCase().includes(conf.label.toLowerCase().split(" ")[0])
        );
        const otherByTeam = espnMarketOutcomes(espnMatch);
        const group = buildGroup(`conf-${conf.ticker}`, conf.label, kalshiByTeam, otherByTeam);
        if (group.outcomes.length > 0) nextGroups.push(group);
      }

      if (!cancelled) {
        setGroups(nextGroups);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, mcResults, mcNumTrials]);

  return { groups, loading: loading || mcLoading, error };
}

// ---------------------------------------------------------------------
// Win totals — a ladder per team (one row per team, one column per win
// threshold: 1+, 2+, ... 11+), not a single outcome per team. Each
// Kalshi outcome's own question text carries both the team name AND the
// threshold ("Will California win at least 10 games this season?") —
// grouping by event_ticker alone isn't reliable without knowing Kalshi's
// exact event/ticker conventions, so both are parsed directly out of
// that text instead, which is unambiguous regardless of how events are
// structured. (This is also the fix for the earlier bug where every
// team+threshold combination rendered as its own column, since the raw
// title text was used verbatim as the column key.)
// ---------------------------------------------------------------------
export interface WinTotalCell {
  kalshiPct: number | null;
  myPct: number | null;
  valuePct: number | null;
}
export interface FuturesWinTotalRow {
  team: string;
  byThreshold: Record<number, WinTotalCell>;
}

function parseWinTotalOutcome(title: string): { team: string; threshold: number } | null {
  const m = /Will\s+(.+?)\s+win\s+at\s+least\s+(\d+)/i.exec(title);
  if (!m) return null;
  return { team: m[1].trim(), threshold: parseInt(m[2], 10) };
}

export function useFuturesWinTotals(season: number) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<FuturesWinTotalRow[]>([]);
  const [thresholds, setThresholds] = useState<number[]>([]);
  const { results: mcResults, numTrials: mcNumTrials, loading: mcLoading } = useLatestMonteCarloRun(season);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchKalshiFutures(KALSHI_FUTURES_SERIES.winTotals)
      .then((events) => {
        if (cancelled) return;
        const mcByTeam = new Map<string, TeamSimResult>();
        for (const r of mcResults ?? []) mcByTeam.set(r.team, r);

        const byTeam = new Map<string, Map<number, number>>(); // team -> threshold -> kalshi implied %
        const thresholdSet = new Set<number>();

        for (const ev of events) {
          for (const o of ev.outcomes) {
            const parsed = parseWinTotalOutcome(o.title ?? o.name);
            if (!parsed) continue;
            const team = matchTeamName(parsed.team).matched ?? parsed.team;
            const prob = kalshiMidProb(o.yesBid, o.yesAsk);
            if (prob == null) continue;
            thresholdSet.add(parsed.threshold);
            if (!byTeam.has(team)) byTeam.set(team, new Map());
            byTeam.get(team)!.set(parsed.threshold, prob * 100);
          }
        }

        const sortedThresholds = Array.from(thresholdSet).sort((a, b) => a - b);
        const outRows: FuturesWinTotalRow[] = Array.from(byTeam.entries())
          .map(([team, kalshiByThreshold]) => {
            const mc = mcByTeam.get(team);
            const byThreshold: Record<number, WinTotalCell> = {};
            for (const t of sortedThresholds) {
              const kalshiPct = kalshiByThreshold.get(t) ?? null;
              const myPct = mc ? winsAtLeastPct(mc, mcNumTrials, t) : null;
              const value = myPct != null && kalshiPct != null ? myPct - kalshiPct : null;
              byThreshold[t] = { kalshiPct, myPct, valuePct: value };
            }
            return { team, byThreshold };
          })
          .sort((a, b) => a.team.localeCompare(b.team));

        setThresholds(sortedThresholds);
        setRows(outRows);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, mcResults, mcNumTrials]);

  return { rows, thresholds, loading: loading || mcLoading, error };
}
