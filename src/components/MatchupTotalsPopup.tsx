import type { CSSProperties, ReactNode } from "react";
import { useTotalsPopupData, type TotalsPopupData } from "../lib/totalsPopupData";
import { TOTAL_BET_THRESHOLD_STDDEV } from "../lib/gameTotalsEngine";
import { BOOK_LABELS } from "../lib/api/placedBets";
import { TOTAL_BIAS_OFFSET } from "../lib/totalModelRidge";
import { BreakdownTable, LeaguePoolNote } from "./TotalBreakdownView";
import type { TeamSeasonInputs } from "../lib/gameTotals";

const OVER = "#8fd39a";
const UNDER = "#e07a7a";
const DIM: CSSProperties = { color: "var(--chalk-dim)" };
const CELL: CSSProperties = { padding: "0.25rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const NUM: CSSProperties = { ...CELL, textAlign: "right", fontVariantNumeric: "tabular-nums" };

export const fmt = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));
// A value that rounds to zero prints as 0.0, never "-0.0".
export const sgn = (v: number | null | undefined, d = 1) => {
  if (v == null || Number.isNaN(v)) return "–";
  const x = Math.abs(v) < 0.5 * 10 ** -d ? 0 : v;
  return `${x > 0 ? "+" : ""}${x.toFixed(d)}`;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--chalk-dim)", margin: "1.1rem 0 0.4rem", borderTop: "1px solid var(--hash)", paddingTop: "0.7rem" }}>
      {children}
    </div>
  );
}

export function LockedBadge({ locked }: { locked: boolean }) {
  return (
    <span
      title={locked ? "Frozen in Freeze Week — this number no longer changes with the model" : "Live model output; not frozen yet"}
      style={{ marginLeft: "0.4rem", fontSize: "0.65rem", fontWeight: 700, padding: "0.1rem 0.35rem", borderRadius: 4, background: locked ? "rgba(217,164,65,0.18)" : "rgba(255,255,255,0.08)", color: locked ? "var(--gold, #d9a441)" : "var(--chalk-dim)" }}
    >
      {locked ? "LOCKED" : "LIVE"}
    </span>
  );
}

export function CallText({ call, filtered }: { call: "Over" | "Under" | null; filtered: boolean }) {
  if (!call) return <span style={DIM}>–</span>;
  return (
    <span style={{ color: call === "Over" ? OVER : UNDER, fontWeight: 700 }}>
      {call}
      {filtered && <span style={{ marginLeft: "0.35rem", fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: 4, background: "rgba(255,255,255,0.1)", color: "var(--chalk)" }}>FILTERED BET</span>}
    </span>
  );
}

