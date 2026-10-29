// Live desk tab (docs/kalshi-bot-handoff.md §19). Renders only the snapshots handed over by hub/live/feed.js;
// it never reads the database. Panels are ported from docs/mockups/live-desk.html. Uses app.js globals:
// api (password header + gate), load (refresh the other tabs) and setView.
import { startFeed } from "./live/feed.js";
import { marginPmf, positions, pnlAt, worstBest, expectedPnl, yesProb, pickRung, pickMargin } from "./live/model.js";

const VEN = ["kalshi", "novig", "prophetx"];
const VN = { kalshi: "Kalshi", novig: "Novig", prophetx: "ProphetX" };
const VS = { kalshi: "K", novig: "NV", prophetx: "PX" };
const VCOL = { kalshi: "var(--k)", novig: "var(--nv)", prophetx: "var(--px)" };
const RANGES = ["15m", "1h", "6h", "24h", "all"];
const RANGE_MS = { "15m": 15 * 60e3, "1h": 3600e3, "6h": 6 * 3600e3, "24h": 86400e3, all: null };
const RANGE_LABEL = { "15m": "15m", "1h": "1h", "6h": "6h", "24h": "24h", all: "All" };
const STALE_MS = 3 * 60e3; // the tower cycles about every 90 s
const KIND_LABEL = { take: "take", make: "make", sell: "sell-back", mkt: "market", placed: "placed", moved: "moved", cancelled: "cancelled" };

const ls = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let look = ls.get("ycprDeskStyle", "site");
if (look !== "site" && look !== "terminal") look = "site"; // the mockup's third look (Clean) was dropped
let gameId = ls.get("ycprDeskGame", null);
let range = RANGES.includes(ls.get("ycprDeskRange", "")) ? ls.get("ycprDeskRange") : "6h";
let book = null; // null = Board, else a lab strategy id
let sub = "desk"; // desk | activity
let sound = ls.get("ycprDeskSound", "off") === "on";
let feed = null, snap = null, shown = false;
let zoom = null; // [t0, t1] in ms while the chart modal is zoomed
let modal = false;
const expanded = new Set(); // risk-board rows showing their venue detail
const act = { game: "", venue: "", type: "", book: "board", open: false, today: true, limit: 200 };
const alerts = [];
const base = { init: false, margins: new Map(), capped: new Set(), status: new Map(), venueErr: new Set() };
const lastCell = new Map(); // venue|ticker → { bid, ask } as last drawn, for the price flash

