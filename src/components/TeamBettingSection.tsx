import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { type BetHistoryRecord, type BetPick } from "../data/betHistory.data";
import { TEAMS_BY_NAME } from "../data/teams";
import { computeCustomGrading, DEFAULT_CUSTOM_PARAMS, emptyTally, winPct, type RecordTally } from "../lib/betHistory";
import { useBetHistoryRecords, BET_HISTORY_SEASONS } from "../lib/useBetHistoryRecords";
import { fetchTeamCoaches, type TeamCoachRow } from "../lib/api/teamInfo";
import SortHeader from "./SortHeader";
import TeamLink from "./TeamLink";

// My betting record by team, graded the same way as Bet History's Custom tab (default parameters, closing line,
// live projections). Four buckets per team:
//   Every bet · picked them      — games where Every Bet took this team, right or wrong
//   Filtered · picked them       — games where the Filtered Bet took this team
//   Every bet · their games      — every game they played, whichever side Every Bet took
//   Filtered · their games       — every Filtered Bet in their games, whichever side
// The first two say how well I project this team to cover; the last two say how well I project their games overall.

type BucketKey = "everyPicked" | "filteredPicked" | "everyInvolved" | "filteredInvolved";

const BUCKETS: { key: BucketKey; label: string; help: string }[] = [
  { key: "everyPicked", label: "Every bet · picked them", help: "Every Bet took this team to cover" },
  { key: "filteredPicked", label: "Filtered · picked them", help: "Filtered Bet took this team to cover" },
  { key: "everyInvolved", label: "Every bet · their games", help: "Every game they played, whichever side Every Bet took" },
  { key: "filteredInvolved", label: "Filtered · their games", help: "Every Filtered Bet in their games, whichever side" },
];

interface GradedGame {
  record: BetHistoryRecord;
  everyTeam: string | null;
  everyResult: BetPick;
  filteredTeam: string | null;
  filteredResult: BetPick;
}

interface TeamRow {
  team: string;
  tallies: Record<BucketKey, RecordTally>;
  games: Record<BucketKey, GradedGame[]>;
}

