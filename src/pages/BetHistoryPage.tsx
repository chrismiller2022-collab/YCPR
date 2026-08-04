import { useMemo, useState } from "react";
import { BET_HISTORY } from "../data/betHistory.data";
import { availableConferences } from "../lib/survivor";
import { aggregatePlain, filterRecords, winPct, computeErrorStatsFromBetHistory, type RecordTally, type BetHistoryFilters } from "../lib/betHistory";

const SEASONS = [2024, 2025, 2026];

function fmtRecord(t: RecordTally) {
  return `${t.w}-${t.l}${t.push > 0 ? `-${t.push}` : ""}`;
}

function fmtPct(t: RecordTally) {
  return `${winPct(t).toFixed(1)}%`;
}

function StatsBlock({ title, overall, byWeek }: { title: string; overall: RecordTally; byWeek: Map<number, RecordTally> }) {
  const weeks = Array.from(byWeek.keys()).sort((a, b) => a - b);
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div
        style={{
          padding: "1.1rem 1.3rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 10,
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
          {title}
        </div>
        <div style={{ display: "flex", gap: "2.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{fmtRecord(overall)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>Record</div>
          </div>
          <div>
            <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{fmtPct(overall)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginTop: "0.2rem" }}>Win %</div>
          </div>
        </div>
      </div>

      {weeks.length > 0 && (
        <details style={{ marginTop: "0.5rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--chalk-dim)", padding: "0.3rem 0.1rem" }}>
            Weekly breakdown
          </summary>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, marginTop: "0.5rem" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th className="th">Week</th>
                  <th className="th th-right">Record</th>
                  <th className="th th-right">Win %</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const t = byWeek.get(w)!;
                  return (
                    <tr key={w}>
                      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week {w}</td>
                      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtRecord(t)}</td>
                      <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtPct(t)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        </details>
      )}
    </div>
  );
}

function ErrorStatsBlock({ errorStats }: { errorStats: ReturnType<typeof computeErrorStatsFromBetHistory> }) {
  const fmtNum = (v: number | null, digits = 2) => (v == null ? "–" : v.toFixed(digits));
  const fmtDelta = (v: number | null, digits = 2) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="section-label">ATS Stats</div>
      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
          <thead>
            <tr>
              <th className="th"></th>
              <th className="th th-right">YC</th>
              <th className="th th-right">Vegas</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Abs Error</td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.yc.absError)}
              </td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.vegas.absError)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Median Abs Error</td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.yc.medianAbsError)}
              </td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.vegas.medianAbsError)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Mean Squared Error</td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.yc.mse)}
              </td>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtNum(errorStats.vegas.mse)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Abs Error over Vegas</td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  borderBottom: "1px solid var(--hash)",
                  textAlign: "right",
                  color: errorStats.absErrorOverVegasYc != null && errorStats.absErrorOverVegasYc < 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.absErrorOverVegasYc)}
              </td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  borderBottom: "1px solid var(--hash)",
                  textAlign: "right",
                  color: errorStats.absErrorOverVegasYc != null && errorStats.absErrorOverVegasYc > 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.absErrorOverVegasYc != null ? -errorStats.absErrorOverVegasYc : null)}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "0.35rem 0.6rem" }}>MSE over Vegas</td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  textAlign: "right",
                  color: errorStats.mseOverVegasYc != null && errorStats.mseOverVegasYc < 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.mseOverVegasYc)}
              </td>
              <td
                style={{
                  padding: "0.35rem 0.6rem",
                  textAlign: "right",
                  color: errorStats.mseOverVegasYc != null && errorStats.mseOverVegasYc > 0 ? "#8fd39a" : "#c45c52",
                }}
              >
                {fmtDelta(errorStats.mseOverVegasYc != null ? -errorStats.mseOverVegasYc : null)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "0.5rem" }}>
        Abs Error / MSE compare each projection (YC's model, Vegas's own line) against the
        actual final margin — negative "over Vegas" values mean lower error (better) than
        Vegas. Recomputes live from whatever seasons/weeks/conferences/team are filtered above.
      </p>
    </div>
  );
}

