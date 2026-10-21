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
  const mkt = num(w.kalshi_home_margin) ?? marketAway(g);
  if (ours != null && mkt != null && !(w.pick === "home" ? ours > mkt : ours < mkt)) return ["No edge", "warn"];
  const resting = data.orders.filter((o) => o.game_id === w.game_id).length;
  return resting ? [`Quoting · ${resting}`, "ok"] : ["Waiting", ""];
}

function marginLabel(w, from, to, limit = 60) {
  const team = from < 0 ? w.away_team : w.home_team;
  const lo = Math.min(Math.abs(from), Math.abs(to)), hi = Math.max(Math.abs(from), Math.abs(to));
  if (hi >= limit) return `${esc(team)} by ${lo}+`;
  return lo === hi ? `${esc(team)} by ${lo}` : `${esc(team)} by ${lo}–${hi}`;
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

function curveSvg(w, pts) {
  if (!pts.length || pts.every((p) => Math.abs(p.v) < 1e-9)) return '<p class="muted">No position yet.</p>';
  const W = 600, H = 130, pad = 12;
  const max = Math.max(...pts.map((p) => Math.abs(p.v)), 0.01);
  const bw = (W - 2 * pad) / pts.length, y0 = H / 2 - 6;
  const bars = pts.map((p, i) => {
    const bh = (Math.abs(p.v) / max) * (y0 - pad);
    const team = p.m < 0 ? w.away_team : w.home_team;
    return `<rect x="${pad + i * bw}" y="${p.v >= 0 ? y0 - bh : y0}" width="${Math.max(1, bw - 1)}" height="${bh}" rx="1" fill="${p.v >= 0 ? "var(--c-ok)" : "var(--c-err)"}"><title>${esc(team)} by ${Math.abs(p.m)}: ${usd(p.v)}</title></rect>`;
  }).join("");
  const ticks = [-28, -21, -14, -7, 7, 14, 21, 28].map((m) => {
    const i = pts.findIndex((p) => p.m === m);
    return i < 0 ? "" : `<text x="${pad + i * bw + bw / 2}" y="${H - 2}" text-anchor="middle">${m < 0 ? "A" : "H"}${Math.abs(m)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profit or loss by final margin"><line x1="${pad}" x2="${W - pad}" y1="${y0}" y2="${y0}" stroke="var(--a-line)"/>${bars}${ticks}</svg>
    <p class="muted" style="margin:2px 0 12px;font-size:.76rem">A7 = ${esc(w.away_team)} by 7 · H7 = ${esc(w.home_team)} by 7 · after fees, held to settlement</p>`;
}

// ---------- Views

function renderBoard() {
  const { watchlist, fills, outcomes = {} } = data;
  let worst = 0, best = 0, evY = 0, evK = 0, anyK = false;
  const rows = watchlist.map((w) => {
    const g = gameOf(w);
    const gFills = fills.filter((f) => f.game_id === w.game_id);
    const pts = curve(positions(gFills));
    const wv = pts.length ? Math.min(...pts.map((p) => p.v)) : 0;
    const bv = pts.length ? Math.max(...pts.map((p) => p.v)) : 0;
    const o = outcomes[w.game_id];
    if (w.enabled) { worst += wv; best += bv; }
    if (o) { evY += o.expected; if (o.marketExpected != null) { evK += o.marketExpected; anyK = true; } }
    const [st, stCls] = statusOf(w, g);
    const kalshi = num(w.kalshi_home_margin);
    return `<div class="brow ${w.enabled ? "" : "off"}" data-game="${esc(w.game_id)}" tabindex="0" role="button" aria-label="Open ${esc(w.away_team)} at ${esc(w.home_team)}">
      <div class="game"><b>${esc(w.away_team)} @ ${esc(w.home_team)}</b><span>${when(w.kickoff)}</span></div>
      <div class="lean"><span class="pill">${esc(w.pick === "home" ? w.home_team : w.away_team)}</span></div>
      <div class="lines"><div><em>YC</em>${signed(ourAway(w))}</div><div><em>Kalshi</em>${signed(kalshi)}</div><div><em>Mkt</em>${signed(marketAway(g))}</div></div>
      <div class="spark">${sparkSvg(pts)}</div>
      <div class="r risk"><span class="${cls(wv)}">${usd(wv)}</span> / <span class="${cls(bv)}">${usd(bv)}</span><small>worst / best</small></div>
      <div class="r ev"><span class="${cls(o?.expected)}">${o ? usd(o.expected) : "–"}</span><small>${o?.marketExpected != null ? `Kalshi ${usd(o.marketExpected)}` : "EV (yours)"}</small></div>
      <div class="r st"><span class="pill ${stCls}">${esc(st)}</span><small>${gFills.length} fills</small></div>
    </div>`;
  }).join("");
  const last = data.runs?.[0];
  const resting = data.orders.length;
  document.querySelector('[data-pane="board"]').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="l">Worst case (all games)</div><div class="v ${cls(worst)}">${usd(worst)}</div><div class="d">if every game lands badly</div></div>
      <div class="stat"><div class="l">Best case</div><div class="v ${cls(best)}">${usd(best)}</div><div class="d">if every game lands well</div></div>
      <div class="stat"><div class="l">Expected · your number</div><div class="v ${cls(evY)}">${usd(evY)}</div><div class="d">${anyK ? `Kalshi's number: ${usd(evK)}` : "after fees"}</div></div>
      <div class="stat"><div class="l">Fills / resting</div><div class="v">${data.fills.length} / ${resting}</div><div class="d">paper</div></div>
      <div class="stat"><div class="l">Last run</div><div class="v" style="font-size:1.05rem">${last ? ago(last.started_at) : "–"}</div><div class="d ${last?.error ? "bad" : ""}">${last ? (last.error ? "error" : `${last.games ?? 0} games · ${last.fills ?? 0} fills`) : "not yet"}</div></div>
    </div>
    <div class="board">
      <div class="brow head"><div>Game</div><div>Lean</div><div>Lines (away)</div><div>P&amp;L by margin</div><div class="r">Worst / best</div><div class="r">Expected</div><div class="r">Status</div></div>
      ${rows || '<div class="empty">No games yet. Add one from <b>Add game</b>.</div>'}
    </div>`;
  $("navCount").textContent = watchlist.filter((w) => w.enabled).length;
}

function renderFills() {
  const { fills, watchlist } = data;
  const name = new Map(watchlist.map((w) => [w.game_id, `${w.away_team} @ ${w.home_team}`]));
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
      <div class="stat"><div class="l">Fees</div><div class="v">${usd(fees)}</div><div class="d">Kalshi model fee</div></div>
    </div>
    <div class="panel">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <label class="field" style="min-width:220px">Game<select id="fillsGame"><option value="">All games</option>${watchlist.map((w) => `<option value="${esc(w.game_id)}" ${w.game_id === fillsFilter ? "selected" : ""}>${esc(w.away_team)} @ ${esc(w.home_team)}</option>`).join("")}</select></label>
      </div>
      <div class="scroll"><table>
        <tr><th>When</th><th>Game</th><th>Number</th><th>Side</th><th>Price</th><th>Fair</th><th>Fee</th><th>CLV</th><th>Result</th><th>P&amp;L</th></tr>
        ${list.length ? list.map((f) => {
          const clv = f.close_mid == null ? null : f.action === "buy" ? f.close_mid - f.price : f.price - f.close_mid;
          const pnl = f.result == null ? null : (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee;
          return `<tr><td>${when(f.filled_at)}</td><td>${esc(name.get(f.game_id) || f.game_id)}</td><td>${esc(rungLabel(f.ticker))}</td><td>${f.action === "buy" ? "Buy" : "Sell"} ${f.count}</td><td>${c(Number(f.price), 0)}</td><td>${c(f.fair_at_fill)}</td><td>${c(Number(f.fee), 2)}</td><td class="${cls(clv)}">${c(clv)}</td><td>${f.result == null ? "–" : f.result ? "YES" : "NO"}</td><td class="${cls(pnl)}">${usd(pnl)}</td></tr>`;
        }).join("") : '<tr><td colspan="10" class="muted">No fills yet.</td></tr>'}
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
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="pill info">Mode: ${esc(state?.mode || "paper")}</span><span class="pill ${state?.kill_switch ? "bad" : "ok"}">${state?.kill_switch ? "Kill switch ON" : "Running"}</span></div>
        <p class="muted" style="font-size:.82rem;margin:8px 0 0">Runs every 5 minutes (cron-job.org → /api/cycle), with an hourly GitHub backup. The kill switch cancels every resting order on the next run.</p>
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3>Recent runs</h3>
      <div class="scroll"><table><tr><th>Started</th><th>Games</th><th>Placed</th><th>Cancelled</th><th>Fills</th><th>Status</th></tr>
      ${runs.length ? runs.map((r) => `<tr><td>${when(r.started_at)}</td><td>${r.games ?? "–"}</td><td>${r.orders_placed ?? "–"}</td><td>${r.orders_cancelled ?? "–"}</td><td>${r.fills ?? "–"}</td><td class="${r.error ? "bad" : ""}">${r.error ? esc(r.error.slice(0, 80)) : r.finished_at ? "ok" : "running"}</td></tr>`).join("") : '<tr><td colspan="6" class="muted">No runs yet.</td></tr>'}
      </table></div>
    </div>`;
}

// ---------- Drawer

function renderDrawer() {
  const root = $("drawerRoot");
  const w = openGame && data.watchlist.find((x) => x.game_id === openGame);
  if (!w) { root.innerHTML = ""; return; }
  const g = gameOf(w);
  const gFills = data.fills.filter((f) => f.game_id === w.game_id);
  const pts = curve(positions(gFills));
  const o = data.outcomes?.[w.game_id];
  const [st, stCls] = statusOf(w, g);
  const worst = pts.length ? Math.min(...pts.map((p) => p.v)) : 0;
  const best = pts.length ? Math.max(...pts.map((p) => p.v)) : 0;
  const tabs = ["outcomes", "ladder", "settings"].map((t) => `<button data-dtab="${t}" class="${drawerTab === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("");
  let body = "";
  if (drawerTab === "outcomes") body = curveSvg(w, pts) + outcomeTable(w, o);
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
          <div class="stat"><div class="l">Kalshi · ${esc(w.away_team)}</div><div class="v num">${signed(num(w.kalshi_home_margin))}</div><div class="d">market ${signed(marketAway(g))}</div></div>
          <div class="stat"><div class="l">Worst / best</div><div class="v num"><span class="${cls(worst)}">${usd(worst)}</span></div><div class="d">best ${usd(best)}</div></div>
          <div class="stat"><div class="l">Expected</div><div class="v num ${cls(o?.expected)}">${o ? usd(o.expected) : "–"}</div><div class="d">${o?.marketExpected != null ? `Kalshi ${usd(o.marketExpected)}` : "your number"}</div></div>
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
  return `<div class="callout">Kalshi (${esc(w.away_team)} ${signed(num(w.kalshi_home_margin) ?? marketAway(g))}) already prices ${esc(team)} at or past your number (${signed(ourAway(w))}), so the bot isn't adding exposure.</div>`;
}

function outcomeTable(w, o) {
  if (!o || !o.ranges?.length) return "";
  const hasMkt = o.market != null;
  const rows = o.ranges.map((r) => {
    const diff = hasMkt ? r.prob - r.marketProb : null;
    return `<tr><td>${marginLabel(w, r.from, r.to)}</td><td class="${cls(r.pnl)}">${usd(r.pnl)}</td><td>${pct(r.prob)}</td>${hasMkt ? `<td>${pct(r.marketProb)}</td><td class="${cls(diff)}">${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff * 100).toFixed(1)}</td>` : ""}</tr>`;
  }).join("");
  return `<div class="panel" style="padding:10px 12px"><div class="scroll"><table>
    <tr><th>If the game ends</th><th>Win / lose</th><th>Yours</th>${hasMkt ? "<th>Kalshi</th><th>Diff (pts)</th>" : ""}</tr>${rows}</table></div></div>
    <p class="muted" style="font-size:.76rem;margin:8px 0 0">Chances by your number (${esc(w.away_team)} ${signed(o.center)})${hasMkt ? ` and by the margin Kalshi's ladder implies (${esc(w.away_team)} ${signed(o.market)})` : ""}.</p>`;
}

function ladderTable(w, gFills) {
  const snaps = data.snapshots.filter((s) => s.game_id === w.game_id).sort((a, b) => Number(b.fair) - Number(a.fair));
  const pos = new Map(positions(gFills).map((p) => [p.ticker, p]));
  const mine = data.orders.filter((o) => o.game_id === w.game_id);
  if (!snaps.length) return '<p class="muted">No ladder snapshot yet.</p>';
  return `<div class="panel" style="padding:10px 12px"><div class="scroll"><table>
    <tr><th>Number (YES)</th><th>Bid / ask</th><th>Fair</th><th>Fair − mid</th><th>Our orders</th><th>Held</th></tr>
    ${snaps.map((s) => {
      const mid = s.bid != null && s.ask != null ? (Number(s.bid) + Number(s.ask)) / 2 : null;
      const edge = s.fair != null && mid != null ? Number(s.fair) - mid : null;
      const p = pos.get(s.ticker);
      const ords = mine.filter((o) => o.ticker === s.ticker).map((o) => `${o.action === "buy" ? "bid" : "ask"} ${c(Number(o.price), 0)}`).join(", ");
      return `<tr><td>${esc(rungLabel(s.ticker))}</td><td>${c(s.bid, 0)} / ${c(s.ask, 0)}</td><td>${c(s.fair)}</td><td class="${cls(edge)}">${c(edge)}</td><td>${esc(ords) || '<span class="muted">–</span>'}</td><td>${p && p.yes ? (p.yes > 0 ? "+" : "") + p.yes : "–"}</td></tr>`;
    }).join("")}</table></div></div>`;
}

function settingsForm(w) {
  const def = num(data.state?.default_ycpr_weight) ?? 1;
  const own = num(w.ycpr_weight);
  const t = Math.round((own ?? def) * 100);
  const v = (x, mult = 100) => (x == null ? "" : Math.round(Number(x) * mult * 100) / 100);
  return `<form id="gameForm" class="panel" data-id="${w.id}">
    <div class="grid2">
      <div class="field" style="grid-column:1/-1">Lean toward
        <div class="seg" id="gPick"><button type="button" data-pick="away" class="${w.pick === "away" ? "on" : ""}">${esc(w.away_team)}</button><button type="button" data-pick="home" class="${w.pick === "home" ? "on" : ""}">${esc(w.home_team)}</button></div></div>
      <div class="field" style="grid-column:1/-1">Trust in your number
        <div style="display:flex;gap:10px;align-items:center"><input id="gTrust" type="range" min="0" max="100" step="5" value="${t}" ${own == null ? "disabled" : ""}><b id="gTrustVal" class="num" style="min-width:44px;text-align:right">${t}%</b></div>
        <label style="display:flex;gap:6px;align-items:center;font-weight:500"><input id="gTrustDef" type="checkbox" ${own == null ? "checked" : ""}> Use default (${Math.round(def * 100)}%)</label></div>
      <label class="field">Override away spread<input id="gOverride" type="number" step="0.1" value="${w.my_home_margin ?? ""}" placeholder="YC ${signed(num(w.ycpr_home_margin))}"></label>
      <label class="field">Max loss on game ($)<input id="gMax" type="number" step="0.5" value="${w.max_worst_case_loss}"></label>
      <label class="field">Contracts per number<input id="gCap" type="number" step="1" value="${w.per_rung_cap}"></label>
      <label class="field">Profit target ($)<input id="gTarget" type="number" step="0.5" value="${w.profit_target ?? ""}" placeholder="none"></label>
      <label class="field">Pro-pick edge (¢)<input id="gPro" type="number" step="0.5" value="${v(w.pro_edge)}"></label>
      <label class="field">Sell-back edge (¢)<input id="gAnti" type="number" step="0.5" value="${v(w.anti_edge)}"></label>
      <label class="field">Take edge (¢)<input id="gTake" type="number" step="0.5" value="${v(w.take_edge)}"></label>
      <label class="field">Extra edge per contract (¢)<input id="gStep" type="number" step="0.5" value="${v(w.edge_step)}"></label>
      <label class="field">Stop quoting (min before)<input id="gStop" type="number" step="5" value="${w.stop_minutes_before}"></label>
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
      <button class="btn primary">Save</button>
      <button class="btn" type="button" id="gToggle">${w.enabled ? "Turn off" : "Turn on"}</button>
      <span id="gMsg" class="muted"></span>
    </div>
  </form>`;
}

// ---------- Add-game form

function renderAddOptions() {
  const sel = $("addGame");
  const keep = sel.value;
  sel.innerHTML = data.upcoming.map((g) => `<option value="${esc(g.id)}">${esc(g.away_team)} @ ${esc(g.home_team)} · ${when(g.start_date)} · YC ${signed(g.yc_away_spread)} · Mkt ${signed(marketAway(g))}</option>`).join("");
  if (keep) sel.value = keep;
  updatePick(!keep);
}

function updatePick(gameChanged = false) {
  const g = data?.upcoming.find((x) => String(x.id) === $("addGame").value);
  const cur = $("addPick").value;
  $("addPick").innerHTML = g ? `<option value="away">${esc(g.away_team)} (away)</option><option value="home">${esc(g.home_team)} (home)</option>` : "";
  if (!g) return;
  $("addYc").value = g.yc_away_spread == null ? "no rating" : `${g.away_team} ${signed(g.yc_away_spread)}`;
  const ours = num($("addOverride").value) ?? g.yc_away_spread;
  const mkt = marketAway(g);
  $("addPick").value = gameChanged || !cur ? (ours != null && mkt != null && ours > mkt ? "home" : "away") : cur;
}

// ---------- Render + routing

function render() {
  const { state } = data;
  $("modePill").textContent = state?.mode === "paper" || !state?.mode ? "Paper" : state.mode;
  $("killBtn").textContent = state?.kill_switch ? "Kill switch ON — resume" : "Kill switch";
  $("killBtn").className = state?.kill_switch ? "btn danger" : "btn";
  const last = data.runs?.[0];
  $("sideRun").textContent = last ? `Last run ${ago(last.started_at)}` : "No runs yet";
  renderBoard();
  renderFills();
  renderSettings();
  renderAddOptions();
  renderDrawer();
}

function setView(v) {
  view = v;
  for (const b of document.querySelectorAll("[data-view]")) b.classList.toggle("on", b.dataset.view === v);
  for (const p of document.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== v;
  $("title").textContent = { board: "Board", fills: "Fills", add: "Add game", settings: "Settings" }[v];
}

async function load() {
  // Don't redraw under someone mid-drag or mid-edit.
  const a = document.activeElement;
  if (a?.matches?.('input[type="range"]') || (a?.closest?.("#gameForm") && a.matches("input"))) return;
  try {
    data = await api("/api/data");
    $("err").textContent = "";
    $("gate").hidden = true;
    $("app").hidden = false;
    render();
  } catch (e) {
    if (e.message !== "unauthorized") $("err").textContent = "Couldn't load: " + e.message;
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openGame) { openGame = null; renderDrawer(); } });

$("drawerRoot").addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) { openGame = null; renderDrawer(); return; }
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
  };
  try {
    await api("/api/admin", body);
    $("gMsg").textContent = "Saved. Applies on the next run (within 5 min).";
    document.activeElement?.blur?.();
    load();
  } catch (err) {
    $("gMsg").textContent = err.message;
  }
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

// Add game
$("addGame").addEventListener("change", () => updatePick(true));
$("addOverride").addEventListener("change", () => updatePick(true));
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pick = $("addPick").value;
  const override = num($("addOverride").value);
  const g = data.upcoming.find((x) => String(x.id) === $("addGame").value);
  const ours = override ?? g?.yc_away_spread ?? null;
  if (ours == null) return alert("No YC number for this game; enter an override away spread.");
  const mkt = marketAway(g);
  if (g && mkt != null && !(pick === "home" ? ours > mkt : ours < mkt)) {
    const team = pick === "home" ? g.home_team : g.away_team;
    if (!confirm(`Your number (${g.away_team} ${signed(ours)}) isn't better for ${team} than the market (${g.away_team} ${signed(mkt)}). The bot won't add exposure unless it is. Save anyway?`)) return;
  }
  const cents = (id) => Number($(id).value) / 100;
  try {
    await api("/api/admin", {
      action: "addWatch",
      game_id: $("addGame").value,
      pick,
      my_home_margin: override,
      ycpr_weight: $("addTrust").value === "" ? null : Number($("addTrust").value),
      max_worst_case_loss: Number($("addMax").value),
      per_rung_cap: Number($("addCap").value),
      profit_target: $("addTarget").value === "" ? null : Number($("addTarget").value),
      pro_edge: cents("addPro"), anti_edge: cents("addAnti"), take_edge: cents("addTake"), edge_step: cents("addStep"),
      stop_minutes_before: Number($("addStop").value),
      enabled: true,
    });
    $("addMsg").textContent = "Saved. The bot picks it up on its next run.";
    await load();
    setView("board");
  } catch (err) {
    $("addMsg").textContent = err.message;
  }
});

applyTheme();
if (PW) load(); else showGate();
setInterval(() => { if (PW && !document.hidden) load(); }, 30000);
