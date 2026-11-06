// "Std Devs" tab on Rating Systems Matchups: for one saved week, every
// team's value in every system expressed as standard deviations from that
// system's FBS average that week (negative = better, the site's sign
// convention). This is the number the standardized build works from, before
// the points-per-SD multiplier. The top rows show what each system's FBS
// average and SD were that week (the SD is its "points per SD" as stored).

import { useEffect, useMemo, useState } from "react";
import TeamLink from "./TeamLink";
import { TEAMS_BY_NAME } from "../data/teams";
import { RATING_SYSTEMS } from "../lib/ratingSystems";
import { standardizeWeek, type ScaleStat } from "../lib/ratingStandardize";

const CP: React.CSSProperties = {
  padding: "0.25rem 0.45rem",
  fontSize: "0.74rem",
  borderBottom: "1px solid var(--a-tint-2)",
  whiteSpace: "nowrap",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
const STICKY: React.CSSProperties = { position: "sticky", left: 0, background: "var(--turf-panel)", zIndex: 2, textAlign: "left" };

// Stronger tint the further from average; green = better (negative), red = worse.
function tint(z: number | undefined): string | undefined {
  if (z == null) return undefined;
  const a = Math.min(Math.abs(z) / 2.5, 1) * 0.35;
  return z < 0 ? `rgba(46, 160, 90, ${a})` : `rgba(210, 70, 60, ${a})`;
}

export default function StdDevsTab({
  ratingsByWeek,
  weeks,
  initialWeek,
  weights,
  scaleStat,
  divFilter,
  confFilter,
}: {
  ratingsByWeek: Map<number, Record<string, Record<string, number>>>;
  weeks: number[];
  initialWeek: number | null;
  weights: Record<string, number> | null;
  scaleStat: ScaleStat;
  divFilter: "all" | "FBS" | "FCS";
  confFilter: string;
}) {
  const [week, setWeek] = useState<number | null>(initialWeek ?? weeks[weeks.length - 1] ?? null);
  // Follow the page's week dropdown when it points at a saved week.
  useEffect(() => {
    if (initialWeek != null) setWeek(initialWeek);
  }, [initialWeek]);
  const [sortKey, setSortKey] = useState("yc");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Old-method twins have no SD view of their own; show every other system.
  const systems = RATING_SYSTEMS.filter((s) => s.key !== "yc_legacy" && s.key !== "consensus_legacy");

  const data = useMemo(() => {
    const byTeam = week != null ? ratingsByWeek.get(week) : undefined;
    if (!byTeam) return null;
    return standardizeWeek(byTeam, { multiplier: 1, scaleStat, weights });
  }, [ratingsByWeek, week, scaleStat, weights]);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = Object.entries(data.byTeam)
      .filter(([team]) => {
        const t = TEAMS_BY_NAME[team];
        if (!t) return false;
        if (divFilter !== "all" && t.div !== divFilter) return false;
        if (confFilter && t.conf !== confFilter) return false;
        return true;
      })
      .map(([team, z]) => ({ team, z }));
    list.sort((a, b) => {
      if (sortKey === "team") return sortDir === "asc" ? a.team.localeCompare(b.team) : b.team.localeCompare(a.team);
      const av = a.z[sortKey];
      const bv = b.z[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [data, divFilter, confFilter, sortKey, sortDir]);

  function sortBy(key: string) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const arrow = (key: string) => (key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  if (weeks.length === 0) return <div className="empty matchups-empty">No saved weeks yet.</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
        <label>
          Saved week{" "}
          <select value={week ?? ""} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "var(--chalk-dim)", fontSize: "0.78rem" }}>
          {rows.length} teams · values are standard deviations from each system's FBS average that week ({scaleStat === "sd" ? "std dev" : "robust MAD"}),
          negative = better. Multiply by the points-per-SD setting to get the standardized power rating.
        </span>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
        YC and Consensus here are rebuilt from these values with the current weights. "Pts / SD" is how many of the system's own stored
        points one standard deviation was that week. A blank column means that system had no usable FBS spread that week.
      </p>

      <div className="table-scroll" style={{ overflowX: "auto", maxHeight: "75vh", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="th" style={{ ...CP, ...STICKY, top: 0, zIndex: 4, background: "var(--turf)", cursor: "pointer" }} onClick={() => sortBy("team")}>
                Team{arrow("team")}
              </th>
              {systems.map((s) => (
                <th
                  key={s.key}
                  className="th th-right"
                  style={{ ...CP, position: "sticky", top: 0, zIndex: 3, background: "var(--turf)", cursor: "pointer" }}
                  onClick={() => sortBy(s.key)}
                >
                  {s.label}
                  {arrow(s.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...CP, ...STICKY, color: "var(--chalk-dim)" }}>FBS avg (stored)</td>
              {systems.map((s) => (
                <td key={s.key} style={{ ...CP, color: "var(--chalk-dim)" }}>
                  {data?.scales[s.key] ? data.scales[s.key]!.center.toFixed(1) : "–"}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...CP, ...STICKY, color: "var(--chalk-dim)", borderBottom: "2px solid var(--hash)" }}>Pts / SD (stored)</td>
              {systems.map((s) => (
                <td key={s.key} style={{ ...CP, color: "var(--chalk-dim)", borderBottom: "2px solid var(--hash)" }}>
                  {data?.scales[s.key] ? data.scales[s.key]!.scale.toFixed(2) : "–"}
                </td>
              ))}
            </tr>
            {rows.map(({ team, z }) => (
              <tr key={team}>
                <td style={{ ...CP, ...STICKY, fontWeight: 600 }}>
                  <TeamLink team={team} />
                </td>
                {systems.map((s) => (
                  <td key={s.key} style={{ ...CP, background: tint(z[s.key]), fontWeight: s.key === "yc" || s.key === "consensus" ? 700 : 400 }}>
                    {z[s.key] != null ? `${z[s.key] > 0 ? "+" : ""}${z[s.key].toFixed(2)}` : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