export default function BetHistoryPage({ onHome, lockedYear }: { onHome?: () => void; lockedYear?: number }) {
  const allConfs = useMemo(() => availableConferences(), []);
  const [years, setYears] = useState<Set<number>>(new Set(lockedYear ? [lockedYear] : SEASONS));
  const [week, setWeek] = useState<number | "all">("all");
  const [confFilters, setConfFilters] = useState<Set<string>>(new Set());
  const [teamQuery, setTeamQuery] = useState("");

  function toggleYear(y: number) {
    if (lockedYear) return; // locked to one year on the per-year pages — nothing to toggle
    setYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  }

  function toggleConf(c: string) {
    setConfFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  const filters: BetHistoryFilters = {
    years: Array.from(years),
    week: week === "all" ? null : week,
    confFilters: Array.from(confFilters),
    teamQuery,
  };

  const filtered = useMemo(
    () => filterRecords(BET_HISTORY, filters),
    [filters.years.join(","), filters.week, filters.confFilters.join(","), filters.teamQuery]
  );
  const { overall, byWeek } = useMemo(() => aggregatePlain(filtered), [filtered]);
  const errorStats = useMemo(() => computeErrorStatsFromBetHistory(filtered), [filtered]);

  const everyBetByWeek = new Map<number, RecordTally>();
  const filteredBetByWeek = new Map<number, RecordTally>();
  const weightedByWeek = new Map<number, RecordTally>();
  for (const [w, v] of byWeek) {
    everyBetByWeek.set(w, v.everyBet);
    filteredBetByWeek.set(w, v.filteredBet);
    weightedByWeek.set(w, v.weightedFilteredBet);
  }

  const weeksAvailable = Array.from(new Set(filtered.map((r) => r.week))).sort((a, b) => a - b);

  return (
    <div style={{ padding: "1.5rem 1.25rem 3rem", maxWidth: 1000, margin: "0 auto" }}>
      <div className="team-hero">
        {onHome && (
          <button className="back-link" onClick={onHome}>
            ‹ All rankings
          </button>
        )}
        <div className="eyebrow">Track Record</div>
        <h1 className="title matchup-title">BET HISTORY{lockedYear ? ` — ${lockedYear}` : ""}</h1>
        <p className="subtitle team-subtitle">
          Against-the-spread results, graded against the closing line — for every game bet,
          filtered bets (a meaningful disagreement with the market), and weighted filtered
          bets (a stricter, relative-strength version of that same idea).
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          marginBottom: "1.5rem",
          padding: "0.9rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
          alignItems: "center",
        }}
      >
        {!lockedYear && <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Seasons:</span>}
        {!lockedYear &&
          SEASONS.map((y) => {
          const active = years.has(y);
          return (
            <button
              key={y}
              onClick={() => toggleYear(y)}
              style={{
                fontSize: "0.78rem",
                padding: "0.3rem 0.6rem",
                borderRadius: 6,
                border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
                background: active ? "var(--gold-dim)" : "transparent",
                color: active ? "var(--chalk)" : "var(--chalk-dim)",
                cursor: "pointer",
              }}
            >
              {y}
            </button>
          );
        })}

        <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          Week{" "}
          <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
            <option value="all">All weeks</option>
            {weeksAvailable.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>

        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Conferences:</span>
        {["P4", "G6", ...allConfs].map((c) => {
          const active = confFilters.has(c);
          return (
            <button
              key={c}
              onClick={() => toggleConf(c)}
              style={{
                fontSize: "0.76rem",
                padding: "0.28rem 0.55rem",
                borderRadius: 6,
                border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
                background: active ? "var(--gold-dim)" : "transparent",
                color: active ? "var(--chalk)" : "var(--chalk-dim)",
                cursor: "pointer",
              }}
            >
              {c === "P4" ? "Power 4 (+ND)" : c === "G6" ? "Group of 6 (+UConn)" : c}
            </button>
          );
        })}

        <input
          placeholder="Search team…"
          value={teamQuery}
          onChange={(e) => setTeamQuery(e.target.value)}
          style={{ minWidth: 160 }}
        />
      </div>

      {BET_HISTORY.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>
          No bet history data has been uploaded yet — check back once results start rolling in.
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No games match those filters.</p>
      ) : (
        <>
          <StatsBlock title="Every Game Bet" overall={overall.everyBet} byWeek={everyBetByWeek} />
          <StatsBlock title="Filtered Bets" overall={overall.filteredBet} byWeek={filteredBetByWeek} />
          <StatsBlock title="Weighted Filtered Bets" overall={overall.weightedFilteredBet} byWeek={weightedByWeek} />
          <ErrorStatsBlock errorStats={errorStats} />
        </>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        Records are graded against each game's actual closing line. "Filtered" and "weighted
        filtered" bets are narrower subsets — games where the model's disagreement with the
        market was large enough (and, for weighted, big enough relative to the size of the
        line itself) to flag as a stronger signal.
      </div>
    </div>
  );
}
