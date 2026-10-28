// YCPR Bot dashboard. Reads /api/data, writes via /api/admin, refreshes every 30s.
// Away orientation throughout (away spread, negative = away favored); internally
// the bot stores a home margin (home − away), which is the same number.
let PW = "";
let THEME = "light";
try { PW = localStorage.getItem("botpw") || ""; THEME = localStorage.getItem("bottheme") || "light"; } catch {}
let data = null;
let view = "board";
let openGame = null; // game_id shown in the drawer
let drawerTab = "outcomes";
let fillsFilter = "";
let lab = null; // /api/lab payload
let openStrat = null; // strategy id, or "new"
let review = null; // /api/review payload
let openReview = null; // game_id shown in the Review drawer
let openHypo = null; // { gameId, methodKey } shown in the Hypotheticals drawer (hypo.js)
let venue = "all"; // venue filter: all | kalshi | novig | prophetx
try { venue = localStorage.getItem("botvenue") || "all"; } catch {}
let showDeltas = false; // Board: change since the last run on each game row
try { showDeltas = localStorage.getItem("botdeltas") === "1"; } catch {}
const VENUES = ["kalshi", "novig", "prophetx"];
const VNAME = { all: "All", kalshi: "Kalshi", novig: "Novig", prophetx: "ProphetX" };
const VSHORT = { kalshi: "K", novig: "NV", prophetx: "PX" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v) => (v == null || v === "" ? null : Number(v));
const c = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "¢");
const usd = (x) => (x == null ? "–" : (x < 0 ? "−$" : "$") + Math.abs(x).toFixed(2));
const cls = (x) => (x == null || Math.abs(x) < 0.005 ? "" : x > 0 ? "ok" : "bad");
const pct = (x) => (x * 100).toFixed(1) + "%";
const signed = (x) => (x == null || !Number.isFinite(x) ? "–" : x === 0 ? "PK" : (x < 0 ? "−" : "+") + Math.abs(x).toFixed(1));
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "–");
const ago = (iso) => {
  if (!iso) return "–";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const ourAway = (w) => num(w.my_home_margin) ?? num(w.ycpr_home_margin);
const marketAway = (g) => (g?.home_spread == null ? null : -g.home_spread);
const vOf = (r) => r.venue || "kalshi";
const vf = (rows) => (venue === "all" ? rows : rows.filter((r) => vOf(r) === venue));
const vMargin = (w, v) => num(w.venue_margins?.[v]) ?? (v === "kalshi" ? num(w.kalshi_home_margin) : null);
// The market line the current view compares against: the venue's own, or Kalshi's (else any) in the combined view.
const mktOf = (w) => (venue === "all" ? vMargin(w, "kalshi") ?? vMargin(w, "novig") ?? vMargin(w, "prophetx") : vMargin(w, venue));
const mktName = (w) => (venue !== "all" ? VNAME[venue] : vMargin(w, "kalshi") != null ? "Kalshi" : vMargin(w, "novig") != null ? "Novig" : "ProphetX");
const outcomeOf = (w) => data.outcomes?.[w.game_id]?.[venue];
const gameOf = (w) => data.upcoming.find((x) => String(x.id) === String(w.game_id));

function applyTheme() {
  document.documentElement.dataset.theme = THEME;
  $("themeBtn").textContent = THEME === "dark" ? "Light theme" : "Dark theme";
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-bot-password": PW, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { showGate("Wrong password."); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function showGate(msg = "") { $("app").hidden = true; $("gate").hidden = false; $("gateErr").textContent = msg; }

// ---------- Per-game derived numbers

function positions(fills) {
  const m = new Map();
  for (const f of fills) {
    const p = m.get(f.ticker) || { ticker: f.ticker, side: f.side, strike: Number(f.strike), yes: 0, cost: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    p.yes += d;
    p.cost += d * Number(f.price) + Number(f.fee);
    m.set(f.ticker, p);
  }
  return [...m.values()];
}

function curve(pos, lo = -35, hi = 35) {
  const pts = [];
  for (let m = lo; m <= hi; m++) {
    if (m === 0) continue;
    let v = 0;
    for (const p of pos) v += p.yes * ((p.side === "home" ? m : -m) > p.strike ? 1 : 0) - p.cost;
    pts.push({ m, v });
  }
  return pts;
}

// Status the way a trader reads it.
function statusOf(w, g) {
  const now = Date.now();
  const kick = w.kickoff ? new Date(w.kickoff).getTime() : null;
  if (!w.enabled) return ["Off", ""];
  if (kick && now > kick) return ["Final / settling", "info"];
  if (kick && now > kick - (w.stop_minutes_before ?? 30) * 60000) return ["Stopped", "warn"];
  const ours = ourAway(w);
  const mkt = mktOf(w) ?? marketAway(g);
  if (ours != null && mkt != null && !(w.pick === "home" ? ours > mkt : ours < mkt)) return ["No edge", "warn"];
  const resting = vf(data.orders).filter((o) => o.game_id === w.game_id).length;
  return resting ? [`Quoting · ${resting}`, "ok"] : ["Waiting", ""];
}

function marginLabel(w, from, to, limit = 60) {
  const team = from < 0 ? w.away_team : w.home_team;
  const lo = Math.min(Math.abs(from), Math.abs(to)), hi = Math.max(Math.abs(from), Math.abs(to));
  if (hi >= limit) return `${esc(team)} by ${lo}+`;
  return lo === hi ? `${esc(team)} by ${lo}` : `${esc(team)} by ${lo}–${hi}`;
}

/** "Central Michigan −2.5" from a rung's side/strike (YES = side wins by over strike); Kalshi ticker fallback. */
function numLabel(r, w) {
  if (r.side && r.strike != null && w) {
    const s = Number(r.strike);
    return `${r.side === "home" ? w.home_team : w.away_team} ${s >= 0 ? "−" : "+"}${Math.abs(s)}`;
  }
  return rungLabel(r.ticker);
}

function linesHtml(w, g) {
  const v = VENUES.filter((x) => vMargin(w, x) != null && (venue === "all" || venue === x));
  return `<div><em>YC</em>${signed(ourAway(w))}</div>${v.map((x) => `<div><em>${VSHORT[x]}</em>${signed(vMargin(w, x))}</div>`).join("")}<div><em>Mkt</em>${signed(marketAway(g))}</div>`;
}

function rungLabel(ticker) {
  const m = /-([A-Z]+?)(\d+)$/.exec(ticker || "");
  return m ? `${m[1]} over ${Number(m[2]) - 0.5}` : ticker;
}

// ---------- Charts

function sparkSvg(pts, w = 104, h = 30) {
  if (!pts.length || pts.every((p) => Math.abs(p.v) < 1e-9)) return '<span class="muted" style="font-size:.76rem">no position</span>';
  const max = Math.max(...pts.map((p) => Math.abs(p.v)), 0.01);
  const bw = w / pts.length;
  const mid = h / 2;
  const bars = pts.map((p, i) => {
    const bh = (Math.abs(p.v) / max) * (mid - 1);
    return `<rect x="${(i * bw).toFixed(2)}" y="${(p.v >= 0 ? mid - bh : mid).toFixed(2)}" width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${bh.toFixed(2)}" fill="${p.v >= 0 ? "var(--c-ok)" : "var(--c-err)"}"/>`;
  }).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars}</svg>`;
}

/**
 * P&L by final margin. `marks` (the game drawer) adds the market line M and our number Y (home margins),
 * and with `shape` on shades the shaped-position zones (§21): the against band and the blowout zone.
 */
function curveSvg(w, pts, marks = null) {
  if (!pts.length || pts.every((p) => Math.abs(p.v) < 1e-9)) return '<p class="muted">No position yet.</p>';
  const W = 600, H = 130, pad = 12;
  const max = Math.max(...pts.map((p) => Math.abs(p.v)), 0.01);
  const bw = (W - 2 * pad) / pts.length, y0 = H / 2 - 6;
  const xAt = (m) => {
    // A fractional home margin sits between its neighbors' bars (there's no bar at 0).
    const i = pts.findIndex((p) => p.m >= m);
    if (i < 0) return null;
    const prev = i > 0 ? pts[i - 1].m : pts[i].m - 1;
    const frac = pts[i].m === prev ? 0 : (m - prev) / (pts[i].m - prev);
    return pad + (i - 1) * bw + bw / 2 + frac * bw;
  };
  let zones = "", lines = "", legend = "";
  if (marks) {
    const pickX = (m) => (w.pick === "home" ? m : -m); // pick-oriented margin
    const M = marks.market;
    const blow = num(w.blowout_margin) ?? 10;
    if (w.shape && M != null) {
      const cut = Math.ceil(pickX(M) - 1e-9);
      const zoneOf = (m) => (pickX(m) >= cut ? null : pickX(m) <= -blow ? "blow" : "band");
      zones = pts.map((p, i) => {
        const z = zoneOf(p.m);
        return z ? `<rect x="${pad + i * bw}" y="${pad - 4}" width="${bw}" height="${H - pad - 10}" fill="${z === "blow" ? "var(--c-err)" : "var(--c-warn)"}" opacity="${z === "blow" ? 0.12 : 0.1}"/>` : "";
      }).join("");
      legend += ` · <span style="color:var(--c-warn)">■</span> against band (loss ≤ ${usd(num(w.against_limit) ?? 0.1 * Number(w.max_worst_case_loss))}) · <span style="color:var(--c-err)">■</span> blowout (${blow}+ pts against)`;
    }
    const mark = (m, label, color, dash) => {
      const x = m == null ? null : xAt(m);
      return x == null ? "" : `<line x1="${x}" x2="${x}" y1="${pad - 4}" y2="${H - 14}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="4 3"' : ""}/><text x="${x + 3}" y="${pad + 4}" font-size="10" fill="${color}">${label}</text>`;
    };
    lines = mark(M, "M", "var(--c-info)", true) + mark(marks.ours, "Y", "var(--c-ok)", false);
    if (M != null || marks.ours != null) legend = ` · M = market ${signed(M)}, Y = yours ${signed(marks.ours)} (${esc(w.away_team)})` + legend;
  }
  const bars = pts.map((p, i) => {
    const bh = (Math.abs(p.v) / max) * (y0 - pad);
    const team = p.m < 0 ? w.away_team : w.home_team;
    return `<rect x="${pad + i * bw}" y="${p.v >= 0 ? y0 - bh : y0}" width="${Math.max(1, bw - 1)}" height="${bh}" rx="1" fill="${p.v >= 0 ? "var(--c-ok)" : "var(--c-err)"}"><title>${esc(team)} by ${Math.abs(p.m)}: ${usd(p.v)}</title></rect>`;
  }).join("");
  const ticks = [-28, -21, -14, -7, 7, 14, 21, 28].map((m) => {
    const i = pts.findIndex((p) => p.m === m);
    return i < 0 ? "" : `<text x="${pad + i * bw + bw / 2}" y="${H - 2}" text-anchor="middle">${m < 0 ? "A" : "H"}${Math.abs(m)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profit or loss by final margin">${zones}<line x1="${pad}" x2="${W - pad}" y1="${y0}" y2="${y0}" stroke="var(--a-line)"/>${bars}${lines}${ticks}</svg>
    <p class="muted" style="margin:2px 0 12px;font-size:.76rem">A7 = ${esc(w.away_team)} by 7 · H7 = ${esc(w.home_team)} by 7 · after fees, held to settlement${legend}</p>`;
}

// Change since the last run (data.changes, from the snapshots the last two cycles saved).
const changeOf = (w) => data.changes?.games?.[w.game_id]?.[venue] ?? null;
function deltaHtml(x, tag = "span") {
  if (x == null) return "";
  if (Math.abs(x) < 0.005) return `<${tag} class="muted">±$0.00</${tag}>`;
  return `<${tag} class="${x > 0 ? "ok" : "bad"}">${x > 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}</${tag}>`;
}

// ---------- Views

/** On the Board until the game is final (then it's only in Review). */
const onBoard = (w) => !w.completed;

function renderBoard() {
  const watchlist = data.watchlist.filter(onBoard);
  const finished = data.watchlist.length - watchlist.length;
  const shown = new Set(watchlist.map((w) => w.game_id));
  const fills = vf(data.fills).filter((f) => shown.has(f.game_id));
  let worst = 0, best = 0, evY = 0, evK = 0, anyK = false;
  let dWorst = 0, dBest = 0, dEvY = 0, dEvK = 0;
  const rows = watchlist.map((w) => {
    const g = gameOf(w);
    const gFills = fills.filter((f) => f.game_id === w.game_id);
    const pts = curve(positions(gFills));
    const wv = pts.length ? Math.min(...pts.map((p) => p.v)) : 0;
    const bv = pts.length ? Math.max(...pts.map((p) => p.v)) : 0;
    const o = outcomeOf(w);
    if (w.enabled) { worst += wv; best += bv; }
    if (o) { evY += o.expected; if (o.marketExpected != null) { evK += o.marketExpected; anyK = true; } }
    const ch = changeOf(w);
    if (ch) { if (w.enabled) { dWorst += ch[0]; dBest += ch[1]; } dEvY += ch[2] ?? 0; dEvK += ch[3] ?? 0; }
    const rowDelta = (x) => (showDeltas && ch ? `<small title="Change since the last run">Δ ${deltaHtml(x)}</small>` : "");
    const [st, stCls] = statusOf(w, g);
    return `<div class="brow ${w.enabled ? "" : "off"}" data-game="${esc(w.game_id)}" tabindex="0" role="button" aria-label="Open ${esc(w.away_team)} at ${esc(w.home_team)}">
      <div class="game"><b>${esc(w.away_team)} @ ${esc(w.home_team)}</b><span>${when(w.kickoff)}</span></div>
      <div class="lean"><span class="pill">${esc(w.pick === "home" ? w.home_team : w.away_team)}</span></div>
      <div class="lines">${linesHtml(w, g)}</div>
      <div class="spark">${sparkSvg(pts)}</div>
      <div class="r risk"><span class="${cls(wv)}">${usd(wv)}</span> / <span class="${cls(bv)}">${usd(bv)}</span><small>worst / best</small>${showDeltas && ch ? `<small title="Change since the last run">Δ ${deltaHtml(ch[0])} / ${deltaHtml(ch[1])}</small>` : ""}</div>
      <div class="r ev"><span class="${cls(o?.expected)}">${o ? usd(o.expected) : "–"}</span><small>${o?.marketExpected != null ? `${mktName(w)} ${usd(o.marketExpected)}` : "EV (yours)"}</small>${rowDelta(ch?.[2])}</div>
      <div class="r st"><span class="pill ${stCls}">${esc(st)}</span><small>${gFills.length} fills</small></div>
    </div>`;
  }).join("");
  const last = data.runs?.[0];
  const resting = vf(data.orders).filter((o) => shown.has(o.game_id)).length;
  const since = data.changes ? `since the ${new Date(data.changes.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} run` : "";
  const tileDelta = (x) => (data.changes ? `<div class="d">${deltaHtml(x)} ${since}</div>` : "");
  document.querySelector('[data-pane="board"]').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="l">Worst case (all games)</div><div class="v ${cls(worst)}">${usd(worst)}</div><div class="d">if every game lands badly</div>${tileDelta(dWorst)}</div>
      <div class="stat"><div class="l">Best case</div><div class="v ${cls(best)}">${usd(best)}</div><div class="d">if every game lands well</div>${tileDelta(dBest)}</div>
      <div class="stat"><div class="l">Expected · your number</div><div class="v ${cls(evY)}">${usd(evY)}</div><div class="d">${anyK ? `market's number: ${usd(evK)}` : "after fees"}</div>${data.changes ? `<div class="d">${deltaHtml(dEvY)} · market ${deltaHtml(dEvK)} ${since}</div>` : ""}</div>
      <div class="stat"><div class="l">Fills / resting</div><div class="v">${fills.length} / ${resting}</div><div class="d">paper · ${VNAME[venue]}</div></div>
      <div class="stat"><div class="l">Last run</div><div class="v" style="font-size:1.05rem">${last ? ago(last.started_at) : "–"}</div><div class="d ${last?.error ? "bad" : ""}">${last ? (last.error ? "error" : `${last.games ?? 0} games · ${last.fills ?? 0} fills`) : "not yet"}</div></div>
    </div>
    <label class="chk" style="margin:0 0 10px;color:var(--a-ink-2)"><input type="checkbox" id="boardDeltas" ${showDeltas ? "checked" : ""}> Show change since last run on each game${data.changes ? "" : ' <span class="muted">(available after two cycles have run)</span>'}</label>
    <div class="board">
      <div class="brow head"><div>Game</div><div>Lean</div><div>Lines (away)</div><div>P&amp;L by margin</div><div class="r">Worst / best</div><div class="r">Expected</div><div class="r">Status</div></div>
      ${rows || `<div class="empty">${finished ? "No games in play." : "No games yet."} Add some from <b>Add games</b>.</div>`}
    </div>
    ${finished ? `<p class="muted" style="font-size:.8rem;margin:10px 0 0">${finished} finished game${finished === 1 ? " is" : "s are"} in <button type="button" class="linkbtn" data-goto="review" style="text-decoration:underline">Review</button>.</p>` : ""}`;
  $("navCount").textContent = watchlist.filter((w) => w.enabled).length;
}

function renderFills() {
  const { watchlist } = data;
  const fills = vf(data.fills);
  const name = new Map(watchlist.map((w) => [w.game_id, `${w.away_team} @ ${w.home_team}`]));
  const wOf = new Map(watchlist.map((w) => [w.game_id, w]));
  const list = fillsFilter ? fills.filter((f) => f.game_id === fillsFilter) : fills;
  const settled = list.filter((f) => f.result != null);
  const settledPnl = settled.reduce((s, f) => s + (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee, 0);
  const clvs = list.filter((f) => f.close_mid != null).map((f) => (f.action === "buy" ? f.close_mid - f.price : f.price - f.close_mid));
  const avgClv = clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null;
  const fees = list.reduce((s, f) => s + Number(f.fee), 0);
  document.querySelector('[data-pane="fills"]').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="l">Fills</div><div class="v">${list.length}</div><div class="d">${settled.length} settled</div></div>
      <div class="stat"><div class="l">Settled P&amp;L</div><div class="v ${cls(settledPnl)}">${settled.length ? usd(settledPnl) : "–"}</div><div class="d">after fees</div></div>
      <div class="stat"><div class="l">Average CLV</div><div class="v ${cls(avgClv)}">${avgClv == null ? "–" : c(avgClv)}</div><div class="d">vs last pregame mid</div></div>
      <div class="stat"><div class="l">Fees</div><div class="v">${usd(fees)}</div><div class="d">each venue's fee model</div></div>
    </div>
    <div class="panel">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <label class="field" style="min-width:220px">Game<select id="fillsGame"><option value="">All games</option>${watchlist.map((w) => `<option value="${esc(w.game_id)}" ${w.game_id === fillsFilter ? "selected" : ""}>${esc(w.away_team)} @ ${esc(w.home_team)}</option>`).join("")}</select></label>
      </div>
      <div class="scroll"><table>
        <tr><th>When</th><th>Venue</th><th>Game</th><th>Number</th><th>Side</th><th>Price</th><th>Fair</th><th>Fee</th><th>CLV</th><th>Result</th><th>P&amp;L</th></tr>
        ${list.length ? list.map((f) => {
          const clv = f.close_mid == null ? null : f.action === "buy" ? f.close_mid - f.price : f.price - f.close_mid;
          const pnl = f.result == null ? null : (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee;
          return `<tr><td>${when(f.filled_at)}</td><td>${VNAME[vOf(f)]}</td><td>${esc(name.get(f.game_id) || f.game_id)}</td><td>${esc(numLabel(f, wOf.get(f.game_id)))}</td><td>${f.action === "buy" ? "Buy" : "Sell"} ${f.count}</td><td>${c(Number(f.price), 0)}</td><td>${c(f.fair_at_fill)}</td><td>${c(Number(f.fee), 2)}</td><td class="${cls(clv)}">${c(clv)}</td><td>${f.result == null ? "–" : f.result ? "YES" : "NO"}</td><td class="${cls(pnl)}">${usd(pnl)}</td></tr>`;
        }).join("") : '<tr><td colspan="11" class="muted">No fills yet.</td></tr>'}
      </table></div>
    </div>`;
}

function renderSettings() {
  const { state, runs } = data;
  const def = Math.round((num(state?.default_ycpr_weight) ?? 1) * 100);
  document.querySelector('[data-pane="settings"]').innerHTML = `
    <div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start">
      <div class="panel">
        <h3>Trust in your number</h3>
        <div style="display:flex;gap:12px;align-items:center"><input id="trustDefault" type="range" min="0" max="100" step="5" value="${def}" aria-label="Default trust"><b id="trustDefaultVal" class="num" style="min-width:44px;text-align:right">${def}%</b></div>
        <p class="muted" style="font-size:.82rem;margin:8px 0 0">Default for every game. 100% = the fair price is your YC number; lower blends toward the market (Kalshi + sportsbooks). Games with their own setting keep it.</p>
      </div>
      <div class="panel">
        <h3>Bot</h3>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="pill info">Mode: ${esc(state?.mode || "paper")}</span><span class="pill ${state?.kill_switch ? "bad" : "ok"}">${state?.kill_switch ? "Kill switch ON" : "Kill switch off"}</span></div>
        <p class="muted" style="font-size:.82rem;margin:8px 0 0">The tower runs the paper cycle about every 90 seconds, the market recorder every 5 minutes, the ProphetX listener continuously and Hypotheticals hourly. Backups: GitHub Actions (a cycle every few hours) and /api/espn (cron-job.org), which saves ESPN finals and trades in the tower's place if no cycle has finished for 10 minutes. The kill switch cancels every resting order on the next cycle.</p>
      </div>
    </div>
    <div class="panel" id="healthPanel" style="margin-top:16px">
      <h3>Health</h3>
      ${healthPanel()}
    </div>
    <div class="panel" style="margin-top:16px">
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">Run history</h3>
        <label class="field" style="min-width:200px">Show<select id="runsMode">${Object.entries(RUN_MODES).map(([k, l]) => `<option value="${k}" ${runsMode === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="scroll runs-scroll"><table class="runs"><tr><th>Started</th>${runsMode === "paper" ? "" : "<th>Type</th>"}<th>Took</th><th>Games</th><th>Placed</th><th>Cancelled</th><th>Fills</th><th>Details</th><th>Status</th></tr>
      ${runRows(runsList ?? (runsMode === "paper" ? runs : []))}
      </table></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <button class="btn" type="button" id="runsMore" ${runsMore ? "" : "disabled"}>${runsMore ? "Load older runs" : "No older runs"}</button>
        <span class="muted" style="font-size:.78rem">${(runsList ?? runs).length} shown</span>
      </div>
    </div>`;
  if (runsList == null && runsMode !== "paper") loadRuns(true);
}

// ---------- Run history (Settings)

const RUN_MODES = { paper: "Paper trading cycles", record: "Market recorder", hypo: "Hypotheticals replays", pxtape: "ProphetX trade listener", espn: "ESPN backup", all: "Everything" };
const HOST_LABEL = { github: "GitHub backup", vercel: "Vercel", local: "a manual run" };
/** Minutes a run may take before an unfinished one counts as cut off (bot/runner/health.ts JOBS.runMs). */
const RUN_LIMIT_MIN = { paper: 6, record: 8, pxtape: 8, hypo: 25, espn: 6 };
let runsMode = "paper";
let runsList = null; // null = the latest paper runs from /api/data
let runsMore = true;

function runDetails(r) {
  const v = r.venues ? Object.entries(r.venues).map(([k, x]) => `${VSHORT[k] || k} ${x.fills}/${x.placed}`).join(" · ") : "";
  const bits = [
    r.host && r.host !== "tower" ? `on ${HOST_LABEL[r.host] ?? r.host}` : "",
    v && `fills/placed ${v}`,
    r.labFills ? `lab fills ${r.labFills}` : "",
    r.snaps != null ? `${r.snaps} price changes` : "",
    r.trades != null ? `${r.trades} trades` : "",
    r.combos != null ? `${r.combos} replays` : "",
    r.venueErrors ? `⚠ ${Object.entries(r.venueErrors).map(([k, e]) => `${VNAME[k] || k}: ${String(e).slice(0, 60)}`).join("; ")}` : "",
  ].filter(Boolean);
  return esc(bits.join(" · "));
}

function runRows(list) {
  if (!list.length) return '<tr><td colspan="9" class="muted">No runs yet.</td></tr>';
  return list.map((r) => {
    const took = r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000) : null;
    // A run with no finish past its job's time limit died mid-run (the process or machine stopped).
    const cut = !r.finished_at && Date.now() - new Date(r.started_at).getTime() > (RUN_LIMIT_MIN[r.mode] ?? 10) * 60e3;
    const status = r.error ? esc(r.error.slice(0, 80)) : r.finished_at ? "ok" : cut ? "cut off" : "running";
    return `<tr><td>${when(r.started_at)}</td>${runsMode === "paper" ? "" : `<td>${esc(RUN_MODES[r.mode] || r.mode || "")}</td>`}<td>${took == null ? "–" : took < 90 ? `${took}s` : `${Math.round(took / 60)}m`}</td><td>${r.games ?? "–"}</td><td>${r.orders_placed ?? "–"}</td><td>${r.orders_cancelled ?? "–"}</td><td>${r.fills ?? "–"}</td><td class="runs-detail">${runDetails(r)}</td><td class="${r.error || cut ? "bad" : ""}">${status}</td></tr>`;
  }).join("");
}

async function loadRuns(reset = false) {
  try {
    const cur = reset ? [] : runsList ?? data.runs;
    const before = cur.length ? cur[cur.length - 1].started_at : "";
    const r = await api(`/api/runs?mode=${runsMode}&limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    runsList = [...cur, ...r.runs];
    runsMore = r.more;
  } catch (e) {
    runsList = runsList ?? (reset ? [] : data.runs); // don't retry in a loop on failure
    runsMore = false;
    if (e.message === "unauthorized") return;
  }
  renderSettings();
}

// ---------- Review

async function loadReview() {
  try {
    review = await api("/api/review");
    renderReview();
    if (openReview != null) renderReviewDrawer();
  } catch (e) {
    if (e.message !== "unauthorized") document.querySelector('[data-pane="review"]').innerHTML = `<p class="err">Couldn't load Review: ${esc(e.message)}</p>`;
  }
}

const finalLabel = (r) => (r.final == null ? (r.completed ? "–" : "in progress") : `${r.final < 0 ? r.away_team : r.home_team} by ${Math.abs(r.final)}`);
const roi = (pnl, risk) => (pnl == null || !risk ? "–" : ((pnl / risk) * 100).toFixed(1) + "%");

function renderReview() {
  const pane = document.querySelector('[data-pane="review"]');
  if (!review) { pane.innerHTML = '<p class="muted">Loading…</p>'; return; }
  const { games, strategies, season } = review;
  if (!games.length) { pane.innerHTML = '<div class="empty">No games have kicked off yet. Post-mortems appear here once a watchlist game starts.</div>'; return; }
  // Venue totals across settled games (Board).
  const vt = {};
  for (const g of games) for (const [v, x] of Object.entries(g.venues)) {
    const t = (vt[v] ??= { fills: 0, settled: 0, any: false, risked: 0 });
    t.fills += x.fills;
    if (x.settled != null) { t.settled += x.settled; t.any = true; t.risked += x.risked; }
  }
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => b - a);
  pane.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="l">Settled P&amp;L · Board</div><div class="v ${cls(season.settled)}">${usd(season.settled)}</div><div class="d">${season.won}–${season.lost} games · ${season.settledGames} settled</div></div>
      <div class="stat"><div class="l">Return on risk</div><div class="v ${cls(season.settled)}">${roi(season.settled, season.risked)}</div><div class="d">P&amp;L ÷ worst cases (${usd(season.risked)})</div></div>
      <div class="stat"><div class="l">Average CLV</div><div class="v ${cls(season.clv)}">${c(season.clv)}</div><div class="d">per contract, vs last pregame mid</div></div>
      <div class="stat"><div class="l">Your number vs the close</div><div class="v">${season.graded ? `${season.oursCloser}/${season.graded}` : "–"}</div><div class="d">finals closer to yours</div></div>
      <div class="stat"><div class="l">Fees</div><div class="v">${usd(season.fees)}</div><div class="d">all venues</div></div>
    </div>
    <div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start;margin-bottom:16px">
      <div class="panel"><h3>By venue</h3><div class="scroll"><table><tr><th>Venue</th><th>Fills</th><th>Settled</th><th>Return</th></tr>
        ${Object.entries(vt).map(([v, t]) => `<tr><td>${VNAME[v]}</td><td>${t.fills}</td><td class="${cls(t.any ? t.settled : null)}">${t.any ? usd(t.settled) : "–"}</td><td>${t.any ? roi(t.settled, t.risked) : "–"}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">No fills.</td></tr>'}
      </table></div></div>
      <div class="panel"><h3>Strategies (lab)</h3><div class="scroll"><table><tr><th>Strategy</th><th>Games</th><th>Settled</th><th>Return</th><th>CLV</th></tr>
        ${strategies.map((st) => `<tr><td>${esc(st.name)}${st.enabled ? "" : ' <span class="pill">Off</span>'}</td><td>${st.games}</td><td class="${cls(st.settled)}">${usd(st.settled)}</td><td>${roi(st.settled, st.risked)}</td><td class="${cls(st.clv)}">${c(st.clv)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No strategies.</td></tr>'}
      </table></div></div>
    </div>
    ${weeks.map((wk) => `<h3 style="margin:14px 0 8px">Week ${wk ?? "–"}</h3>
      <div class="panel" style="padding:8px 10px"><div class="scroll"><table class="review">
        <tr><th>Game</th><th>Lean</th><th>Yours / close / final</th><th>Fills</th><th>CLV</th><th>Settled</th><th>Return</th><th>Your bets</th></tr>
        ${games.filter((g) => g.week === wk).map((g) => `<tr data-review="${esc(g.game_id)}" tabindex="0" style="cursor:pointer">
          <td><b>${esc(g.away_team)} @ ${esc(g.home_team)}</b><small>${when(g.kickoff)}</small></td>
          <td>${esc(g.pick === "home" ? g.home_team : g.away_team)}</td>
          <td>${signed(g.ours)} / ${signed(g.close)} / ${g.final == null ? "–" : signed(g.final)}<small>${g.oursCloser == null ? finalLabel(g) : g.oursCloser ? "final closer to yours" : "final closer to the close"}</small></td>
          <td>${g.board.fills}<small>${Object.keys(g.venues).map((v) => VSHORT[v]).join(" · ") || "none"}</small></td>
          <td class="${cls(g.board.clv)}">${c(g.board.clv)}</td>
          <td class="${cls(g.board.settled)}">${usd(g.board.settled)}<small>${g.board.unsettled ? `${g.board.unsettled} ungraded` : ""}</small></td>
          <td>${roi(g.board.settled, g.board.risked)}<small>risked ${usd(g.board.risked)}</small></td>
          <td>${g.bets.length || "–"}</td>
        </tr>`).join("")}
      </table></div></div>`).join("")}
    <p class="muted" style="font-size:.76rem;margin:8px 0 0">Lines are away spreads (negative = away favored). Close = last pregame line the bot saw (Kalshi, else Novig/ProphetX). Risked = the worst final-margin outcome of what was held. Paper results only; your real bets are shown for comparison and never changed.</p>`;
}

function renderReviewDrawer() {
  const root = $("drawerRoot");
  const r = openReview != null && review?.games.find((g) => g.game_id === openReview);
  if (!r) { root.innerHTML = ""; return; }
  const pts = curve(positions(r.fills), -45, 45);
  const atFinal = r.final == null ? null : pts.find((p) => p.m === r.final)?.v ?? null;
  const lines = [["Yours", r.ours], ["Close", r.close], ...VENUES.filter((v) => r.venueClose?.[v] != null).map((v) => [VNAME[v], Number(r.venueClose[v])]), ["Final", r.final]];
  const story = r.final == null || r.ours == null || r.close == null ? "" :
    `<div class="callout">${esc(r.final < 0 ? r.away_team : r.home_team)} won by ${Math.abs(r.final)}. Your number (${esc(r.away_team)} ${signed(r.ours)}) was ${Math.abs(r.final - r.ours).toFixed(1)} pts from the final; the close (${signed(r.close)}) was ${Math.abs(r.final - r.close).toFixed(1)} pts away${r.oursCloser ? " — yours was closer." : " — the market was closer."}${atFinal != null ? ` The Board's position paid ${usd(atFinal)} at that margin.` : ""}</div>`;
  const vrows = Object.entries(r.venues);
  const srows = (review.strategies || []).filter((st) => r.byStrategy[st.id]);
  root.innerHTML = `<div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Post-mortem">
      <div class="drawer-head"><div><h2>${esc(r.away_team)} @ ${esc(r.home_team)}</h2><div class="muted" style="font-size:.8rem;margin-top:4px">${when(r.kickoff)} · lean ${esc(r.pick === "home" ? r.home_team : r.away_team)} · ${finalLabel(r)}</div></div><button class="xbtn" data-close="1" aria-label="Close">✕</button></div>
      <div class="drawer-body">
        <div class="mini-stats">
          ${lines.map(([l, v]) => `<div class="stat"><div class="l">${l} · ${esc(r.away_team)}</div><div class="v num">${v == null ? "–" : signed(v)}</div></div>`).join("")}
        </div>
        ${story}
        <div class="mini-stats">
          <div class="stat"><div class="l">Settled</div><div class="v num ${cls(r.board.settled)}">${usd(r.board.settled)}</div><div class="d">${r.board.unsettled ? `${r.board.unsettled} ungraded` : "after fees"}</div></div>
          <div class="stat"><div class="l">Risked</div><div class="v num">${usd(r.board.risked)}</div><div class="d">return ${roi(r.board.settled, r.board.risked)}</div></div>
          <div class="stat"><div class="l">CLV</div><div class="v num ${cls(r.board.clv)}">${c(r.board.clv)}</div><div class="d">edge at fill ${c(r.board.edgeAtFill)}</div></div>
          <div class="stat"><div class="l">Fills</div><div class="v num">${r.board.fills}</div><div class="d">${r.board.contracts} contracts · fees ${usd(r.board.fees)}</div></div>
        </div>
        <h3>P&amp;L by final margin</h3>
        ${curveSvg(r, pts)}
        ${vrows.length > 1 ? `<div class="panel" style="padding:10px 12px;margin-bottom:12px"><div class="scroll"><table><tr><th>Venue</th><th>Fills</th><th>Settled</th><th>CLV</th></tr>
          ${vrows.map(([v, x]) => `<tr><td>${VNAME[v]}</td><td>${x.fills}</td><td class="${cls(x.settled)}">${usd(x.settled)}</td><td class="${cls(x.clv)}">${c(x.clv)}</td></tr>`).join("")}</table></div></div>` : ""}
        ${srows.length ? `<div class="panel" style="padding:10px 12px;margin-bottom:12px"><div class="scroll"><table><tr><th>Lab strategy</th><th>Fills</th><th>Settled</th><th>Return</th><th>CLV</th></tr>
          ${srows.map((st) => { const x = r.byStrategy[st.id]; return `<tr><td>${esc(st.name)}</td><td>${x.fills}</td><td class="${cls(x.settled)}">${usd(x.settled)}</td><td>${roi(x.settled, x.risked)}</td><td class="${cls(x.clv)}">${c(x.clv)}</td></tr>`; }).join("")}</table></div></div>` : ""}
        <h3>Fills</h3>
        <div class="panel" style="padding:10px 12px;margin-bottom:12px"><div class="scroll"><table>
          <tr><th>When</th><th>Venue</th><th>Number</th><th>Side</th><th>Price</th><th>Fair</th><th>Close</th><th>Result</th><th>P&amp;L</th></tr>
          ${r.fills.map((f) => {
            const pnl = f.result == null ? null : (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee;
            return `<tr><td>${when(f.filled_at)}</td><td>${VSHORT[vOf(f)]}</td><td>${esc(numLabel(f, r))}</td><td>${f.action === "buy" ? "Buy" : "Sell"} ${f.count}</td><td>${c(Number(f.price), 1)}</td><td>${c(f.fair_at_fill)}</td><td>${c(f.close_mid)}</td><td>${f.result == null ? "–" : f.result ? "YES" : "NO"}</td><td class="${cls(pnl)}">${usd(pnl)}</td></tr>`;
          }).join("") || '<tr><td colspan="9" class="muted">The Board didn\'t trade this game.</td></tr>'}
        </table></div></div>
        ${r.bets.length ? `<h3>Your bets on this game</h3><div class="panel" style="padding:10px 12px"><div class="scroll"><table><tr><th>Book</th><th>Side</th><th>Line</th><th>Price</th><th>Stake</th><th>Result</th></tr>
          ${r.bets.map((b) => `<tr><td>${esc(b.book)}</td><td>${esc(b.side)}</td><td>${b.line_value == null ? "–" : signed(Number(b.line_value))}</td><td>${esc(b.price)}</td><td>${b.stake == null ? "–" : usd(Number(b.stake))}</td><td>${esc(b.result || "pending")}</td></tr>`).join("")}</table></div></div>` : ""}
      </div>
    </aside>`;
}

// ---------- Strategy lab

async function loadLab() {
  try {
    lab = await api("/api/lab");
    renderLab();
    if (openStrat != null) renderLabDrawer();
  } catch (e) {
    if (e.message !== "unauthorized") document.querySelector('[data-pane="lab"]').innerHTML = `<p class="err">Couldn't load the lab: ${esc(e.message)}</p>`;
  }
}

function renderLab() {
  const pane = document.querySelector('[data-pane="lab"]');
  if (!lab) { pane.innerHTML = '<p class="muted">Loading…</p>'; return; }
  const list = lab.strategies;
  const scored = list.filter((x) => x.stats.evPerDollar != null);
  const bestId = scored.length ? scored.reduce((a, b) => (b.stats.evPerDollar > a.stats.evPerDollar ? b : a)).id : null;
  const trust = (x) => (x.ycpr_weight == null ? "default" : Math.round(x.ycpr_weight * 100) + "%");
  pane.innerHTML = `
    <div class="callout" style="border-color:var(--c-info);background:var(--c-info-bg)">Each strategy paper-trades <b>every game on your watchlist</b> against the same venue books as the Board (Kalshi, Novig, ProphetX), with its own orders and fills. The Board is unaffected. Compare <b>expected value per dollar risked</b> and <b>CLV</b> first; settled P&amp;L needs many games before it means much.</div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn primary" id="newStrat" type="button">New strategy</button></div>
    <div class="panel lab" style="padding:8px 10px"><div class="scroll"><table>
      <tr><th>Strategy</th><th title="pro-pick / sell-back / take / extra per contract">Edges ¢</th><th>Fills</th><th>Edge at fill</th><th>CLV</th><th>Worst / best</th><th>Expected</th><th>EV per $</th><th>Settled</th></tr>
      ${list.map((x) => {
        const t = x.stats;
        return `<tr data-strat="${x.id}" class="${x.id === bestId ? "best" : ""}">
          <td><b>${esc(x.name)}</b> ${x.enabled ? "" : '<span class="pill">Off</span>'}<small>trust ${trust(x)} · cap ${usd(Number(x.max_worst_case_loss))} · ${x.per_rung_cap}/number${x.shape ? " · shaped" : ""}</small></td>
          <td>${[x.pro_edge, x.anti_edge, x.take_edge, x.edge_step].map((e) => +(Number(e) * 100).toFixed(1)).join(" / ")}<small>pro / sell / take / step</small></td>
          <td>${t.fills}<small>${t.resting} resting · ${t.games} games</small></td>
          <td class="${cls(t.avgEdgeAtFill)}">${c(t.avgEdgeAtFill)}</td>
          <td class="${cls(t.avgClv)}">${c(t.avgClv)}<small>${t.clvFills} graded</small></td>
          <td><span class="${cls(t.worst)}">${usd(t.worst)}</span> / <span class="${cls(t.best)}">${usd(t.best)}</span></td>
          <td class="${cls(t.expected)}">${usd(t.expected)}<small>Kalshi ${usd(t.marketExpected)}</small></td>
          <td class="${cls(t.evPerDollar)}">${t.evPerDollar == null ? "–" : (t.evPerDollar * 100).toFixed(1) + "¢"}<small>${usd(t.risked)} risked</small></td>
          <td class="${cls(t.settled)}">${usd(t.settled)}<small>${t.settledFills} settled</small></td>
        </tr>`;
      }).join("") || '<tr><td colspan="9" class="muted">No strategies yet.</td></tr>'}
    </table></div></div>
    <p class="muted" style="font-size:.76rem;margin:8px 0 0">Edge at fill = fair minus price when filled. CLV = move to the last pregame mid. EV per $ = expected value by your number ÷ dollars at risk. Gold bar = best EV per $.</p>`;
}

function renderLabDrawer() {
  const root = $("drawerRoot");
  if (openStrat == null || !lab) { root.innerHTML = ""; return; }
  const x = openStrat === "new" ? null : lab.strategies.find((s) => s.id === openStrat);
  if (openStrat !== "new" && !x) { root.innerHTML = ""; return; }
  const v = (val, mult = 100) => (val == null ? "" : Math.round(Number(val) * mult * 100) / 100);
  const st = x || { name: "", pro_edge: 0.02, anti_edge: 0.04, take_edge: 0.03, edge_step: 0.01, max_worst_case_loss: 10, per_rung_cap: 1, ycpr_weight: null, stop_minutes_before: 30, enabled: true, notes: "", shape: false, market_floor: null, against_limit: null, blowout_margin: null };
  const def = num(data?.state?.default_ycpr_weight) ?? 1;
  const t = Math.round((num(st.ycpr_weight) ?? def) * 100);
  const games = x ? x.perGame : [];
  root.innerHTML = `<div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Strategy">
      <div class="drawer-head"><div><h2>${x ? esc(x.name) : "New strategy"}</h2><div class="muted" style="font-size:.8rem;margin-top:4px">${x ? esc(x.notes || "") : "Runs on every watchlist game from the next cycle."}</div></div><button class="xbtn" data-close="1" aria-label="Close">✕</button></div>
      <div class="drawer-body">
        <form id="stratForm" class="panel" data-id="${x ? x.id : ""}">
          <div class="grid2">
            <label class="field" style="grid-column:1/-1">Name<input id="sName" value="${esc(st.name)}" maxlength="40" required></label>
            <label class="field">Pro-pick edge (¢)<input id="sPro" type="number" step="0.5" value="${v(st.pro_edge)}"></label>
            <label class="field">Sell-back edge (¢)<input id="sAnti" type="number" step="0.5" value="${v(st.anti_edge)}"></label>
            <label class="field">Take edge (¢)<input id="sTake" type="number" step="0.5" value="${v(st.take_edge)}"></label>
            <label class="field">Extra edge per contract (¢)<input id="sStep" type="number" step="0.5" value="${v(st.edge_step)}"></label>
            <label class="field">Max loss per game ($)<input id="sMax" type="number" step="0.5" value="${st.max_worst_case_loss}"></label>
            <label class="field">Contracts per number<input id="sCap" type="number" step="1" value="${st.per_rung_cap}"></label>
            <label class="field">Stop quoting (min before)<input id="sStop" type="number" step="5" value="${st.stop_minutes_before}"></label>
            ${shapeFields("s", st)}
            <div class="field" style="grid-column:1/-1">Trust in your number
              <div style="display:flex;gap:10px;align-items:center"><input id="sTrust" type="range" min="0" max="100" step="5" value="${t}" ${st.ycpr_weight == null ? "disabled" : ""}><b id="sTrustVal" class="num" style="min-width:44px;text-align:right">${t}%</b></div>
              <label style="display:flex;gap:6px;align-items:center;font-weight:500"><input id="sTrustDef" type="checkbox" ${st.ycpr_weight == null ? "checked" : ""}> Use default (${Math.round(def * 100)}%)</label></div>
            <label class="field" style="grid-column:1/-1">Notes<input id="sNotes" value="${esc(st.notes || "")}" maxlength="300" placeholder="What this strategy tests"></label>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
            <button class="btn primary">${x ? "Save" : "Create"}</button>
            ${x ? `<button class="btn" type="button" id="sToggle">${x.enabled ? "Turn off" : "Turn on"}</button>` : ""}
            <span id="sMsg" class="muted"></span>
          </div>
          ${x ? '<p class="muted" style="font-size:.76rem;margin:10px 0 0">Changes apply from the next cycle. Fills already made stay as they are, so for a clean comparison create a new strategy instead of editing one mid-week.</p>' : ""}
        </form>
        ${x ? `<div class="panel" style="margin-top:14px;padding:10px 12px"><h3 style="margin:4px 0 8px">By game</h3><div class="scroll"><table>
          <tr><th>Game</th><th>Fills</th><th>Worst / best</th><th>Expected</th><th>Settled</th></tr>
          ${games.length ? games.map((g) => `<tr><td>${esc(g.game)}<small class="muted" style="display:block;font-size:.72rem">${g.resting} resting</small></td><td>${g.fills}</td><td><span class="${cls(g.worst)}">${usd(g.worst)}</span> / <span class="${cls(g.best)}">${usd(g.best)}</span></td><td class="${cls(g.expected)}">${usd(g.expected)}<small class="muted" style="display:block;font-size:.72rem">Kalshi ${usd(g.marketExpected)}</small></td><td class="${cls(g.settled)}">${usd(g.settled)}</td></tr>`).join("") : '<tr><td colspan="5" class="muted">No fills yet.</td></tr>'}
        </table></div></div>` : ""}
      </div>
    </aside>`;
}

// ---------- Drawer

function renderDrawer() {
  const root = $("drawerRoot");
  const w = openGame && data.watchlist.find((x) => x.game_id === openGame);
  if (!w) { root.innerHTML = ""; return; }
  const g = gameOf(w);
  const gFills = vf(data.fills).filter((f) => f.game_id === w.game_id);
  const pts = curve(positions(gFills));
  const o = outcomeOf(w);
  const [st, stCls] = statusOf(w, g);
  const worst = pts.length ? Math.min(...pts.map((p) => p.v)) : 0;
  const best = pts.length ? Math.max(...pts.map((p) => p.v)) : 0;
  const tabs = ["outcomes", "ladder", "settings"].map((t) => `<button data-dtab="${t}" class="${drawerTab === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("");
  let body = "";
  if (drawerTab === "outcomes") body = curveSvg(w, pts, { market: mktOf(w), ours: ourAway(w) }) + outcomeTable(w, o);
  if (drawerTab === "ladder") body = ladderTable(w, gFills);
  if (drawerTab === "settings") body = settingsForm(w);
  root.innerHTML = `<div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(w.away_team)} at ${esc(w.home_team)}">
      <div class="drawer-head">
        <div><h2>${esc(w.away_team)} @ ${esc(w.home_team)}</h2>
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"><span class="pill ${stCls}">${esc(st)}</span><span class="muted" style="font-size:.8rem">${when(w.kickoff)} · lean ${esc(w.pick === "home" ? w.home_team : w.away_team)}</span></div></div>
        <button class="xbtn" data-close="1" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body">
        <div class="mini-stats">
          <div class="stat"><div class="l">${w.my_home_margin != null ? "Your line" : "YC"} · ${esc(w.away_team)}</div><div class="v num">${signed(ourAway(w))}</div></div>
          <div class="stat"><div class="l">${mktName(w)} · ${esc(w.away_team)}</div><div class="v num">${signed(mktOf(w))}</div><div class="d">${VENUES.filter((x) => vMargin(w, x) != null).map((x) => `${VSHORT[x]} ${signed(vMargin(w, x))}`).join(" · ") || "no venue ladder"} · book ${signed(marketAway(g))}</div></div>
          <div class="stat"><div class="l">Worst / best</div><div class="v num"><span class="${cls(worst)}">${usd(worst)}</span></div><div class="d">best ${usd(best)}</div></div>
          <div class="stat"><div class="l">Expected</div><div class="v num ${cls(o?.expected)}">${o ? usd(o.expected) : "–"}</div><div class="d">${o?.marketExpected != null ? `${mktName(w)} ${usd(o.marketExpected)}` : "your number"}</div></div>
        </div>
        ${statusNote(w, g)}
        <div class="tabs">${tabs}</div>
        ${body}
      </div>
    </aside>`;
}

function statusNote(w, g) {
  const [st] = statusOf(w, g);
  if (st !== "No edge") return "";
  const team = w.pick === "home" ? w.home_team : w.away_team;
  return `<div class="callout">${mktName(w)} (${esc(w.away_team)} ${signed(mktOf(w) ?? marketAway(g))}) already prices ${esc(team)} at or past your number (${signed(ourAway(w))}), so the bot isn't adding exposure.</div>`;
}

function outcomeTable(w, o) {
  if (!o || !o.ranges?.length) return "";
  const hasMkt = o.market != null;
  const rows = o.ranges.map((r) => {
    const diff = hasMkt ? r.prob - r.marketProb : null;
    return `<tr><td>${marginLabel(w, r.from, r.to)}</td><td class="${cls(r.pnl)}">${usd(r.pnl)}</td><td>${pct(r.prob)}</td>${hasMkt ? `<td>${pct(r.marketProb)}</td><td class="${cls(diff)}">${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff * 100).toFixed(1)}</td>` : ""}</tr>`;
  }).join("");
  return `<div class="panel" style="padding:10px 12px"><div class="scroll"><table>
    <tr><th>If the game ends</th><th>Win / lose</th><th>Yours</th>${hasMkt ? `<th>${mktName(w)}</th><th>Diff (pts)</th>` : ""}</tr>${rows}</table></div></div>
    <p class="muted" style="font-size:.76rem;margin:8px 0 0">Chances by your number (${esc(w.away_team)} ${signed(o.center)})${hasMkt ? ` and by the margin ${mktName(w)}'s ladder implies (${esc(w.away_team)} ${signed(o.market)})` : ""}.</p>`;
}

function ladderTable(w, gFills) {
  const snaps = vf(data.snapshots).filter((s) => s.game_id === w.game_id).sort((a, b) => vOf(a).localeCompare(vOf(b)) || Number(b.fair) - Number(a.fair));
  const pos = new Map(positions(gFills).map((p) => [p.ticker, p]));
  const mine = vf(data.orders).filter((o) => o.game_id === w.game_id);
  if (!snaps.length) return '<p class="muted">No ladder snapshot yet.</p>';
  return `<div class="panel" style="padding:10px 12px"><div class="scroll"><table>
    <tr><th>Venue</th><th>Number (YES)</th><th>Bid / ask</th><th>Fair</th><th>Fair − mid</th><th>Our orders</th><th>Held</th></tr>
    ${snaps.map((s) => {
      const mid = s.bid != null && s.ask != null ? (Number(s.bid) + Number(s.ask)) / 2 : null;
      const edge = s.fair != null && mid != null ? Number(s.fair) - mid : null;
      const p = pos.get(s.ticker);
      const ords = mine.filter((o) => o.ticker === s.ticker).map((o) => `${o.action === "buy" ? "bid" : "ask"} ${c(Number(o.price), 0)}`).join(", ");
      return `<tr><td>${VSHORT[vOf(s)]}</td><td>${esc(numLabel(s, w))}</td><td>${c(s.bid, 0)} / ${c(s.ask, 0)}</td><td>${c(s.fair)}</td><td class="${cls(edge)}">${c(edge)}</td><td>${esc(ords) || '<span class="muted">–</span>'}</td><td>${p && p.yes ? (p.yes > 0 ? "+" : "") + p.yes : "–"}</td></tr>`;
    }).join("")}</table></div></div>`;
}

/** Shape fields (§21) for the game Settings and lab strategy forms; `p` = id prefix ("g" or "s"). */
function shapeFields(p, x) {
  const v = (k) => (x[k] == null ? "" : Number(x[k]));
  return `<label class="field">Shape<select id="${p}Shape"><option value="" ${x.shape ? "" : "selected"}>Off</option><option value="1" ${x.shape ? "selected" : ""}>On</option></select>
      <span class="muted" style="font-weight:400;font-size:.76rem">Solve the whole position for a P&amp;L shape instead of rung by rung.</span></label>
    <label class="field">Minimum P&amp;L at the market line ($)<input id="${p}Floor" type="number" step="0.5" value="${v("market_floor")}" placeholder="0"></label>
    <label class="field">Max loss when it goes moderately against you ($)<input id="${p}Against" type="number" step="0.5" value="${v("against_limit")}" placeholder="10% of max loss"></label>
    <label class="field">Blowout margin (pts)<input id="${p}Blowout" type="number" step="1" value="${v("blowout_margin")}" placeholder="10"></label>`;
}
/** The shape fields' values for the admin API (blank = the default in code). */
function readShape(p) {
  const n = (id) => ($(id).value === "" ? null : Number($(id).value));
  return { shape: $(`${p}Shape`).value === "1", market_floor: n(`${p}Floor`), against_limit: n(`${p}Against`), blowout_margin: n(`${p}Blowout`) };
}

function settingsForm(w) {
  const def = num(data.state?.default_ycpr_weight) ?? 1;
  const own = num(w.ycpr_weight);
  const t = Math.round((own ?? def) * 100);
  const v = (x, mult = 100) => (x == null ? "" : Math.round(Number(x) * mult * 100) / 100);
  const preset = String(w.strategy_preset ?? (presetLabel(w) === "Bot defaults" ? "" : "custom"));
  return `<form id="gameForm" class="panel" data-id="${w.id}">
    <div class="grid2">
      <label class="field" style="grid-column:1/-1">Strategy<select id="gPreset">${presets().map((p) => `<option value="${esc(p.id)}" ${String(p.id) === preset ? "selected" : ""}>${esc(p.name)}</option>`).join("")}<option value="custom" ${preset === "custom" ? "selected" : ""}>Custom</option></select>
        <span class="muted" style="font-weight:400;font-size:.76rem">Fills the fields below; ${esc(presetLabel(w))} now.</span></label>
      <div class="field" style="grid-column:1/-1">Lean toward
        <div class="seg" id="gPick"><button type="button" data-pick="away" class="${w.pick === "away" ? "on" : ""}">${esc(w.away_team)}</button><button type="button" data-pick="home" class="${w.pick === "home" ? "on" : ""}">${esc(w.home_team)}</button></div></div>
      <div class="field" style="grid-column:1/-1">Trust in your number
        <div style="display:flex;gap:10px;align-items:center"><input id="gTrust" type="range" min="0" max="100" step="5" value="${t}" ${own == null ? "disabled" : ""}><b id="gTrustVal" class="num" style="min-width:44px;text-align:right">${t}%</b></div>
        <label style="display:flex;gap:6px;align-items:center;font-weight:500"><input id="gTrustDef" type="checkbox" ${own == null ? "checked" : ""}> Use default (${Math.round(def * 100)}%)</label></div>
      <div class="field" style="grid-column:1/-1">Trade on
        <div style="display:flex;gap:14px;flex-wrap:wrap">${VENUES.map((x) => `<label style="display:flex;gap:6px;align-items:center;font-weight:500"><input type="checkbox" class="gVenue" value="${x}" ${(w.venues ?? VENUES).includes(x) ? "checked" : ""}> ${VNAME[x]}${vMargin(w, x) != null ? ` <span class="muted">${signed(vMargin(w, x))}</span>` : ""}</label>`).join("")}</div>
        <span class="muted" style="font-weight:400;font-size:.76rem">One loss cap covers the game across every venue.</span></div>
      <label class="field">Override away spread<input id="gOverride" type="number" step="0.1" value="${w.my_home_margin ?? ""}" placeholder="YC ${signed(num(w.ycpr_home_margin))}"></label>
      <label class="field">Max loss on game ($)<input id="gMax" type="number" step="0.5" value="${w.max_worst_case_loss}"></label>
      <label class="field">Contracts per number<input id="gCap" type="number" step="1" value="${w.per_rung_cap}"></label>
      <label class="field">Profit target ($)<input id="gTarget" type="number" step="0.5" value="${w.profit_target ?? ""}" placeholder="none"></label>
      <label class="field">Pro-pick edge (¢)<input id="gPro" type="number" step="0.5" value="${v(w.pro_edge)}"></label>
      <label class="field">Sell-back edge (¢)<input id="gAnti" type="number" step="0.5" value="${v(w.anti_edge)}"></label>
      <label class="field">Take edge (¢)<input id="gTake" type="number" step="0.5" value="${v(w.take_edge)}"></label>
      <label class="field">Extra edge per contract (¢)<input id="gStep" type="number" step="0.5" value="${v(w.edge_step)}"></label>
      <label class="field">Stop quoting (min before)<input id="gStop" type="number" step="5" value="${w.stop_minutes_before}"></label>
      ${shapeFields("g", w)}
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
      <button class="btn primary">Save</button>
      <button class="btn" type="button" id="gToggle">${w.enabled ? "Turn off" : "Turn on"}</button>
      <span id="gMsg" class="muted"></span>
    </div>
  </form>`;
}

// ---------- Render + routing

// ---------- Bot health (header pill, Settings panel): from /api/data's `health` (bot/runner/health.ts)

let dashErr = ""; // the dashboard itself can't reach /api/data
const LEVEL_CLS = { ok: "ok", warn: "warn", bad: "bad", off: "" };
const clock = (iso) => (Date.now() - new Date(iso).getTime() < 12 * 3600e3 ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : when(iso));
function healthLabel(h) {
  if (dashErr) return "Dashboard can't load data";
  if (!h) return "Status unknown";
  const age = h.lastCycle ? ago(h.lastCycle) : null;
  if (h.level === "bad") return h.since ? `${h.label} since ${clock(h.since)}` : h.label;
  if (h.label === "Backup") return h.since ? `Backup only · tower down since ${clock(h.since)}` : "Backup only · tower down";
  if (h.source === "venue") return `Live · ⚠ ${h.detail.replace(/^Venue error in the last cycle: /, "").split(":")[0]}`;
  if (h.level === "warn" && h.source === "job") return `Live · ⚠ ${h.jobs.filter((j) => j.mode !== "paper" && (j.level === "warn" || j.level === "bad")).map((j) => j.name).join(", ")}`;
  return age ? `${h.label} · ${age}` : h.label;
}
function renderHealth() {
  const h = data?.health;
  const b = $("healthPill");
  b.className = `pill health ${dashErr ? "bad" : LEVEL_CLS[h?.level] ?? ""}`;
  const full = healthLabel(h);
  const short = dashErr ? "Offline" : h ? (h.level === "warn" && h.label === "Live" ? "Live ⚠" : h.label) : "?";
  b.innerHTML = `<span class="hl">${esc(full)}</span><span class="hs">${esc(short)}</span>`;
  b.title = dashErr ? `Couldn't reach /api/data: ${dashErr}` : h ? `${h.detail} (click for every job)` : "";
}
function healthPanel() {
  const h = data.health;
  if (!h) return '<p class="muted" style="margin:0">Status unavailable.</p>';
  return `<p style="margin:0 0 8px"><span class="pill ${LEVEL_CLS[h.level]}">${esc(healthLabel(h))}</span> <span style="font-size:.84rem">${esc(h.detail)}</span></p>
    <div class="scroll"><table class="jobs"><tr><th>Job</th><th>Status</th><th>Last sign of life</th><th>Note</th></tr>
    ${h.jobs.map((j) => `<tr><td>${esc(j.name)}</td><td><span class="pill ${LEVEL_CLS[j.level]}">${{ ok: "OK", warn: "Warning", bad: "Stopped", off: "Idle" }[j.level]}</span></td><td>${j.last ? `${when(j.last)}<small>${ago(j.last)}</small>` : "–"}</td><td style="font-size:.78rem">${esc(j.note)}</td></tr>`).join("")}
    </table></div>`;
}

function render() {
  const { state } = data;
  renderHealth();
  $("modePill").textContent = state?.mode === "paper" || !state?.mode ? "Paper" : state.mode;
  $("killBtn").textContent = state?.kill_switch ? "Kill switch ON — resume" : "Kill switch";
  $("killBtn").className = state?.kill_switch ? "btn danger" : "btn";
  const last = data.runs?.[0];
  $("sideRun").textContent = last ? `Last run ${ago(last.started_at)}` : "No runs yet";
  $("venueSeg").innerHTML = ["all", ...VENUES].map((x) => `<button type="button" data-venue="${x}" class="${venue === x ? "on" : ""}">${VNAME[x]}</button>`).join("");
  renderBoard();
  renderFills();
  renderSettings();
  if (view === "manage") renderManage();
  if (openStrat == null && openReview == null && openHypo == null) renderDrawer();
}

function setView(v) {
  view = v;
  for (const b of document.querySelectorAll("[data-view]")) b.classList.toggle("on", b.dataset.view === v);
  for (const p of document.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== v;
  $("title").textContent = { board: "Board", live: "Live desk", scores: "Scores", fills: "Fills", review: "Review", hypo: "Hypotheticals", add: "Add games", manage: "Manage games", lab: "Strategy lab", settings: "Settings" }[v];
  openGame = null;
  openStrat = null;
  openReview = null;
  openHypo = null;
  $("drawerRoot").innerHTML = "";
  if (v === "lab") { renderLab(); loadLab(); }
  if (v === "review") { renderReview(); loadReview(); }
  if (v === "hypo") { renderHypo(); loadHypo(); }
  if (v === "add") { renderAdd(); loadPicker(); }
  if (v === "manage") renderManage();
  window.liveDesk?.show(v === "live"); // hub/live.js: starts/pauses the desk feed
  document.documentElement.dataset.view = v;
  window.scoresTab?.show(v === "scores"); // hub/scores.js: polls scores only while open
}

async function load() {
  // Don't redraw under someone mid-drag or mid-edit.
  const a = document.activeElement;
  if (a?.matches?.('input[type="range"]') || (a?.closest?.("#gameForm") && a.matches("input"))) return;
  try {
    data = await api("/api/data");
    dashErr = "";
    $("err").textContent = "";
    $("gate").hidden = true;
    $("app").hidden = false;
    render();
  } catch (e) {
    if (e.message !== "unauthorized") {
      $("err").textContent = "Couldn't load: " + e.message;
      dashErr = e.message;
      if (data) renderHealth();
    }
  }
}

// ---------- Events

$("gateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  PW = $("pw").value;
  try { localStorage.setItem("botpw", PW); } catch {}
  load();
});
$("themeBtn").addEventListener("click", () => {
  THEME = THEME === "dark" ? "light" : "dark";
  try { localStorage.setItem("bottheme", THEME); } catch {}
  applyTheme();
});
for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));
document.querySelector('[data-pane="board"]').addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) setView(go.dataset.goto);
});
$("venueSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-venue]");
  if (!b) return;
  venue = b.dataset.venue;
  try { localStorage.setItem("botvenue", venue); } catch {}
  render();
});
$("healthPill").addEventListener("click", () => {
  setView("settings");
  $("healthPanel")?.scrollIntoView({ block: "start", behavior: "smooth" });
});
// The pill's "40s ago" keeps counting between loads; coming back to the tab refreshes at once.
setInterval(() => { if (data && !document.hidden) renderHealth(); }, 10e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden && PW) load(); });
$("killBtn").addEventListener("click", async () => {
  const on = !data.state?.kill_switch;
  if (on && !confirm("Turn the kill switch on? The bot cancels all resting orders on its next run and stops quoting.")) return;
  await api("/api/admin", { action: "kill", on }).catch((e) => alert(e.message));
  load();
});

