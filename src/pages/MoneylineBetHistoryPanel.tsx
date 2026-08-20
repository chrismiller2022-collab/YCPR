import { useEffect, useMemo, useState } from "react";
import { useWeeklyStats } from "../lib/api/weeklyStats";
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

const SEASONS = [2024, 2025, 2026];

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
function fmtUnits(v: number) {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}u`;
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function StakingModeSummary({ tally, mode, compact }: { tally: MlTally; mode: "toWin1" | "flat1"; compact?: boolean }) {
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
          {fmtUnits(units)}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>
          Units ({mode === "toWin1" ? "bet-to-win-1" : "flat-1"})
        </div>
      </div>
    </div>
  );
}

function SplitsTable({ every, filtered, evThreshold }: { every: MlSplitBucket; filtered: MlSplitBucket; evThreshold: number }) {
  const rows: { key: keyof MlSplitBucket; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "away", label: "Away" },
    { key: "favorite", label: "Favorite" },
    { key: "underdog", label: "Underdog" },
  ];
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="section-label">Home / Away / Favorite / Underdog</div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", margin: "0 0 0.6rem" }}>
        Favorite/underdog comes from my projected spread (true pick'ems excluded from that split).
        Combo cuts aren't broken out separately — too small a sample size for now.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}></th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Every Bet</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                Filtered (EV &gt; {evThreshold.toFixed(1)}%)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const e = every[key];
              const f = filtered[key];
              return (
                <tr key={key}>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{label}</td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {e.w}-{e.l} <span style={{ color: "var(--chalk-dim)" }}>({mlWinPct(e).toFixed(1)}%)</span>
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
  const [season, setSeason] = useState(2025);
  const [week, setWeek] = useState<"all" | number>("all");
  const [stakingMode, setStakingMode] = useState<"toWin1" | "flat1">("toWin1");
  const [evThreshold, setEvThreshold] = useState(0);
  // Bill R Method only applies to live games (no BET_HISTORY entry for the
  // season) — see buildMlRowsFromLiveRatingsBillR's doc comment for why.
  const [conversionMethod, setConversionMethod] = useState<"current" | "billR">("current");
  const [billRDivisor, setBillRDivisor] = useState(BILL_R_DEFAULT_DIVISOR);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

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
    if (hasBetHistoryForSeason) {
      const { rows, unmatchedBetHistory } = buildMlRowsFromBetHistory(season, games);
      return { allRows: rows, unmatchedCount: unmatchedBetHistory.length };
    }
    if (conversionMethod === "billR") {
      return { allRows: buildMlRowsFromLiveRatingsBillR(games, liveByTeam, billRDivisor), unmatchedCount: 0 };
    }
    return { allRows: buildMlRowsFromLiveRatings(games, liveByTeam), unmatchedCount: 0 };
  }, [season, games, hasBetHistoryForSeason, liveByTeam, conversionMethod, billRDivisor]);

  const weekRows = useMemo(
    () => (week === "all" ? allRows : allRows.filter((r) => r.game.week === week)),
    [allRows, week]
  );

  const weeks = useMemo(() => Array.from(new Set(allRows.map((r) => r.game.week))).sort((a, b) => a - b), [allRows]);

  const { overall, byWeek } = useMemo(() => aggregateMlRows(weekRows), [weekRows]);
  const seasonAgg = useMemo(() => aggregateMlRows(allRows), [allRows]);
  const weeksSorted = Array.from(byWeek.keys()).sort((a, b) => a - b);

  const { overall: filteredOverall, byWeek: filteredByWeek } = useMemo(
    () => aggregateMlRowsFiltered(weekRows, evThreshold),
    [weekRows, evThreshold]
  );
  const filteredSeasonAgg = useMemo(() => aggregateMlRowsFiltered(allRows, evThreshold), [allRows, evThreshold]);

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
        no bet. 2024/2025 use the historical prediction actually made at the time (from Bet History); 2026 onward uses
        live power ratings as each week is synced.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        {SEASONS.map((s) => (
          <button key={s} className={`mode-btn ${season === s ? "mode-btn-active" : ""}`} onClick={() => setSeason(s)}>
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
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>My win% derivation:</span>
        <button
          className={`mode-btn ${conversionMethod === "current" ? "mode-btn-active" : ""}`}
          onClick={() => setConversionMethod("current")}
        >
          Current conversion
        </button>
        <button
          className={`mode-btn ${conversionMethod === "billR" ? "mode-btn-active" : ""}`}
          onClick={() => setConversionMethod("billR")}
          disabled={hasBetHistoryForSeason}
          title={hasBetHistoryForSeason ? "Live games only — no historical rating snapshots to rebuild " + season + " with." : undefined}
        >
          Bill R Method
        </button>
        {conversionMethod === "billR" && !hasBetHistoryForSeason && (
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
        {hasBetHistoryForSeason && (
          <span style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>
            Bill R Method is live-only (2026+) — {season} keeps using the current conversion.
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
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
        <span style={{ fontSize: "0.85rem", fontWeight: 700, minWidth: 42 }}>{evThreshold.toFixed(1)}%</span>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && games.length === 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.85rem" }}>
          No games/lines synced for {season} yet — sync it from Admin → Games & Lines first (check "Whole season").
          Moneylines only started being captured once that sync was fixed to store them, so a season synced before
          that fix needs a re-sync to backfill them.
        </p>
      )}
      {!loading && games.length > 0 && allRows.length === 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.85rem" }}>
          {games.length} games synced for {season}, but none had a line carrying both moneylines yet — try re-syncing
          Games & Lines for this season.
        </p>
      )}
      {unmatchedCount > 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.85rem" }}>
          {unmatchedCount} Bet History game(s) for {season} had no matching synced game/line (team-name mismatch, or
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
              {week === "all" ? `${season} — Every Bet` : `${season} Week ${week} — Every Bet`}
            </div>
            <StakingModeSummary tally={overall} mode={stakingMode} />

            <div style={{ marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: "1px solid var(--hash)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
                Filtered Bet — EV &gt; {evThreshold.toFixed(1)}%
              </div>
              <StakingModeSummary tally={filteredOverall} mode={stakingMode} compact />
            </div>

            {week !== "all" && (
              <div style={{ marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: "1px solid var(--hash)" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
                  Full {season} season — Every Bet
                </div>
                <StakingModeSummary tally={seasonAgg.overall} mode={stakingMode} compact />
                <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", margin: "0.6rem 0 0.4rem" }}>
                  Full {season} season — Filtered Bet (EV &gt; {evThreshold.toFixed(1)}%)
                </div>
                <StakingModeSummary tally={filteredSeasonAgg.overall} mode={stakingMode} compact />
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
                    <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                      Filtered (rec / units)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weeksSorted.map((w) => {
                    const t = byWeek.get(w)!;
                    const units = stakingMode === "toWin1" ? t.toWin1Units : t.flat1Units;
                    const ft = filteredByWeek.get(w);
                    const filteredUnits = ft ? (stakingMode === "toWin1" ? ft.toWin1Units : ft.flat1Units) : 0;
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
                            textAlign: "right",
                            color: filteredUnits >= 0 ? "var(--gold)" : "#e05a5a",
                          }}
                        >
                          {ft && ft.w + ft.l > 0 ? `${fmtUnits(filteredUnits)} (${ft.w}-${ft.l})` : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <SplitsTable every={everySplits} filtered={filteredSplits} evThreshold={evThreshold} />

          <AlsoBetSpreadBlock weekRows={weekRows} season={season} stakingMode={stakingMode} hasBetHistoryForSeason={hasBetHistoryForSeason} />

          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Away</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Home</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>My Spread</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>My Away Win%</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Vegas Away ML</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Away EV</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Vegas Home ML</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Home EV</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Bet</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Result</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>Units</th>
                </tr>
              </thead>
              <tbody>
                {weekRows.map((r: MlGameRow) => {
                  const stake = stakingMode === "toWin1" ? r.toWin1 : r.flat1;
                  return (
                    <tr key={r.game.id}>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}>
                        {fmtDateTime(r.game.start_date)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{r.game.away_team}</td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{r.game.home_team}</td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtSpread(r.myAwaySpread)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "right" }}>
                        {fmtPct(r.myAwayWinPct)}
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
                          fontWeight: 700,
                          color: stake == null ? "inherit" : stake.profit >= 0 ? "var(--gold)" : "#e05a5a",
                        }}
                      >
                        {stake == null ? "–" : fmtUnits(stake.profit)}
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
    </div>
  );
}
