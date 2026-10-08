import { useState, type CSSProperties } from "react";
import { useTotalsPopupData } from "../lib/totalsPopupData";
import { BreakdownTable, LeaguePoolNote, TeamStatsLine } from "./TotalBreakdownView";
import MatchupTotalsPopup, { CallText, LockedBadge, fmt, sgn } from "./MatchupTotalsPopup";

const DIM: CSSProperties = { color: "var(--chalk-dim)" };
const OVER = "#8fd39a";
const UNDER = "#e07a7a";

// Compact totals-model summary for the bottom of the regular matchup popup, with the full breakdown folded
// underneath and a button for the dedicated totals popup.
export default function TotalsModelBlock({ season, week, awayTeam, homeTeam }: { season: number; week: number; awayTeam: string; homeTeam: string }) {
  const d = useTotalsPopupData(season, week, awayTeam, homeTeam);
  const [open, setOpen] = useState(false);
  const b = d.breakdown;
  return (
    <div style={{ borderTop: "1px solid var(--hash)", marginTop: "1.1rem", paddingTop: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.4rem" }}>
        <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", ...DIM }}>Totals model</div>
        <button className="mode-btn" onClick={() => setOpen(true)} disabled={!d.row}>
          Open full totals popup
        </button>
      </div>
      {d.loading ? (
        <p style={{ fontSize: "0.78rem", margin: 0, ...DIM }}>Loading…</p>
      ) : !d.row ? (
        <p style={{ fontSize: "0.78rem", margin: 0, ...DIM }}>No totals model data for this game.</p>
      ) : (
        <>
          <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ ...DIM, padding: "0.15rem 0" }}>Projected total<LockedBadge locked={d.locked} /></td>
                <td style={{ textAlign: "right" }}>
                  <strong>{fmt(d.myTotal)}</strong> vs Vegas {fmt(d.vegasOpen)} open → {fmt(d.vegasCurrent ?? d.vegasUsed)} {d.completed ? "close" : "now"}
                </td>
              </tr>
              <tr>
                <td style={{ ...DIM, padding: "0.15rem 0" }}>Amount off · std dev off</td>
                <td style={{ textAlign: "right" }}>
                  {sgn(d.amountOff)} · {sgn(d.stdDevOff, 2)} SD <span style={{ marginLeft: "0.4rem" }}><CallText call={d.call} filtered={d.isFiltered} /></span>
                </td>
              </tr>
              {b && (
                <tr>
                  <td style={{ ...DIM, padding: "0.15rem 0" }}>Stats only, no market total</td>
                  <td style={{ textAlign: "right" }}>{fmt(b.noMarket.total)}</td>
                </tr>
              )}
              {d.drivers.length > 0 && (
                <tr>
                  <td style={{ ...DIM, padding: "0.15rem 0", verticalAlign: "top" }}>Top drivers</td>
                  <td style={{ textAlign: "right" }}>
                    {d.drivers.map((s, i) => (
                      <span key={s.key}>
                        {i > 0 ? " · " : ""}
                        {s.label} <strong style={{ color: s.contribution >= 0 ? OVER : UNDER }}>{sgn(s.contribution, 2)}</strong>
                      </span>
                    ))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {b && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.78rem", ...DIM }}>Show how the model got there</summary>
              <div style={{ marginTop: "0.5rem" }}>
                {d.locked && d.liveTotal != null && (
                  <p style={{ fontSize: "0.72rem", margin: "0 0 0.4rem", ...DIM }}>
                    Locked at {fmt(d.lockedTotal)}; this table re-runs the model on today's stats and projects {fmt(b.breakdown.total)}.
                  </p>
                )}
                <p style={{ fontSize: "0.75rem", margin: "0 0 0.4rem", ...DIM }}>
                  <TeamStatsLine label={homeTeam} t={b.home} />
                  <TeamStatsLine label={awayTeam} t={b.away} />
                </p>
                <BreakdownTable b={b.breakdown} withStats compact />
                {d.league && <LeaguePoolNote league={d.league} />}
              </div>
            </details>
          )}
        </>
      )}
      {open && <MatchupTotalsPopup season={season} week={week} awayTeam={awayTeam} homeTeam={homeTeam} onClose={() => setOpen(false)} />}
    </div>
  );
}