const cell: CSSProperties = { padding: "0.3rem 0.55rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

function addResult(t: RecordTally, result: BetPick) {
  if (result === "win") t.w++;
  else if (result === "loss") t.l++;
  else if (result === "push") t.push++;
}

function fmtTally(t: RecordTally): string {
  if (t.w + t.l + t.push === 0) return "–";
  return `${t.w}-${t.l}${t.push ? `-${t.push}` : ""} (${winPct(t).toFixed(0)}%)`;
}

function pctColor(t: RecordTally): string | undefined {
  if (t.w + t.l < 3) return undefined;
  const p = winPct(t);
  return p >= 55 ? "var(--c-ok)" : p <= 45 ? "var(--c-err)" : undefined;
}

function fmtLine(v: number): string {
  return `${v > 0 ? "+" : ""}${v}`;
}

function resultStyle(r: BetPick): CSSProperties {
  return { ...cell, fontWeight: 700, color: r === "win" ? "var(--c-ok)" : r === "loss" ? "var(--c-err)" : "var(--chalk-dim)" };
}

export default function TeamBettingSection() {
  const currentSeason = new Date().getFullYear();
  const { records, loading } = useBetHistoryRecords("team", "close");
  const [years, setYears] = useState<Set<number>>(new Set([currentSeason]));
  const [coachOnly, setCoachOnly] = useState(false);
  const [coaches, setCoaches] = useState<Record<string, TeamCoachRow>>({});
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"team" | BucketKey>("everyInvolved");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [open, setOpen] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<BucketKey>("everyPicked");

  useEffect(() => {
    fetchTeamCoaches(currentSeason)
      .then(setCoaches)
      .catch(() => setCoaches({}));
  }, [currentSeason]);

  const rows = useMemo<TeamRow[]>(() => {
    const byTeam = new Map<string, TeamRow>();
    const rowFor = (team: string): TeamRow => {
      let row = byTeam.get(team);
      if (!row) {
        row = {
          team,
          tallies: { everyPicked: emptyTally(), filteredPicked: emptyTally(), everyInvolved: emptyTally(), filteredInvolved: emptyTally() },
          games: { everyPicked: [], filteredPicked: [], everyInvolved: [], filteredInvolved: [] },
        };
        byTeam.set(team, row);
      }
      return row;
    };
    for (const r of records) {
      if (!years.has(r.season)) continue;
      const g = computeCustomGrading(r, DEFAULT_CUSTOM_PARAMS);
      const graded: GradedGame = {
        record: r,
        everyTeam: g.everyBetTeam,
        everyResult: g.everyBetResult,
        filteredTeam: g.filteredBetTeam,
        filteredResult: g.filteredBetResult,
      };
      for (const team of [r.homeTeam, r.awayTeam]) {
        if (TEAMS_BY_NAME[team]?.div !== "FBS") continue;
        // Current-coach view: only seasons since this team's current head coach started there.
        if (coachOnly) {
          const since = coaches[team]?.first_year_at_school;
          if (since == null || r.season < since) continue;
        }
        const row = rowFor(team);
        if (graded.everyResult != null) {
          addResult(row.tallies.everyInvolved, graded.everyResult);
          row.games.everyInvolved.push(graded);
          if (graded.everyTeam === team) {
            addResult(row.tallies.everyPicked, graded.everyResult);
            row.games.everyPicked.push(graded);
          }
        }
        if (graded.filteredTeam != null && graded.filteredResult != null) {
          addResult(row.tallies.filteredInvolved, graded.filteredResult);
          row.games.filteredInvolved.push(graded);
          if (graded.filteredTeam === team) {
            addResult(row.tallies.filteredPicked, graded.filteredResult);
            row.games.filteredPicked.push(graded);
          }
        }
      }
    }
    return Array.from(byTeam.values());
  }, [records, years, coachOnly, coaches]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.team.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortKey === "team") return sortDir === "asc" ? a.team.localeCompare(b.team) : b.team.localeCompare(a.team);
        const ta = a.tallies[sortKey];
        const tb = b.tallies[sortKey];
        const pa = ta.w + ta.l > 0 ? winPct(ta) : -1;
        const pb = tb.w + tb.l > 0 ? winPct(tb) : -1;
        return sortDir === "asc" ? pa - pb : pb - pa;
      });
  }, [rows, query, sortKey, sortDir]);

  function handleSort(key: string) {
    const k = key as typeof sortKey;
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "team" ? "asc" : "desc");
    }
  }

  function toggleYear(y: number) {
    setYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) {
        if (next.size > 1) next.delete(y);
      } else next.add(y);
      return next;
    });
  }

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0, maxWidth: "75ch" }}>
        Graded like Bet History's Custom tab (default parameters, closing line). <b>Picked them</b> = games where my projection took
        this team to cover, right or wrong. <b>Their games</b> = every game they played, whichever side I took, which measures how well
        I project their games overall. Click a team to see the games in each bucket.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginBottom: "0.75rem" }}>
        {BET_HISTORY_SEASONS.map((y) => (
          <button key={y} className={`mode-btn ${years.has(y) ? "mode-btn-active" : ""}`} onClick={() => toggleYear(y)}>
            {y}
          </button>
        ))}
        <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={coachOnly} onChange={(e) => setCoachOnly(e.target.checked)} />
          Current coach only
        </label>
        <input placeholder="Search team" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 160 }} />
        {loading && <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>Loading {currentSeason} games…</span>}
      </div>
      <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 680, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <SortHeader label="Team" sortKey="team" active={sortKey === "team"} dir={sortDir} onClick={handleSort} />
              {coachOnly && <th style={{ ...cell, textAlign: "left" }}>Coach (since)</th>}
              {BUCKETS.map((b) => (
                <SortHeader key={b.key} label={b.label} sortKey={b.key} active={sortKey === b.key} dir={sortDir} onClick={handleSort} align="right" />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.team}>
                <tr
                  style={{ cursor: "pointer", background: open === r.team ? "var(--turf-panel)" : undefined }}
                  onClick={() => setOpen(open === r.team ? null : r.team)}
                >
                  <td style={{ ...cell, fontWeight: 700 }}>
                    {open === r.team ? "▾ " : "▸ "}
                    {r.team}
                  </td>
                  {coachOnly && (
                    <td style={cell}>
                      {coaches[r.team]?.coach_name ?? "–"} {coaches[r.team]?.first_year_at_school ? `(${coaches[r.team]!.first_year_at_school})` : ""}
                    </td>
                  )}
                  {BUCKETS.map((b) => (
                    <td key={b.key} style={{ ...num, color: pctColor(r.tallies[b.key]) }} title={b.help}>
                      {fmtTally(r.tallies[b.key])}
                    </td>
                  ))}
                </tr>
                {open === r.team && (
                  <tr>
                    <td colSpan={BUCKETS.length + (coachOnly ? 2 : 1)} style={{ padding: "0.6rem 0.8rem", background: "var(--turf-panel)" }}>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem", alignItems: "center" }}>
                        <TeamLink team={r.team} />
                        {BUCKETS.map((b) => (
                          <button
                            key={b.key}
                            className={`mode-btn ${openBucket === b.key ? "mode-btn-active" : ""}`}
                            onClick={() => setOpenBucket(b.key)}
                            style={{ fontSize: "0.74rem" }}
                          >
                            {b.label} · {r.games[b.key].length}
                          </button>
                        ))}
                      </div>
                      <GamesList team={r.team} games={r.games[openBucket]} filtered={openBucket.startsWith("filtered")} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  {loading ? "Loading…" : "No graded games for these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GamesList({ team, games, filtered }: { team: string; games: GradedGame[]; filtered: boolean }) {
  if (games.length === 0) return <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", margin: 0 }}>No games in this bucket.</p>;
  const sorted = [...games].sort((a, b) => b.record.season - a.record.season || b.record.week - a.record.week);
  return (
    <table style={{ borderCollapse: "collapse", fontSize: "0.76rem" }}>
      <thead>
        <tr>
          {["Season", "Wk", "Opponent", "Line", "My proj", "Score", "Picked", "Result"].map((h) => (
            <th key={h} style={{ ...cell, textAlign: h === "Line" || h === "My proj" ? "right" : "left", color: "var(--chalk-dim)" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((g) => {
          const r = g.record;
          const isHome = r.homeTeam === team;
          // spread/prediction are home-relative (negative = home favored); show them from this team's side.
          const sign = isHome ? 1 : -1;
          const picked = filtered ? g.filteredTeam : g.everyTeam;
          const result = filtered ? g.filteredResult : g.everyResult;
          return (
            <tr key={`${r.season}-${r.week}-${r.homeTeam}`}>
              <td style={cell}>{r.season}</td>
              <td style={cell}>{r.week}</td>
              <td style={cell}>
                {isHome ? "vs" : "@"} {isHome ? r.awayTeam : r.homeTeam}
              </td>
              <td style={num}>{fmtLine(sign * r.spread)}</td>
              <td style={num}>{fmtLine(Math.round(sign * r.prediction * 10) / 10)}</td>
              <td style={cell}>
                {isHome ? `${r.homeScore}-${r.awayScore}` : `${r.awayScore}-${r.homeScore}`}
              </td>
              <td style={{ ...cell, fontWeight: picked === team ? 700 : 400 }}>{picked ?? "–"}</td>
              <td style={resultStyle(result)}>{result ?? "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