const pane = document.querySelector('[data-pane="live"]');
const esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
const fmtUsd = (x) => (x == null || !Number.isFinite(x) ? "–" : (x < -0.004 ? "−$" : "+$") + Math.abs(x).toFixed(2));
const plainUsd = (x) => (x == null ? "–" : "$" + Math.abs(x).toFixed(Math.abs(x) >= 100 ? 0 : 2).replace(/\.00$/, ""));
const fmtC = (x, d = 1) => (x == null || !Number.isFinite(x) ? "–" : (x > 0.00049 ? "+" : x < -0.00049 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "¢");
const cents = (p, venue) => (p == null ? "–" : (p * 100).toFixed(venue === "novig" ? 1 : 0));
const signed = (x) => (x == null || !Number.isFinite(x) ? "–" : Math.abs(x) < 0.05 ? "PK" : (x < 0 ? "−" : "+") + Math.abs(x).toFixed(1));
const timeStr = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const shortTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayTime = (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const tone = (x) => (x == null || Math.abs(x) < 0.005 ? "" : x > 0 ? "up" : "down");
const teamOf = (g, side) => (side === "home" ? g.home : g.away);
const lineLabel = (team, k) => `${team} ${k >= 0 ? "−" : "+"}${Math.abs(Number(k))}`;
const agoStr = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const bookName = (id) => (id == null ? "Board" : snap?.strategies.find((s) => s.id === id)?.name ?? `Lab ${id}`);
const usedColor = (u) => (u >= 0.8 ? "var(--down)" : u >= 0.6 ? "var(--warn)" : "var(--up)");

// ---------- Skeleton (built once; panels are redrawn from each snapshot)

pane.innerHTML = `<div class="desk" id="dk" data-look="${look}">
  <div class="dk-bar">
    <div class="dk-seg" role="group" aria-label="Look"><button type="button" data-look="site">Site</button><button type="button" data-look="terminal">Terminal</button></div>
    <div class="dk-seg" role="group" aria-label="View"><button type="button" data-sub="desk">Desk</button><button type="button" data-sub="activity">Activity</button></div>
    <select id="dkGame" aria-label="Game in focus"></select>
    <select id="dkBook" aria-label="Book"></select>
    <span class="grow"></span>
    <span class="dk-fresh"><span class="dk-live" id="dkLive">Live</span><span id="dkAgo">connecting…</span><span id="dkVenues"></span></span>
    <button type="button" class="dk-ctl" id="dkSound" aria-pressed="false">Sound off</button>
    <button type="button" class="dk-ctl" id="dkKill">Kill switch</button>
  </div>
  <div id="dkBanners" style="display:grid;gap:8px"></div>
  <section id="dkDesk" style="display:grid;gap:var(--gap)">
    <div class="dk-head"><h2 id="dkTitle">Live desk</h2><span class="dk-note" id="dkSubTitle"></span><span class="grow" style="flex:1"></span><button type="button" class="dk-ctl" id="dkPause">Pause this game</button></div>
    <section class="dk-kpis" aria-label="Game summary">
      <div class="dk-kpi"><div class="l">If you're right</div><div class="v" id="kEv">–</div><div class="d" id="kEvD">expected P&amp;L at settlement</div></div>
      <div class="dk-kpi"><div class="l">If the market's right</div><div class="v" id="kEvM">–</div><div class="d" id="kEvMD">expected P&amp;L by the market</div></div>
      <div class="dk-kpi"><div class="l">Mark to market</div><div class="v" id="kMtm">–</div><div class="d" id="kMtmD">positions at current mids</div></div>
      <div class="dk-kpi"><div class="l">Worst case vs cap</div><div class="v" id="kWorst">–</div><div class="dk-gauge"><i id="kGauge" style="width:0"></i></div></div>
      <div class="dk-kpi"><div class="l">Take / make / sell</div><div class="v" id="kFills">–</div><div class="d" id="kFillsD">this game</div></div>
      <div class="dk-kpi"><div class="l">Edge · CLV</div><div class="v" id="kEdge">–</div><div class="d">vs your fair · vs latest mid</div></div>
    </section>
    <section class="dk-grid">
      <div class="dk-panel c7">
        <h3>Price ladder <span class="sp" id="ladderSub"></span></h3>
        <div class="dk-scroll dk-ladder-wrap"><table class="dk-ladder" id="dkLadder"></table></div>
        <div class="dk-legend"><span><i style="background:var(--yc)"></i>your fair</span><span><i style="background:transparent;outline:1.5px solid var(--yc)"></i>your quote is the best price</span><span><i style="background:var(--accent)"></i>market line</span><span>bid / ask in ¢ for YES = the line covers</span></div>
      </div>
      <div class="dk-panel c5">
        <h3>Trade tape <span class="sp" id="tapeSub">all venues</span></h3>
        <div class="dk-scroll dk-tape"><table id="dkTape"><thead><tr><th>Time</th><th>Venue</th><th>Line</th><th>Price</th><th>Type</th><th>Edge</th></tr></thead><tbody></tbody></table></div>
        <div class="dk-legend"><span><span class="dk-tag take">take</span> you crossed</span><span><span class="dk-tag make">make</span> your quote filled</span><span><span class="dk-tag sell">sell-back</span></span><span><span class="dk-tag mkt">market</span> others</span></div>
      </div>
      <div class="dk-panel c7">
        <h3>P&amp;L by final margin <span class="sp">after fees, held to settlement</span></h3>
        <svg id="dkPnl" viewBox="0 0 640 210" role="img" aria-label="Profit or loss by final margin"></svg>
        <div class="dk-kv" id="dkPnlKv"></div>
        <div class="dk-scroll"><table id="dkVenuePos"></table></div>
      </div>
      <div class="dk-panel c5">
        <h3>Your number vs the market <span class="dk-seg" role="group" aria-label="Time range" data-ranges></span><button type="button" class="dk-icon" id="dkExpand" aria-label="Open the chart full screen" title="Full screen">⤢</button></h3>
        <svg id="dkLine" viewBox="0 0 480 220" role="img" aria-label="Your number and each venue's implied line over time"></svg>
        <div class="dk-legend" id="dkLineLegend"></div>
      </div>
      <div class="dk-panel c8">
        <h3>Risk board <span class="sp">every watched game · click a row to focus it</span></h3>
        <div class="dk-risk" id="dkRisk"></div>
        <p class="dk-rules">Status: <b>Final</b> kicked off · <b>Stopped</b> past the stop time · <b>Paused</b> turned off · <b>Near cap</b> 80%+ of the loss cap used · <b>No edge</b> the market is at or past your number · <b>Thin edge</b> your number and the market under 1 pt apart · <b>Quoting</b> orders resting.</p>
      </div>
      <div class="dk-panel c4">
        <h3>Alerts <span class="sp" id="dkAlertSub"></span></h3>
        <div class="dk-alerts" id="dkAlerts"></div>
      </div>
    </section>
  </section>
  <section id="dkAct" hidden style="display:grid;gap:var(--gap)"></section>
  <p class="dk-note" id="dkFoot">Paper trading. Updates every few seconds from the bot's ~90-second cycle, the market recorder and the ProphetX tape. Times are in your time zone.</p>
</div>`;
const overlay = document.createElement("div");
overlay.className = "desk";
overlay.id = "dkOverlay";
overlay.dataset.look = look;
overlay.innerHTML = '<div id="dkModalRoot"></div><div id="dkConfirmRoot"></div><div class="dk-toasts" id="dkToasts" aria-live="polite"></div>';
document.body.appendChild(overlay);
const $d = (id) => document.getElementById(id);

// ---------- Show / hide (called by app.js setView)

function show(on) {
  shown = on;
  document.documentElement.dataset.desk = on ? look : "";
  if (!on) { feed?.pause(); closeModal(); return; }
  setTitle();
  if (!feed) feed = startFeed(onSnap, { gameId, range, book, get: (p) => api(p) });
  else feed.resume();
}
window.liveDesk = { show };

function setTitle() {
  if (!shown) return;
  const t = document.getElementById("title");
  if (t) t.textContent = look === "terminal" ? "YCPR // LIVE DESK" : "Live desk";
}

function setLook(l) {
  look = l;
  ls.set("ycprDeskStyle", l);
  $d("dk").dataset.look = l;
  overlay.dataset.look = l;
  if (shown) document.documentElement.dataset.desk = l;
  setTitle();
  render();
}

// ---------- Snapshot in

function onSnap(s) {
  snap = s;
  if (!s.game && s.games.length && !s.error) {
    const live = (g) => !["Final", "Stopped", "Paused"].includes(g.status.label);
    const pick = s.games.find((g) => g.game_id === gameId) ?? s.games.find(live) ?? s.games.find((g) => g.status.label !== "Final") ?? s.games[0];
    if (pick.game_id !== gameId || !s.game) {
      gameId = pick.game_id;
      ls.set("ycprDeskGame", gameId);
      feed.setGame(gameId);
    }
  }
  detect(s);
  render();
}

// ---------- Alerts: line moves ≥ 1 pt between steps, cap ≥ 80%, edge flipped to none, venue errors

function detect(s) {
  if (!s.asOf) return;
  const fire = !!base.init;
  for (const g of s.games) {
    for (const [v, m] of Object.entries(g.venue_margins || {})) {
      if (m == null) continue;
      const k = `${g.game_id}|${v}`;
      const prev = base.margins.get(k);
      if (prev != null && Math.abs(m - prev) >= 1 && fire) pushAlert("move", `${VN[v] || v}: ${g.label} moved ${Math.abs(m - prev).toFixed(1)} pts (${g.away} ${signed(prev)} → ${signed(m)})`, g.game_id);
      if (prev == null || prev !== m) base.margins.set(k, Number(m));
    }
    if (g.used >= 0.8 && !base.capped.has(g.game_id)) {
      base.capped.add(g.game_id);
      if (fire) pushAlert("cap", `${g.label} is using ${plainUsd(-g.worst)} of its ${plainUsd(g.cap)} cap (${Math.round(g.used * 100)}%): new risk pauses`, g.game_id);
    } else if (g.used < 0.7) base.capped.delete(g.game_id);
    const prev = base.status.get(g.game_id);
    if (fire && prev && prev !== "No edge" && g.status.label === "No edge") pushAlert("edge", `${g.label}: the market reached your number (${g.away} ${signed(g.ours)}). No edge, quotes come down`, g.game_id);
    base.status.set(g.game_id, g.status.label);
  }
  const run = (s.runs.paper || []).find((r) => r.finished_at) ?? null;
  for (const r of [run, s.runs.record].filter(Boolean)) {
    for (const [v, e] of Object.entries(r.venueErrors || {})) {
      const k = `${r.started_at}|${v}`;
      if (base.venueErr.has(k)) continue;
      base.venueErr.add(k);
      if (fire) pushAlert("venue", `${VN[v] || v}: ${String(e).slice(0, 120)}`, null);
    }
  }
  base.init = true;
}

function pushAlert(kind, text, gid) {
  const a = { t: Date.now(), kind, text, gid };
  alerts.unshift(a);
  if (alerts.length > 60) alerts.pop();
  toast(a);
}

function toast(a) {
  const root = $d("dkToasts");
  const el = document.createElement("div");
  el.className = `dk-toast ${a.kind}`;
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="ic">${alertLabel(a.kind)}</span><span>${esc2(a.text)}</span><button type="button" aria-label="Dismiss">✕</button>`;
  el.querySelector("button").addEventListener("click", () => el.remove());
  root.prepend(el);
  while (root.children.length > 4) root.lastChild.remove();
  setTimeout(() => el.remove(), 9000);
  if (sound) beep(a.kind === "move" ? 660 : 880);
}
const alertLabel = (k) => ({ move: "Line move", cap: "Cap", edge: "No edge", venue: "Venue", error: "Error" })[k] || k;

let audio = null;
function beep(freq) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.26);
  } catch {}
}

// ---------- Render

function render() {
  if (!snap) return;
  renderBar();
  $d("dkDesk").hidden = sub !== "desk";
  $d("dkAct").hidden = sub !== "activity";
  if (sub === "desk") renderDesk();
  // Don't redraw the blotter under an open filter menu.
  else if (!(document.activeElement?.tagName === "SELECT" && document.activeElement.closest("#dkAct"))) renderActivity();
  if (modal) renderModal();
}

function lastRun(s) {
  return (s.runs.paper || []).find((r) => r.finished_at) ?? null;
}

function venueStatus(s) {
  const out = {};
  const runs = [lastRun(s), s.runs.record].filter(Boolean);
  for (const v of VEN) {
    const errs = runs.map((r) => r.venueErrors?.[v]).filter(Boolean);
    out[v] = !runs.length ? ["none", "–"] : !errs.length ? ["ok", "ok"] : errs.some((e) => /429|rate.?limit|too many/i.test(e)) ? ["rate", "rate-limited"] : ["err", "error"];
  }
  return out;
}

function renderBar() {
  const s = snap;
  for (const b of pane.querySelectorAll("[data-look]")) if (b.tagName === "BUTTON") b.classList.toggle("on", b.dataset.look === look);
  for (const b of pane.querySelectorAll("[data-sub]")) b.classList.toggle("on", b.dataset.sub === sub);
  const gs = $d("dkGame");
  const gOpts = s.games.map((g) => `<option value="${esc2(g.game_id)}">${esc2(g.label)} · ${g.kickoff ? dayTime(g.kickoff) : "–"}</option>`).join("");
  if (gs.dataset.sig !== gOpts) { gs.innerHTML = gOpts || "<option>No watched games</option>"; gs.dataset.sig = gOpts; }
  if (gameId) gs.value = gameId;
  gs.hidden = sub !== "desk";
  const bs = $d("dkBook");
  const bOpts = `<option value="">Board</option>${s.strategies.map((x) => `<option value="${x.id}">Lab · ${esc2(x.name)}${x.enabled ? "" : " (off)"}</option>`).join("")}`;
  if (bs.dataset.sig !== bOpts) { bs.innerHTML = bOpts; bs.dataset.sig = bOpts; }
  bs.value = book == null ? "" : String(book);
  bs.hidden = sub !== "desk";
  const kill = !!s.state?.kill_switch;
  $d("dkKill").textContent = kill ? "Kill switch ON · resume" : "Kill switch";
  $d("dkKill").className = "dk-ctl" + (kill ? " danger" : "");
  $d("dkSound").textContent = sound ? "Sound on" : "Sound off";
  $d("dkSound").classList.toggle("on", sound);
  $d("dkSound").setAttribute("aria-pressed", String(sound));
  const vs = venueStatus(s);
  $d("dkVenues").innerHTML = VEN.map((v) => `<span class="dk-vchip ${vs[v][0]}" title="${esc2(VN[v])}: ${vs[v][1]}">${VS[v]} ${vs[v][1]}</span>`).join(" ");
  renderFresh();
  // Banners: feed down, the cycle missed, kill switch on.
  const run = lastRun(s);
  const age = run ? Date.now() - ms(run.finished_at) : null;
  const b = [];
  if (s.error) b.push(`<div class="dk-banner bad">Can't reach the desk feed: ${esc2(s.error)}. Retrying.</div>`);
  if (age != null && age > STALE_MS) b.push(`<div class="dk-banner">The last paper cycle finished ${agoStr(ms(run.finished_at))}. It normally runs about every 90 seconds, so cycles were missed: prices and orders here may be stale. The status pill at the top says why.</div>`);
  if (!run && s.asOf) b.push('<div class="dk-banner">No paper cycle has finished yet.</div>');
  if (run?.error) b.push(`<div class="dk-banner bad">The last cycle ended with an error: ${esc2(String(run.error).slice(0, 160))}</div>`);
  if (kill) b.push('<div class="dk-banner bad"><b>Kill switch is ON.</b> The bot cancels every resting order on its next run and stops quoting.</div>');
  $d("dkBanners").innerHTML = b.join("");
}

function renderFresh() {
  if (!snap) return;
  const run = lastRun(snap);
  const age = run ? Date.now() - ms(run.finished_at) : null;
  const live = $d("dkLive");
  live.className = "dk-live" + (snap.error ? " down" : age != null && age > STALE_MS ? " stale" : "");
  live.textContent = snap.error ? "Offline" : age != null && age > STALE_MS ? "Stale" : "Live";
  $d("dkAgo").textContent = run ? `updated ${agoStr(ms(run.finished_at))}` : snap.asOf ? "waiting for a cycle" : "connecting…";
  $d("dkAgo").title = snap.receivedAt ? `Feed polled ${agoStr(snap.receivedAt)}` : "";
}
setInterval(() => { if (shown) renderFresh(); }, 1000);

function renderDesk() {
  const s = snap;
  const g = s.game;
  $d("dkPause").hidden = !g;
  if (!g) {
    $d("dkTitle").textContent = s.games.length ? "Loading…" : "No watched games";
    $d("dkSubTitle").textContent = s.games.length ? "" : "Add a game from Add game; it shows here on the next cycle.";
    renderRisk();
    renderAlerts();
    return;
  }
  $d("dkTitle").textContent = `${g.away} @ ${g.home}`;
  const st = s.games.find((x) => x.game_id === g.game_id)?.status;
  $d("dkSubTitle").innerHTML = `${g.kickoff ? dayTime(g.kickoff) : ""} · lean ${esc2(teamOf(g, g.pick))} · ${esc2(bookName(book))} book${st ? ` · <span class="dk-pill ${st.tone}">${esc2(st.label)}</span>` : ""}`;
  $d("dkPause").textContent = g.enabled ? "Pause this game" : "Resume this game";
  const pos = positions(s.fills);
  const mids = new Map(s.ladder.filter((r) => r.bid != null && r.ask != null).map((r) => [`${r.venue}|${r.ticker}`, (Number(r.bid) + Number(r.ask)) / 2]));
  renderKpis(g, pos, mids);
  renderLadder(g, pos);
  renderTape(g);
  renderPnl(g, pos);
  renderVenuePos(g);
  renderLinePanel();
  renderRisk();
  renderAlerts();
}

function renderKpis(g, pos, mids) {
  const s = snap;
  const e = g.ours == null ? null : expectedPnl(pos, marginPmf(g.ours));
  const em = g.market == null ? null : expectedPnl(pos, marginPmf(g.market));
  let mtm = 0, unpriced = 0;
  for (const p of pos) {
    if (!p.yes) { mtm -= p.cost; continue; }
    const m = mids.get(`${p.venue}|${p.ticker}`);
    if (m == null) unpriced++;
    else mtm += p.yes * m - p.cost;
  }
  const { worst } = worstBest(pos);
  const used = g.cap > 0 ? Math.min(1, Math.max(0, -worst) / g.cap) : 0;
  const set = (id, val, cls) => { const el = $d(id); el.textContent = val; el.className = "v " + (cls || ""); };
  set("kEv", fmtUsd(e), tone(e));
  set("kEvM", fmtUsd(em), tone(em));
  set("kMtm", pos.length ? fmtUsd(mtm) : "–", tone(mtm));
  set("kWorst", `${plainUsd(Math.max(0, -worst))} / ${plainUsd(g.cap)}`, used >= 0.8 ? "down" : "");
  $d("kGauge").style.width = (used * 100).toFixed(0) + "%";
  $d("kGauge").style.background = usedColor(used);
  const n = (k) => s.fills.filter((f) => f.kind === k).length;
  set("kFills", `${n("take")} / ${n("make")} / ${n("sell")}`);
  const withFair = s.fills.filter((f) => f.fair_at_fill != null);
  const edge = withFair.length ? withFair.reduce((a, f) => a + (f.action === "buy" ? f.fair_at_fill - f.price : f.price - f.fair_at_fill), 0) / withFair.length : null;
  const withMid = s.fills.filter((f) => mids.has(`${f.venue}|${f.ticker}`));
  const clv = withMid.length ? withMid.reduce((a, f) => { const m = mids.get(`${f.venue}|${f.ticker}`); return a + (f.action === "buy" ? m - f.price : f.price - m); }, 0) / withMid.length : null;
  set("kEdge", `${fmtC(edge)} · ${fmtC(clv)}`, tone(clv));
  $d("kEvD").textContent = g.ours == null ? "no number yet" : `YC ${g.away} ${signed(g.ours)}`;
  const mv = VEN.find((v) => g.venue_margins?.[v] != null);
  $d("kEvMD").textContent = g.market == null ? "no market line yet" : `${VN[mv] || "Kalshi"} implies ${g.away} ${signed(g.market)}`;
  $d("kMtmD").textContent = unpriced ? `${unpriced} line${unpriced > 1 ? "s" : ""} without a price` : "positions at current mids";
  $d("kFillsD").textContent = `this game · ${s.quotes.length} quotes resting`;
}

/** The focused game's ladder from the pick's side: one row per line, a bid/ask pair per venue. */
function ladderRows(g) {
  const rows = new Map();
  const pmf = g.ours == null ? null : marginPmf(g.ours);
  for (const r of snap.ladder) {
    const pr = pickRung(r, g.pick);
    const row = rows.get(pr.k) ?? { k: pr.k, cells: {}, fair: null };
    const cur = row.cells[r.venue];
    if (!cur || (cur.flip && !pr.flip)) row.cells[r.venue] = { ...pr, ticker: r.ticker };
    else (row.extra ??= []).push({ venue: r.venue, ticker: r.ticker, flip: pr.flip });
    if (r.fair != null && row.fair == null) row.fair = pr.flip ? 1 - Number(r.fair) : Number(r.fair);
    rows.set(pr.k, row);
  }
  for (const row of rows.values()) if (row.fair == null && pmf) row.fair = yesProb(pmf, g.pick, row.k);
  return [...rows.values()].sort((a, b) => b.k - a.k);
}

function renderLadder(g, pos) {
  const s = snap;
  const pick = teamOf(g, g.pick);
  $d("ladderSub").textContent = `YES = ${pick} covers · ${s.ladder.length ? `${new Set(s.ladder.map((r) => r.venue)).size} venue${new Set(s.ladder.map((r) => r.venue)).size > 1 ? "s" : ""}` : "no ladder yet"}`;
  const rows = ladderRows(g);
  if (!rows.length) { $d("dkLadder").innerHTML = '<tbody><tr><td class="mut">No ladder recorded for this game yet. It fills in after the next cycle.</td></tr></tbody>'; return; }
  const vens = VEN.filter((v) => rows.some((r) => r.cells[v]));
  const pm = pickMargin(g.pick, g.market);
  const mktK = pm == null ? null : rows.reduce((best, r) => (best == null || Math.abs(r.k - pm) < Math.abs(best - pm) ? r.k : best), null);
  const posBy = new Map(pos.map((p) => [`${p.venue}|${p.ticker}`, p]));
  let html = `<thead><tr><th>Line</th><th>Fair</th>${vens.map((v) => `<th class="sep">${VS[v]} bid</th><th>${VS[v]} ask</th>`).join("")}<th>Best edge</th><th>Your quotes</th><th>Held</th></tr></thead><tbody>`;
  for (const r of rows) {
    let bestEdge = null, held = 0;
    const chips = [];
    const cells = vens.map((v) => {
      const c = r.cells[v];
      if (!c) return '<td class="sep mut">·</td><td class="mut">·</td>';
      const tickers = [{ ticker: c.ticker, flip: c.flip }, ...(r.extra || []).filter((x) => x.venue === v)];
      let myBid = null, myAsk = null;
      for (const t of tickers) {
        const p = posBy.get(`${v}|${t.ticker}`);
        if (p) held += t.flip ? -p.yes : p.yes;
        for (const o of s.quotes.filter((q) => q.venue === v && q.ticker === t.ticker)) {
          // Buying the other team's YES is selling this line, at 100 − price.
          const isBid = (o.action === "buy") !== t.flip;
          const px = t.flip ? 1 - Number(o.price) : Number(o.price);
          if (isBid) myBid = Math.max(myBid ?? 0, px); else myAsk = Math.min(myAsk ?? 1, px);
          chips.push(`<span class="dk-chip ${v}" title="${isBid ? "bid" : "offer"} ${o.count} on ${VN[v]}">${VS[v]} ${isBid ? "" : "ask "}${cents(px, v)}</span>`);
        }
      }
      if (r.fair != null) {
        if (c.ask != null) bestEdge = Math.max(bestEdge ?? -1, r.fair - c.ask);
        if (c.bid != null) bestEdge = Math.max(bestEdge ?? -1, c.bid - r.fair);
      }
      const prev = lastCell.get(`${v}|${c.ticker}`);
      lastCell.set(`${v}|${c.ticker}`, { bid: c.bid, ask: c.ask });
      const fl = (a, b) => (b == null || a == null || a === b ? "" : a > b ? "dk-flash-up" : "dk-flash-dn");
      const mineB = myBid != null && c.bid != null && myBid >= c.bid - 1e-9;
      const mineA = myAsk != null && c.ask != null && myAsk <= c.ask + 1e-9;
      return `<td class="sep vb ${fl(c.bid, prev?.bid)}"><span class="${mineB ? "dk-mine" : ""}">${cents(c.bid, v)}</span></td><td class="va ${fl(c.ask, prev?.ask)}"><span class="${mineA ? "dk-mine" : ""}">${cents(c.ask, v)}</span></td>`;
    }).join("");
    html += `<tr class="${r.k === mktK ? "mkt" : ""}"><td>${esc2(lineLabel(pick, r.k))}</td><td class="fair">${r.fair == null ? "–" : (r.fair * 100).toFixed(1)}</td>${cells}<td class="${bestEdge > 0 ? "up" : "mut"}">${bestEdge == null ? "–" : fmtC(bestEdge)}</td><td class="ours">${chips.join("") || '<span class="mut">–</span>'}</td><td>${held ? (held > 0 ? "+" : "−") + Math.abs(held) : '<span class="mut">–</span>'}</td></tr>`;
  }
  $d("dkLadder").innerHTML = html + "</tbody>";
}

function rungLabelFor(g, venue, ticker) {
  const r = snap.ladder.find((x) => x.venue === venue && x.ticker === ticker) ?? snap.fills.find((x) => x.venue === venue && x.ticker === ticker);
  return r?.side ? lineLabel(teamOf(g, r.side), r.strike) : ticker;
}

function renderTape(g) {
  const s = snap;
  const rows = s.tape.slice(0, 80).map((r) => {
    const ours = !!r.ours;
    const kind = ours ? r.ours : "mkt";
    const edge = ours && r.fair != null ? (r.action === "buy" ? r.fair - r.yes_price : r.yes_price - r.fair) : null;
    return `<tr class="${r.fresh ? "newrow" : ""} ${ours ? "ourrow" : ""}"><td>${timeStr(r.t)}</td><td><span class="dk-chip ${r.venue}">${VS[r.venue] || r.venue}</span></td><td>${esc2(rungLabelFor(g, r.venue, r.ticker))}</td><td>${cents(r.yes_price, r.venue)}¢</td><td><span class="dk-tag ${kind}">${KIND_LABEL[kind]}</span>${ours ? ` ${r.action}` : ""}</td><td class="${ours ? tone(edge) : "mut"}">${ours ? fmtC(edge) : "–"}</td></tr>`;
  }).join("");
  $d("dkTape").querySelector("tbody").innerHTML = rows || '<tr><td colspan="6" class="mut">No trades recorded yet for this game.</td></tr>';
  $d("tapeSub").textContent = `${s.fills.length} yours · ${s.tape.length - s.tape.filter((t) => t.ours).length} market · all venues`;
}

function renderPnl(g, pos) {
  const W = 640, H = 210, padL = 44, padR = 10, padT = 12, padB = 30;
  const toHome = (p) => (g.pick === "home" ? p : -p);
  const pts = [];
  for (let p = -30; p <= 40; p++) if (p !== 0) pts.push({ m: p, pnl: pnlAt(pos, toHome(p)) });
  const max = Math.max(1, ...pts.map((p) => Math.abs(p.pnl)));
  const y0 = padT + (H - padT - padB) / 2;
  const sy = (H - padT - padB) / 2 / max;
  const bw = (W - padL - padR) / pts.length;
  const xOf = (mu) => { const i = pts.findIndex((p) => p.m >= mu); return padL + (i < 0 ? pts.length : i) * bw; };
  let s = "";
  for (const f of [-1, -0.5, 0.5, 1]) { const y = y0 - f * max * sy; s += `<line class="dk-gridl" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text class="dk-axis" x="${padL - 6}" y="${y + 3}" text-anchor="end">${f * max < 0 ? "−" : ""}$${Math.abs(f * max).toFixed(max < 5 ? 1 : 0)}</text>`; }
  s += `<line x1="${padL}" x2="${W - padR}" y1="${y0}" y2="${y0}" stroke="var(--line)"/>`;
  const other = teamOf(g, g.pick === "home" ? "away" : "home"), pick = teamOf(g, g.pick);
  pts.forEach((p, i) => {
    const h = Math.abs(p.pnl) * sy;
    const who = p.m > 0 ? `${pick} by ${p.m}` : `${other} by ${-p.m}`;
    s += `<rect x="${(padL + i * bw + 0.5).toFixed(1)}" y="${(p.pnl >= 0 ? y0 - h : y0).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="1" fill="${p.pnl >= 0 ? "var(--up)" : "var(--down)"}"><title>${esc2(who)}: ${fmtUsd(p.pnl)}</title></rect>`;
  });
  const marks = [[pickMargin(g.pick, g.ours), "var(--yc)", "YC"], [pickMargin(g.pick, g.market), "var(--k)", "PM"]];
  marks.forEach(([mu, col, lab], i) => {
    if (mu == null) return;
    const x = xOf(mu);
    // Labels sit on separate rows so YC and Mkt never overprint when the numbers are close.
    s += `<line x1="${x}" x2="${x}" y1="${padT}" y2="${H - padB}" stroke="${col}" stroke-width="1.5" stroke-dasharray="4 3"/><text class="dk-axis" x="${x + 3}" y="${padT + 8 + i * 11}" style="fill:${col}">${lab}</text>`;
  });
  for (const m of [-21, -14, -7, 7, 14, 21, 28, 35]) { const i = pts.findIndex((p) => p.m === m); if (i >= 0) s += `<text class="dk-axis" x="${padL + i * bw + bw / 2}" y="${H - 14}" text-anchor="middle">${m > 0 ? "+" : "−"}${Math.abs(m)}</text>`; }
  s += `<text class="dk-axis" x="${padL}" y="${H - 1}">← ${esc2(other)} wins</text><text class="dk-axis" x="${W - padR}" y="${H - 1}" text-anchor="end">${esc2(pick)} wins by more →</text>`;
  if (!pos.length) s += `<text class="dk-axis" x="${W / 2}" y="${y0 - 8}" text-anchor="middle">No position yet</text>`;
  $d("dkPnl").innerHTML = s;
  const { worst, best } = worstBest(pos);
  $d("dkPnlKv").innerHTML = `<span>Worst <b class="${worst < 0 ? "down" : ""}">${fmtUsd(worst)}</b></span><span>Best <b class="up">${fmtUsd(best)}</b></span><span>Contracts <b>${pos.reduce((a, p) => a + Math.abs(p.yes), 0)}</b></span><span>Lines held <b>${pos.filter((p) => p.yes).length}</b></span>`;
}

/** Contracts, cost and worst case per venue for the focused game: one loss cap covers all of them. */
function renderVenuePos(g) {
  const all = positions(snap.fills);
  const vens = VEN.filter((v) => all.some((p) => p.venue === v));
  if (!vens.length) { $d("dkVenuePos").innerHTML = ""; return; }
  const rows = vens.map((v) => {
    const p = all.filter((x) => x.venue === v);
    const { worst } = worstBest(p);
    return `<tr><td><span class="dk-chip ${v}">${VN[v]}</span></td><td>${p.reduce((a, x) => a + Math.abs(x.yes), 0)}</td><td>${plainUsd(p.reduce((a, x) => a + x.cost, 0))}</td><td class="${tone(worst)}">${fmtUsd(worst)}</td></tr>`;
  }).join("");
  const { worst } = worstBest(all);
  $d("dkVenuePos").innerHTML = `<thead><tr><th>By venue</th><th>Contracts</th><th>Cost</th><th>Worst case</th></tr></thead><tbody>${rows}<tr><td><b>Combined</b></td><td>${all.reduce((a, x) => a + Math.abs(x.yes), 0)}</td><td>${plainUsd(all.reduce((a, x) => a + x.cost, 0))}</td><td class="${tone(worst)}"><b>${fmtUsd(worst)}</b> of ${plainUsd(g.cap)} cap</td></tr></tbody>`;
}

// ---------- "Your number vs the market" chart (panel + full-screen modal)

function chartDomain() {
  const s = snap;
  const t1 = s.asOf ? ms(s.asOf) : Date.now();
  if (zoom && modal) return zoom;
  const span = RANGE_MS[range];
  if (span) return [t1 - span, t1];
  const first = Math.min(...s.lines.map((l) => ms(l.t)), ...s.fills.map((f) => ms(f.filled_at)), t1 - 3600e3);
  return [first, t1];
}

/** Value of each venue's implied line at time t (the last point at or before t). */
function lineAt(series, t) {
  let v = null;
  for (const p of series) { if (p.t <= t) v = p.v; else break; }
  return v ?? series[0]?.v ?? null;
}

function chartModel(W, H) {
  const s = snap, g = s.game;
  const [t0, t1] = chartDomain();
  const padL = 46, padR = 12, padT = 12, padB = 24;
  const series = {};
  for (const l of s.lines) (series[l.venue] ??= []).push({ t: ms(l.t), v: Number(l.margin) });
  const vens = VEN.filter((v) => series[v]?.length);
  // Each venue's visible points, starting from its value at the left edge.
  const vis = {};
  for (const v of vens) {
    const arr = series[v];
    const inside = arr.filter((p) => p.t >= t0 && p.t <= t1);
    const before = arr.filter((p) => p.t < t0).at(-1);
    vis[v] = [...(before ? [{ t: t0, v: before.v }] : []), ...inside];
    if (vis[v].length) vis[v].push({ t: t1, v: vis[v].at(-1).v, edge: true });
  }
  const fills = s.fills.filter((f) => ms(f.filled_at) >= t0 && ms(f.filled_at) <= t1).map((f) => {
    const arr = series[f.venue] || [];
    const y = lineAt(arr, ms(f.filled_at)) ?? g.market;
    return { ...f, t: ms(f.filled_at), y };
  });
  const vals = [...vens.flatMap((v) => vis[v].map((p) => p.v)), g.ours, g.book, ...fills.map((f) => f.y)].filter((x) => x != null && Number.isFinite(x));
  let lo = vals.length ? Math.min(...vals) - 0.6 : -1, hi = vals.length ? Math.max(...vals) + 0.6 : 1;
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const tAt = (px) => t0 + ((px - padL) / (W - padL - padR)) * (t1 - t0);
  return { W, H, padL, padR, padT, padB, t0, t1, lo, hi, x, y, tAt, vis, vens, fills, series, g };
}

function chartSvg(M) {
  const { W, H, padL, padR, padB, t0, t1, lo, hi, x, y, vis, vens, fills, g } = M;
  let s = "";
  for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4; s += `<line class="dk-gridl" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="dk-axis" x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${signed(v)}</text>`; }
  if (g.book != null) s += `<line x1="${padL}" x2="${W - padR}" y1="${y(g.book)}" y2="${y(g.book)}" stroke="var(--book)" stroke-dasharray="3 3"><title>Sportsbook ${esc2(g.away)} ${signed(g.book)}</title></line>`;
  if (g.ours != null) s += `<line x1="${padL}" x2="${W - padR}" y1="${y(g.ours)}" y2="${y(g.ours)}" stroke="var(--yc)" stroke-width="2"><title>YC ${esc2(g.away)} ${signed(g.ours)}</title></line>`;
  for (const v of vens) {
    const pts = vis[v];
    if (!pts.length) continue;
    // Step line: each recorder step holds until the next.
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].t).toFixed(1)}V${y(pts[i].v).toFixed(1)}`;
    s += `<path d="${d}" fill="none" stroke="${VCOL[v]}" stroke-width="${v === "kalshi" ? 2 : 1.5}" opacity="${v === "kalshi" ? 1 : 0.85}"/>`;
    const last = pts.at(-1);
    s += `<circle cx="${x(last.t)}" cy="${y(last.v)}" r="3" fill="${VCOL[v]}"/>`;
  }
  for (const f of fills) {
    const col = f.kind === "take" ? "var(--take)" : f.kind === "sell" ? "var(--sell)" : "var(--make)";
    s += `<circle cx="${x(f.t).toFixed(1)}" cy="${y(f.y).toFixed(1)}" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="1.5"><title>${esc2(timeStr(f.t))} · ${VN[f.venue]} · ${esc2(rungLabelFor(g, f.venue, f.ticker))} · ${f.action === "buy" ? "bought" : "sold"} at ${cents(Number(f.price), f.venue)}¢ (${KIND_LABEL[f.kind]})</title></circle>`;
  }
  if (!vens.length) s += `<text class="dk-axis" x="${(W + padL) / 2}" y="${H / 2}" text-anchor="middle">No implied lines recorded in this range yet</text>`;
  const sameDay = new Date(t0).toDateString() === new Date(t1).toDateString();
  const lab = (t) => (sameDay ? shortTime(t) : dayTime(t));
  s += `<text class="dk-axis" x="${padL}" y="${H - 6}">${esc2(lab(t0))}</text><text class="dk-axis" x="${(padL + W - padR) / 2}" y="${H - 6}" text-anchor="middle">${esc2(lab((t0 + t1) / 2))}</text><text class="dk-axis" x="${W - padR}" y="${H - 6}" text-anchor="end">${zoom && modal ? esc2(lab(t1)) : "now"}</text>`;
  void padB;
  return s;
}

function legendHtml(g) {
  const vens = VEN.filter((v) => snap.lines.some((l) => l.venue === v));
  return `<span><i style="background:var(--yc)"></i>YC ${signed(g.ours)}</span>${vens.map((v) => `<span><i style="background:${VCOL[v]}"></i>${VN[v]} ${signed(g.venue_margins?.[v] == null ? null : Number(g.venue_margins[v]))}</span>`).join("")}${g.book != null ? `<span><i style="background:var(--book)"></i>sportsbook ${signed(g.book)}</span>` : ""}<span><i style="background:var(--take);border-radius:50%"></i>take</span><span><i style="background:var(--make);border-radius:50%"></i>make</span><span><i style="background:var(--sell);border-radius:50%"></i>sell-back</span><span>· away spread</span>`;
}

const rangeButtons = () => RANGES.map((r) => `<button type="button" data-range="${r}" class="${r === range ? "on" : ""}">${RANGE_LABEL[r]}</button>`).join("");

function renderLinePanel() {
  const g = snap.game;
  for (const el of pane.querySelectorAll("[data-ranges]")) el.innerHTML = rangeButtons();
  $d("dkLine").innerHTML = chartSvg(chartModel(480, 220));
  $d("dkLineLegend").innerHTML = legendHtml(g);
}

function openModal() {
  modal = true;
  zoom = null;
  renderModal();
  $d("dkModalRoot").querySelector(".dk-icon")?.focus();
}
function closeModal() {
  if (!modal) return;
  modal = false;
  zoom = null;
  $d("dkModalRoot").innerHTML = "";
  $d("dkExpand")?.focus();
}

function renderModal() {
  const root = $d("dkModalRoot");
  const g = snap?.game;
  if (!g) { closeModal(); return; }
  if (!root.firstChild) {
    root.innerHTML = `<div class="dk-modal" role="dialog" aria-modal="true" aria-label="Your number vs the market, full screen">
      <div class="dk-head"><h2 id="dkMTitle"></h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="dk-seg" role="group" aria-label="Time range" data-ranges></span><button type="button" class="dk-ctl" id="dkReset">Reset zoom</button><button type="button" class="dk-icon" id="dkClose" aria-label="Close (Esc)">✕</button></div></div>
      <div class="dk-note">Drag across the chart to zoom into a stretch of time; hover or touch for values.</div>
      <div class="plot" id="dkPlot"><svg id="dkBig" role="img" aria-label="Your number and each venue's implied line over time"></svg><div class="dk-tip" id="dkTip" hidden></div></div>
      <div class="dk-legend" id="dkMLegend"></div>
    </div>`;
    wireModal();
  }
  $d("dkMTitle").textContent = `Your number vs the market · ${g.away} @ ${g.home}`;
  for (const el of root.querySelectorAll("[data-ranges]")) el.innerHTML = rangeButtons();
  $d("dkReset").disabled = !zoom;
  drawBig();
  $d("dkMLegend").innerHTML = legendHtml(g);
}

let bigModel = null;
function drawBig() {
  const plot = $d("dkPlot");
  if (!plot) return;
  const W = Math.max(320, Math.round(plot.clientWidth)), H = Math.max(220, Math.round(plot.clientHeight));
  bigModel = chartModel(W, H);
  const svg = $d("dkBig");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = chartSvg(bigModel) + '<line id="dkRule" y1="0" y2="0" stroke="var(--muted)" stroke-dasharray="2 3" visibility="hidden"/><rect id="dkBrush" y="0" height="0" fill="var(--accent)" opacity=".15" visibility="hidden"/>';
}

function wireModal() {
  const svg = $d("dkBig"), tip = $d("dkTip");
  let drag = null;
  const px = (e) => { const r = svg.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * bigModel.W, y: ((e.clientY - r.top) / r.height) * bigModel.H, r }; };
  const hover = (e) => {
    const M = bigModel;
    if (!M) return;
    const { x, y, r } = px(e);
    if (x < M.padL || x > M.W - M.padR) { tip.hidden = true; $d("dkRule").setAttribute("visibility", "hidden"); return; }
    const t = M.tAt(x);
    const rule = $d("dkRule");
    rule.setAttribute("x1", x); rule.setAttribute("x2", x); rule.setAttribute("y1", M.padT); rule.setAttribute("y2", M.H - M.padB); rule.setAttribute("visibility", "visible");
    const near = M.fills.map((f) => ({ f, d: Math.hypot(M.x(f.t) - x, M.y(f.y) - y) })).sort((a, b) => a.d - b.d)[0];
    let html = `<div class="dk-note">${esc2(new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" }))}</div>`;
    if (M.g.ours != null) html += `<div>YC <b>${signed(M.g.ours)}</b></div>`;
    for (const v of M.vens) { const val = lineAt(M.series[v], t); if (val != null) html += `<div><span style="color:${VCOL[v]}">●</span> ${VN[v]} <b>${signed(val)}</b></div>`; }
    if (M.g.book != null) html += `<div>Sportsbook <b>${signed(M.g.book)}</b></div>`;
    if (near && near.d < 14) {
      const f = near.f;
      html += `<div style="margin-top:4px;border-top:1px solid var(--line);padding-top:4px"><span class="dk-tag ${f.kind}">${KIND_LABEL[f.kind]}</span> ${esc2(timeStr(f.t))}<br>${VN[f.venue]} · ${esc2(rungLabelFor(M.g, f.venue, f.ticker))}<br>${f.action === "buy" ? "Bought" : "Sold"} at <b>${cents(Number(f.price), f.venue)}¢</b>${f.fair_at_fill != null ? ` · fair ${(f.fair_at_fill * 100).toFixed(1)}¢` : ""}</div>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const left = e.clientX - r.left, top = e.clientY - r.top;
    tip.style.left = Math.min(r.width - tip.offsetWidth - 4, left + 14) + "px";
    tip.style.top = Math.max(0, Math.min(r.height - tip.offsetHeight - 4, top + 14)) + "px";
  };
  svg.addEventListener("pointerdown", (e) => {
    const { x } = px(e);
    drag = { x0: x, x1: x, id: e.pointerId };
    svg.setPointerCapture?.(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    hover(e);
    if (!drag) return;
    drag.x1 = px(e).x;
    const b = $d("dkBrush"), M = bigModel;
    b.setAttribute("x", Math.max(M.padL, Math.min(drag.x0, drag.x1)));
    b.setAttribute("width", Math.abs(drag.x1 - drag.x0));
    b.setAttribute("y", M.padT);
    b.setAttribute("height", M.H - M.padT - M.padB);
    b.setAttribute("visibility", "visible");
  });
  const end = () => {
    if (!drag) return;
    const M = bigModel;
    const a = Math.max(M.padL, Math.min(drag.x0, drag.x1)), b = Math.min(M.W - M.padR, Math.max(drag.x0, drag.x1));
    drag = null;
    if (b - a > 10) { zoom = [M.tAt(a), M.tAt(b)]; renderModal(); }
    else $d("dkBrush")?.setAttribute("visibility", "hidden");
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", () => { drag = null; $d("dkBrush")?.setAttribute("visibility", "hidden"); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !drag) { tip.hidden = true; $d("dkRule")?.setAttribute("visibility", "hidden"); } });
  svg.addEventListener("dblclick", () => { zoom = null; renderModal(); });
}

window.addEventListener("resize", () => { if (modal) drawBig(); });

// ---------- Risk board

function renderRisk() {
  const s = snap;
  if (!s.games.length) { $d("dkRisk").innerHTML = '<p class="dk-empty">No watched games.</p>'; return; }
  const head = `<div class="dk-rrow head" aria-hidden="true"><div>Game</div><div class="ln">Lean</div><div class="u">Loss cap used</div><div class="r">If you're right</div><div class="r">If the market's right</div><div class="r">Status</div></div>`;
  $d("dkRisk").innerHTML = head + s.games.map((g) => {
    const using = Math.max(0, -g.worst);
    const edge = g.ours != null && g.market != null ? Math.abs(g.ours - g.market) : null;
    const tot = Object.values(g.byVenue).reduce((a, b) => a + b, 0);
    const open = expanded.has(g.game_id) || g.game_id === gameId;
    const detail = open ? `<div class="dk-rdetail">
        <span>Contracts by venue</span>
        <span class="dk-bar-split" aria-hidden="true">${tot ? VEN.map((v) => `<span style="width:${((g.byVenue[v] || 0) / tot) * 100}%;background:${VCOL[v]}"></span>`).join("") : ""}</span>
        <span>${VEN.map((v) => `${VS[v]} ${g.byVenue[v] || 0}`).join(" · ")}</span>
        <span>Worst ${fmtUsd(g.worst)} · best ${fmtUsd(g.best)}</span><span>${g.fills} fills · ${g.resting} quotes resting</span></div>` : "";
    return `<div class="dk-rrow ${g.game_id === gameId ? "on" : ""}" data-g="${esc2(g.game_id)}" role="button" tabindex="0" aria-label="Focus ${esc2(g.label)}">
      <div class="g"><b>${esc2(g.label)}</b><small>${g.kickoff ? dayTime(g.kickoff) : "–"}${g.game_id === gameId ? "" : ` · <span data-toggle="${esc2(g.game_id)}" style="text-decoration:underline;cursor:pointer">${open ? "less" : "more"}</span>`}</small></div>
      <div class="ln"><b>${esc2(g.pick === "home" ? g.home : g.away)}</b><small>YC ${signed(g.ours)} · mkt ${signed(g.market)}${edge == null ? "" : ` · ${edge.toFixed(1)} pts`}</small></div>
      <div class="u dk-bar-wrap"><div class="dk-meter" role="meter" aria-valuemin="0" aria-valuemax="${g.cap}" aria-valuenow="${using.toFixed(2)}" aria-label="Loss cap used"><i style="width:${(Math.min(1, g.used) * 100).toFixed(0)}%;background:${usedColor(g.used)}"></i></div><small>Using ${plainUsd(using)} of ${plainUsd(g.cap)} (${Math.round(g.used * 100)}%)</small></div>
      <div class="r ly"><span class="${tone(g.expected)}">${fmtUsd(g.expected)}</span><small>if you're right</small></div>
      <div class="r lm"><span class="${tone(g.marketExpected)}">${fmtUsd(g.marketExpected)}</span><small>if the market's right</small></div>
      <div class="r st"><span class="dk-pill ${g.status.tone}">${esc2(g.status.label)}</span></div>
      ${detail}
    </div>`;
  }).join("");
}

function renderAlerts() {
  $d("dkAlerts").innerHTML = alerts.slice(0, 30).map((a) => `<div class="dk-alert ${a.kind}"><span class="ic">${alertLabel(a.kind)}</span><span>${esc2(a.text)}</span><time>${shortTime(a.t)}</time></div>`).join("")
    || '<p class="dk-note" style="margin:0">No alerts since you opened the desk. You get one for a line move of 1+ pt, a game reaching 80% of its cap, an edge disappearing, or a venue error.</p>';
  $d("dkAlertSub").textContent = `${alerts.length} this session`;
}

// ---------- Activity (blotter of everything the bot does, every game)

function renderActivity() {
  const s = snap;
  const root = $d("dkAct");
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const label = new Map(s.games.map((g) => [g.game_id, g]));
  const bookOk = (r) => act.book === "" || (act.book === "board" ? r.book == null : String(r.book) === act.book);
  const rows = s.activity.filter((r) => (!act.game || r.game_id === act.game) && (!act.venue || r.venue === act.venue) && (!act.type || r.type === act.type)
    && bookOk(r) && (!act.open || r.open) && (!act.today || act.open || ms(r.t) >= midnight.getTime()));
  const scope = s.activity.filter((r) => bookOk(r) && (!act.game || r.game_id === act.game) && (!act.venue || r.venue === act.venue));
  const today = scope.filter((r) => ms(r.t) >= midnight.getTime());
  const openQ = scope.filter((r) => r.open).length;
  const n = (k) => today.filter((r) => r.type === k).length;
  const fees = today.reduce((a, r) => a + (r.fee || 0), 0);
  const opt = (v, l, cur) => `<option value="${esc2(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc2(l)}</option>`;
  const focusKeep = document.activeElement?.closest?.("#dkAct") ? document.activeElement.id : null;
  root.innerHTML = `
    <section class="dk-kpis" aria-label="Activity summary">
      <div class="dk-kpi"><div class="l">Open quotes</div><div class="v">${openQ}</div><div class="d">resting now</div></div>
      <div class="dk-kpi"><div class="l">Fills today · take / make / sell</div><div class="v">${n("take")} / ${n("make")} / ${n("sell")}</div><div class="d">since midnight, your time</div></div>
      <div class="dk-kpi"><div class="l">Fees today</div><div class="v">${plainUsd(fees)}</div><div class="d">each venue's fee model</div></div>
      <div class="dk-kpi"><div class="l">Quotes placed today</div><div class="v">${n("placed")}</div><div class="d">${n("moved")} moved · ${n("cancelled")} cancelled</div></div>
    </section>
    <div class="dk-panel">
      <div class="dk-filters">
        <label>Game <select id="aGame">${opt("", "All games", act.game)}${s.games.map((g) => opt(g.game_id, g.label, act.game)).join("")}</select></label>
        <label>Venue <select id="aVenue">${opt("", "All", act.venue)}${VEN.map((v) => opt(v, VN[v], act.venue)).join("")}</select></label>
        <label>Type <select id="aType">${opt("", "All", act.type)}${["placed", "moved", "cancelled", "make", "take", "sell"].map((t) => opt(t, t === "sell" ? "sell-back" : t === "make" ? "make (quote filled)" : t, act.type)).join("")}</select></label>
        <label>Book <select id="aBook">${opt("", "All books", act.book)}${opt("board", "Board", act.book)}${s.strategies.map((x) => opt(x.id, `Lab · ${x.name}`, act.book)).join("")}</select></label>
        <label><input type="checkbox" id="aOpen" ${act.open ? "checked" : ""}> Open quotes only</label>
        <label><input type="checkbox" id="aToday" ${act.today ? "checked" : ""}> Today only</label>
        <span class="dk-note" style="margin-left:auto">${rows.length} rows</span>
      </div>
      <div class="dk-scroll dk-act-wrap"><table class="dk-act"><thead><tr><th>Time</th><th>Game</th><th>Venue</th><th>Line</th><th>Action</th><th>Price</th><th>Edge vs fair</th><th>Book</th><th>Status</th></tr></thead><tbody>
        ${rows.slice(0, act.limit).map((r) => {
          const g = label.get(r.game_id);
          const line = r.side && g ? lineLabel(r.side === "home" ? g.home : g.away, r.strike) : r.ticker;
          const price = r.type === "moved" && r.prevPrice != null ? `${cents(r.prevPrice, r.venue)} → ${cents(r.price, r.venue)}¢` : `${cents(r.price, r.venue)}¢`;
          return `<tr class="${r.type === "take" || r.type === "make" || r.type === "sell" ? "ourrow" : ""}"><td>${esc2(new Date(r.t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" }))}</td><td class="l">${esc2(g?.label ?? r.game_id)}</td><td><span class="dk-chip ${r.venue}">${VS[r.venue] || r.venue}</span></td><td class="l">${esc2(line)}</td><td class="l"><span class="dk-tag ${r.type}">${KIND_LABEL[r.type]}</span> ${r.action === "buy" ? "Buy" : "Sell"} ${r.count ?? 1}</td><td>${price}</td><td class="${tone(r.edge)}">${fmtC(r.edge)}</td><td>${esc2(bookName(r.book))}</td><td class="${r.open ? "up" : "mut"}">${r.status}</td></tr>`;
        }).join("") || '<tr><td colspan="9" class="mut">Nothing matches these filters.</td></tr>'}
      </tbody></table></div>
      ${rows.length > act.limit ? `<button type="button" class="dk-ctl" id="aMore">Show ${Math.min(200, rows.length - act.limit)} more</button>` : ""}
      <p class="dk-note" style="margin:0">A re-price (cancel and place on the same line in one cycle) shows as one <b>moved</b> row. Edge vs fair = fair − price for buys, price − fair for sells, at the time of the order or fill.</p>
    </div>`;
  if (focusKeep) $d(focusKeep)?.focus();
}

// ---------- In-page confirm (window.confirm is unavailable in some viewers)

function confirmBox(text, ok = "Confirm", danger = false) {
  return new Promise((resolve) => {
    const root = $d("dkConfirmRoot");
    const prev = document.activeElement;
    root.innerHTML = `<div class="dk-scrim"><div class="dk-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dkCText"><p id="dkCText">${esc2(text)}</p><div class="acts"><button type="button" class="dk-ctl" data-c="0">Cancel</button><button type="button" class="dk-ctl ${danger ? "danger" : "on"}" data-c="1">${esc2(ok)}</button></div></div></div>`;
    const done = (v) => { root.innerHTML = ""; document.removeEventListener("keydown", key, true); prev?.focus?.(); resolve(v); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", key, true);
    root.querySelector('[data-c="1"]').focus();
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) done(b.dataset.c === "1"); else if (e.target.classList.contains("dk-scrim")) done(false); }, { once: false });
  });
}

// ---------- Events

pane.addEventListener("click", async (e) => {
  const t = e.target;
  const lk = t.closest("button[data-look]");
  if (lk) return setLook(lk.dataset.look);
  const sb = t.closest("[data-sub]");
  if (sb) { sub = sb.dataset.sub; render(); return; }
  const rg = t.closest("[data-range]");
  if (rg) return setRange(rg.dataset.range);
  if (t.closest("#dkExpand")) return openModal();
  if (t.closest("#dkSound")) { sound = !sound; ls.set("ycprDeskSound", sound ? "on" : "off"); if (sound) beep(660); renderBar(); return; }
  if (t.closest("#dkKill")) {
    const on = !snap?.state?.kill_switch;
    const yes = await confirmBox(on ? "Turn the kill switch on? The bot cancels every resting order on its next run and stops quoting until you turn it off." : "Turn the kill switch off? The bot starts quoting again on its next run.", on ? "Turn kill switch on" : "Resume trading", on);
    if (!yes) return;
    try { await api("/api/admin", { action: "kill", on }); } catch (err) { pushAlert("error", `Kill switch: ${err.message}`, null); }
    feed?.refresh(); load();
    return;
  }
  if (t.closest("#dkPause")) {
    const g = snap?.game;
    if (!g) return;
    const yes = await confirmBox(g.enabled ? `Pause ${g.away} @ ${g.home}? The bot cancels this game's quotes on its next run and adds no new risk. Positions are held.` : `Resume ${g.away} @ ${g.home}? The bot quotes it again from the next run.`, g.enabled ? "Pause game" : "Resume game", g.enabled);
    if (!yes) return;
    try { await api("/api/admin", { action: "updateWatch", id: g.id, enabled: !g.enabled }); } catch (err) { pushAlert("error", `Pause: ${err.message}`, null); }
    feed?.refresh(); load();
    return;
  }
  const tg = t.closest("[data-toggle]");
  if (tg) { e.stopPropagation(); const id = tg.dataset.toggle; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderRisk(); return; }
  const row = t.closest(".dk-rrow[data-g]");
  if (row) return focusGame(row.dataset.g);
  if (t.id === "aMore") { act.limit += 200; renderActivity(); }
});
pane.addEventListener("keydown", (e) => {
  const row = e.target.closest?.(".dk-rrow[data-g]");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); focusGame(row.dataset.g); }
});
pane.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "dkGame") return focusGame(t.value);
  if (t.id === "dkBook") { book = t.value === "" ? null : Number(t.value); feed?.setBook(book); return; }
  const map = { aGame: "game", aVenue: "venue", aType: "type", aBook: "book" };
  if (map[t.id]) { act[map[t.id]] = t.value; act.limit = 200; renderActivity(); }
  if (t.id === "aOpen") { act.open = t.checked; renderActivity(); }
  if (t.id === "aToday") { act.today = t.checked; renderActivity(); }
});
$d("dkModalRoot").addEventListener("click", (e) => {
  const rg = e.target.closest("[data-range]");
  if (rg) return setRange(rg.dataset.range);
  if (e.target.closest("#dkReset")) { zoom = null; renderModal(); }
  if (e.target.closest("#dkClose")) closeModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal && !$d("dkConfirmRoot").firstChild) closeModal(); });

function focusGame(id) {
  if (!id || id === gameId) return;
  gameId = id;
  ls.set("ycprDeskGame", id);
  lastCell.clear();
  feed?.setGame(id);
  if (snap) { snap = { ...snap, game: null, ladder: [], tape: [], fills: [], quotes: [], lines: [] }; render(); }
  window.scrollTo?.({ top: 0, behavior: "smooth" });
}

function setRange(r) {
  if (!RANGES.includes(r)) return;
  range = r;
  zoom = null;
  ls.set("ycprDeskRange", r);
  feed?.setRange(r);
  if (snap) render();
}

// app.js may have shown the Live desk before this module loaded.
if (typeof view !== "undefined" && view === "live") show(true);
