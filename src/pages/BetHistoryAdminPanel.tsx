import { useMemo, useState } from "react";
import { BET_HISTORY } from "../data/betHistory.data";
import { availableConferences } from "../lib/survivor";
import {
  aggregatePlain,
  aggregateCustom,
  breakdownByConference,
  breakdownByTeam,
  filterRecords,
  winPct,
  DEFAULT_CUSTOM_PARAMS,
  type RecordTally,
  type BetHistoryFilters,
  type CustomParams,
  type BreakdownTriple,
} from "../lib/betHistory";

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
        }}
      >
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{fmtRecord(overall)}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>Record</div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{fmtPct(overall)}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>Win %</div>
        </div>
      </div>

      {weeks.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Record</th>
                <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Win %</th>
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
      )}
    </div>
  );
}

function BreakdownTable({ title, breakdown, maxHeight }: { title: string; breakdown: BreakdownTriple; maxHeight?: number }) {
  const [search, setSearch] = useState("");
  const groups = Array.from(
    new Set([...breakdown.everyBet.keys(), ...breakdown.filteredBet.keys(), ...breakdown.weightedFilteredBet.keys()])
  ).sort((a, b) => a.localeCompare(b));

  const filteredGroups = groups.filter((g) => !search.trim() || g.toLowerCase().includes(search.trim().toLowerCase()));
  const empty = { w: 0, l: 0, push: 0 };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <div className="section-label" style={{ margin: 0 }}>
          {title}
        </div>
        <input
          placeholder="Filter rows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: "0.78rem", maxWidth: 180 }}
        />
      </div>
      {groups.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem" }}>No data for this breakdown yet.</p>
      ) : (
        <div style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: maxHeight ?? undefined }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "0.4rem 0.6rem",
                    borderBottom: "1px solid var(--hash)",
                    position: "sticky",
                    top: 0,
                    background: "var(--turf-panel-2)",
                  }}
                >
                  {title.includes("Conference") ? "Conference" : "Team"}
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "0.4rem 0.6rem",
                    borderBottom: "1px solid var(--hash)",
                    position: "sticky",
                    top: 0,
                    background: "var(--turf-panel-2)",
                  }}
                >
                  Every Bet
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "0.4rem 0.6rem",
                    borderBottom: "1px solid var(--hash)",
                    position: "sticky",
                    top: 0,
                    background: "var(--turf-panel-2)",
                  }}
                >
                  Filtered Bet
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "0.4rem 0.6rem",
                    borderBottom: "1px solid var(--hash)",
                    position: "sticky",
                    top: 0,
                    background: "var(--turf-panel-2)",
                  }}
                >
                  Weighted Filtered
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g) => {
                const eb = breakdown.everyBet.get(g) ?? empty;
                const fb = breakdown.filteredBet.get(g) ?? empty;
                const wfb = breakdown.weightedFilteredBet.get(g) ?? empty;
                return (
                  <tr key={g}>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{g}</td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fmtRecord(eb)} <span style={{ color: "var(--chalk-dim)" }}>({fmtPct(eb)})</span>
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {fb.w + fb.l + fb.push > 0 ? (
                        <>
                          {fmtRecord(fb)} <span style={{ color: "var(--chalk-dim)" }}>({fmtPct(fb)})</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--chalk-dim)" }}>–</span>
                      )}
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                      {wfb.w + wfb.l + wfb.push > 0 ? (
                        <>
                          {fmtRecord(wfb)} <span style={{ color: "var(--chalk-dim)" }}>({fmtPct(wfb)})</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--chalk-dim)" }}>–</span>
                      )}
                    </td>
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

