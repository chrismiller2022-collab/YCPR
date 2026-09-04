import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import SortHeader from "../components/SortHeader";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { classOf } from "../lib/matchupsCompute";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { BET_HISTORY } from "../data/betHistory.data";
import {
  buildMlRowsFromBetHistory,
  buildMlRowsFromLiveRatings,
  buildMlRowsFromLiveRatingsBillR,
  BILL_R_DEFAULT_DIVISOR,
  aggregateMlRows,
  aggregateMlRowsFiltered,
  aggregateMlSplits,
  aggregateMlSplitsFiltered,
  filterMlRowsBySpreadSignal,
  mlWinPct,
  type MlGameRow,
  type MlTally,
  type MlSplitBucket,
  type SpreadSignal,
} from "../lib/moneylineBetHistory";

const SEASONS = [2024, 2025, 2026] as const;

// Encapsulates "fetch this one season's games/ratings and build its ML
// rows" — called once per fixed SEASONS entry below (never in a loop,
// so it stays a fixed number of hook calls regardless of how many
// seasons are actually selected). Lets multi-season selection combine
// results from any subset of the 3 without conditionally calling hooks.
function useSeasonMlRows(season: number, conversionMethod: "old" | "billR", billRDivisor: number, hfaMode: "team" | "flat", currentSeason: number) {
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekNumbersInView = useMemo(() => Array.from(new Set(games.map((g) => g.week))), [games]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbersInView, currentSeason);
  const hasRatingsForSeason = useMemo(() => Object.values(ratingsByWeek).some((m) => Object.keys(m).length > 0), [ratingsByWeek]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch((err) => setError(err.message ?? "Failed to load games/lines"))
      .finally(() => setLoading(false));
  }, [season]);

  const hasBetHistoryForSeason = useMemo(() => BET_HISTORY.some((r) => r.season === season), [season]);

  const { allRows, unmatchedCount } = useMemo(() => {
    if (conversionMethod === "billR" && hasRatingsForSeason) {
      return { allRows: buildMlRowsFromLiveRatingsBillR(games, ratingsByWeek, billRDivisor), unmatchedCount: 0 };
    }
    if (hasBetHistoryForSeason) {
      const { rows, unmatchedBetHistory } = buildMlRowsFromBetHistory(season, games);
      return { allRows: rows, unmatchedCount: unmatchedBetHistory.length };
    }
    if (conversionMethod === "billR") {
      return { allRows: buildMlRowsFromLiveRatingsBillR(games, ratingsByWeek, billRDivisor), unmatchedCount: 0 };
    }
    return { allRows: buildMlRowsFromLiveRatings(games, ratingsByWeek, hfaMode), unmatchedCount: 0 };
  }, [season, games, hasBetHistoryForSeason, ratingsByWeek, hasRatingsForSeason, conversionMethod, billRDivisor, hfaMode]);

  return { games, loading, error, allRows, unmatchedCount, hasBetHistoryForSeason, hasRatingsForSeason };
}

