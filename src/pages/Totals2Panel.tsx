// Models → Totals: the site's totals model (Totals v2). Reads only stored numbers (written every 3 hours by the
// scheduled job), so it opens fast. Tabs: Bets (sorted by edge) · All games · Track record · Backtest · How it works.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTotals2Fast, type Totals2Fast } from "../lib/totals2/fastData";
import { impliedPoints } from "../lib/totals2/model";
import { BREAK_EVEN } from "../lib/totals2/report";
import { latestTeamLines } from "../lib/totals2/ttCompare";
import { T2_ATS, T2_BACKTEST, T2_CONFIG, T2_MOVE_CUT_TOP10, T2_TRAINED_THROUGH, T2_VERSION } from "../lib/totals2/frozen";
import { saveTotals2Picks, type Totals2PickRow } from "../lib/api/totals2Data";
import { syncTeamTotalsNow } from "../lib/api/teamTotalLines";
import { splitTeamTotal } from "../lib/gameTotals";
import type { Totals2ProjectionRow } from "../lib/api/totals2Projections";
import { CELL, DIM, H3, NUM, P, f1, sgn, pct } from "../components/drogba/shared";

const HEAD: CSSProperties = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600, cursor: "pointer", userSelect: "none" };
const HEADL: CSSProperties = { ...CELL, color: "var(--chalk-dim)", fontWeight: 600, cursor: "pointer", userSelect: "none" };
const OVER = "#8fd39a";
const UNDER = "#e07a7a";
const STAR_BG = "rgba(232, 198, 106, 0.10)";
const SMALL = 100;

const leanColor = (v: number | null | undefined) => (v == null || v === 0 ? undefined : v > 0 ? OVER : UNDER);
function winStyle(p: number | null, n: number): CSSProperties {
  if (p == null) return {};
  return { color: p >= BREAK_EVEN ? OVER : p < 50 ? UNDER : "var(--c-warn, #e8c66a)", opacity: n < SMALL ? 0.6 : 1, fontStyle: n < SMALL ? "italic" : undefined };
}
const kick = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "TBD";

