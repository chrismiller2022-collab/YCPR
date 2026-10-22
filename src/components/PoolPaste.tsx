import { useState } from "react";
import { fetchGamesWithLines } from "../lib/api/gamesLines";
import { parsePoolPaste, matchPasteToWeek, toPasteRow, type PasteFormat, type MatchedPasteGame } from "../lib/poolPaste";
import { billRWinPctFromSpread } from "../lib/moneylineBetHistory";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";

async function applyPaste(pool: string, season: number, week: number, games: ReturnType<typeof toPasteRow>[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool, action: "applyPaste", season, week, games }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
}

/**
 * Paste the pool's pick page; it matches each game to this week's schedule,
 * previews, then replaces the week's games (clearing picks) and stores the
 * pool's lines and public pick %. `pools` lists every pool the paste feeds
 * (ESPN Moneylines and Confidence share one slate).
 */
export function PoolPasteBox({
  format,
  pools,
  season,
  week,
  onApplied,
  hint,
}: {
  format: PasteFormat;
  pools: string[];
  season: number;
  week: number;
  onApplied: () => void;
  hint: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [matched, setMatched] = useState<MatchedPasteGame[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function preview() {
    setMsg(null);
    setBusy(true);
    try {
      const parsed = parsePoolPaste(format, text);
      if (parsed.games.length === 0) throw new Error("Couldn't find any games in that paste.");
      const weekGames = await fetchGamesWithLines(season, week);
      setMatched(matchPasteToWeek(parsed, weekGames.map((g) => ({ id: String(g.id), away_team: g.away_team, home_team: g.home_team }))));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? "Couldn't read that paste" });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!matched) return;
    const good = matched.filter((m) => m.game);
    if (!confirm(`Replace Week ${week}'s games with these ${good.length}? Saved picks for the week are cleared.`)) return;
    setBusy(true);
    try {
      const rows = good.map((m, i) => toPasteRow(m, i + 1));
      for (const pool of pools) await applyPaste(pool, season, week, rows);
      setMsg({ ok: true, text: `Saved ${rows.length} games${pools.length > 1 ? ` to ${pools.length} pools` : ""}.` });
      setMatched(null);
      setText("");
      setOpen(false);
      onApplied();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  const unmatched = matched?.filter((m) => !m.game).length ?? 0;
  return (
    <div style={{ margin: "0.5rem 0 1rem" }}>
      <button className="menu-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide paste" : "Paste from pool"}
      </button>
      {msg && <span style={{ marginLeft: "0.6rem", fontSize: "0.82rem", color: msg.ok ? "var(--c-ok)" : "var(--c-err)" }}>{msg.text}</span>}
      {open && (
        <div className="admin-panel" style={{ marginTop: "0.5rem", maxWidth: 760 }}>
          <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", margin: "0 0 0.4rem" }}>{hint}</p>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMatched(null);
            }}
            rows={8}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.78rem" }}
            placeholder="Paste the pool's page here"
          />
          <button className="menu-btn" onClick={preview} disabled={busy || !text.trim()} style={{ marginTop: "0.4rem" }}>
            Read paste
          </button>
          {matched && (
            <div style={{ marginTop: "0.6rem", fontSize: "0.8rem" }}>
              <ol style={{ margin: "0 0 0.5rem", paddingLeft: "1.4rem" }}>
                {matched.map((m, i) => (
                  <li key={i} style={{ color: m.game ? undefined : "var(--c-err)" }}>
                    {m.pasted.away.name} @ {m.pasted.home.name}
                    {m.game ? (m.game.away_team !== m.pasted.away.name || m.game.home_team !== m.pasted.home.name ? ` → ${m.game.away_team} @ ${m.game.home_team}` : "") : " — no match this week"}
                    {m.pasted.away.pct != null && ` · ${m.pasted.away.pct}% / ${m.pasted.home.pct}%`}
                    {m.pasted.away.spread != null && ` · ${m.pasted.away.spread > 0 ? "+" : ""}${m.pasted.away.spread}`}
                    {m.pasted.away.ml != null && ` · ${m.pasted.away.ml > 0 ? "+" : ""}${m.pasted.away.ml} / ${m.pasted.home.ml! > 0 ? "+" : ""}${m.pasted.home.ml}`}
                    {m.isKey && <b style={{ color: "var(--gold)" }}> · tiebreaker</b>}
                  </li>
                ))}
              </ol>
              {unmatched > 0 && <p style={{ color: "var(--c-err)", margin: "0 0 0.4rem" }}>{unmatched} game(s) didn't match and will be left out.</p>}
              <button onClick={apply} disabled={busy || matched.every((m) => !m.game)}>
                {busy ? "Saving…" : `Use these ${matched.filter((m) => m.game).length} games`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Public pick % and leverage --------------------------------------

const COVER_SIGMA = DEFAULT_CUSTOM_PARAMS.sigmaDivisor;

function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** My chance the picked side covers the pool's line (away-perspective spreads). */
export function myCoverProb(myAwaySpread: number | null, poolAwaySpread: number | null, side: "away" | "home" | null): number | null {
  if (myAwaySpread == null || poolAwaySpread == null || side == null) return null;
  const away = normalCdf((poolAwaySpread - myAwaySpread) / COVER_SIGMA);
  return side === "away" ? away : 1 - away;
}

/** My chance the picked side wins outright. */
export function myWinProb(myAwaySpread: number | null, side: "away" | "home" | null): number | null {
  if (myAwaySpread == null || side == null) return null;
  const away = billRWinPctFromSpread(myAwaySpread);
  return side === "away" ? away : 1 - away;
}

/**
 * Public pick % for both teams, plus leverage on my side (my chance minus
 * the public's %). Gold when the public is on my side 40% or less, deeper
 * gold at 25% or less: those picks gain the most on the field.
 */
export function PublicPickCell({
  awayPct,
  homePct,
  side,
  myProb,
}: {
  awayPct: number | null | undefined;
  homePct: number | null | undefined;
  side: "away" | "home" | null;
  myProb: number | null;
}) {
  if (awayPct == null || homePct == null) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  const sidePct = side === "away" ? awayPct : side === "home" ? homePct : null;
  const lev = sidePct != null && myProb != null ? Math.round(myProb * 100 - sidePct) : null;
  const tier = sidePct != null && myProb != null && myProb > 0.5 ? (sidePct <= 25 ? 2 : sidePct <= 40 ? 1 : 0) : 0;
  return (
    <span
      title="Public pick % (away / home). Leverage = my chance on my side minus the public's %."
      style={{
        display: "inline-block",
        padding: "0.1rem 0.35rem",
        borderRadius: 4,
        background: tier === 2 ? "rgba(255,200,87,0.55)" : tier === 1 ? "rgba(255,200,87,0.25)" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {awayPct}% / {homePct}%
      {lev != null && <b style={{ marginLeft: 6, color: lev > 0 ? "var(--pos-green)" : "var(--neg-red)" }}>{lev > 0 ? `+${lev}` : lev}</b>}
    </span>
  );
}

/** How far the pool's line is from another line, and which team that helps. */
export function LineGapCell({ poolLine, otherLine, away, home }: { poolLine: number | null; otherLine: number | null; away: string; home: string }) {
  if (poolLine == null || otherLine == null) return <span style={{ color: "var(--chalk-dim)" }}>–</span>;
  const diff = poolLine - otherLine;
  if (Math.abs(diff) < 0.05) return <span style={{ color: "var(--chalk-dim)" }}>0</span>;
  // A bigger away number than the other line gives the away side extra points.
  return (
    <span style={{ whiteSpace: "nowrap" }} title={diff > 0 ? `Pool gives ${away} ${diff.toFixed(1)} extra` : `Pool gives ${home} ${(-diff).toFixed(1)} extra`}>
      {Math.abs(diff).toFixed(1)} {diff > 0 ? away : home}
    </span>
  );
}

export function byPasteOrder<T extends { paste_order?: number | null }>(rows: T[]): T[] {
  if (!rows.some((r) => r.paste_order != null)) return rows;
  return [...rows].sort((a, b) => (a.paste_order ?? 999) - (b.paste_order ?? 999));
}