function kickoffLabel(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function TeamInputsRow({ label, t, rest, isHome }: { label: string; t: TeamSeasonInputs; rest: number; isHome: boolean }) {
  const g = Math.max(1, t.games);
  return (
    <tr>
      <td style={CELL}>{label} <span style={DIM}>({isHome ? "home" : "away"})</span></td>
      <td style={NUM}>{t.games}</td>
      <td style={NUM}>{fmt(t.offPpa, 3)}</td>
      <td style={NUM}>{fmt(t.defPpa, 3)}</td>
      <td style={NUM}>{fmt(t.offExplosiveness, 3)}</td>
      <td style={NUM}>{fmt(t.defExplosiveness, 3)}</td>
      <td style={NUM}>{t.games > 0 ? fmt(t.offensePlays / g, 1) : "–"}</td>
      <td style={NUM}>{t.games > 0 ? fmt(t.pointsFor / g, 1) : "–"}</td>
      <td style={NUM}>{t.games > 0 ? fmt(t.pointsAgainst / g, 1) : "–"}</td>
      <td style={NUM}>{rest}</td>
    </tr>
  );
}

// "Is my total near a key number" block — nearest key numbers to Vegas's number and to mine, and the study's
// definition of a straddle (a key sitting between my total and Vegas's).
function KeyNumbers({ d }: { d: TotalsPopupData }) {
  const k = d.keys;
  const fmtNear = (arr: typeof k.nearVegas) =>
    arr.length === 0 ? "none within 2 points" : arr.slice(0, 3).map((n) => `${n.key} (T${n.tier}, ${n.distance > 0 ? "+" : ""}${n.distance.toFixed(1)})`).join(", ");
  return (
    <div style={{ fontSize: "0.78rem" }}>
      <div><span style={DIM}>Key numbers near Vegas's {fmt(d.vegasUsed)}:</span> {fmtNear(k.nearVegas)}</div>
      <div><span style={DIM}>Key numbers near my {fmt(d.myTotal)}:</span> {fmtNear(k.nearMine)}</div>
      {k.crossed.length === 0 ? (
        <div style={{ marginTop: "0.3rem", ...DIM }}>No key number sits between my total and Vegas's.</div>
      ) : (
        <div style={{ marginTop: "0.3rem" }}>
          <div style={DIM}>Key numbers between my total and Vegas's (a "straddle"):</div>
          {k.crossed.map((c) => (
            <div key={c.key} style={{ marginLeft: "0.8rem" }}>
              <strong>{c.key}</strong> — {c.tierLabel}; supports the <span style={{ color: c.side === "Over" ? OVER : UNDER, fontWeight: 700 }}>{c.side}</span>
              {c.thisSeason ? (
                <span style={DIM}> · this season's {c.side} straddles of {c.key}: {c.thisSeason.w}-{c.thisSeason.l}{c.thisSeason.push ? `-${c.thisSeason.push}` : ""}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: "0.3rem", fontSize: "0.7rem", ...DIM }}>
        Tiers come from your key-number list (Tier 1 = most critical). Straddle records are the live 2026+ study on the Totals History tab (small samples; graded against the Vegas total used there).
      </div>
    </div>
  );
}

export default function MatchupTotalsPopup({ season, week, awayTeam, homeTeam, onClose }: { season: number; week: number; awayTeam: string; homeTeam: string; onClose: () => void }) {
  const d = useTotalsPopupData(season, week, awayTeam, homeTeam);
  const b = d.breakdown;
  const move = d.vegasOpen != null && d.vegasCurrent != null ? d.vegasCurrent - d.vegasOpen : null;
  const marketPts = b ? b.breakdown.total - b.noMarket.total : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1002, padding: "1rem" }} onClick={onClose}>
      <div style={{ background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 10, padding: "1.25rem", width: 900, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: "0.75rem", right: "0.75rem", background: "none", border: "none", color: "var(--chalk-dim)", fontSize: "1.2rem", lineHeight: 1, cursor: "pointer", padding: "0.25rem" }}>
          ✕
        </button>
        <div style={{ fontWeight: 700, paddingRight: "1.5rem" }}>Totals — {awayTeam} @ {homeTeam}</div>
        <div style={{ fontSize: "0.78rem", ...DIM, marginBottom: "0.8rem" }}>
          {season} · Week {week}
          {d.game && <> · {kickoffLabel(d.game.startDate)} · {d.game.neutralSite ? "neutral site" : "true home game"}{d.completed ? " · Final" : ""}</>}
        </div>

        {d.loading ? (
          <p style={DIM}>Loading…</p>
        ) : d.error ? (
          <p style={{ color: "crimson" }}>{d.error}</p>
        ) : !d.row ? (
          <p style={DIM}>This game isn't in the synced totals data (no model inputs for one of the teams, or the game hasn't been synced).</p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={CELL}>Vegas total — open</td>
                  <td style={NUM}>{fmt(d.vegasOpen)}</td>
                  <td style={{ ...CELL, ...DIM }}>{d.vegasOpen == null ? "no opening line synced" : ""}</td>
                </tr>
                <tr>
                  <td style={CELL}>Vegas total — {d.completed ? "close" : "current"}</td>
                  <td style={NUM}>{fmt(d.vegasCurrent ?? d.vegasUsed)}</td>
                  <td style={{ ...CELL, ...DIM }}>{move != null ? `moved ${sgn(move)} since the open` : ""}{d.vegasCurrent == null && d.vegasUsed != null ? "only the opening number is synced" : ""}</td>
                </tr>
                <tr>
                  <td style={{ ...CELL, fontWeight: 700 }}>My total<LockedBadge locked={d.locked} /></td>
                  <td style={{ ...NUM, fontWeight: 700 }}>{fmt(d.myTotal)}</td>
                  <td style={{ ...CELL, ...DIM }}>
                    {d.locked && d.liveTotal != null && Math.abs(d.liveTotal - (d.lockedTotal ?? 0)) >= 0.05 ? `frozen at ${fmt(d.lockedTotal)}; the model would say ${fmt(d.liveTotal)} today` : ""}
                  </td>
                </tr>
                <tr>
                  <td style={CELL}>Amount off (mine − Vegas)</td>
                  <td style={NUM}>{sgn(d.amountOff)}</td>
                  <td style={CELL}><CallText call={d.call} filtered={d.isFiltered} /></td>
                </tr>
                <tr>
                  <td style={CELL}>Std dev off</td>
                  <td style={NUM}>{sgn(d.stdDevOff, 2)}</td>
                  <td style={{ ...CELL, ...DIM }}>a filtered bet is {TOTAL_BET_THRESHOLD_STDDEV}+ SD; the pool SD is {fmt(d.poolStd, 2)} pts</td>
                </tr>
                {d.completed && (
                  <tr>
                    <td style={CELL}>Final total</td>
                    <td style={NUM}>{fmt(d.actualTotal, 0)}</td>
                    <td style={{ ...CELL, ...DIM }}>
                      {d.actualTotal != null && d.vegasUsed != null ? `${d.actualTotal > d.vegasUsed ? "went Over" : d.actualTotal < d.vegasUsed ? "went Under" : "pushed"} Vegas's ${fmt(d.vegasUsed)}` : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <SectionTitle>Projected score vs Vegas-implied</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={CELL} />
                  <th style={{ ...NUM, ...DIM }}>My team total</th>
                  <th style={{ ...NUM, ...DIM }}>Vegas-implied</th>
                  <th style={{ ...NUM, ...DIM }}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { team: awayTeam, mine: d.myAwayTT, vegas: d.vegasAwayTT },
                  { team: homeTeam, mine: d.myHomeTT, vegas: d.vegasHomeTT },
                ].map((r) => (
                  <tr key={r.team}>
                    <td style={CELL}>{r.team}</td>
                    <td style={NUM}>{fmt(r.mine)}</td>
                    <td style={NUM}>{fmt(r.vegas)}</td>
                    <td style={NUM}>{r.mine != null && r.vegas != null ? sgn(r.mine - r.vegas) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: "0.7rem", ...DIM, marginTop: "0.25rem" }}>
              Team totals split the game total by the spread ({d.locked ? "locked" : "live"} spread {sgn(d.myHomeSpread)} for the home team; Vegas-implied uses the posted spread).
            </div>

            <SectionTitle>How the model got there</SectionTitle>
            {b ? (
              <>
                {d.locked && d.liveTotal != null && (
                  <p style={{ fontSize: "0.75rem", ...DIM, margin: "0 0 0.4rem" }}>
                    This game is locked, so the headline above is the frozen {fmt(d.lockedTotal)}. The table below is the model re-run on today's stats and today's Vegas total, projecting {fmt(b.breakdown.total)}.
                  </p>
                )}
                <p style={{ fontSize: "0.8rem", margin: "0 0 0.4rem" }}>
                  Biggest drivers:{" "}
                  {d.drivers.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 ? " · " : ""}
                      {s.label} <strong style={{ color: s.contribution >= 0 ? OVER : UNDER }}>{sgn(s.contribution, 2)}</strong>
                    </span>
                  ))}
                </p>
                <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
                  Team stats alone (no market total) give <strong>{fmt(b.noMarket.total)}</strong>; the Vegas total moves it {sgn(marketPts)} to <strong>{fmt(b.breakdown.total)}</strong>. The calibration offset ({sgn(TOTAL_BIAS_OFFSET)}) is included in both.
                </p>
                <BreakdownTable b={b.breakdown} withStats compact />

                <SectionTitle>Both teams' inputs</SectionTitle>
                <div className="table-scroll">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={CELL} />
                        <th style={{ ...NUM, ...DIM }}>G</th>
                        <th style={{ ...NUM, ...DIM }}>Off PPA</th>
                        <th style={{ ...NUM, ...DIM }}>Def PPA</th>
                        <th style={{ ...NUM, ...DIM }}>Off expl</th>
                        <th style={{ ...NUM, ...DIM }}>Def expl</th>
                        <th style={{ ...NUM, ...DIM }}>Plays/G</th>
                        <th style={{ ...NUM, ...DIM }}>Pts/G</th>
                        <th style={{ ...NUM, ...DIM }}>Opp pts/G</th>
                        <th style={{ ...NUM, ...DIM }}>Rest days</th>
                      </tr>
                    </thead>
                    <tbody>
                      <TeamInputsRow label={awayTeam} t={b.away} rest={d.awayRest} isHome={false} />
                      <TeamInputsRow label={homeTeam} t={b.home} rest={d.homeRest} isHome />
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: "0.7rem", ...DIM, marginTop: "0.25rem" }}>
                  PPA/explosiveness are season-to-date, blended with last season until a team has 4 games (def values are what the defense allows — lower is better). Plays/G is offensive pace.
                </div>
                {d.league && <LeaguePoolNote league={d.league} />}
              </>
            ) : (
              <p style={DIM}>No model inputs for one of these teams yet.</p>
            )}

            <SectionTitle>Key numbers</SectionTitle>
            <KeyNumbers d={d} />

            <SectionTitle>Bets on this game</SectionTitle>
            {d.bets.length === 0 ? (
              <p style={{ fontSize: "0.78rem", margin: 0, ...DIM }}>No totals or team-total bets logged{d.isFiltered ? ", though this one qualifies as a filtered bet" : ""}.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={CELL}>Type</th>
                    <th style={CELL}>Side</th>
                    <th style={NUM}>Line</th>
                    <th style={NUM}>Price</th>
                    <th style={NUM}>Stake</th>
                    <th style={CELL}>Book</th>
                    <th style={CELL}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {d.bets.map((x) => (
                    <tr key={x.id}>
                      <td style={CELL}>{x.bet_type === "total" ? "Game total" : "Team total"}</td>
                      <td style={CELL}>{x.side}</td>
                      <td style={NUM}>{fmt(x.line_value)}</td>
                      <td style={NUM}>{x.price > 0 ? `+${x.price}` : x.price}</td>
                      <td style={NUM}>{x.stake == null ? "–" : x.stake}</td>
                      <td style={CELL}>{BOOK_LABELS[x.book] ?? x.book}</td>
                      <td style={{ ...CELL, textTransform: "capitalize" }}>{x.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