// ------------------------------------------------------------------ sorting
type SortDir = 1 | -1;
function useSort<K extends string>(initial: K, dir: SortDir = -1) {
  const [key, setKey] = useState<K>(initial);
  const [d, setD] = useState<SortDir>(dir);
  const click = (k: K) => {
    if (k === key) setD((x) => (x === 1 ? -1 : 1));
    else {
      setKey(k);
      setD(-1);
    }
  };
  const arrow = (k: K) => (k === key ? (d === -1 ? " ▼" : " ▲") : "");
  return { key, dir: d, click, arrow };
}
function sortRows<T>(rows: T[], get: (r: T) => number | string | null | undefined, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

// ------------------------------------------------------------------ per-game view model
interface GameView {
  p: Totals2ProjectionRow;
  open: number | null;
  now: number | null; // current line (closing line once played)
  nowSpread: number | null;
  move: number | null; // the bet signal: expected open → close move
  star: boolean;
  dir: "OVER" | "UNDER" | null;
  moved: number | null; // how far the line has already moved toward the bet (+) or away (−)
  v2Total: number | null; // current line + v2's expected residual
  started: boolean;
  final: number | null;
  logged: boolean;
}

function buildViews(s: Totals2Fast): GameView[] {
  const logged = new Set(s.picks.map((p) => p.game_id));
  const nowMs = Date.now();
  return s.proj.map((p) => {
    const m = s.markets.get(p.game_id);
    const g = s.games.get(p.game_id);
    const open = p.open_total ?? m?.openTotal ?? null;
    const now = m?.closeTotal ?? p.line_total;
    const move = p.move;
    const dir = move == null || move === 0 ? null : move > 0 ? "OVER" : "UNDER";
    const moved = open != null && now != null && move ? Math.sign(move) * (now - open) : null;
    const final = g?.completed && g.home_points != null && g.away_points != null ? g.home_points + g.away_points : null;
    return {
      p,
      open,
      now,
      nowSpread: m?.closeSpread ?? p.line_spread,
      move,
      star: !!p.star,
      dir,
      moved,
      v2Total: now != null && p.resid_total != null ? now + p.resid_total : p.proj_total,
      started: !!g?.completed || (p.start_date != null && Date.parse(p.start_date) <= nowMs),
      final,
      logged: logged.has(p.game_id),
    };
  });
}

// ------------------------------------------------------------------ page
type Tab = "bets" | "games" | "record" | "backtest" | "how";
const TABS: [Tab, string][] = [
  ["bets", "Bets"],
  ["games", "All games"],
  ["record", "Track record"],
  ["backtest", "Backtest"],
  ["how", "How it works"],
];

export default function Totals2Panel() {
  const season = new Date().getFullYear();
  const s = useTotals2Fast(season);
  const [tab, setTab] = useState<Tab>("bets");
  const views = useMemo(() => buildViews(s), [s]);
  const weeks = useMemo(() => Array.from(new Set(views.map((v) => v.p.week))).sort((a, b) => a - b), [views]);
  const nextWeek = useMemo(() => views.filter((v) => !v.started).map((v) => v.p.week).sort((a, b) => a - b)[0] ?? weeks[weeks.length - 1] ?? 1, [views, weeks]);
  const [week, setWeek] = useState<number | null>(null);
  const wk = week ?? nextWeek;

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: "0.2rem" }}>Totals</h2>
      <p style={{ ...DIM, marginTop: 0 }}>
        ★ = a bet: take the <strong>opening</strong> total in the direction shown, as early as you can. Numbers refresh every 3 hours and each game is logged
        automatically the first time it has a line.
        {s.lastComputed && <> Last updated {new Date(s.lastComputed).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.</>}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", margin: "0.6rem 0 1rem" }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={`mode-btn ${tab === k ? "mode-btn-active" : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        {(tab === "bets" || tab === "games") && weeks.length > 0 && (
          <label style={{ fontSize: "0.85rem", marginLeft: "auto" }}>
            Week{" "}
            <select value={wk} onChange={(e) => setWeek(Number(e.target.value))}>
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {s.error && <p style={{ color: "crimson" }}>{s.error}</p>}
      {tab === "backtest" ? (
        <BacktestTab />
      ) : tab === "how" ? (
        <HowItWorks />
      ) : s.loading ? (
        <div className="empty">Loading…</div>
      ) : s.proj.length === 0 ? (
        <div className="empty">No stored numbers yet — the scheduled job (GitHub Actions → "Totals v2") writes them every 3 hours; it can also be run by hand from there.</div>
      ) : (
        <>
          {tab === "bets" && <BetsTab s={s} views={views.filter((v) => v.p.week === wk)} season={season} />}
          {tab === "games" && <GamesTab s={s} views={views.filter((v) => v.p.week === wk)} />}
          {tab === "record" && <RecordTab s={s} views={views} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Bets
type BetKey = "edge" | "game" | "kick" | "open" | "now" | "moved";
function BetsTab({ s, views, season }: { s: Totals2Fast; views: GameView[]; season: number }) {
  const sort = useSort<BetKey>("edge");
  const [onlyStars, setOnlyStars] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = sortRows(
    views.filter((v) => v.move != null && v.open != null && (!onlyStars || v.star)),
    (v) =>
      sort.key === "edge"
        ? Math.abs(v.move ?? 0)
        : sort.key === "game"
          ? `${v.p.away_team}`
          : sort.key === "kick"
            ? v.p.start_date ?? ""
            : sort.key === "open"
              ? v.open
              : sort.key === "now"
                ? v.now
                : v.moved,
    sort.dir
  );
  const stars = views.filter((v) => v.star && !v.started).length;

  async function saveNow() {
    setBusy(true);
    setMsg(null);
    try {
      const picks: Omit<Totals2PickRow, "created_at">[] = views
        .filter((v) => !v.started && v.p.proj_total != null)
        .map((v) => ({
          game_id: v.p.game_id,
          season,
          week: v.p.week,
          home_team: v.p.home_team,
          away_team: v.p.away_team,
          model_version: v.p.model_version ?? T2_VERSION,
          market_total: v.now,
          market_home_spread: v.nowSpread,
          market_provider: v.p.market_provider,
          proj_total: v.v2Total,
          proj_home_pts: v.p.proj_home_pts,
          proj_away_pts: v.p.proj_away_pts,
          stats_home_pts: v.p.stats_home_pts,
          stats_away_pts: v.p.stats_away_pts,
          yc_home_spread: s.locks[v.p.game_id]?.my_away_spread != null ? -Number(s.locks[v.p.game_id].my_away_spread) : null,
          open_total: v.open,
          proj_move: v.move,
          weather: (v.p.weather as any) ?? null,
        }));
      if (!picks.length) return setMsg("Every game this week has kicked off.");
      const r = await saveTotals2Picks(picks, false);
      setMsg(`Logged ${r.saved} new; ${r.skippedExisting} were already logged.`);
      s.reload();
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.95rem" }}>
          {stars} ★ bet{stars === 1 ? "" : "s"} open this week
        </strong>
        <label style={{ fontSize: "0.82rem" }}>
          <input type="checkbox" checked={onlyStars} onChange={(e) => setOnlyStars(e.target.checked)} /> Only ★
        </label>
        <button className="mode-btn" disabled={busy} onClick={saveNow} title="Games are logged automatically; this just does it now">
          Log now
        </button>
      </div>
      {msg && <p style={DIM}>{msg}</p>}
      <h3 style={H3}>Game totals</h3>
      <p style={{ ...DIM, marginTop: 0 }}>
        Sorted by edge = how far the model expects the total to move after it opens. ★ = the top 10% of edges (≥ {T2_MOVE_CUT_TOP10} pts), the only ones worth
        betting. "Moved" = how much of that has already happened (green = toward the bet); once a line has moved past the edge, the value is gone.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL} onClick={() => sort.click("game")}>Game{sort.arrow("game")}</th>
              <th style={HEADL} onClick={() => sort.click("kick")}>Kickoff{sort.arrow("kick")}</th>
              <th style={{ ...HEADL, cursor: "default" }}>Bet</th>
              <th style={HEAD} onClick={() => sort.click("edge")}>Edge{sort.arrow("edge")}</th>
              <th style={HEAD} onClick={() => sort.click("open")}>Open{sort.arrow("open")}</th>
              <th style={HEAD} onClick={() => sort.click("now")}>Now{sort.arrow("now")}</th>
              <th style={HEAD} onClick={() => sort.click("moved")}>Moved{sort.arrow("moved")}</th>
              <th style={{ ...HEAD, cursor: "default" }}>Logged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const gone = v.moved != null && v.move != null && v.moved >= Math.abs(v.move);
              return (
                <tr key={v.p.game_id} style={{ background: v.star ? STAR_BG : undefined, opacity: v.started ? 0.5 : 1 }}>
                  <td style={CELL}>
                    {v.p.away_team} @ {v.p.home_team}
                  </td>
                  <td style={{ ...CELL, color: "var(--chalk-dim)" }}>{v.started ? "started" : kick(v.p.start_date)}</td>
                  <td style={{ ...CELL, fontWeight: v.star ? 700 : 400, color: v.star ? leanColor(v.move) : "var(--chalk-dim)" }}>
                    {v.star ? "★ " : ""}
                    {v.dir} {f1(v.open)}
                  </td>
                  <td style={{ ...NUM, fontWeight: 600, color: leanColor(v.move) }}>{sgn(v.move, 2)}</td>
                  <td style={NUM}>{f1(v.open)}</td>
                  <td style={NUM}>{f1(v.now)}</td>
                  <td style={{ ...NUM, color: leanColor(v.moved) }} title={gone ? "Already moved past the edge" : undefined}>
                    {sgn(v.moved)}
                    {gone ? " (gone)" : ""}
                  </td>
                  <td style={{ ...NUM, color: "var(--chalk-dim)" }}>{v.logged ? "✓" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TeamTotalBets s={s} views={views} season={season} />
    </div>
  );
}

type TTKey = "edge" | "team" | "line";
function TeamTotalBets({ s, views, season }: { s: Totals2Fast; views: GameView[]; season: number }) {
  const sort = useSort<TTKey>("edge");
  const [msg, setMsg] = useState<string | null>(null);
  const real = useMemo(() => latestTeamLines(s.ttLines), [s.ttLines]);
  const rows: { v: GameView; team: string; line: number; mine: number; edge: number }[] = [];
  for (const v of views) {
    if (v.now == null || v.nowSpread == null || v.p.line_total == null || v.p.line_spread == null) continue;
    for (const side of ["away", "home"] as const) {
      const team = side === "home" ? v.p.home_team : v.p.away_team;
      const line = real.get(`${v.p.game_id}|${team}`);
      const stored = side === "home" ? v.p.proj_home_pts : v.p.proj_away_pts;
      if (line == null || stored == null) continue;
      const resid = stored - impliedPoints(v.p.line_total, v.p.line_spread, side);
      const mine = impliedPoints(v.now, v.nowSpread, side) + resid;
      rows.push({ v, team, line, mine, edge: mine - line });
    }
  }
  const sorted = sortRows(rows, (r) => (sort.key === "edge" ? Math.abs(r.edge) : sort.key === "team" ? r.team : r.line), sort.dir);
  async function pull() {
    setMsg(null);
    try {
      const games = views.filter((v) => !v.started).map((v) => ({ id: v.p.game_id, week: v.p.week, home_team: v.p.home_team, away_team: v.p.away_team }));
      const r = await syncTeamTotalsNow(games as any, season);
      setMsg(`Pulled ${r.rows} team-total lines from ${r.events} games.`);
      s.reload();
    } catch (e: any) {
      setMsg(e?.message ?? "Pull failed");
    }
  }
  return (
    <>
      <h3 style={H3}>
        Team totals <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--chalk-dim)" }}>· unproven — tracking only</span>
      </h3>
      <p style={{ ...DIM, marginTop: 0 }}>
        The model's team number against the real posted team total, sorted by the gap. In the backtest team totals ran about break-even, so treat these as
        leads to check, not bets, until the Track record says otherwise.{" "}
        <button className="mode-btn" onClick={pull} style={{ fontSize: "0.75rem" }} title="The Odds API: 1 credit per game">
          Pull team-total lines
        </button>
      </p>
      {msg && <p style={DIM}>{msg}</p>}
      {sorted.length === 0 ? (
        <p style={DIM}>No team-total lines pulled for this week yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={HEADL} onClick={() => sort.click("team")}>Team{sort.arrow("team")}</th>
                <th style={{ ...HEADL, cursor: "default" }}>Lean</th>
                <th style={HEAD} onClick={() => sort.click("edge")}>Edge{sort.arrow("edge")}</th>
                <th style={HEAD} onClick={() => sort.click("line")}>Team total{sort.arrow("line")}</th>
                <th style={{ ...HEAD, cursor: "default" }}>Model</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={`${r.v.p.game_id}|${r.team}`} style={{ opacity: r.v.started ? 0.5 : 1 }}>
                  <td style={CELL}>
                    {r.team} <span style={{ color: "var(--chalk-dim)", fontSize: "0.72rem" }}>vs {r.team === r.v.p.home_team ? r.v.p.away_team : r.v.p.home_team}</span>
                  </td>
                  <td style={{ ...CELL, color: leanColor(r.edge) }}>
                    {r.edge > 0 ? "OVER" : "UNDER"} {f1(r.line)}
                  </td>
                  <td style={{ ...NUM, fontWeight: 600, color: leanColor(r.edge) }}>{sgn(r.edge)}</td>
                  <td style={NUM}>{f1(r.line)}</td>
                  <td style={NUM}>{f1(r.mine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ All games
type GKey = "game" | "kick" | "edge" | "lean" | "now" | "v2";
function GamesTab({ s, views }: { s: Totals2Fast; views: GameView[] }) {
  const sort = useSort<GKey>("kick", 1);
  const rows = sortRows(
    views,
    (v) =>
      sort.key === "game"
        ? v.p.away_team
        : sort.key === "kick"
          ? v.p.start_date ?? ""
          : sort.key === "edge"
            ? Math.abs(v.move ?? 0)
            : sort.key === "lean"
              ? Math.abs((v.v2Total ?? 0) - (v.now ?? 0))
              : sort.key === "now"
                ? v.now
                : v.v2Total,
    sort.dir
  );
  return (
    <div>
      <p style={{ ...DIM, marginTop: 0 }}>
        Every game this week. <strong>v2 total</strong> is the number the rest of the site uses (the current line plus the model's expected difference). Team
        totals are that total split by the market spread; "YCPR split" splits it by your power-rating spread instead, and "Site v1" is the old model's locked
        total, for comparison. Click a column to sort.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL} onClick={() => sort.click("game")}>Game{sort.arrow("game")}</th>
              <th style={HEADL} onClick={() => sort.click("kick")}>Kickoff{sort.arrow("kick")}</th>
              <th style={{ ...HEAD, cursor: "default" }}>Weather</th>
              <th style={HEAD} onClick={() => sort.click("edge")}>Bet edge{sort.arrow("edge")}</th>
              <th style={{ ...HEAD, cursor: "default" }}>Open</th>
              <th style={HEAD} onClick={() => sort.click("now")}>Now{sort.arrow("now")}</th>
              <th style={HEAD} onClick={() => sort.click("v2")}>v2 total{sort.arrow("v2")}</th>
              <th style={HEAD} onClick={() => sort.click("lean")}>v2 − now{sort.arrow("lean")}</th>
              <th style={{ ...HEAD, cursor: "default" }}>Away / Home TT</th>
              <th style={{ ...HEAD, cursor: "default" }}>YCPR split</th>
              <th style={{ ...HEAD, cursor: "default" }}>Site v1</th>
              <th style={{ ...HEAD, cursor: "default" }}>Final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const lock = s.locks[v.p.game_id];
              const ycHome = lock?.my_away_spread != null ? -Number(lock.my_away_spread) : null;
              const tt = v.v2Total != null && v.nowSpread != null ? splitTeamTotal(v.v2Total, v.nowSpread) : null;
              const yc = v.v2Total != null && ycHome != null ? splitTeamTotal(v.v2Total, ycHome) : null;
              const w = v.p.weather;
              const lean = v.v2Total != null && v.now != null ? v.v2Total - v.now : null;
              return (
                <tr key={v.p.game_id} style={{ background: v.star ? STAR_BG : undefined }}>
                  <td style={CELL}>
                    {v.p.away_team} @ {v.p.home_team}
                  </td>
                  <td style={{ ...CELL, color: "var(--chalk-dim)" }}>{v.final != null ? "final" : kick(v.p.start_date)}</td>
                  <td style={NUM}>{w?.dome ? "dome" : w?.avgWind != null ? `${f1(w.avgWind, 0)} mph${(w.precip ?? 0) >= 0.1 ? " · rain" : ""}${w.snow ? " · snow" : ""}` : "–"}</td>
                  <td style={{ ...NUM, color: leanColor(v.move), fontWeight: v.star ? 700 : 400 }}>
                    {v.star ? "★ " : ""}
                    {sgn(v.move, 2)}
                  </td>
                  <td style={NUM}>{f1(v.open)}</td>
                  <td style={NUM}>{f1(v.now)}</td>
                  <td style={{ ...NUM, fontWeight: 600 }}>{f1(v.v2Total)}</td>
                  <td style={{ ...NUM, color: leanColor(lean) }}>{sgn(lean, 2)}</td>
                  <td style={NUM}>{tt ? `${f1(tt.away)} / ${f1(tt.home)}` : "–"}</td>
                  <td style={NUM}>{yc ? `${f1(yc.away)} / ${f1(yc.home)}` : "–"}</td>
                  <td style={NUM}>{lock?.my_total != null ? f1(Number(lock.my_total)) : "–"}</td>
                  <td style={NUM}>{v.final ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Track record
function Stat({ label, w, l, clv, note }: { label: string; w: number; l: number; clv: number | null; note?: ReactNode }) {
  const p = w + l ? (100 * w) / (w + l) : null;
  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.6rem 0.9rem", minWidth: 190 }}>
      <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, ...winStyle(p, w + l) }}>
        {w}-{l} · {pct(p)}
      </div>
      <div style={{ fontSize: "0.78rem", color: leanColor(clv) }}>Line moved our way: {sgn(clv, 2)} pts avg</div>
      {note && <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{note}</div>}
    </div>
  );
}

function RecordTab({ s, views }: { s: Totals2Fast; views: GameView[] }) {
  const graded = s.picks
    .map((p) => {
      const g = s.games.get(p.game_id);
      const m = s.markets.get(p.game_id);
      if (!g?.completed || g.home_points == null || g.away_points == null) return null;
      const actual = g.home_points + g.away_points;
      const open = p.open_total ?? p.market_total;
      if (p.proj_move == null || p.proj_move === 0 || open == null) return null;
      const sg = Math.sign(p.proj_move);
      return { week: p.week, star: Math.abs(p.proj_move) >= T2_MOVE_CUT_TOP10, res: sg * (actual - open), clv: m?.closeTotal != null ? sg * (m.closeTotal - open) : null };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const tally = (xs: typeof graded) => {
    const c = xs.filter((x) => x.clv != null);
    return { w: xs.filter((x) => x.res > 0).length, l: xs.filter((x) => x.res < 0).length, clv: c.length ? c.reduce((a, x) => a + x.clv!, 0) / c.length : null };
  };
  const star = tally(graded.filter((x) => x.star));
  const all = tally(graded);
  const weeks = Array.from(new Set(graded.map((x) => x.week))).sort((a, b) => b - a);
  return (
    <div>
      <p style={{ ...DIM, marginTop: 0 }}>
        Graded from the log only — each game's number as it stood when it was logged, before kickoff — against the opening total it was logged with. The line
        moving our way is the early sign the model is right: it settles in a few dozen bets, the win rate needs hundreds.
      </p>
      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
        <Stat label="★ bets" {...star} note={starBacktestNote()} />
        <Stat label="Every logged game, same rule" {...all} />
      </div>
      {weeks.length > 0 && (
        <>
          <h3 style={H3}>By week</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ ...HEADL, cursor: "default" }}>Week</th>
                  <th style={{ ...HEAD, cursor: "default" }}>★ bets</th>
                  <th style={{ ...HEAD, cursor: "default" }}>★ line moved our way</th>
                  <th style={{ ...HEAD, cursor: "default" }}>Every game</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const a = tally(graded.filter((x) => x.week === w && x.star));
                  const b = tally(graded.filter((x) => x.week === w));
                  return (
                    <tr key={w}>
                      <td style={CELL}>{w}</td>
                      <td style={NUM}>
                        {a.w}-{a.l}
                      </td>
                      <td style={{ ...NUM, color: leanColor(a.clv) }}>{sgn(a.clv, 2)}</td>
                      <td style={NUM}>
                        {b.w}-{b.l}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <TTCompare s={s} views={views} />
    </div>
  );
}

function starBacktestNote(): string {
  const b = T2_ATS.find((r) => r.market === "game-move" && r.seasons === "2023+2024+2025+2026")?.buckets.find((x) => x.frac === 0.1);
  if (!b) return "";
  return `Backtest 2023–26: ${((100 * b.w) / (b.w + b.l)).toFixed(1)}%, line moved our way ${sgn(b.clv, 2)} pts`;
}

// Team totals: four ways to build the team number, graded on the same games.
function TTCompare({ s, views }: { s: Totals2Fast; views: GameView[] }) {
  const real = useMemo(() => latestTeamLines(s.ttLines), [s.ttLines]);
  type Arm = "v2" | "v2yc" | "v1yc" | "v1mkt";
  const ARMS: [Arm, string][] = [
    ["v2", "v2 total ÷ market spread (what the site uses now)"],
    ["v2yc", "v2 total ÷ YCPR spread"],
    ["v1yc", "Old: v1 total ÷ YCPR spread"],
    ["v1mkt", "v1 total ÷ market spread"],
  ];
  const sides: { actual: number; derived: number; real: number | null; arms: Partial<Record<Arm, number>> }[] = [];
  for (const v of views) {
    const g = s.games.get(v.p.game_id);
    const m = s.markets.get(v.p.game_id);
    if (!g?.completed || g.home_points == null || g.away_points == null || m?.closeTotal == null || m.closeSpread == null) continue;
    const lock = s.locks[v.p.game_id];
    const ycHome = lock?.my_away_spread != null ? -Number(lock.my_away_spread) : null;
    const v1 = lock?.my_total != null ? Number(lock.my_total) : null;
    const v2tot = v.p.resid_total != null ? m.closeTotal + v.p.resid_total : null;
    const sp = (t: number | null, spr: number | null) => (t == null || spr == null ? null : splitTeamTotal(t, spr));
    const a = { v2: sp(v2tot, m.closeSpread), v2yc: sp(v2tot, ycHome), v1yc: sp(v1, ycHome), v1mkt: sp(v1, m.closeSpread) };
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? v.p.home_team : v.p.away_team;
      const arms: Partial<Record<Arm, number>> = {};
      for (const [k] of ARMS) {
        const x = a[k];
        const val = x ? (side === "home" ? x.home : x.away) : null;
        if (val != null) arms[k] = val;
      }
      sides.push({ actual: side === "home" ? g.home_points : g.away_points, derived: impliedPoints(m.closeTotal, m.closeSpread, side), real: real.get(`${v.p.game_id}|${team}`) ?? null, arms });
    }
  }
  const stat = (arm: Arm, grade: "derived" | "real") => {
    let n = 0, ae = 0, w = 0, l = 0;
    for (const x of sides) {
      const mv = x.arms[arm];
      const line = grade === "derived" ? x.derived : x.real;
      if (mv == null || line == null) continue;
      n++;
      ae += Math.abs(mv - x.actual);
      const d = mv - line;
      if (Math.abs(d) < 1) continue;
      const r = Math.sign(d) * (x.actual - line);
      if (r > 0) w++;
      else if (r < 0) l++;
    }
    return { n, mae: n ? ae / n : null, w, l };
  };
  return (
    <>
      <h3 style={H3}>Team totals: which way of building the team number is best?</h3>
      <p style={{ ...DIM, marginTop: 0 }}>
        This season's played games. "Miss" = average points off a team's actual score (lower is better). "1+ off" = a bet whenever the team number differs from the
        line by a point or more. Graded against the market's own team number (closing total split by closing spread) and against real team-total lines where pulled.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ ...HEADL, cursor: "default" }}>Team number</th>
              <th style={{ ...HEAD, cursor: "default" }}>Miss vs market #</th>
              <th style={{ ...HEAD, cursor: "default" }}>1+ off vs market #</th>
              <th style={{ ...HEAD, cursor: "default" }}>Miss vs real TT</th>
              <th style={{ ...HEAD, cursor: "default" }}>1+ off vs real TT</th>
            </tr>
          </thead>
          <tbody>
            {ARMS.map(([k, label]) => {
              const d = stat(k, "derived");
              const r = stat(k, "real");
              const pc = (x: { w: number; l: number }) => (x.w + x.l ? (100 * x.w) / (x.w + x.l) : null);
              return (
                <tr key={k}>
                  <td style={CELL}>{label}</td>
                  <td style={NUM}>{f1(d.mae, 2)}</td>
                  <td style={{ ...NUM, ...winStyle(pc(d), d.w + d.l) }}>
                    {d.w}-{d.l} {pct(pc(d))}
                  </td>
                  <td style={NUM}>
                    {f1(r.mae, 2)} <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({r.n})</span>
                  </td>
                  <td style={{ ...NUM, ...winStyle(pc(r), r.w + r.l) }}>
                    {r.w}-{r.l} {pct(pc(r))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Backtest
const APPROACHES: { scope: "game" | "team"; market: (typeof T2_ATS)[number]["market"]; name: string; what: string; verdict: string }[] = [
  {
    scope: "game",
    market: "game-move",
    name: "★ Bet the opening total, in the direction the line should move",
    what: "The model predicts which way the total moves after it opens; bet the opening number that way. This is what the Bets tab recommends.",
    verdict: "Use this",
  },
  {
    scope: "game",
    market: "game-open",
    name: "Bet the opening total, using the model's score projection",
    what: "The model projects the final combined score and compares it with the opening total.",
    verdict: "Weaker, less steady",
  },
  {
    scope: "game",
    market: "game-close",
    name: "Bet near kickoff, using the model's score projection",
    what: "Same projection, against the line at kickoff. By then the market has absorbed nearly everything the model knows.",
    verdict: "Doesn't hold up — not used",
  },
  {
    scope: "team",
    market: "team-move",
    name: "Bet the opening team total, in the direction the line should move",
    what: "The same line-move signal, applied to each team's half of the total.",
    verdict: "Break-even overall",
  },
  {
    scope: "team",
    market: "team-open",
    name: "Bet the opening team total, using the model's score projection",
    what: "Each team's projected points against its share of the opening total.",
    verdict: "Break-even",
  },
  {
    scope: "team",
    market: "team-close",
    name: "Bet the team total near kickoff, using the model's score projection",
    what: "Same, against the line at kickoff.",
    verdict: "Doesn't hold up",
  },
];

function BacktestTab() {
  const [frac, setFrac] = useState(0.1);
  const PERIODS: [string, string][] = [
    ["2023+2024", "Tuning seasons (2023–24)"],
    ["2025+2026", "Holdout — never used to tune (2025–26)"],
    ["2023+2024+2025+2026", "All 2023–26"],
  ];
  const cell = (market: string, seasons: string) => T2_ATS.find((r) => r.market === market && r.seasons === seasons)?.buckets.find((b) => b.frac === frac);
  return (
    <div>
      <p style={{ ...DIM, marginTop: 0 }}>
        Every season is predicted by a model built only from earlier seasons, so none of these games were seen in training. Flat bets at −110 (52.4% breaks even).
        "Line moved our way" = how far the total moved toward the bet between open and close — the steadier read, because it needs far fewer bets to show.
      </p>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", margin: "0.4rem 0 0.8rem" }}>
        <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>Bets taken:</span>
        {[
          [0.1, "Strongest 10%"],
          [0.25, "Strongest 25%"],
          [1, "Every game"],
        ].map(([f, label]) => (
          <button key={f} className={`mode-btn ${frac === f ? "mode-btn-active" : ""}`} onClick={() => setFrac(f as number)} style={{ fontSize: "0.78rem" }}>
            {label}
          </button>
        ))}
      </div>
      {(["game", "team"] as const).map((scope) => (
        <div key={scope}>
          <h3 style={H3}>{scope === "game" ? "Game totals" : "Team totals"}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ ...HEADL, cursor: "default", minWidth: 260 }}>Approach</th>
                  {PERIODS.map(([k, label]) => (
                    <th key={k} style={{ ...HEAD, cursor: "default" }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {APPROACHES.filter((a) => a.scope === scope).map((a) => (
                  <tr key={a.market} style={{ background: a.market === "game-move" ? STAR_BG : undefined }}>
                    <td style={{ ...CELL, whiteSpace: "normal" }}>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{a.what}</div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: a.market === "game-move" ? OVER : "var(--chalk-dim)" }}>{a.verdict}</div>
                    </td>
                    {PERIODS.map(([k]) => {
                      const b = cell(a.market, k);
                      if (!b) return <td key={k} style={NUM}>–</td>;
                      const p = b.w + b.l ? (100 * b.w) / (b.w + b.l) : null;
                      return (
                        <td key={k} style={{ ...NUM, verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600, ...winStyle(p, b.w + b.l) }}>
                            {b.w}-{b.l} · {pct(p)}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: leanColor(b.units) }}>
                            {b.units >= 0 ? "+" : ""}
                            {b.units} units
                          </div>
                          {b.clv != null && <div style={{ fontSize: "0.72rem", color: leanColor(b.clv) }}>line moved our way {sgn(b.clv, 2)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ methodology + backtest
function HowItWorks() {
  const seasons = Array.from(new Set(T2_BACKTEST.map((r) => r.season)));
  const cell = (season: number, scope: "game" | "team", line: "close" | "open") => T2_BACKTEST.find((r) => r.season === season && r.scope === scope && r.line === line);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h3 style={H3}>What changed from v1</h3>
      <ul style={{ ...P, paddingLeft: "1.2rem" }}>
        <li>
          <strong>Residual target, market weight fixed at 1.</strong> v1 put 0.31 on the Vegas total and let stats fill the rest, so every line move created a fake edge
          against the move. v2 predicts (actual − market) only; with no information it says exactly the market's number.
        </li>
        <li>
          <strong>Point-in-time stats.</strong> v1 was trained on end-of-season stats that already contained the game being predicted. v2's ratings at week w come only
          from games before week w, the same way in training and live.
        </li>
        <li>
          <strong>Walk-forward validation.</strong> Each season is predicted by fits on earlier seasons only. Settings were chosen on 2023–24 and reported, untouched,
          on 2025–26.
        </li>
        <li>
          <strong>Team level.</strong> The model predicts each team's points against one defense; the game total is the sum. Team totals come out natively instead of
          being split from a game total by a spread.
        </li>
      </ul>
      <h3 style={H3}>Inputs</h3>
      <ul style={{ ...P, paddingLeft: "1.2rem" }}>
        <li>
          <strong>Opponent-adjusted efficiency</strong> (offense effect + the opponent defense's effect): PPA, success rate, explosiveness, and garbage-time-filtered
          success rate and isolated explosiveness from the play-by-play pull; scoring (points, points per drive).
        </li>
        <li>
          <strong>Pace</strong>: opponent-adjusted drives and plays per game for both teams, and <strong>tempo</strong> — game-clock seconds between an
          offense's snaps from CFBD play-by-play (garbage time, the last 2:00 of each half, overtime, kneels and spikes left out). CFBD records the clock for only
          part of its games (about 35–45% before 2024, most since), so tempo uses those games and falls back to the prior for the rest. Adding it improved the
          walk-forward record (line-move top 10%: 54.4% → 57.2%; residual R² and CLV up).
        </li>
        <li>
          <strong>Special teams / field position</strong>: field goals over expected plus net punt and kickoff field position, rated head-to-head.
        </li>
        <li>
          <strong>Weather</strong> (closing-line model only): wind above 10 mph, a 15+ mph flag, rain, snow, cold, dome. Training uses observed station data
          (Meteostat); live uses Open-Meteo forecasts. The open model gets no weather — nobody knows it when lines open, so crediting it would be look-ahead.
        </li>
        <li>
          <strong>Preseason / returning production</strong>: ratings start each season at last season's final, carried {Math.round(T2_CONFIG.rho * 100)}% for an
          average-returning team. A team with low returning production carries less (−{T2_CONFIG.retRhoK} per SD) and lets go of the prior faster: its prior is
          worth e^({T2_CONFIG.retLambdaK} × z) times as many games (z = returning production in SDs), so a team 1 SD below average trusts its new games ~{Math.exp(T2_CONFIG.retLambdaK).toFixed(1)}× sooner and one
          1 SD above ~{Math.exp(T2_CONFIG.retLambdaK).toFixed(1)}× later. There is no 4-game switch: the prior's weight fades smoothly as games come in (data weight ≈
          games ÷ (games + prior strength)). Tuning pushed both returning-production knobs to the top of the tested range — faster adjustment for rebuilt rosters
          held up.
        </li>
        <li>
          <strong>QB changes and injuries: not in the model.</strong> There is no injury or depth-chart feed in the database; the market prices these and the model
          cannot. Treat any lean on a game with a QB change as unreliable until a feed exists.
        </li>
      </ul>
      <h3 style={H3}>Walk-forward record</h3>
      <p style={DIM}>
        Residual R² = share of (actual − line) explained; 0 is "no better than the line". Win % = every side, in the model's direction (no threshold). CLV = average
        points the line moved toward the model's side, open → close (opening model).
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL}>Season</th>
              <th style={HEAD}>Game vs close R² / win</th>
              <th style={HEAD}>Game vs open R² / win / CLV</th>
              <th style={HEAD}>Team vs close R² / win</th>
              <th style={HEAD}>Team vs open R² / win / CLV</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((S) => {
              const gc = cell(S, "game", "close");
              const go = cell(S, "game", "open");
              const tc = cell(S, "team", "close");
              const to = cell(S, "team", "open");
              return (
                <tr key={S}>
                  <td style={CELL}>
                    {S}
                    {S >= 2025 ? " (holdout)" : " (tuning)"}
                  </td>
                  <td style={NUM}>
                    {f1(gc?.r2, 2)}% / {pct(gc?.win)}
                  </td>
                  <td style={NUM}>
                    {f1(go?.r2, 2)}% / {pct(go?.win)} / {sgn(go?.clv, 2)}
                  </td>
                  <td style={NUM}>
                    {f1(tc?.r2, 2)}% / {pct(tc?.win)}
                  </td>
                  <td style={NUM}>
                    {f1(to?.r2, 2)}% / {pct(to?.win)} / {sgn(to?.clv, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 style={H3}>Reading it honestly</h3>
      <ul style={{ ...P, paddingLeft: "1.2rem" }}>
        <li>Against the closing total the model finds almost nothing (R² ≈ 0–0.6%, ≈ 0 on the holdout). The close is efficient; that is the expected result.</li>
        <li>
          Against the opener there is a small, steady signal. The <strong>line-move model</strong> — trained to predict where the total goes after it opens, not the
          final score — moved the line its way in every season (see Backtest O/U record), and its top 10% is the bet. Line moves are about 6× less noisy than final
          scores, so this target needs far less data to learn.
        </li>
        <li>
          Team numbers take the game's residual split evenly; the market decides how points divide between the teams. Letting the model split them was effectively
          a spread opinion, and it lost in every season (47–49%).
        </li>
        <li>
          The one input stable across every fit: high team totals land slightly under (≈ −0.04 points per point above 28). Observed weather is fully priced by the close.
        </li>
        <li>
          Real team-total lines are on file for only a few weeks. Pull them every week — the "vs real lines" comparison is what will tell you whether the softer
          market is beatable with these numbers.
        </li>
      </ul>
    </div>
  );
}