// Board → drawer
document.querySelector('[data-pane="board"]').addEventListener("click", (e) => {
  const row = e.target.closest(".brow[data-game]");
  if (!row) return;
  openGame = row.dataset.game;
  drawerTab = "outcomes";
  renderDrawer();
});
document.querySelector('[data-pane="board"]').addEventListener("keydown", (e) => {
  const row = e.target.closest(".brow[data-game]");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (openGame || openStrat != null || openReview != null || openHypo != null)) { openGame = null; openStrat = null; openReview = null; openHypo = null; $("drawerRoot").innerHTML = ""; }
});

$("drawerRoot").addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) { openGame = null; openStrat = null; openReview = null; openHypo = null; $("drawerRoot").innerHTML = ""; return; }
  const t = e.target.closest("[data-dtab]");
  if (t) { drawerTab = t.dataset.dtab; renderDrawer(); return; }
  const p = e.target.closest("[data-pick]");
  if (p) { for (const b of document.querySelectorAll("#gPick button")) b.classList.toggle("on", b === p); return; }
  if (e.target.id === "gToggle") {
    const w = data.watchlist.find((x) => x.game_id === openGame);
    await api("/api/admin", { action: "updateWatch", id: w.id, enabled: !w.enabled }).catch((err) => alert(err.message));
    load();
  }
});
$("drawerRoot").addEventListener("input", (e) => {
  if (e.target.id === "gTrust") $("gTrustVal").textContent = e.target.value + "%";
});
$("drawerRoot").addEventListener("change", (e) => {
  if (e.target.id === "gTrustDef") $("gTrust").disabled = e.target.checked;
  // A strategy fills the game's settings (games.js presets); editing a field afterwards makes it Custom.
  if (e.target.id === "gPreset" && e.target.value !== "custom") {
    const p = presetById(e.target.value);
    const set = (id, v) => ($(id).value = v);
    set("gMax", p.max_worst_case_loss); set("gCap", p.per_rung_cap); set("gStop", p.stop_minutes_before);
    for (const [id, k] of [["gPro", "pro_edge"], ["gAnti", "anti_edge"], ["gTake", "take_edge"], ["gStep", "edge_step"]]) set(id, Math.round(Number(p[k]) * 10000) / 100);
    set("gShape", p.shape ? "1" : "");
    for (const [id, k] of [["gFloor", "market_floor"], ["gAgainst", "against_limit"], ["gBlowout", "blowout_margin"]]) set(id, p[k] == null ? "" : Number(p[k]));
    $("gTrustDef").checked = p.ycpr_weight == null;
    $("gTrust").disabled = p.ycpr_weight == null;
    if (p.ycpr_weight != null) { $("gTrust").value = Math.round(p.ycpr_weight * 100); $("gTrustVal").textContent = $("gTrust").value + "%"; }
  }
});
$("drawerRoot").addEventListener("input", (e) => {
  if (e.target.closest?.("#gameForm") && ["gMax", "gCap", "gStop", "gPro", "gAnti", "gTake", "gStep", "gTrust", "gShape", "gFloor", "gAgainst", "gBlowout"].includes(e.target.id) && $("gPreset")) $("gPreset").value = "custom";
});
$("drawerRoot").addEventListener("submit", async (e) => {
  if (e.target.id !== "gameForm") return;
  e.preventDefault();
  const f = e.target;
  const cents = (id) => ($(id).value === "" ? undefined : Number($(id).value) / 100);
  const body = {
    action: "updateWatch",
    id: Number(f.dataset.id),
    pick: document.querySelector("#gPick button.on")?.dataset.pick,
    ycpr_weight: $("gTrustDef").checked ? null : Number($("gTrust").value) / 100,
    my_home_margin: $("gOverride").value === "" ? null : Number($("gOverride").value),
    max_worst_case_loss: Number($("gMax").value),
    per_rung_cap: Number($("gCap").value),
    profit_target: $("gTarget").value === "" ? null : Number($("gTarget").value),
    pro_edge: cents("gPro"), anti_edge: cents("gAnti"), take_edge: cents("gTake"), edge_step: cents("gStep"),
    stop_minutes_before: Number($("gStop").value),
    venues: [...document.querySelectorAll(".gVenue:checked")].map((x) => x.value),
    ...readShape("g"),
    strategy_preset: ["", "custom"].includes($("gPreset").value) ? null : Number($("gPreset").value),
  };
  try {
    await api("/api/admin", body);
    $("gMsg").textContent = "Saved. Applies on the next cycle (about 90 s).";
    document.activeElement?.blur?.();
    load();
  } catch (err) {
    $("gMsg").textContent = err.message;
  }
});

