import { useEffect, useMemo, useState } from "react";
import { fetchGameProjectionLocks } from "../../lib/api/gameProjectionLocks";
import { AGREE_LABELS, agreementStat, buildAgreementRows, ycSpreadByGame, type AgreeSet, type AgreeStat } from "../../lib/drogba/agreement";
import { atsColor, clvColor, isSmallSample } from "../../lib/drogba/colors";
import { TIER_LABELS, type Tier } from "../../lib/drogba/tiers";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, sgn } from "./shared";

const SEASONS = [2024, 2025, 2026]; // the seasons YC projections exist for
const EDGES = [0, 3, 5];
const SETS: AgreeSet[] = ["all", "agree", "agreeStrong", "disagree"];
const HEAD = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };

function Cells({ s }: { s: AgreeStat }) {
  const small = isSmallSample(s.w + s.l);
  return (
    <>
      <td style={NUM}>{s.n}</td>
      <td style={NUM}>{s.w}–{s.l}</td>
      <td style={{ ...NUM, color: atsColor(s.atsPct), fontWeight: 700, opacity: small ? 0.55 : 1, fontStyle: small ? "italic" : undefined }}>{s.atsPct == null ? "–" : `${s.atsPct.toFixed(1)}%`}</td>
      <td style={{ ...NUM, color: clvColor(s.clv), opacity: small ? 0.55 : 1 }}>{s.clv == null ? "–" : sgn(s.clv, 2)}</td>
    </>
  );
}

export default function DrogbaAgreementSection({ state }: { state: DrogbaState }) {
  const [yc, setYc] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.games.length) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ BET_HISTORY }, locks] = await Promise.all([import("../../data/betHistory.data"), fetchGameProjectionLocks(2026, Array.from({ length: 16 }, (_, i) => i + 1))]);
        if (cancelled) return;
        setYc(ycSpreadByGame(state.games, BET_HISTORY as any, Object.values(locks)));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Loading YC projections failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.games]);

  const rows = useMemo(() => (state.engine && yc ? buildAgreementRows(state.engine.signals, yc, SEASONS) : null), [state.engine, yc]);

  return (
    <div>
      <h3 style={H3}>DROGBA vs YC: does it help when they agree?</h3>
      <p style={DIM}>
        For every game DROGBA bets, whether YC's own projection is on the same side of the opening line or the other side. DROGBA never sees YC; this only compares them afterwards. 2024–26, DROGBA fit on earlier seasons only. YC numbers are the final
        pre-kickoff ones, made later than DROGBA's Sunday numbers, so YC may know things DROGBA could not at the time.
      </p>
      {error && <p style={{ color: "crimson", fontSize: "0.85rem" }}>{error}</p>}
      {!rows && !error && <p style={DIM}>Loading YC projections…</p>}
      {rows && (
        <>
          <p style={DIM}>{rows.length} games have both numbers.</p>
          {(["power", "other", "all"] as (Tier | "all")[]).map((tier) => (
            <div key={tier}>
              <h4 style={{ margin: "0.9rem 0 0.2rem", fontSize: "0.9rem" }}>{tier === "all" ? "All games" : TIER_LABELS[tier]}</h4>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th style={CELL}>DROGBA edge</th>
                      <th style={CELL}>YC</th>
                      <th style={HEAD}>Bets</th>
                      <th style={HEAD}>W–L</th>
                      <th style={HEAD}>ATS</th>
                      <th style={HEAD}>CLV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EDGES.flatMap((T) =>
                      SETS.map((set) => (
                        <tr key={`${T}-${set}`} style={set === "all" ? { borderTop: "1px solid rgba(255,255,255,0.12)" } : undefined}>
                          <td style={CELL}>{set === "all" ? (T === 0 ? "any" : `${T}+`) : ""}</td>
                          <td style={{ ...CELL, fontWeight: set === "all" ? 700 : 400 }}>{AGREE_LABELS[set]}</td>
                          <Cells s={agreementStat(rows, tier, T, set)} />
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
