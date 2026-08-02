import { useMemo, useState } from "react";
import { BET_HISTORY } from "../data/betHistory.data";
import { availableConferences } from "../lib/survivor";
import {
  gradeRecord,
  gradeRecordDefault,
  aggregate,
  filterRecords,
  winPct,
  DEFAULT_HFA_MODE_BY_SEASON,
  DEFAULT_FILTERED_THRESHOLD,
  type HfaMode,
  type RecordTally,
  type BetHistoryFilters,
} from "../lib/betHistory";

const SEASONS = [2024, 2025, 2026];

function fmtRecord(t: RecordTally) {
  return `${t.w}-${t.l}${t.push > 0 ? `-${t.push}` : ""}`;
}
function fmtPct(t: RecordTally) {
  return `${winPct(t).toFixed(1)}%`;
}
function fmtDelta(n: number, isPct = false) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${isPct ? n.toFixed(1) : n}${isPct ? "%" : ""}`;
}

function StatsBlockWithDiff({
  title,
  current,
  original,
  byWeekCurrent,
  byWeekOriginal,
  showDiff,
}: {
  title: string;
  current: RecordTally;
  original: RecordTally;
  byWeekCurrent: Map<number, RecordTally>;
  byWeekOriginal: Map<number, RecordTally>;
  showDiff: boolean;
}) {
  const weeks = Array.from(byWeekCurrent.keys()).sort((a, b) => a - b);
  const winDelta = current.w - original.w;
  const lossDelta = current.l - original.l;
  const pctDelta = winPct(current) - winPct(original);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="section-label">{title}</div>
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          alignItems: "baseline",
          padding: "0.9rem 1.1rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{fmtRecord(current)}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>Record</div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{fmtPct(current)}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>Win %</div>
        </div>
        {showDiff && (winDelta !== 0 || lossDelta !== 0) && (
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: pctDelta >= 0 ? "#8fd39a" : "#c45c52" }}>
              {fmtDelta(winDelta)}W / {fmtDelta(lossDelta)}L ({fmtDelta(pctDelta, true)})
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>
              vs original ({fmtRecord(original)}, {fmtPct(original)})
            </div>
          </div>
        )}
      </div>

      {weeks.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Win %</th>
                {showDiff && (
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>vs Original</th>
                )}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const t = byWeekCurrent.get(w)!;
                const o = byWeekOriginal.get(w) ?? { w: 0, l: 0, push: 0 };
                const wd = t.w - o.w;
                const ld = t.l - o.l;
                return (
                  <tr key={w}>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week {w}</td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtRecord(t)}</td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>{fmtPct(t)}</td>
                    {showDiff && (
                      <td
                        style={{
                          padding: "0.35rem 0.6rem",
                          borderBottom: "1px solid var(--hash)",
                          textAlign: "right",
                          color: wd - ld >= 0 ? "#8fd39a" : "#c45c52",
                        }}
                      >
                        {wd !== 0 || ld !== 0 ? `${fmtDelta(wd)}W / ${fmtDelta(ld)}L` : "–"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BetHistoryAdminPanel({ onBack }: { onBack: () => void }) {
  const allConfs = useMemo(() => availableConferences(), []);
  const [years, setYears] = useState<Set<number>>(new Set(SEASONS));
  const [week, setWeek] = useState<number | "all">("all");
  const [confFilter, setConfFilter] = useState("All");
  const [teamQuery, setTeamQuery] = useState("");

  const [hfaModeBySeason, setHfaModeBySeason] = useState<Record<number, HfaMode>>({ ...DEFAULT_HFA_MODE_BY_SEASON });
  const [threshold, setThreshold] = useState(DEFAULT_FILTERED_THRESHOLD);

  function toggleYear(y: number) {
    setYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  }

  function setSeasonHfaMode(season: number, mode: HfaMode) {
    setHfaModeBySeason((prev) => ({ ...prev, [season]: mode }));
  }

  const filters: BetHistoryFilters = {
    years: Array.from(years),
    week: week === "all" ? null : week,
    confFilter,
    teamQuery,
  };

  const filtered = useMemo(
    () => filterRecords(BET_HISTORY, filters),
    [filters.years.join(","), filters.week, filters.confFilter, filters.teamQuery]
  );

  const gradedCurrent = useMemo(
    () => filtered.map((r) => gradeRecord(r, hfaModeBySeason[r.season] ?? "teamSpecific", threshold)),
    [filtered, hfaModeBySeason, threshold]
  );
  const gradedOriginal = useMemo(() => filtered.map((r) => gradeRecordDefault(r, DEFAULT_FILTERED_THRESHOLD)), [filtered]);

  const currentAgg = useMemo(() => aggregate(gradedCurrent), [gradedCurrent]);
  const originalAgg = useMemo(() => aggregate(gradedOriginal), [gradedOriginal]);

  const settingsChanged =
    threshold !== DEFAULT_FILTERED_THRESHOLD ||
    SEASONS.some((s) => (hfaModeBySeason[s] ?? "teamSpecific") !== (DEFAULT_HFA_MODE_BY_SEASON[s] ?? "teamSpecific"));

  function toWeekMap(agg: typeof currentAgg, which: "overall" | "filtered") {
    const m = new Map<number, RecordTally>();
    for (const [w, v] of agg.byWeek) m.set(w, v[which]);
    return m;
  }

  const weeksAvailable = Array.from(new Set(filtered.map((r) => r.week))).sort((a, b) => a - b);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Bet History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Same data the public page uses, plus two adjustable knobs: which HFA assumption each
        season uses, and the amount-off threshold for what counts as a "filtered bet." Both
        recompute everything live, with a delta against the historical defaults shown once you
        change something.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
          padding: "0.9rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
          alignItems: "center",
        }}
      >
        {SEASONS.map((s) => (
          <label key={s} style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            {s} HFA:{" "}
            <select value={hfaModeBySeason[s] ?? "teamSpecific"} onChange={(e) => setSeasonHfaMode(s, e.target.value as HfaMode)}>
              <option value="flat">Flat 2.4</option>
              <option value="teamSpecific">Team-Specific</option>
            </select>
            {(hfaModeBySeason[s] ?? "teamSpecific") !== (DEFAULT_HFA_MODE_BY_SEASON[s] ?? "teamSpecific") && (
              <span style={{ color: "#a15c00", marginLeft: "0.3rem" }}>changed</span>
            )}
          </label>
        ))}
        <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          Filtered-bet threshold (amount off){" "}
          <input
            type="number"
            step="0.5"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
            style={{ width: 70 }}
          />
          {threshold !== DEFAULT_FILTERED_THRESHOLD && <span style={{ color: "#a15c00", marginLeft: "0.3rem" }}>changed</span>}
        </label>
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
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Seasons:</span>
        {SEASONS.map((y) => {
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

        <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          Conference{" "}
          <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)}>
            <option value="All">All</option>
            <option value="P4">Power 4 (SEC/B1G/B12/ACC + Notre Dame)</option>
            <option value="G6">Group of 6 (everyone else)</option>
            {allConfs.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <input
          placeholder="Search team…"
          value={teamQuery}
          onChange={(e) => setTeamQuery(e.target.value)}
          style={{ minWidth: 160 }}
        />
      </div>

      {BET_HISTORY.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No bet history data uploaded yet.</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No games match those filters.</p>
      ) : (
        <>
          <StatsBlockWithDiff
            title="All Games (ATS)"
            current={currentAgg.overall}
            original={originalAgg.overall}
            byWeekCurrent={toWeekMap(currentAgg, "overall")}
            byWeekOriginal={toWeekMap(originalAgg, "overall")}
            showDiff={settingsChanged}
          />
          <StatsBlockWithDiff
            title={`Filtered Bets (${threshold}+ points off the market)`}
            current={currentAgg.filtered}
            original={originalAgg.filtered}
            byWeekCurrent={toWeekMap(currentAgg, "filtered")}
            byWeekOriginal={toWeekMap(originalAgg, "filtered")}
            showDiff={settingsChanged}
          />
        </>
      )}
    </div>
  );
}