function FilterBar({ years, toggleYear, week, setWeek, confFilters, toggleConf, teamQuery, setTeamQuery, weeksAvailable, allConfs }: any) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
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
          {weeksAvailable.map((w: number) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </label>

      <input placeholder="Search team…" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} style={{ minWidth: 150 }} />

      <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginLeft: "0.5rem" }}>Conferences (multi-select):</span>
      {["P4", "G6", ...allConfs].map((c: string) => {
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
    </div>
  );
}

export default function BetHistoryAdminPanel({ onBack }: { onBack: () => void }) {
  const allConfs = useMemo(() => availableConferences(), []);
  const [tab, setTab] = useState<"plain" | "custom">("custom");

  const [years, setYears] = useState<Set<number>>(new Set(SEASONS));
  const [week, setWeek] = useState<number | "all">("all");
  const [confFilters, setConfFilters] = useState<Set<string>>(new Set());
  const [teamQuery, setTeamQuery] = useState("");

  const [params, setParams] = useState<CustomParams>({ ...DEFAULT_CUSTOM_PARAMS });

  function toggleYear(y: number) {
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

  function setParam(key: keyof CustomParams, value: number) {
    setParams((prev) => ({ ...prev, [key]: value }));
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

  const plainAgg = useMemo(() => aggregatePlain(filtered), [filtered]);
  const customAgg = useMemo(() => aggregateCustom(filtered, params), [filtered, params]);

  const plainByConf = useMemo(() => breakdownByConference(filtered, "plain"), [filtered]);
  const plainByTeam = useMemo(() => breakdownByTeam(filtered, "plain"), [filtered]);
  const customByConf = useMemo(() => breakdownByConference(filtered, "custom", params), [filtered, params]);
  const customByTeam = useMemo(() => breakdownByTeam(filtered, "custom", params), [filtered, params]);

  const weeksAvailable = Array.from(new Set(filtered.map((r) => r.week))).sort((a, b) => a - b);

  function toWeekMap(agg: typeof plainAgg, which: "everyBet" | "filteredBet" | "weightedFilteredBet") {
    const m = new Map<number, RecordTally>();
    for (const [w, v] of agg.byWeek) m.set(w, v[which]);
    return m;
  }

  const isDefault =
    params.filterThreshold === DEFAULT_CUSTOM_PARAMS.filterThreshold &&
    params.minAbsLine === DEFAULT_CUSTOM_PARAMS.minAbsLine &&
    params.posThreshold === DEFAULT_CUSTOM_PARAMS.posThreshold &&
    params.negThreshold === DEFAULT_CUSTOM_PARAMS.negThreshold;

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Bet History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        <strong>Plain History</strong> shows the data exactly as uploaded — the actual
        historical record, unchanged. <strong>Custom</strong> ignores those precomputed
        columns and recomputes Every Bet / Filtered Bet / Weighted Filtered Bet fresh from the
        raw spread and prediction, live, as you adjust the four parameters below. Conferences
        are multi-select — pick more than one at once. Breakdown tables below slice all three
        categories by conference and by team.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button className={`mode-btn ${tab === "plain" ? "mode-btn-active" : ""}`} onClick={() => setTab("plain")}>
          Plain History
        </button>
        <button className={`mode-btn ${tab === "custom" ? "mode-btn-active" : ""}`} onClick={() => setTab("custom")}>
          Custom
        </button>
      </div>

      <FilterBar
        years={years}
        toggleYear={toggleYear}
        week={week}
        setWeek={setWeek}
        confFilters={confFilters}
        toggleConf={toggleConf}
        teamQuery={teamQuery}
        setTeamQuery={setTeamQuery}
        weeksAvailable={weeksAvailable}
        allConfs={allConfs}
      />

      {tab === "custom" && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: "1.5rem",
            padding: "0.9rem",
            background: "var(--turf-panel)",
            border: "1px solid var(--hash)",
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            Filtered Bet threshold (abs amount off &gt;){" "}
            <input
              type="number"
              step="0.5"
              value={params.filterThreshold}
              onChange={(e) => setParam("filterThreshold", parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            Min abs betting line (&gt;, no pick'ems){" "}
            <input
              type="number"
              step="0.5"
              value={params.minAbsLine}
              onChange={(e) => setParam("minAbsLine", parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            Relative-off positive threshold (&gt;){" "}
            <input
              type="number"
              step="0.1"
              value={params.posThreshold}
              onChange={(e) => setParam("posThreshold", parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
            Relative-off negative threshold (&lt;){" "}
            <input
              type="number"
              step="0.1"
              value={params.negThreshold}
              onChange={(e) => setParam("negThreshold", parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <button className="menu-btn" onClick={() => setParams({ ...DEFAULT_CUSTOM_PARAMS })} disabled={isDefault}>
            Reset to defaults
          </button>
        </div>
      )}

      {BET_HISTORY.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No bet history data uploaded yet.</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No games match those filters.</p>
      ) : tab === "plain" ? (
        <>
          <StatsBlock title="Every Game Bet" overall={plainAgg.overall.everyBet} byWeek={toWeekMap(plainAgg, "everyBet")} />
          <StatsBlock title="Filtered Bet" overall={plainAgg.overall.filteredBet} byWeek={toWeekMap(plainAgg, "filteredBet")} />
          <StatsBlock
            title="Weighted Filtered Bet"
            overall={plainAgg.overall.weightedFilteredBet}
            byWeek={toWeekMap(plainAgg, "weightedFilteredBet")}
          />
          <BreakdownTable title="Breakdown by Conference" breakdown={plainByConf} />
          <BreakdownTable title="Breakdown by Team" breakdown={plainByTeam} maxHeight={500} />
        </>
      ) : (
        <>
          <StatsBlock title="Every Game Bet" overall={customAgg.overall.everyBet} byWeek={toWeekMap(customAgg, "everyBet")} />
          <StatsBlock
            title={`Filtered Bet (abs amount off > ${params.filterThreshold})`}
            overall={customAgg.overall.filteredBet}
            byWeek={toWeekMap(customAgg, "filteredBet")}
          />
          <StatsBlock
            title={`Weighted Filtered Bet (line > ${params.minAbsLine}, relative off > ${params.posThreshold} or < ${params.negThreshold})`}
            overall={customAgg.overall.weightedFilteredBet}
            byWeek={toWeekMap(customAgg, "weightedFilteredBet")}
          />
          <BreakdownTable title="Breakdown by Conference" breakdown={customByConf} />
          <BreakdownTable title="Breakdown by Team" breakdown={customByTeam} maxHeight={500} />
        </>
      )}
    </div>
  );
}
