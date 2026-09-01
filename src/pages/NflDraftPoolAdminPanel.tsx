import { useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import { computeNflWinTotals, RATING_SYSTEMS, type NflWinTotalRow } from "../lib/nflWinTotals";

// NFL win-total draft pool: 4 players (Kal, Presley, Ethan, YC) each draft
// teams, whoever has the highest combined win total wins. Entirely static
// — no data pulls, no Supabase. computeNflWinTotals() runs once off the
// hardcoded schedule + power ratings in data/nflDraftPoolData.ts (see
// that file's header for how to update the ratings next season) using
// the same rating-diff -> spread -> win% -> season-sum approach as the
// college Win Totals pages.
//
// Draft assignments are kept in plain React state on purpose (per Chris
// — this is a live draft-night tool, not something that needs to survive
// a refresh or be checked from another device). Refreshing the page
// clears the draft.

const PLAYERS = ["Kal", "Presley", "Ethan", "YC"] as const;
type Player = (typeof PLAYERS)[number];

function fmtWins(v: number): string {
  return v.toFixed(1);
}

function compareValues(a: number | string | null, b: number | string | null, dir: "asc" | "desc"): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return dir === "asc" ? a - b : b - a;
  }
  const as = String(a);
  const bs = String(b);
  return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
}

function sortValue(r: NflWinTotalRow, key: string): number | string | null {
  if (key === "team") return r.name;
  if (key === "average") return r.average;
  if (key === "high") return r.high;
  if (key === "low") return r.low;
  return r.winsBySystem[key] ?? null;
}

const cellStyle = { padding: "0.35rem 0.6rem", borderBottom: "1px solid var(--hash)" } as const;
const rightCellStyle = { ...cellStyle, textAlign: "right" as const };

export default function NflDraftPoolAdminPanel({ onBack }: { onBack: () => void }) {
  const rows = useMemo(() => computeNflWinTotals(), []);

  const [sortKey, setSortKey] = useState("average");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [assignments, setAssignments] = useState<Record<string, Player>>({});
  const [hideDrafted, setHideDrafted] = useState(false);

  function handleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedRows = useMemo(() => {
    const visible = hideDrafted ? rows.filter((r) => !assignments[r.team]) : rows;
    return [...visible].sort((a, b) => compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir));
  }, [rows, sortKey, sortDir, hideDrafted, assignments]);

  const draftedCount = Object.keys(assignments).length;

  const playerSummaries = useMemo(() => {
    return PLAYERS.map((p) => {
      const teams = rows.filter((r) => assignments[r.team] === p);
      const totalAvg = teams.reduce((sum, r) => sum + r.average, 0);
      return { player: p, teams, totalAvg };
    });
  }, [rows, assignments]);

  function assign(team: string, player: Player) {
    setAssignments((prev) => ({ ...prev, [team]: player }));
  }
  function unassign(team: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[team];
      return next;
    });
  }
  function resetDraft() {
    if (draftedCount > 0 && !window.confirm(`Clear all ${draftedCount} draft picks?`)) return;
    setAssignments({});
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <h2 style={{ marginTop: 0 }}>NFL Win Total Draft</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", maxWidth: 680 }}>
        Projected season win total for every team, per power-rating system (rating diff ± home field advantage →
        win% → summed over the full 18-week schedule), plus the average/high/low across all 8 systems. Draft teams
        to Kal, Presley, Ethan, or YC below — assigned teams show crossed out. Nothing here is saved: this is a
        live-draft tool, and a refresh clears picks.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.6rem", margin: "1rem 0 1.5rem" }}>
        {playerSummaries.map(({ player, teams, totalAvg }) => (
          <div key={player} style={{ background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8, padding: "0.7rem 0.9rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.2rem" }}>{player}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
              {teams.length} team{teams.length === 1 ? "" : "s"} · {fmtWins(totalAvg)} proj. wins
            </div>
            {teams.length > 0 && (
              <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "0.3rem" }}>
                {teams.map((t) => t.team).join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
          <input type="checkbox" checked={hideDrafted} onChange={(e) => setHideDrafted(e.target.checked)} />
          Hide drafted teams (best available only)
        </label>
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          {draftedCount} / {rows.length} drafted
        </span>
        <button className="menu-btn" onClick={resetDraft} disabled={draftedCount === 0} style={{ fontSize: "0.78rem", padding: "0.3rem 0.7rem" }}>
          Reset draft
        </button>
      </div>

      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 700, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              {RATING_SYSTEMS.map((sys) => (
                <SortHeader key={sys.key} label={sys.label} sortKey={sys.key} active={sortKey === sys.key} dir={sortDir} onClick={handleSort} align="right" />
              ))}
              <SortHeader label="Average" sortKey="average" active={sortKey === "average"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="High" sortKey="high" active={sortKey === "high"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Low" sortKey="low" active={sortKey === "low"} dir={sortDir} onClick={handleSort} align="right" />
              <th className="th">Drafted By</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => {
              const owner = assignments[r.team];
              return (
                <tr key={r.team}>
                  <td style={{ ...cellStyle, textDecoration: owner ? "line-through" : "none", color: owner ? "var(--chalk-dim)" : "inherit" }}>
                    {r.name} <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({r.team})</span>
                  </td>
                  {RATING_SYSTEMS.map((sys) => (
                    <td key={sys.key} style={rightCellStyle}>
                      {fmtWins(r.winsBySystem[sys.key])}
                    </td>
                  ))}
                  <td style={{ ...rightCellStyle, fontWeight: 700 }}>{fmtWins(r.average)}</td>
                  <td style={rightCellStyle}>{fmtWins(r.high)}</td>
                  <td style={rightCellStyle}>{fmtWins(r.low)}</td>
                  <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                    {owner ? (
                      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontWeight: 700 }}>{owner}</span>
                        <button onClick={() => unassign(r.team)} className="menu-btn" style={{ fontSize: "0.68rem", padding: "0.1rem 0.4rem" }}>
                          undo
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                        {PLAYERS.map((p) => (
                          <button
                            key={p}
                            onClick={() => assign(r.team, p)}
                            className="menu-btn"
                            style={{ fontSize: "0.68rem", padding: "0.1rem 0.4rem" }}
                          >
                            {p}
                          </button>
                        ))}
                      </span>
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