// Review → post-mortem drawer
document.querySelector('[data-pane="review"]').addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-review]");
  if (row) { openReview = row.dataset.review; renderReviewDrawer(); }
});
document.querySelector('[data-pane="review"]').addEventListener("keydown", (e) => {
  const row = e.target.closest("tr[data-review]");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); }
});

// Strategy lab
document.querySelector('[data-pane="lab"]').addEventListener("click", (e) => {
  if (e.target.closest("#newStrat")) { openStrat = "new"; renderLabDrawer(); return; }
  const row = e.target.closest("tr[data-strat]");
  if (row) { openStrat = Number(row.dataset.strat); renderLabDrawer(); }
});
$("drawerRoot").addEventListener("input", (e) => {
  if (e.target.id === "sTrust") $("sTrustVal").textContent = e.target.value + "%";
});
$("drawerRoot").addEventListener("change", (e) => {
  if (e.target.id === "sTrustDef") $("sTrust").disabled = e.target.checked;
});
$("drawerRoot").addEventListener("click", async (e) => {
  if (e.target.id !== "sToggle") return;
  const x = lab.strategies.find((s) => s.id === openStrat);
  await api("/api/admin", { action: "saveStrategy", id: x.id, enabled: !x.enabled }).catch((err) => alert(err.message));
  loadLab();
});
$("drawerRoot").addEventListener("submit", async (e) => {
  if (e.target.id !== "stratForm") return;
  e.preventDefault();
  const cents = (id) => Number($(id).value) / 100;
  const id = e.target.dataset.id ? Number(e.target.dataset.id) : undefined;
  try {
    const res = await api("/api/admin", {
      action: "saveStrategy", id,
      name: $("sName").value, notes: $("sNotes").value,
      pro_edge: cents("sPro"), anti_edge: cents("sAnti"), take_edge: cents("sTake"), edge_step: cents("sStep"),
      max_worst_case_loss: Number($("sMax").value), per_rung_cap: Number($("sCap").value), stop_minutes_before: Number($("sStop").value),
      ycpr_weight: $("sTrustDef").checked ? null : Number($("sTrust").value) / 100,
      ...readShape("s"),
      ...(id ? {} : { enabled: true }),
    });
    openStrat = res.strategy?.id ?? openStrat;
    document.activeElement?.blur?.();
    await loadLab();
    $("sMsg") && ($("sMsg").textContent = "Saved. Applies from the next cycle.");
  } catch (err) {
    $("sMsg").textContent = err.message;
  }
});

