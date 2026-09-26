import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "./SortHeader";
import TeamLink from "./TeamLink";
import { TEAMS } from "../data/teams";
import type { WeekSaveInfo } from "../lib/api/ratingSystems";

interface Loaded {
  weeks: number[];
  byWeek: Record<number, Record<string, number | null>>;
  weekInfo: Record<number, WeekSaveInfo>;
}

const cell: CSSProperties = { padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" };
const right: CSSProperties = { ...cell, textAlign: "right" };

function fmtChange(v: number | null, digits: number) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

/**
 * Admin view of what "Save to Site" actually stored: every team x every
 * saved week, plus Week Change (latest saved week vs the one before) and
 * Season Change (latest vs the first saved week). Reads the same archive
 * table the public Weekly Progression page reads. `refreshKey` bumps after
 * a save so the new week shows up without a manual reload.
 */
export default function SavedWeekProgression({
  title,
  description,
  fetchByWeeks,
  refreshKey,
  digits = 2,
  higherIsBetter,
}: {
  title: string;
  description?: string;
  fetchByWeeks: (season: number) => Promise<Loaded>;
  refreshKey: number;
  digits?: number;
  // Colors the change columns: true = up is good (Resume), false = up is bad.
  // Omit for no coloring.
  higherIsBetter?: boolean;
}) {
  const season = new Date().getFullYear();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [division, setDivision] = useState<"FBS" | "FCS" | "all">("FBS");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("latest");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchByWeeks(season)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message ?? "Failed to load saved weeks");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fetchByWeeks is a stable module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, refreshKey, reloadTick]);

  const rows = useMemo(() => {
    if (!data) return [];
    const { weeks, byWeek } = data;
    return TEAMS.filter((t) => (division === "all" || t.div === division) && (!query || t.team.toLowerCase().includes(query.toLowerCase())))
      .map((t) => {
        // Walk newest -> oldest per team: a team can be missing from a week
        // (e.g. FBS-only early saves) while present in others.
        const vals = weeks.map((w) => byWeek[w]?.[t.team] ?? null);
        let latestIdx = -1;
        for (let i = vals.length - 1; i >= 0; i--) {
          if (vals[i] != null) {
            latestIdx = i;
            break;
          }
        }
        const latest = latestIdx >= 0 ? vals[latestIdx] : null;
        let prev: number | null = null;
        let first: number | null = null;
        for (let i = latestIdx - 1; i >= 0; i--) {
          if (vals[i] != null) {
            prev = prev ?? vals[i];
            first = vals[i];
          }
        }
        return {
          team: t.team,
          conf: t.conf,
          vals,
          latest,
          weekChange: latest != null && prev != null ? latest - prev : null,
          seasonChange: latest != null && first != null ? latest - first : null,
        };
      });
  }, [data, division, query]);

  const sorted = useMemo(() => {
    const weeks = data?.weeks ?? [];
    const get = (r: (typeof rows)[number]): string | number | null => {
      if (sortKey === "team") return r.team;
      if (sortKey === "conf") return r.conf;
      if (sortKey === "latest") return r.latest;
      if (sortKey === "weekChange") return r.weekChange;
      if (sortKey === "seasonChange") return r.seasonChange;
      if (sortKey.startsWith("w")) return r.vals[weeks.indexOf(Number(sortKey.slice(1)))] ?? null;
      return null;
    };
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDir, data]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team" || key === "conf" ? "asc" : "desc");
    }
  }

  function changeColor(v: number | null): string | undefined {
    if (v == null || v === 0 || higherIsBetter == null) return undefined;
    return v > 0 === higherIsBetter ? "#8fd39a" : "#c45c52";
  }

  const weeks = data?.weeks ?? [];

  return (
    <div style={{ marginTop: "2rem" }}>
      <h2>{title}</h2>
      {description && <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>{description}</p>}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        {(["FBS", "FCS", "all"] as const).map((d) => (
          <button key={d} className={`mode-btn ${division === d ? "mode-btn-active" : ""}`} onClick={() => setDivision(d)}>
            {d === "all" ? "All" : d}
          </button>
        ))}
        <input className="search" placeholder="Search a team…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 170 }} />
        <button className="menu-btn" onClick={() => setReloadTick((n) => n + 1)} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem", fontSize: "0.74rem" }}>
        {weeks.length === 0 && !loading && <span style={{ color: "var(--chalk-dim)" }}>Nothing saved yet this season.</span>}
        {weeks.map((w) => {
          const info = data?.weekInfo[w];
          return (
            <span
              key={w}
              style={{
                padding: "0.2rem 0.5rem",
                border: "1px solid var(--hash)",
                borderRadius: 6,
                background: "var(--turf-panel)",
                color: info?.legacy ? "#d9a441" : undefined,
              }}
              title={info?.legacy ? "Saved before the blend existed — no blend values for this week" : undefined}
            >
              {w === 0 ? "Pre" : `Wk ${w}`} · {info?.teams ?? 0} teams
              {info?.updatedAt ? ` · saved ${new Date(info.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
              {info?.legacy ? " · no blend" : ""}
            </span>
          );
        })}
      </div>

      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 700, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Conf" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
              {weeks.map((w) => (
                <SortHeader key={w} label={w === 0 ? "Pre" : `Wk ${w}`} sortKey={`w${w}`} active={sortKey === `w${w}`} dir={sortDir} onClick={handleSort} align="right" />
              ))}
              <SortHeader label="Week Change" sortKey="weekChange" active={sortKey === "weekChange"} dir={sortDir} onClick={handleSort} align="right" />
              <SortHeader label="Season Change" sortKey="seasonChange" active={sortKey === "seasonChange"} dir={sortDir} onClick={handleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team}>
                <td style={{ ...cell, fontWeight: 700 }}>
                  <TeamLink team={r.team} />
                </td>
                <td style={cell}>{r.conf}</td>
                {r.vals.map((v, i) => (
                  <td key={weeks[i]} style={right}>
                    {v != null ? v.toFixed(digits) : "–"}
                  </td>
                ))}
                <td style={{ ...right, fontWeight: 700, color: changeColor(r.weekChange) }}>{fmtChange(r.weekChange, digits)}</td>
                <td style={{ ...right, fontWeight: 700, color: changeColor(r.seasonChange) }}>{fmtChange(r.seasonChange, digits)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4 + weeks.length} className="empty">
                  {loading ? "Loading…" : "No teams to show."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.75rem" }}>
        Week Change = latest saved week minus the previous saved week; Season Change = latest minus the first saved week. "–" = that team wasn't in that week's save.
      </p>
    </div>
  );
}
