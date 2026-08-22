import { distributionAtLeastPct, type TeamSimResult } from "../lib/montecarlo/engine";

// Shared between the Monte Carlo admin tab (conference picked from a
// dropdown) and every public Conference Preview page (conference fixed to
// that page's own conference). Both sides read the same saved Monte Carlo
// run — the admin tab lets you pick which saved run, the public page
// always uses the most recent one for the season, so this table updates
// itself the moment a new run is saved without either side needing its
// own copy of the rendering logic.

function fmtRec(w: number, l: number) {
  return `${w}-${l}`;
}

// Green at the high end (near-certain), fading through amber, to plain
// text once the odds get thin enough that highlighting would just be
// noise. A guaranteed 0-loss floor (win >= 0 games) is always 100% and
// shown as a checkmark instead of a redundant "100%" in every row.
function standingsHeatBg(pct: number): string | undefined {
  if (pct < 15) return undefined;
  if (pct >= 95) return "rgba(90, 168, 105, 0.55)";
  if (pct >= 80) return "rgba(90, 168, 105, 0.35)";
  if (pct >= 60) return "rgba(214, 158, 46, 0.35)";
  if (pct >= 35) return "rgba(214, 158, 46, 0.2)";
  return undefined;
}

export default function ConferenceStandingsOddsTable({
  results,
  numTrials,
  conference,
}: {
  results: TeamSimResult[];
  numTrials: number;
  conference: string;
}) {
  const teams = results.filter((r) => r.conf === conference);
  if (teams.length === 0) {
    return <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>No teams found for {conference} in this run.</p>;
  }

  // Runs saved before conference-win tracking was added to the engine won't
  // have confWinDistribution/confCurrentWins/confCurrentLosses in their
  // stored JSONB at all, even though TeamSimResult now types them as
  // present. Detect that case up front and show a clear message instead of
  // silently rendering "undefined-undefined" and a single empty "0" column.
  const hasConfData = teams.some((t) => (t.confWinDistribution ?? []).some((c) => c > 0));
  if (!hasConfData) {
    return (
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        This saved run predates conference-win tracking, so {conference} standings odds aren't available for it. Run and save a
        new Monte Carlo simulation to see this table.
      </p>
    );
  }

  // Column count is read straight off the data (the highest conference-win
  // bucket any team in this conference actually has trials in) rather than
  // hardcoded, so it stays correct whichever conference is picked and
  // however many conference games it plays, realignment included.
  const maxConfGames = Math.max(
    0,
    ...teams.map((t) => {
      const dist = t.confWinDistribution ?? [];
      let max = 0;
      for (let w = dist.length - 1; w >= 0; w--) {
        if (dist[w] > 0) {
          max = w;
          break;
        }
      }
      return max;
    })
  );
  const columns = Array.from({ length: maxConfGames + 1 }, (_, i) => maxConfGames - i); // descending, e.g. 9..0

  const rows = teams
    .map((t) => {
      const dist = t.confWinDistribution ?? [];
      const sum = dist.reduce((s, c, w) => s + c * w, 0);
      const avgConfWins = numTrials > 0 ? sum / numTrials : 0;
      return { team: t, avgConfWins };
    })
    .sort((a, b) => b.avgConfWins - a.avgConfWins);

  return (
    <div className="table-scroll" style={{ overflow: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 700 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
        <thead>
          <tr>
            <th className="th">Rk</th>
            <th className="th">Team</th>
            <th className="th th-right">Rec</th>
            <th className="th th-right">Avg</th>
            {columns.map((c) => (
              <th key={c} className="th th-right">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, avgConfWins }, idx) => (
            <tr key={team.team}>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" }}>{idx + 1}</td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>{team.team}</td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                {fmtRec(team.confCurrentWins ?? 0, team.confCurrentLosses ?? 0)}
              </td>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", textAlign: "right", fontWeight: 700 }}>
                {avgConfWins.toFixed(1)}
              </td>
              {columns.map((c) => {
                const pct = distributionAtLeastPct(team.confWinDistribution, numTrials, c);
                return (
                  <td
                    key={c}
                    style={{
                      padding: "0.3rem 0.5rem",
                      borderBottom: "1px solid var(--hash)",
                      textAlign: "right",
                      background: standingsHeatBg(pct),
                    }}
                  >
                    {c === 0 ? "✓" : pct < 0.5 ? "" : `${Math.round(pct)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