// Board: per-game change toggle
document.querySelector('[data-pane="board"]').addEventListener("change", (e) => {
  if (e.target.id !== "boardDeltas") return;
  showDeltas = e.target.checked;
  try { localStorage.setItem("botdeltas", showDeltas ? "1" : "0"); } catch {}
  renderBoard();
});

// Fills filter
document.querySelector('[data-pane="fills"]').addEventListener("change", (e) => {
  if (e.target.id === "fillsGame") { fillsFilter = e.target.value; renderFills(); }
});

// Settings: default trust
document.querySelector('[data-pane="settings"]').addEventListener("input", (e) => {
  if (e.target.id === "trustDefault") $("trustDefaultVal").textContent = e.target.value + "%";
});
document.querySelector('[data-pane="settings"]').addEventListener("change", async (e) => {
  if (e.target.id !== "trustDefault") return;
  await api("/api/admin", { action: "defaultTrust", value: Number(e.target.value) / 100 }).catch((err) => alert(err.message));
  e.target.blur();
  load();
});

applyTheme();
if (PW) load(); else showGate();
setInterval(() => {
  if (!PW || document.hidden) return;
  load();
  const a = document.activeElement;
  if (view === "lab" && !(a?.closest?.("#stratForm") && a.matches("input"))) loadLab();
}, 30000);

// Settings → run history
document.querySelector('[data-pane="settings"]').addEventListener("change", (e) => {
  if (e.target.id !== "runsMode") return;
  runsMode = e.target.value;
  runsList = null;
  runsMore = true;
  renderSettings();
});
document.querySelector('[data-pane="settings"]').addEventListener("click", (e) => {
  if (e.target.id === "runsMore") { e.target.disabled = true; e.target.textContent = "Loading…"; loadRuns(); }
});