function fmtSpread(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtPct(v: number | null) {
  return v == null ? "–" : `${(v * 100).toFixed(1)}%`;
}
function fmtEv(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtOdds(v: number | null) {
  if (v == null) return "–";
  return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}
function fmtUnits(v: number, currency: "units" | "dollars" = "units", dollarsPerUnit = 100) {
  if (currency === "dollars") {
    const dollars = v * dollarsPerUnit;
    return `${dollars < 0 ? "-" : "+"}$${Math.abs(dollars).toFixed(2)}`;
  }
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}u`;
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function StakingModeSummary({
  tally,
  mode,
  compact,
  currency = "units",
  dollarsPerUnit = 100,
}: {
  tally: MlTally;
  mode: "toWin1" | "flat1";
  compact?: boolean;
  currency?: "units" | "dollars";
  dollarsPerUnit?: number;
}) {
  const units = mode === "toWin1" ? tally.toWin1Units : tally.flat1Units;
  const size = compact ? "1.4rem" : "2rem";
  return (
    <div style={{ display: "flex", gap: compact ? "1.5rem" : "2.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1 }}>
          {tally.w}-{tally.l}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>Record</div>
      </div>
      <div>
        <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1 }}>{mlWinPct(tally).toFixed(1)}%</div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>Win %</div>
      </div>
      <div>
        <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1, color: units >= 0 ? "var(--gold)" : "#e05a5a" }}>
          {fmtUnits(units, currency, dollarsPerUnit)}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>
          {currency === "dollars" ? "$" : "Units"} ({mode === "toWin1" ? "bet-to-win-1" : "flat-1"})
        </div>
      </div>
    </div>
  );
}

function SplitsTable({
  every,
  filtered,
  evThreshold,
  stakingMode,
  currency,
  dollarsPerUnit,
}: {
  every: MlSplitBucket;
  filtered: MlSplitBucket;
  evThreshold: number;
  stakingMode: "toWin1" | "flat1";
  currency: "units" | "dollars";
  dollarsPerUnit: number;
}) {
  const rows: { key: keyof MlSplitBucket; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "away", label: "Away" },
    { key: "favorite", label: "Favorite" },
    { key: "underdog", label: "Underdog" },
    { key: "homeFav", label: "Home Favorite" },
    { key: "homeDog", label: "Home Underdog" },
    { key: "awayFav", label: "Away Favorite" },
    { key: "awayDog", label: "Away Underdog" },
  ];
  function tallyUnits(t: MlTally) {
    return stakingMode === "toWin1" ? t.toWin1Units : t.flat1Units;
  }
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="section-label">Home / Away / Favorite / Underdog</div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
        Favorite/underdog comes from my win% (&gt;50% = favorite; true pick'ems excluded from
        those splits). Home Favorite/Underdog and Away Favorite/Underdog are the 4 combo cuts of
        the same thing.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}></th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Every Bet</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Units</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                Filtered (EV &gt; {evThreshold.toFixed(1)}%)
              </th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Units</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const e = every[key];
              const f = filtered[key];
              const eUnits = tallyUnits(e);
              const fUnits = tallyUnits(f);
              return (
                <tr key={key}>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{label}</td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {e.w}-{e.l} <span style={{ color: "var(--chalk-dim)" }}>({mlWinPct(e).toFixed(1)}%)</span>
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.6rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      color: e.w + e.l > 0 ? (eUnits >= 0 ? "var(--gold)" : "#e05a5a") : "var(--chalk-dim)",
                    }}
                  >
                    {e.w + e.l > 0 ? fmtUnits(eUnits, currency, dollarsPerUnit) : "–"}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {f.w + f.l > 0 ? (
                      <>
                        {f.w}-{f.l} <span style={{ color: "var(--chalk-dim)" }}>({mlWinPct(f).toFixed(1)}%)</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td
                    style={{
                      padding: "0.4rem 0.6rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      color: f.w + f.l > 0 ? (fUnits >= 0 ? "var(--gold)" : "#e05a5a") : "var(--chalk-dim)",
                    }}
                  >
                    {f.w + f.l > 0 ? fmtUnits(fUnits, currency, dollarsPerUnit) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SPREAD_SIGNALS: { key: SpreadSignal; label: string }[] = [
  { key: "filtered", label: "Filtered Bet" },
  { key: "wfb", label: "WFB" },
  { key: "nwfb", label: "NWFB" },
];

/** Only meaningful for seasons with a BET_HISTORY entry (2024/25 currently) — that's the only place the ATS engine's inputs are stored, so live 2026+ games can't be cross-referenced yet. */
function AlsoBetSpreadBlock({
  weekRows,
  season,
  stakingMode,
  hasBetHistoryForSeason,
}: {
  weekRows: MlGameRow[];
  season: number;
  stakingMode: "toWin1" | "flat1";
  hasBetHistoryForSeason: boolean;
}) {
  const [signal, setSignal] = useState<SpreadSignal>("filtered");
  const cut = useMemo(() => filterMlRowsBySpreadSignal(weekRows, season, signal), [weekRows, season, signal]);
  const agg = useMemo(() => aggregateMlRows(cut), [cut]);

  return (
    <div
      style={{
        padding: "1.1rem 1.3rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 10,
        marginBottom: "1.5rem",
      }}
    >
      <div
        style={{
          fontSize: "0.8rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--gold)",
          marginBottom: "0.4rem",
        }}
      >
        Also bet the spread
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
        ML record restricted to games where the spread side's own signal also fired that week
        (same engine as Admin Bet History, default thresholds).
        {!hasBetHistoryForSeason && (
          <strong style={{ color: "#a15c00" }}> Not available for {season} yet — no historical spread/prediction data stored for it.</strong>
        )}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {SPREAD_SIGNALS.map((s) => (
          <button key={s.key} className={`mode-btn ${signal === s.key ? "mode-btn-active" : ""}`} onClick={() => setSignal(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {cut.length > 0 ? (
        <StakingModeSummary tally={agg.overall} mode={stakingMode} compact />
      ) : (
        <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", margin: 0 }}>No matching games for this cut.</p>
      )}
    </div>
  );
}

export default function MoneylineBetHistoryPanel({ onBack }: { onBack: () => void }) {
  // Multi-selectable — Chris asked for this specifically so historical
  // seasons can be combined (e.g. 2024+2025), with the per-game table
  // and the spread-crossover block (both single-season-only concepts)
  // hidden once more than one is selected, per his own suggestion.
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set([2025]));
  function toggleSeason(s: number) {
    setSelectedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        if (next.size > 1) next.delete(s); // never allow zero seasons selected
      } else {
        next.add(s);
      }
      return next;
    });
  }
  const [week, setWeek] = useState<"all" | number>("all");
  const [stakingMode, setStakingMode] = useState<"toWin1" | "flat1">("toWin1");
  const [evThreshold, setEvThreshold] = useState(0);
  const [showEvLadder, setShowEvLadder] = useState(true);
  // Bill R Method only applies to live games (no BET_HISTORY entry for the
  // season) — see buildMlRowsFromLiveRatingsBillR's doc comment for why.
  const [conversionMethod, setConversionMethod] = useState<"old" | "billR">("billR");
  const [billRDivisor, setBillRDivisor] = useState(BILL_R_DEFAULT_DIVISOR);
  // Flat HFA (site-wide 2.4 constant) vs each home team's own saved HFA —
  // only applies to the "Current conversion" live path; Bill R Method uses
  // its own fixed 2.5 HFA regardless (see buildMlRowsFromLiveRatingsBillR).
  const [hfaMode, setHfaMode] = useState<"team" | "flat">("team");

  const currentSeason = new Date().getFullYear();

  // Fixed, unconditional calls — one per SEASONS entry, regardless of
  // selection (see useSeasonMlRows's doc comment for why this has to
  // be a fixed count rather than looping over selectedSeasons).
  const season2024 = useSeasonMlRows(2024, conversionMethod, billRDivisor, hfaMode, currentSeason);
  const season2025 = useSeasonMlRows(2025, conversionMethod, billRDivisor, hfaMode, currentSeason);
  const season2026 = useSeasonMlRows(2026, conversionMethod, billRDivisor, hfaMode, currentSeason);
  const bySeasonData: Record<number, ReturnType<typeof useSeasonMlRows>> = {
    2024: season2024,
    2025: season2025,
    2026: season2026,
  };

  const selectedList = useMemo(() => Array.from(selectedSeasons).sort((a, b) => a - b), [selectedSeasons]);
  const isMultiSeason = selectedSeasons.size > 1;
  const primarySeason = selectedList[0] ?? 2025;
  const seasonLabel = selectedList.join(" + ");

  const loading = selectedList.some((s) => bySeasonData[s].loading);
  const error = selectedList.map((s) => bySeasonData[s].error).find((e) => e != null) ?? null;
  // The per-game table and division/conference filters only make sense
  // against one season's actual games — hidden entirely when multiple
  // seasons are selected, rather than trying to show a combined table
  // that mixes different seasons' schedules.
  const games = isMultiSeason ? [] : bySeasonData[primarySeason].games;
  const allRows = useMemo(
    () => selectedList.flatMap((s) => bySeasonData[s].allRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedList, season2024.allRows, season2025.allRows, season2026.allRows]
  );
  const unmatchedCount = isMultiSeason ? 0 : bySeasonData[primarySeason].unmatchedCount;
  const hasBetHistoryForSeason = bySeasonData[primarySeason].hasBetHistoryForSeason;
  const hasRatingsForSeason = bySeasonData[primarySeason].hasRatingsForSeason;

  // Division matchup filter — multi-selectable (any combination of the
  // 3, including all 3 = unfiltered). Games with an unknown/untracked
  // classification on either side don't match any of the 3 buckets and
  // are always shown, so they're never silently hidden by narrowing this
  // filter down.
  const DIV_BUCKETS = ["fbsvfbs", "fcsvfcs", "cross"] as const;
  type DivBucket = (typeof DIV_BUCKETS)[number];
  const [divFilters, setDivFilters] = useState<Set<DivBucket>>(new Set(DIV_BUCKETS));
  function toggleDivFilter(b: DivBucket) {
    setDivFilters((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  }
  function divBucketOf(g: GameWithLines): DivBucket | "other" {
    const h = classOf(g, "home");
    const a = classOf(g, "away");
    if (h === "fbs" && a === "fbs") return "fbsvfbs";
    if (h === "fcs" && a === "fcs") return "fcsvfcs";
    if ((h === "fbs" && a === "fcs") || (h === "fcs" && a === "fbs")) return "cross";
    return "other";
  }

  // Conference filter — multi-selectable, matches if EITHER team belongs
  // to a selected conference. Empty selection = no filter (show every
  // conference), rather than forcing the user to select all of them.
  const [confFilters, setConfFilters] = useState<Set<string>>(new Set());
  function toggleConfFilter(c: string) {
    setConfFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  const availableConferences = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.home_conference) set.add(g.home_conference);
      if (g.away_conference) set.add(g.away_conference);
    }
    return Array.from(set).sort();
  }, [games]);

  // Units -> dollars view. $ per unit is just a multiplier applied at
  // display time — none of the underlying win/loss math changes.
  const [displayCurrency, setDisplayCurrency] = useState<"units" | "dollars">("units");
  const [dollarsPerUnit, setDollarsPerUnit] = useState(100);
  function fmtStakeValue(units: number | null | undefined): string {
    if (units == null) return "–";
    if (displayCurrency === "dollars") {
      const dollars = units * dollarsPerUnit;
      return `${dollars < 0 ? "-" : ""}$${Math.abs(dollars).toFixed(2)}`;
    }
    return `${units > 0 ? "+" : ""}${units.toFixed(2)}u`;
  }

  const weekRows = useMemo(() => {
    const base = week === "all" ? allRows : allRows.filter((r) => r.game.week === week);
    return base.filter((r) => {
      const bucket = divBucketOf(r.game);
      if (bucket !== "other" && !divFilters.has(bucket)) return false;
      if (confFilters.size > 0) {
        const homeMatch = r.game.home_conference != null && confFilters.has(r.game.home_conference);
        const awayMatch = r.game.away_conference != null && confFilters.has(r.game.away_conference);
        if (!homeMatch && !awayMatch) return false;
      }
      return true;
    });
  }, [allRows, week, divFilters, confFilters]);

  const weeks = useMemo(() => Array.from(new Set(allRows.map((r) => r.game.week))).sort((a, b) => a - b), [allRows]);

  // Per-game table sort. "bestEv" is a special combined sort (not a real
  // column) — max(evAway, evHome) descending, so whichever side has the
  // stronger edge surfaces first regardless of which side it's on.
  type TableSortKey =
    | "date" | "away" | "home" | "mySpread" | "awayWinPct" | "awayMl" | "vegasAwayMl" | "evAway"
    | "homeWinPct" | "homeMl" | "vegasHomeMl" | "evHome" | "bet" | "filteredBet" | "result" | "stake" | "units" | "bestEv";
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>("date");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("asc");

  function handleTableSort(key: string) {
    const k = key as TableSortKey;
    if (tableSortKey === k) {
      setTableSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTableSortKey(k);
      setTableSortDir(k === "bestEv" ? "desc" : "asc");
    }
  }

  function tableSortValue(r: MlGameRow, key: TableSortKey): number | string | null {
    const stake = stakingMode === "toWin1" ? r.toWin1 : r.flat1;
    switch (key) {
      case "date":
        return r.game.start_date ?? "";
      case "away":
        return r.game.away_team;
      case "home":
        return r.game.home_team;
      case "mySpread":
        return r.myAwaySpread;
      case "awayWinPct":
        return r.myAwayWinPct;
      case "awayMl":
        return r.myAwayMoneyline;
      case "vegasAwayMl":
        return r.vegasAwayMoneyline;
      case "evAway":
        return r.evAway;
      case "homeWinPct":
        return r.myHomeWinPct;
      case "homeMl":
        return r.myHomeMoneyline;
      case "vegasHomeMl":
        return r.vegasHomeMoneyline;
      case "evHome":
        return r.evHome;
      case "bet":
        return r.betSide ?? "";
      case "filteredBet":
        return r.betEv != null && r.betEv > evThreshold ? r.betSide ?? "" : "";
      case "result":
        return r.result ?? "";
      case "stake":
        return stake?.stake ?? null;
      case "units":
        return stake?.profit ?? null;
      case "bestEv": {
        const vals = [r.evAway, r.evHome].filter((v): v is number => v != null);
        return vals.length > 0 ? Math.max(...vals) : null;
      }
    }
  }

  const sortedTableRows = useMemo(() => {
    return [...weekRows].sort((a, b) => {
      const av = tableSortValue(a, tableSortKey);
      const bv = tableSortValue(b, tableSortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        return tableSortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return tableSortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekRows, tableSortKey, tableSortDir, stakingMode, evThreshold]);

  const { overall, byWeek } = useMemo(() => aggregateMlRows(weekRows), [weekRows]);
  const seasonAgg = useMemo(() => aggregateMlRows(allRows), [allRows]);
  const weeksSorted = Array.from(byWeek.keys()).sort((a, b) => a - b);

  const { overall: filteredOverall, byWeek: filteredByWeek } = useMemo(
    () => aggregateMlRowsFiltered(weekRows, evThreshold),
    [weekRows, evThreshold]
  );
  const filteredSeasonAgg = useMemo(() => aggregateMlRowsFiltered(allRows, evThreshold), [allRows, evThreshold]);
  // 1% to 10% in half-point steps (19 levels) — a quick side-by-side
  // comparison across thresholds instead of dragging the slider above
  // one level at a time. Uses allRows (whichever season/model/staking
  // selections are currently active), same as every other stat on this
  // page — not a separate, second computation.
  const evLadder = useMemo(() => {
    const levels: number[] = [];
    for (let t = 1; t <= 10; t += 0.5) levels.push(t);
    return levels.map((threshold) => ({ threshold, agg: aggregateMlRowsFiltered(allRows, threshold).overall }));
  }, [allRows]);

  const everySplits = useMemo(() => aggregateMlSplits(weekRows), [weekRows]);
  const filteredSplits = useMemo(() => aggregateMlSplitsFiltered(weekRows, evThreshold), [weekRows, evThreshold]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Moneyline Bet History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Every game, both sides' moneyline converted to Vegas's implied win% (vig included, same convention as the
        Matchups pages' EV column), compared against my own fair win% from that game's projected spread. Whichever
        side is positive EV is the bet — if neither side is positive (the vig eating both, which is the normal case),
        no bet. Old conversion: 2024/2025 use the historical prediction actually made at the time (from Bet
        History); 2026 onward uses live power ratings as each week is synced. Bill R Method: available for any
        season with real per-team-per-week ratings on file — 2025 (archived) and 2026 (live) — since it derives a
        win probability directly from each team's own rating rather than a single graded spread number.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        {SEASONS.map((s) => (
          <button key={s} className={`mode-btn ${selectedSeasons.has(s) ? "mode-btn-active" : ""}`} onClick={() => toggleSeason(s)}>
            {s}
          </button>
        ))}
        <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
          <option value="all">All weeks</option>
          {weeks.map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Staking:</span>
        <button className={`mode-btn ${stakingMode === "toWin1" ? "mode-btn-active" : ""}`} onClick={() => setStakingMode("toWin1")}>
          Bet-to-win-1
        </button>
        <button className={`mode-btn ${stakingMode === "flat1" ? "mode-btn-active" : ""}`} onClick={() => setStakingMode("flat1")}>
          Flat-1
        </button>
        <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Show:</span>
        <button
          className={`mode-btn ${displayCurrency === "units" ? "mode-btn-active" : ""}`}
          onClick={() => setDisplayCurrency("units")}
        >
          Units
        </button>
        <button
          className={`mode-btn ${displayCurrency === "dollars" ? "mode-btn-active" : ""}`}
          onClick={() => setDisplayCurrency("dollars")}
        >
          $
        </button>
        {displayCurrency === "dollars" && (
          <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            $ per unit{" "}
            <input
              type="number"
              step="10"
              value={dollarsPerUnit}
              onChange={(e) => setDollarsPerUnit(parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Division:</span>
        <button
          className={`mode-btn ${divFilters.has("fbsvfbs") ? "mode-btn-active" : ""}`}
          onClick={() => toggleDivFilter("fbsvfbs")}
        >
          FBS v FBS
        </button>
        <button
          className={`mode-btn ${divFilters.has("fcsvfcs") ? "mode-btn-active" : ""}`}
          onClick={() => toggleDivFilter("fcsvfcs")}
        >
          FCS v FCS
        </button>
        <button
          className={`mode-btn ${divFilters.has("cross") ? "mode-btn-active" : ""}`}
          onClick={() => toggleDivFilter("cross")}
        >
          Cross-Div
        </button>
      </div>

      {availableConferences.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginTop: "0.35rem" }}>Conference:</span>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", flex: 1 }}>
            {availableConferences.map((c) => (
              <button
                key={c}
                className={`mode-btn ${confFilters.has(c) ? "mode-btn-active" : ""}`}
                style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }}
                onClick={() => toggleConfFilter(c)}
              >
                {c}
              </button>
            ))}
            {confFilters.size > 0 && (
              <button className="mode-btn" style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }} onClick={() => setConfFilters(new Set())}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>My win% derivation:</span>
        <button
          className={`mode-btn ${conversionMethod === "old" ? "mode-btn-active" : ""}`}
          onClick={() => setConversionMethod("old")}
        >
          Old conversion
        </button>
        <button
          className={`mode-btn ${conversionMethod === "billR" ? "mode-btn-active" : ""}`}
          onClick={() => setConversionMethod("billR")}
          disabled={!hasRatingsForSeason}
          title={!hasRatingsForSeason ? "No per-team rating snapshots to rebuild " + primarySeason + " with." : undefined}
        >
          Bill R Method
        </button>
        {conversionMethod === "billR" && hasRatingsForSeason && (
          <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            z-score divisor{" "}
            <input
              type="number"
              step="0.5"
              value={billRDivisor}
              onChange={(e) => setBillRDivisor(parseFloat(e.target.value) || BILL_R_DEFAULT_DIVISOR)}
              style={{ width: 60 }}
            />
          </label>
        )}
        {!hasRatingsForSeason && (
          <span style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
            No rating snapshots for {primarySeason} — Bill R needs a live season or an archived one (season_weekly_ratings).
          </span>
        )}
      </div>

      {!hasBetHistoryForSeason && conversionMethod === "old" && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>HFA:</span>
          <select value={hfaMode} onChange={(e) => setHfaMode(e.target.value as "team" | "flat")}>
            <option value="team">Team-specific</option>
            <option value="flat">Flat 2.4</option>
          </select>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Filtered Bet — only bet if EV above:</span>
        <input
          type="range"
          min={0}
          max={30}
          step={0.5}
          value={evThreshold}
          onChange={(e) => setEvThreshold(parseFloat(e.target.value))}
          style={{ width: 220 }}
        />
        {/* Dragging a 0-30 range slider to an exact value (e.g. 9.0%
            precisely) is inherently imprecise — this number input lets
            typing the exact threshold directly instead. */}
        <input
          type="number"
          min={0}
          max={30}
          step={0.5}
          value={evThreshold}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) setEvThreshold(Math.min(30, Math.max(0, v)));
          }}
          style={{ width: 60 }}
        />
        <span style={{ fontSize: "0.85rem", fontWeight: 700, minWidth: 20 }}>%</span>
        <button
          className="mode-btn"
          onClick={() => handleTableSort("bestEv")}
          title="Sorts the per-game table below by whichever side (home or away) has the stronger EV, highest to lowest"
        >
          Sort by Best EV
        </button>
        <button className={`mode-btn ${showEvLadder ? "mode-btn-active" : ""}`} onClick={() => setShowEvLadder((v) => !v)}>
          {showEvLadder ? "Hide" : "Show"} EV Ladder
        </button>
      </div>

      {showEvLadder && (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginBottom: "1.5rem" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>EV Threshold</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Win %</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                  Units ({stakingMode === "toWin1" ? "bet-to-win-1" : "flat-1"})
                </th>
              </tr>
            </thead>
            <tbody>
              {evLadder.map(({ threshold, agg }) => {
                const units = stakingMode === "toWin1" ? agg.toWin1Units : agg.flat1Units;
                return (
                  <tr key={threshold} style={{ background: threshold === evThreshold ? "var(--gold-dim)" : undefined }}>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>EV &gt; {threshold.toFixed(1)}%</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {agg.w}-{agg.l}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {agg.w + agg.l > 0 ? `${mlWinPct(agg).toFixed(1)}%` : "–"}
                    </td>
                    <td
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderBottom: "1px solid var(--hash)",
                        textAlign: "right",
                        color: units >= 0 ? "var(--gold)" : "#e05a5a",
                        fontWeight: 700,
                      }}
                    >
                      {agg.w + agg.l > 0 ? fmtUnits(units, displayCurrency, dollarsPerUnit) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && !isMultiSeason && games.length === 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.85rem" }}>
          No games/lines synced for {primarySeason} yet — sync it from Admin → Games & Lines first (check "Whole season").
          Moneylines only started being captured once that sync was fixed to store them, so a season synced before
          that fix needs a re-sync to backfill them.
        </p>
      )}
      {!loading && !isMultiSeason && games.length > 0 && allRows.length === 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.85rem" }}>
          {games.length} games synced for {primarySeason}, but none had a line carrying both moneylines yet — try re-syncing
          Games & Lines for this season.
        </p>
      )}
      {!isMultiSeason && unmatchedCount > 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.85rem" }}>
          {unmatchedCount} Bet History game(s) for {primarySeason} had no matching synced game/line (team-name mismatch, or
          that week hasn't been synced) and were skipped.
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div
            style={{
              padding: "1.1rem 1.3rem",
              background: "var(--turf-panel)",
              border: "1px solid var(--hash)",
              borderRadius: 10,
              marginBottom: "1.5rem",
            }}
          >
            <div
              style={{
                fontSize: "0.8rem",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--gold)",
                marginBottom: "0.6rem",
              }}
            >
              {week === "all" ? `${seasonLabel} — Every Bet` : `${seasonLabel} Week ${week} — Every Bet`}
            </div>
            <StakingModeSummary tally={overall} mode={stakingMode} currency={displayCurrency} dollarsPerUnit={dollarsPerUnit} />

            <div style={{ marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: "1px solid var(--hash)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
                Filtered Bet — EV &gt; {evThreshold.toFixed(1)}%
              </div>
              <StakingModeSummary tally={filteredOverall} mode={stakingMode} compact currency={displayCurrency} dollarsPerUnit={dollarsPerUnit} />
            </div>

            {week !== "all" && !isMultiSeason && (
              <div style={{ marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: "1px solid var(--hash)" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
                  Full {seasonLabel} season — Every Bet
                </div>
                <StakingModeSummary tally={seasonAgg.overall} mode={stakingMode} compact currency={displayCurrency} dollarsPerUnit={dollarsPerUnit} />
                <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", margin: "0.6rem 0 0.4rem" }}>
                  Full {seasonLabel} season — Filtered Bet (EV &gt; {evThreshold.toFixed(1)}%)
                </div>
                <StakingModeSummary tally={filteredSeasonAgg.overall} mode={stakingMode} compact currency={displayCurrency} dollarsPerUnit={dollarsPerUnit} />
              </div>
            )}
          </div>

          {weeksSorted.length > 1 && (
            <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginBottom: "1.5rem" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Win %</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Units</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", borderLeft: "1px solid var(--hash)" }}>
                      Filtered Record
                    </th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Filtered Win %</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Filtered Units</th>
                  </tr>
                </thead>
                <tbody>
                  {weeksSorted.map((w) => {
                    const t = byWeek.get(w)!;
                    const units = stakingMode === "toWin1" ? t.toWin1Units : t.flat1Units;
                    const ft = filteredByWeek.get(w);
                    const filteredUnits = ft ? (stakingMode === "toWin1" ? ft.toWin1Units : ft.flat1Units) : 0;
                    const hasFiltered = !!ft && ft.w + ft.l > 0;
                    return (
                      <tr key={w}>
                        <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>Week {w}</td>
                        <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                          {t.w}-{t.l}
                        </td>
                        <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                          {mlWinPct(t).toFixed(1)}%
                        </td>
                        <td
                          style={{
                            padding: "0.35rem 0.6rem",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            textAlign: "right",
                            color: units >= 0 ? "var(--gold)" : "#e05a5a",
                            fontWeight: 700,
                          }}
                        >
                          {fmtUnits(units)}
                        </td>
                        <td
                          style={{
                            padding: "0.35rem 0.6rem",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            borderLeft: "1px solid var(--hash)",
                            textAlign: "right",
                          }}
                        >
                          {hasFiltered ? `${ft!.w}-${ft!.l}` : "–"}
                        </td>
                        <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                          {hasFiltered ? `${mlWinPct(ft!).toFixed(1)}%` : "–"}
                        </td>
                        <td
                          style={{
                            padding: "0.35rem 0.6rem",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            textAlign: "right",
                            color: hasFiltered ? (filteredUnits >= 0 ? "var(--gold)" : "#e05a5a") : undefined,
                            fontWeight: hasFiltered ? 700 : undefined,
                          }}
                        >
                          {hasFiltered ? fmtUnits(filteredUnits) : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <SplitsTable
            every={everySplits}
            filtered={filteredSplits}
            evThreshold={evThreshold}
            stakingMode={stakingMode}
            currency={displayCurrency}
            dollarsPerUnit={dollarsPerUnit}
          />

          {isMultiSeason ? (
            <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
              Per-game table and spread-crossover hidden while combining multiple seasons — pick a single
              season above to see individual games.
            </p>
          ) : (
            <>
              <AlsoBetSpreadBlock weekRows={weekRows} season={primarySeason} stakingMode={stakingMode} hasBetHistoryForSeason={hasBetHistoryForSeason} />

              <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
              <thead>
                <tr>
                  <SortHeader label="Date" sortKey="date" active={tableSortKey === "date"} dir={tableSortDir} onClick={handleTableSort} />
                  <SortHeader label="Away" sortKey="away" active={tableSortKey === "away"} dir={tableSortDir} onClick={handleTableSort} />
                  <SortHeader label="Home" sortKey="home" active={tableSortKey === "home"} dir={tableSortDir} onClick={handleTableSort} />
                  <SortHeader
                    label="My Spread"
                    sortKey="mySpread"
                    active={tableSortKey === "mySpread"}
                    dir={tableSortDir}
                    onClick={handleTableSort}
                    align="right"
                  />
                  <SortHeader label="My Away Win%" sortKey="awayWinPct" active={tableSortKey === "awayWinPct"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="My Away ML" sortKey="awayMl" active={tableSortKey === "awayMl"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="Vegas Away ML" sortKey="vegasAwayMl" active={tableSortKey === "vegasAwayMl"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="Away EV" sortKey="evAway" active={tableSortKey === "evAway"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="My Home Win%" sortKey="homeWinPct" active={tableSortKey === "homeWinPct"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="My Home ML" sortKey="homeMl" active={tableSortKey === "homeMl"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="Vegas Home ML" sortKey="vegasHomeMl" active={tableSortKey === "vegasHomeMl"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="Home EV" sortKey="evHome" active={tableSortKey === "evHome"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="Bet" sortKey="bet" active={tableSortKey === "bet"} dir={tableSortDir} onClick={handleTableSort} />
                  <SortHeader label="Filtered Bet" sortKey="filteredBet" active={tableSortKey === "filteredBet"} dir={tableSortDir} onClick={handleTableSort} />
                  <SortHeader label="Result" sortKey="result" active={tableSortKey === "result"} dir={tableSortDir} onClick={handleTableSort} />
                  <SortHeader label="Stake" sortKey="stake" active={tableSortKey === "stake"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                  <SortHeader label="Units" sortKey="units" active={tableSortKey === "units"} dir={tableSortDir} onClick={handleTableSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedTableRows.map((r: MlGameRow) => {
                  const stake = stakingMode === "toWin1" ? r.toWin1 : r.flat1;
                  return (
                    <tr key={r.game.id}>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}>
                        {fmtDateTime(r.game.start_date)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <TeamLogo team={r.game.away_team} /> {r.game.away_team}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <TeamLogo team={r.game.home_team} /> {r.game.home_team}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtSpread(r.myAwaySpread)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtPct(r.myAwayWinPct)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtOdds(r.myAwayMoneyline)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtOdds(r.vegasAwayMoneyline)}
                      </td>
                      <td
                        style={{
                          padding: "0.3rem 0.5rem",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          textAlign: "right",
                          color: r.evAway != null && r.evAway > 0 ? "var(--gold)" : "inherit",
                        }}
                      >
                        {fmtEv(r.evAway)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtPct(r.myHomeWinPct)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtOdds(r.myHomeMoneyline)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtOdds(r.vegasHomeMoneyline)}
                      </td>
                      <td
                        style={{
                          padding: "0.3rem 0.5rem",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          textAlign: "right",
                          color: r.evHome != null && r.evHome > 0 ? "var(--gold)" : "inherit",
                        }}
                      >
                        {fmtEv(r.evHome)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", fontWeight: 700 }}>
                        {r.betSide != null && (
                          <TeamLogo team={r.betSide === "away" ? r.game.away_team : r.game.home_team} />
                        )}{" "}
                        {r.betSide === "away" ? r.game.away_team : r.betSide === "home" ? r.game.home_team : "–"}
                        {r.betEv != null && r.betEv > evThreshold && (
                          <span
                            className="cell-tip"
                            data-tip={`Clears the ${evThreshold.toFixed(1)}% Filtered Bet threshold`}
                            style={{ color: "var(--gold)", marginLeft: "0.3rem" }}
                          >
                            ✓
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "var(--gold)" }}>
                        {r.betEv != null && r.betEv > evThreshold && r.betSide != null ? (
                          <>
                            <TeamLogo team={r.betSide === "away" ? r.game.away_team : r.game.home_team} />{" "}
                            {r.betSide === "away" ? r.game.away_team : r.game.home_team}
                          </>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td
                        style={{
                          padding: "0.3rem 0.5rem",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          color: r.result === "win" ? "var(--gold)" : r.result === "loss" ? "#e05a5a" : "var(--chalk-dim)",
                        }}
                      >
                        {r.result ?? (r.betSide == null ? "no bet" : "pending")}
                      </td>
                      <td
                        style={{
                          padding: "0.3rem 0.5rem",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          textAlign: "right",
                          color: "var(--chalk-dim)",
                        }}
                      >
                        {stake == null ? "–" : fmtStakeValue(stake.stake)}
                      </td>
                      <td
                        style={{
                          padding: "0.3rem 0.5rem",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                          textAlign: "right",
                          fontWeight: 700,
                          color: stake == null ? "inherit" : stake.profit >= 0 ? "var(--gold)" : "#e05a5a",
                        }}
                      >
                        {stake == null ? "–" : fmtStakeValue(stake.profit)}
                      </td>
                    </tr>
                  );
                })}
                {weekRows.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ padding: "1rem", textAlign: "center", color: "var(--chalk-dim)" }}>
                      No games match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
