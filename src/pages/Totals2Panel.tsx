// Models → Totals → Model v2: the residual team-total model (src/lib/totals2). One page: this week's numbers, the honest
// walk-forward record, this season so far, the saved log, and the team-total comparison (v2 team numbers vs the v2 game
// total split by the market spread vs split by the YCPR spread vs the current site's numbers).
import { useMemo, useState, type CSSProperties } from "react";
import { useTotals2 } from "../lib/totals2/live";
import { impliedPoints, lineOf, projectedTotal, type GamePred } from "../lib/totals2/model";
import { scoreGames, scoreTeams, BREAK_EVEN, type ScoreSummary } from "../lib/totals2/report";
import { buildTTSides, latestTeamLines, ttArmStat, TT_ARMS, TT_ARM_LABEL, TT_DIFFS } from "../lib/totals2/ttCompare";
import { T2_BACKTEST, T2_CONFIG, T2_TRAINED_THROUGH, T2_VERSION } from "../lib/totals2/frozen";
import { saveTotals2Picks, type Totals2PickRow } from "../lib/api/totals2Data";
import { syncTeamTotalsNow } from "../lib/api/teamTotalLines";
import { splitTeamTotal } from "../lib/gameTotals";
import { weatherFeatureVector } from "../lib/totals2/weatherFeatures";
import { CELL, DIM, H3, NUM, P, f1, sgn, pct } from "../components/drogba/shared";

const HEAD: CSSProperties = { ...NUM, color: "var(--chalk-dim)", fontWeight: 600 };
const HEADL: CSSProperties = { ...CELL, color: "var(--chalk-dim)", fontWeight: 600 };
const OVER = "#8fd39a";
const UNDER = "#e07a7a";
const SMALL = 100; // fewer decided bets than this: shown faded — too few to read anything into

function winColor(p: number | null, n: number): CSSProperties {
  if (p == null) return {};
  return { color: p >= BREAK_EVEN ? OVER : p < 50 ? UNDER : "var(--c-warn, #e8c66a)", opacity: n < SMALL ? 0.55 : 1, fontStyle: n < SMALL ? "italic" : undefined };
}
const leanColor = (v: number | null | undefined) => (v == null ? undefined : v > 0 ? OVER : v < 0 ? UNDER : undefined);

type Tab = "week" | "season" | "tt" | "log" | "how";
const TABS: [Tab, string][] = [
  ["week", "This week"],
  ["tt", "Team totals: compare"],
  ["season", "Season so far"],
  ["log", "Saved log"],
  ["how", "How it works + backtest"],
];

