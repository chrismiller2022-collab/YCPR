import { useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import ConfLink from "../components/ConfLink";
import { conferencesForDivision, teamsForConference } from "../data/teams";
import { SOS_BY_TEAM } from "../data/sor";
import { RESUME_BY_TEAM } from "../data/resume";
import { hfaFor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";

// ---------------------------------------------------------------------
// Per-conference aggregate row.
// ---------------------------------------------------------------------
interface ConfRow {
  conf: string;
  teamCount: number;
  avgRating: number | null;
  avgSos: number | null;
  avgResume: number | null;
  avgInConfSos: number | null; // placeholder — real in-conference-only SOS calc comes later
  expWins: number;
  expLosses: number;
  expWinPct: number | null;
  actWins: number;
  actLosses: number;
  actWinPct: number | null;
  avgHfa: number | null;
}

function avgOf(values: (number | null | undefined)[]): number | null {
  const usable = values.filter((v): v is number => v != null);
  if (usable.length === 0) return null;
  return usable.reduce((s, v) => s + v, 0) / usable.length;
}

function buildConfRows(div: "FBS" | "FCS", liveByTeam: Record<string, any>): ConfRow[] {
  return conferencesForDivision(div).map((conf) => {
    const teams = teamsForConference(div, conf);

    const ratings = teams.map((t) => liveByTeam[t.team]?.rating ?? t.rating);
    const sosValues = teams.map((t) => liveByTeam[t.team]?.sor ?? SOS_BY_TEAM[t.team] ?? null);
    const resumeValues = teams.map((t) => liveByTeam[t.team]?.resume_rating ?? RESUME_BY_TEAM[t.team]?.rating ?? null);
    const hfaValues = teams.map((t) => hfaFor(t.team, liveByTeam));

    let expWins = 0;
    let expLosses = 0;
    let actWins = 0;
    let actLosses = 0;
    for (const t of teams) {
      const live = liveByTeam[t.team];
      if (!live) continue;
      if (live.total_wins != null) expWins += live.total_wins;
      const liveLosses = live.live_losses ?? 0;
      const lossesLeft = live.losses_left ?? 0;
      if (live.total_wins != null) expLosses += liveLosses + lossesLeft;
      actWins += live.live_wins ?? 0;
      actLosses += live.live_losses ?? 0;
    }

    return {
      conf,
      teamCount: teams.length,
      avgRating: avgOf(ratings),
      avgSos: avgOf(sosValues),
      avgResume: avgOf(resumeValues),
      avgInConfSos: null, // placeholder
      expWins,
      expLosses,
      expWinPct: expWins + expLosses > 0 ? (expWins / (expWins + expLosses)) * 100 : null,
      actWins,
      actLosses,
      actWinPct: actWins + actLosses > 0 ? (actWins / (actWins + actLosses)) * 100 : null,
      avgHfa: avgOf(hfaValues),
    };
  });
}

// ---------------------------------------------------------------------
function fmt(v: number | null, digits = 2) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}
function fmtPlain(v: number | null, digits = 1) {
  if (v == null) return "–";
  return v.toFixed(digits);
}
function fmtPct(v: number | null) {
  if (v == null) return "–";
  return `${v.toFixed(1)}%`;
}

export default function ConferenceOverviewPage({
  onNavigateConference,
  onHome,
}: {
  onNavigateConference?: (conf: string) => void;
  onHome: () => void;
}) {
  const [div, setDiv] = useState<"FBS" | "FCS">("FBS");
  const [sortKey, setSortKey] = useState<keyof ConfRow>("avgRating");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  const rows = useMemo(() => buildConfRows(div, liveByTeam), [div, liveByTeam]);

  function handleSort(key: string) {
    const k = key as keyof ConfRow;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      // Rating/SOS/Resume are negative-is-better, so default to ascending
      // (best first); everything else (wins, %, HFA) defaults to descending
      // (highest first) — matches how each stat reads naturally.
      setSortDir(k === "avgRating" || k === "avgSos" || k === "avgResume" || k === "avgInConfSos" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortDir]);

  return (
    <div className="matchup-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">Conference Previews</div>
        <h1 className="title matchup-title">CONFERENCE COMPARISON</h1>
        <p className="subtitle team-subtitle">
          Every conference at a glance — average power rating, strength of schedule, resume rating, and win totals
          (projected and actual), side by side.
        </p>
      </div>

      <div className="matchup-body compare-body">
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button className={`mode-btn ${div === "FBS" ? "mode-btn-active" : ""}`} onClick={() => setDiv("FBS")}>
            FBS
          </button>
          <button className={`mode-btn ${div === "FCS" ? "mode-btn-active" : ""}`} onClick={() => setDiv("FCS")}>
            FCS
          </button>
        </div>

        <div className="table-wrap compare-table-wrap">
          <div className="table-scroll">
            <table className="matchups-table" style={{ fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <SortHeader label="Conference" sortKey="conf" active={sortKey === "conf"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Teams" sortKey="teamCount" active={sortKey === "teamCount"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Avg Power Rating" sortKey="avgRating" active={sortKey === "avgRating"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Avg SOS" sortKey="avgSos" active={sortKey === "avgSos"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Avg Resume Rating" sortKey="avgResume" active={sortKey === "avgResume"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Avg In-Conf SOS" sortKey="avgInConfSos" active={sortKey === "avgInConfSos"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Exp. Wins" sortKey="expWins" active={sortKey === "expWins"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Exp. Losses" sortKey="expLosses" active={sortKey === "expLosses"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Exp. Win %" sortKey="expWinPct" active={sortKey === "expWinPct"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Act. Wins" sortKey="actWins" active={sortKey === "actWins"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Act. Losses" sortKey="actLosses" active={sortKey === "actLosses"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Act. Win %" sortKey="actWinPct" active={sortKey === "actWinPct"} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Avg HFA" sortKey="avgHfa" active={sortKey === "avgHfa"} dir={sortDir} onClick={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.conf}>
                    <td className="matchup-team-cell">
                      <ConfLink conf={r.conf} onNavigateConference={onNavigateConference} />
                    </td>
                    <td style={{ textAlign: "right" }}>{r.teamCount}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.avgRating)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.avgSos)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.avgResume)}</td>
                    <td style={{ textAlign: "right", color: "var(--chalk-dim)" }}>Coming soon</td>
                    <td style={{ textAlign: "right" }}>{fmtPlain(r.expWins)}</td>
                    <td style={{ textAlign: "right" }}>{fmtPlain(r.expLosses)}</td>
                    <td style={{ textAlign: "right" }}>{fmtPct(r.expWinPct)}</td>
                    <td style={{ textAlign: "right" }}>{r.actWins}</td>
                    <td style={{ textAlign: "right" }}>{r.actLosses}</td>
                    <td style={{ textAlign: "right" }}>{fmtPct(r.actWinPct)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.avgHfa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="footer-note" style={{ marginTop: "1rem" }}>
          Power Rating / SOS / Resume Rating use the negative-is-better convention (lower = stronger), so sorting
          those columns ascending shows the best conferences first. Expected wins/losses come from each team's live
          season-long win projection; expected losses = each team's actual losses so far plus its projected
          remaining losses. Avg In-Conf SOS is a placeholder — a real in-conference-only calculation is coming
          later.
        </div>
      </div>
    </div>
  );
}