export default function Totals2Panel() {
  const season = new Date().getFullYear();
  const s = useTotals2(season);
  const [tab, setTab] = useState<Tab>("week");

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Totals — Model v2 (residual, team level)</h2>
      <p style={DIM}>
        Starts from the market's own number and only adds what the model can justify: a team's points = the market's implied team total + the model's expected
        residual. Game total = the two teams added up. Ratings are point-in-time (only games before each week), opponent-adjusted, garbage-time-filtered, and
        shrink toward last season by how much production returns. Frozen fit {T2_VERSION}, trained on seasons through {T2_TRAINED_THROUGH} — every {season} number
        here is out-of-sample.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.6rem 0 1rem" }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={`mode-btn ${tab === k ? "mode-btn-active" : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <button className="mode-btn" onClick={s.reload} disabled={s.loading} style={{ marginLeft: "auto" }}>
          Reload data
        </button>
      </div>
      {s.error && <p style={{ color: "crimson" }}>{s.error}</p>}
      {s.weatherNote && <p style={{ ...DIM, color: "var(--c-warn, #e8c66a)" }}>{s.weatherNote}</p>}
      {tab === "how" ? (
        <HowItWorks />
      ) : s.loading ? (
        <div className="empty">Loading games, lines and stats, building ratings and pulling weather…</div>
      ) : (
        <>
          {tab === "week" && <WeekTab s={s} season={season} />}
          {tab === "season" && <SeasonTab gps={s.gps} preds={s.preds} />}
          {tab === "tt" && <TTTab s={s} />}
          {tab === "log" && <LogTab picks={s.picks} gps={s.gps} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ this week
function WeekTab({ s, season }: { s: ReturnType<typeof useTotals2>; season: number }) {
  const weeks = useMemo(() => Array.from(new Set(s.gps.map((g) => g.g.week))).sort((a, b) => a - b), [s.gps]);
  const firstOpen = useMemo(() => s.gps.filter((g) => !g.g.completed).map((g) => g.g.week).sort((a, b) => a - b)[0] ?? weeks[weeks.length - 1] ?? 1, [s.gps, weeks]);
  const [week, setWeek] = useState<number | null>(null);
  const wk = week ?? firstOpen;
  const realLines = useMemo(() => latestTeamLines(s.ttLines), [s.ttLines]);
  const rows = useMemo(() => s.gps.filter((g) => g.g.week === wk).sort((a, b) => (a.g.startMs ?? 0) - (b.g.startMs ?? 0)), [s.gps, wk]);
  const logged = useMemo(() => new Set(s.picks.map((p) => p.game_id)), [s.picks]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ycHome = (gp: GamePred) => {
    const l = s.locks[gp.g.id];
    return l?.my_away_spread != null ? -Number(l.my_away_spread) : null;
  };

  async function save(overwrite: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const picks: Omit<Totals2PickRow, "created_at">[] = [];
      for (const gp of rows) {
        if (gp.g.completed) continue;
        const l = lineOf(gp.mkt, "close");
        const tot = projectedTotal(gp, "close");
        if (!l || tot == null) continue;
        picks.push({
          game_id: gp.g.id,
          season,
          week: gp.g.week,
          home_team: gp.g.home,
          away_team: gp.g.away,
          model_version: T2_VERSION,
          market_total: l.total,
          market_home_spread: l.spread,
          market_provider: gp.mkt.provider,
          proj_total: tot,
          proj_home_pts: impliedPoints(l.total, l.spread, "home") + (gp.home.resid.close ?? 0),
          proj_away_pts: impliedPoints(l.total, l.spread, "away") + (gp.away.resid.close ?? 0),
          stats_home_pts: gp.home.l1,
          stats_away_pts: gp.away.l1,
          yc_home_spread: ycHome(gp),
          weather: (s.weather.get(gp.g.id) as any) ?? null,
        });
      }
      if (!picks.length) {
        setMsg("Nothing to save — every game this week has kicked off or has no line.");
        return;
      }
      const r = await saveTotals2Picks(picks, overwrite);
      setMsg(`Saved ${r.saved} new, replaced ${r.overwritten}, kept ${r.skippedExisting} already logged, skipped ${r.skippedStarted} already kicked off.`);
      s.reload();
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncTT() {
    setBusy(true);
    setMsg(null);
    try {
      const games = rows.filter((g) => !g.g.completed).map((g) => ({ id: g.g.id, week: g.g.week, home_team: g.g.home, away_team: g.g.away }));
      const r = await syncTeamTotalsNow(games as any, season);
      setMsg(`Team-total lines: ${r.rows} rows from ${r.events} events.`);
      s.reload();
    } catch (e: any) {
      setMsg(e?.message ?? "Team-total sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Week{" "}
          <select value={wk} onChange={(e) => setWeek(Number(e.target.value))}>
            {weeks.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <button className="mode-btn" disabled={busy} onClick={() => save(false)} title="First save wins: games already logged are kept">
          Save this week's v2 numbers
        </button>
        <button className="mode-btn" disabled={busy} onClick={() => confirm("Replace already-logged numbers for games that haven't kicked off?") && save(true)}>
          Re-save (overwrite unplayed)
        </button>
        <button className="mode-btn" disabled={busy} onClick={syncTT} title="Pulls real team-total lines from The Odds API (1 credit per game)">
          Pull team-total lines
        </button>
      </div>
      {msg && <p style={DIM}>{msg}</p>}
      <p style={DIM}>
        "Now" = the current line (the closing line once a game is played). "v2 vs open" = the opening-line model, the number to bet into when lines first post (its
        record is graded by closing-line value). Team rows: the market's own team number (total split by spread), a real team-total line when one has been pulled,
        then v2's team number and the v2 total split by the YCPR spread and by the market spread. Edges are small by design — the model is heavily shrunk toward the
        market, so a 1-point lean is a strong one here.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL}>Game / team</th>
              <th style={HEAD}>Weather</th>
              <th style={HEAD}>Open → now</th>
              <th style={HEAD}>v2 vs open</th>
              <th style={HEAD}>v2 vs now</th>
              <th style={HEAD}>Lean</th>
              <th style={HEAD} title="Real team-total line, when pulled">TT line</th>
              <th style={HEAD}>v2 team</th>
              <th style={HEAD}>v2 ÷ YCPR</th>
              <th style={HEAD}>v2 ÷ mkt</th>
              <th style={HEAD}>Site (v1)</th>
              <th style={HEAD}>Final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((gp) => {
              const g = gp.g;
              const now = lineOf(gp.mkt, "close");
              const open = lineOf(gp.mkt, "open");
              const vClose = projectedTotal(gp, "close");
              const vOpen = projectedTotal(gp, "open");
              const lean = vClose != null && now ? vClose - now.total : null;
              const wx = s.weather.get(g.id);
              const wf = weatherFeatureVector(wx);
              const lock = s.locks[g.id];
              const yc = ycHome(gp);
              const v2yc = vClose != null && yc != null ? splitTeamTotal(vClose, yc) : null;
              const v1yc = lock?.my_total != null && yc != null ? splitTeamTotal(Number(lock.my_total), yc) : null;
              const v2m = vClose != null && now ? splitTeamTotal(vClose, now.spread) : null;
              const final = g.completed ? (g.homePts ?? 0) + (g.awayPts ?? 0) : null;
              return [
                <tr key={g.id} style={{ borderTop: "1px solid var(--hash)" }}>
                  <td style={{ ...CELL, fontWeight: 600 }}>
                    {g.away} @ {g.home}
                    {g.neutral ? " (N)" : ""}
                    {logged.has(g.id) && <span style={{ ...DIM, marginLeft: "0.4rem" }}>· logged</span>}
                  </td>
                  <td style={NUM} title={wx ? `wind ${f1(wx.avgWind)} mph, precip ${f1(wx.precip, 2)} in, ${f1(wx.temp, 0)}°F` : "no weather"}>
                    {wx?.dome ? "dome" : wx ? `${f1(wx.avgWind, 0)} mph${wf.rain ? " · rain" : ""}${wf.snow ? " · snow" : ""}` : "–"}
                  </td>
                  <td style={NUM}>
                    {f1(open?.total)} → {f1(now?.total)}
                  </td>
                  <td style={{ ...NUM, color: leanColor(vOpen != null && open ? vOpen - open.total : null) }}>{f1(vOpen)}</td>
                  <td style={NUM}>{f1(vClose)}</td>
                  <td style={{ ...NUM, color: leanColor(lean), fontWeight: 600 }}>{lean == null ? "–" : `${lean > 0 ? "O" : "U"} ${sgn(lean)}`}</td>
                  <td style={NUM} />
                  <td style={NUM} />
                  <td style={NUM} />
                  <td style={NUM} />
                  <td style={NUM}>{lock?.my_total != null ? f1(Number(lock.my_total)) : "–"}</td>
                  <td style={NUM}>{final ?? ""}</td>
                </tr>,
                ...(["away", "home"] as const).map((side) => {
                  const p = side === "home" ? gp.home : gp.away;
                  const team = side === "home" ? g.home : g.away;
                  const imp = now ? impliedPoints(now.total, now.spread, side) : null;
                  const mine = imp != null && p.resid.close != null ? imp + p.resid.close : null;
                  const real = realLines.get(`${g.id}|${team}`) ?? null;
                  const pick = (sp: { home: number | null; away: number | null } | null) => (sp ? (side === "home" ? sp.home : sp.away) : null);
                  const ref = real ?? imp;
                  const ttLean = mine != null && ref != null ? mine - ref : null;
                  const pts = g.completed ? (side === "home" ? g.homePts : g.awayPts) : null;
                  return (
                    <tr key={`${g.id}|${side}`}>
                      <td style={{ ...CELL, paddingLeft: "1.4rem", color: "var(--chalk-dim)" }}>
                        {team} <span style={{ fontSize: "0.7rem" }}>mkt {f1(imp)}</span>
                      </td>
                      <td style={NUM} />
                      <td style={NUM} />
                      <td style={NUM} />
                      <td style={NUM} />
                      <td style={{ ...NUM, color: leanColor(ttLean) }}>{ttLean == null ? "" : `${ttLean > 0 ? "O" : "U"} ${sgn(ttLean)}`}</td>
                      <td style={NUM}>{f1(real)}</td>
                      <td style={{ ...NUM, fontWeight: 600 }}>{f1(mine)}</td>
                      <td style={NUM}>{f1(pick(v2yc))}</td>
                      <td style={NUM}>{f1(pick(v2m))}</td>
                      <td style={NUM}>{f1(pick(v1yc))}</td>
                      <td style={NUM}>{pts ?? ""}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ season so far
function ScoreTable({ title, rows }: { title: string; rows: [string, ScoreSummary][] }) {
  const thresholds = rows[0]?.[1].buckets.map((b) => b.minEdge) ?? [];
  return (
    <>
      <h3 style={H3}>{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL}>Graded against</th>
              <th style={HEAD}>n</th>
              <th style={HEAD} title="Share of (actual − line) the model explains. 0 = no better than the line">Residual R²</th>
              <th style={HEAD}>Corr</th>
              <th style={HEAD}>MAE model / line</th>
              {thresholds.map((t) => (
                <th key={t} style={HEAD}>
                  {t === 0 ? "Every side" : `Lean ≥ ${t}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, sm]) => (
              <tr key={label}>
                <td style={CELL}>{label}</td>
                <td style={NUM}>{sm.n}</td>
                <td style={NUM}>{sm.r2 == null ? "–" : `${(100 * sm.r2).toFixed(2)}%`}</td>
                <td style={NUM}>{f1(sm.corr, 3)}</td>
                <td style={NUM}>
                  {f1(sm.mae, 2)} / {f1(sm.lineMae, 2)}
                </td>
                {sm.buckets.map((b) => (
                  <td key={b.minEdge} style={{ ...NUM, ...winColor(b.winPct, b.w + b.l) }} title={`${b.w}-${b.l}${b.p ? `-${b.p}` : ""}`}>
                    {pct(b.winPct)} <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({b.n})</span>
                    {b.clv != null && <div style={{ fontSize: "0.68rem", color: leanColor(b.clv) }}>CLV {sgn(b.clv, 2)}</div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const SEASON_EDGES = [0, 0.5, 1, 1.5, 2];

function SeasonTab({ gps, preds }: { gps: GamePred[]; preds: ReturnType<typeof useTotals2>["preds"] }) {
  const [from, setFrom] = useState(1);
  const sg = gps.filter((g) => g.g.week >= from);
  const sp = preds.filter((p) => p.row.g.week >= from);
  return (
    <div>
      <p style={DIM}>
        Every completed FBS-vs-FBS game this season, recomputed from the frozen model — not what was logged at the time (see Saved log for that). Weather for played
        games is Open-Meteo's record of the game window. Win % is colored against the 52.4% break-even; faded italic = fewer than {SMALL} decided bets. CLV is
        shown for the opening-line model only.
      </p>
      <label style={{ fontSize: "0.85rem" }}>
        From week{" "}
        <input type="number" min={1} max={16} value={from} onChange={(e) => setFrom(Math.max(1, Number(e.target.value) || 1))} style={{ width: "3.5rem" }} />
      </label>
      <ScoreTable
        title="Game totals"
        rows={[
          ["Closing line (close model)", scoreGames(sg, "close", SEASON_EDGES)],
          ["Opening line (open model)", scoreGames(sg, "open", SEASON_EDGES)],
        ]}
      />
      <ScoreTable
        title="Team totals (vs the market's own team number: total split by spread)"
        rows={[
          ["Closing line (close model)", scoreTeams(sp, "close", SEASON_EDGES)],
          ["Opening line (open model)", scoreTeams(sp, "open", SEASON_EDGES)],
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ team totals compare
function TTTab({ s }: { s: ReturnType<typeof useTotals2> }) {
  const sides = useMemo(() => buildTTSides(s.gps, s.locks, latestTeamLines(s.ttLines)), [s.gps, s.locks, s.ttLines]);
  const withReal = sides.filter((x) => x.real != null).length;
  return (
    <div>
      <p style={DIM}>
        Same games, same results — only the way the team number is built differs. Graded first against the market's own team number (closing total split by closing
        spread: the bar any team-total line has to clear), then against real team-total lines where one was pulled ({withReal} team-games so far; pull them every
        week with the button on This week — that history is what lets you specialize in this market). "Stats only" is layer 1 with no market input at all.
      </p>
      {(["derived", "real"] as const).map((grade) => (
        <div key={grade}>
          <h3 style={H3}>{grade === "derived" ? "vs the market's derived team number (closing total ÷ closing spread)" : "vs real team-total lines (latest pull)"}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={HEADL}>Team number</th>
                  <th style={HEAD}>Team-games</th>
                  <th style={HEAD}>MAE / line MAE</th>
                  {TT_DIFFS.map((d) => (
                    <th key={d} style={HEAD}>
                      Bets {d}+ off
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TT_ARMS.map((arm) => {
                  const st = ttArmStat(sides, arm, grade);
                  return (
                    <tr key={arm}>
                      <td style={CELL}>{TT_ARM_LABEL[arm]}</td>
                      <td style={NUM}>{st.n}</td>
                      <td style={NUM}>
                        {f1(st.mae, 2)} / {f1(st.lineMae, 2)}
                      </td>
                      {st.bets.map((b) => (
                        <td key={b.minDiff} style={{ ...NUM, ...winColor(b.pct, b.w + b.l) }} title={`${b.w}-${b.l}${b.p ? `-${b.p}` : ""}`}>
                          {pct(b.pct)} <span style={{ color: "var(--chalk-dim)", fontSize: "0.7rem" }}>({b.w + b.l + b.p})</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ saved log
function LogTab({ picks, gps }: { picks: Totals2PickRow[]; gps: GamePred[] }) {
  const byId = useMemo(() => new Map(gps.map((g) => [g.g.id, g])), [gps]);
  const graded = picks
    .map((p) => {
      const gp = byId.get(p.game_id);
      if (!gp || !gp.g.completed || p.proj_total == null || p.market_total == null) return null;
      const actual = (gp.g.homePts ?? 0) + (gp.g.awayPts ?? 0);
      const edge = p.proj_total - p.market_total;
      const res = Math.sign(edge) * (actual - p.market_total);
      const clv = gp.mkt.closeTotal != null ? Math.sign(edge) * (gp.mkt.closeTotal - p.market_total) : null;
      return { p, gp, actual, edge, res, clv };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const tally = (min: number) => {
    const sub = graded.filter((x) => Math.abs(x.edge) >= min && x.edge !== 0);
    const w = sub.filter((x) => x.res > 0).length;
    const l = sub.filter((x) => x.res < 0).length;
    const c = sub.filter((x) => x.clv != null);
    return { n: sub.length, w, l, pct: w + l ? (100 * w) / (w + l) : null, clv: c.length ? c.reduce((a, x) => a + x.clv!, 0) / c.length : null };
  };
  return (
    <div>
      <p style={DIM}>
        What the model said when it was saved, against the line it was saved with — the honest record. {picks.length} games logged, {graded.length} played. CLV = how far
        the closing total moved toward the logged lean.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL}>Lean at least</th>
              <th style={HEAD}>Bets</th>
              <th style={HEAD}>W-L</th>
              <th style={HEAD}>Win %</th>
              <th style={HEAD}>Avg CLV</th>
            </tr>
          </thead>
          <tbody>
            {[0, 0.5, 1, 1.5, 2].map((m) => {
              const t = tally(m);
              return (
                <tr key={m}>
                  <td style={CELL}>{m === 0 ? "Every game" : `${m} pts`}</td>
                  <td style={NUM}>{t.n}</td>
                  <td style={NUM}>
                    {t.w}-{t.l}
                  </td>
                  <td style={{ ...NUM, ...winColor(t.pct, t.w + t.l) }}>{pct(t.pct)}</td>
                  <td style={{ ...NUM, color: leanColor(t.clv) }}>{sgn(t.clv, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 style={H3}>Logged games</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={HEADL}>Wk</th>
              <th style={HEADL}>Game</th>
              <th style={HEAD}>Logged line</th>
              <th style={HEAD}>v2</th>
              <th style={HEAD}>Lean</th>
              <th style={HEAD}>Close</th>
              <th style={HEAD}>Final</th>
              <th style={HEAD}>Result</th>
            </tr>
          </thead>
          <tbody>
            {[...picks]
              .sort((a, b) => b.week - a.week || a.game_id.localeCompare(b.game_id))
              .map((p) => {
                const gp = byId.get(p.game_id);
                const edge = p.proj_total != null && p.market_total != null ? p.proj_total - p.market_total : null;
                const actual = gp?.g.completed ? (gp.g.homePts ?? 0) + (gp.g.awayPts ?? 0) : null;
                const res = edge != null && actual != null && p.market_total != null ? Math.sign(edge) * (actual - p.market_total) : null;
                return (
                  <tr key={p.game_id}>
                    <td style={CELL}>{p.week}</td>
                    <td style={CELL}>
                      {p.away_team} @ {p.home_team}
                    </td>
                    <td style={NUM}>{f1(p.market_total)}</td>
                    <td style={NUM}>{f1(p.proj_total)}</td>
                    <td style={{ ...NUM, color: leanColor(edge) }}>{edge == null ? "–" : `${edge > 0 ? "O" : "U"} ${sgn(edge)}`}</td>
                    <td style={NUM}>{f1(gp?.mkt.closeTotal)}</td>
                    <td style={NUM}>{actual ?? ""}</td>
                    <td style={{ ...NUM, color: res == null ? undefined : res > 0 ? OVER : res < 0 ? UNDER : undefined }}>{res == null ? "" : res > 0 ? "W" : res < 0 ? "L" : "P"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
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
          <strong>Pace</strong>: opponent-adjusted drives and plays per game for both teams. (Seconds per play needs per-game possession time, which isn't pulled
          yet.)
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
          Against the opener there is a small, steady signal: layer 1's disagreement is worth ~0.1 points per point, and the line tends to move toward the model (CLV
          positive in most seasons). The edge, if there is one, is in betting early — and team totals, which books move less carefully, are the natural place for it.
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
