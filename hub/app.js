// YCPR Bot dashboard. Reads /api/data, writes via /api/admin, refreshes every 30s.
let PW = "";
try { PW = localStorage.getItem("botpw") || ""; } catch {}
let data = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const c = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "¢");
const usd = (x) => (x == null ? "–" : (x < 0 ? "−$" : "$") + Math.abs(x).toFixed(2));
const cls = (x) => (x == null ? "" : x > 0 ? "good" : x < 0 ? "bad" : "");
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "–");
const signed = (x) => (x == null || !Number.isFinite(x) ? "–" : x === 0 ? "PK" : (x < 0 ? "−" : "+") + Math.abs(x).toFixed(1));
// Away orientation, like the site: away spread, negative = away favored.
// Internally the bot stores a home margin (home − away), which is the same number.
const ourAway = (w) => num(w.my_home_margin) ?? num(w.ycpr_home_margin);
function num(v) { return v == null || v === "" ? null : Number(v); }
const marketAway = (g) => (g?.home_spread == null ? null : -g.home_spread);
// Our number favors the pick only if it's better for the pick than the market's.
function favorsPick(pick, oursAway, mktAway) {
  if (oursAway == null || mktAway == null) return true;
  return pick === "home" ? oursAway > mktAway : oursAway < mktAway;
}
function noEdgeWarning(w, upcoming) {
  const g = upcoming.find((x) => String(x.id) === String(w.game_id));
  if (!g || favorsPick(w.pick, ourAway(w), marketAway(g))) return "";
  const team = w.pick === "home" ? w.home_team : w.away_team;
  return `<p class="warn">Your number (${esc(w.away_team)} ${signed(ourAway(w))}) isn't better for ${esc(team)} than the market (${esc(w.away_team)} ${signed(marketAway(g))}), so the bot won't add exposure on this game.</p>`;
}

// Home margin (home − away) → "Air Force by 8–10" / "Wyoming by 25+".
function marginLabel(w, from, to, limit = 60) {
  const team = from < 0 ? w.away_team : w.home_team;
  const a = Math.abs(from), b = Math.abs(to);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi >= limit) return `${esc(team)} by ${lo}+`;
  return lo === hi ? `${esc(team)} by ${lo}` : `${esc(team)} by ${lo}–${hi}`;
}

function outcomeTable(w, o) {
  if (!o || !o.ranges?.length) return "";
  const hasMkt = o.market != null;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const rows = o.ranges.map((r) => {
    const diff = hasMkt ? r.prob - r.marketProb : null;
    return `<tr><td>${marginLabel(w, r.from, r.to)}</td><td class="${cls(r.pnl)}">${usd(r.pnl)}</td><td>${pct(r.prob)}</td>${
      hasMkt ? `<td>${pct(r.marketProb)}</td><td class="${cls(diff)}">${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff * 100).toFixed(1)}</td>` : ""
    }</tr>`;
  }).join("");
  const head = `<tr><th>If the game ends</th><th>You win / lose</th><th>Chance (yours)</th>${hasMkt ? "<th>Chance (Kalshi)</th><th>Yours − Kalshi (pts)</th>" : ""}</tr>`;
  const exp = `Expected by your number (${esc(w.away_team)} ${signed(o.center)}): <b class="${cls(o.expected)}">${usd(o.expected)}</b>` +
    (hasMkt ? ` · by Kalshi's (${esc(w.away_team)} ${signed(o.market)}): <b class="${cls(o.marketExpected)}">${usd(o.marketExpected)}</b>` : "");
  return `<details open><summary>Win / loss by final margin</summary>
    <div class="scroll"><table>${head}${rows}</table></div>
    <p class="muted" style="margin:4px 0 0">After fees, held to settlement. ${exp}.${hasMkt ? " Kalshi's chances use the margin its whole ladder implies (fitted to the mid prices)." : ""}</p></details>`;
}

function trustRow(w, defTrust) {
  const own = num(w.ycpr_weight);
  const v = Math.round((own ?? defTrust) * 100);
  return `<div class="trustRow"><span class="muted">Trust</span>
    <input type="range" min="0" max="100" step="5" value="${v}" data-trust="${w.id}" ${own == null ? "disabled" : ""} aria-label="Trust for this game">
    <b>${v}%</b>
    <label><input type="checkbox" data-trust-default="${w.id}" ${own == null ? "checked" : ""}> Use default (${Math.round(defTrust * 100)}%)</label></div>`;
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

// Kalshi ticker suffix → "OKST over 7.5" (…-OKST8 means wins by over 7.5).
function rungLabel(ticker) {
  const m = /-([A-Z]+?)(\d+)$/.exec(ticker || "");
  return m ? `${m[1]} over ${Number(m[2]) - 0.5}` : ticker;
}

function positions(fills) {
  const m = new Map();
  for (const f of fills) {
    const p = m.get(f.ticker) || { ticker: f.ticker, side: f.side, strike: Number(f.strike), yes: 0, cost: 0, fees: 0 };
    const d = f.action === "buy" ? f.count : -f.count;
    p.yes += d; p.cost += d * Number(f.price); p.fees += Number(f.fee);
    m.set(f.ticker, p);
  }
  return [...m.values()];
}

function pnlCurve(pos, lo = -35, hi = 35) {
  const pts = [];
  for (let m = lo; m <= hi; m++) {
    if (m === 0) continue;
    let v = 0;
    for (const p of pos) v += p.yes * ((p.side === "home" ? m : -m) > p.strike ? 1 : 0) - p.cost - p.fees;
    pts.push({ m, v });
  }
  return pts;
}

function curveSvg(pts) {
  if (!pts.length || pts.every((p) => Math.abs(p.v) < 1e-9)) return '<p class="muted">No position yet.</p>';
  const W = 640, H = 110, pad = 14;
  const max = Math.max(...pts.map((p) => Math.abs(p.v)), 0.01);
  const bw = (W - 2 * pad) / pts.length;
  const y0 = H / 2;
  const bars = pts.map((p, i) => {
    const h = (Math.abs(p.v) / max) * (H / 2 - pad);
    const y = p.v >= 0 ? y0 - h : y0;
    return `<rect x="${pad + i * bw}" y="${y}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${p.v >= 0 ? "var(--good)" : "var(--bad)"}"><title>Home by ${p.m}: ${usd(p.v)}</title></rect>`;
  }).join("");
  const ticks = [-28, -21, -14, -7, -3, 3, 7, 14, 21, 28].map((m) => {
    const i = pts.findIndex((p) => p.m === m);
    return i < 0 ? "" : `<text x="${pad + i * bw + bw / 2}" y="${H - 1}" text-anchor="middle">${m > 0 ? "H" : "A"}${Math.abs(m)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profit or loss by final margin"><line x1="${pad}" x2="${W - pad}" y1="${y0}" y2="${y0}" stroke="var(--line)"/>${bars}${ticks}</svg>
    <p class="muted" style="margin:2px 0 0">P&amp;L by final margin (A7 = away wins by 7, H7 = home wins by 7), after fees, if held to settlement.</p>`;
}

function render() {
  const { state, watchlist, orders, fills, snapshots, runs, upcoming, outcomes = {} } = data;
  const defTrust = num(state?.default_ycpr_weight) ?? 1;
  if (document.activeElement !== $("trustDefault")) $("trustDefault").value = Math.round(defTrust * 100);
  $("trustDefaultVal").textContent = Math.round(defTrust * 100) + "%";
  $("modeChip").textContent = `Mode: ${state?.mode || "?"}`;
  $("killBtn").textContent = state?.kill_switch ? "Kill switch ON — resume" : "Kill switch";
  $("killBtn").className = state?.kill_switch ? "danger" : "";
  const last = runs?.[0];
  $("runInfo").innerHTML = last ? `Last run ${when(last.started_at)}${last.error ? ' · <span class="bad">error</span>' : ""}` : "No runs yet";

  const snapBy = new Map(snapshots.map((s) => [s.ticker, s]));
  $("games").innerHTML = watchlist.length ? "" : '<div class="card muted">No games on the watchlist yet. Add one below.</div>';
  for (const w of watchlist) {
    const gFills = fills.filter((f) => f.game_id === w.game_id);
    const gOrders = orders.filter((o) => o.game_id === w.game_id);
    const pos = positions(gFills);
    const curve = pnlCurve(pos);
    const worst = curve.length ? Math.min(...curve.map((p) => p.v)) : 0;
    const best = curve.length ? Math.max(...curve.map((p) => p.v)) : 0;
    const settled = gFills.filter((f) => f.result != null);
    const settledPnl = settled.reduce((s, f) => s + (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee, 0);
    const pickTeam = w.pick === "home" ? w.home_team : w.away_team;
    const tickers = [...new Set([...snapshots.filter((s) => s.game_id === w.game_id).map((s) => s.ticker), ...pos.map((p) => p.ticker)])]
      .sort((a, b) => (snapBy.get(b)?.fair ?? 0) - (snapBy.get(a)?.fair ?? 0));
    const rows = tickers.map((t) => {
      const s = snapBy.get(t) || {};
      const mid = s.bid != null && s.ask != null ? (Number(s.bid) + Number(s.ask)) / 2 : null;
      const p = pos.find((x) => x.ticker === t);
      const mine = gOrders.filter((o) => o.ticker === t).map((o) => `${o.action === "buy" ? "bid" : "ask"} ${c(Number(o.price), 0)}`).join(", ");
      const edge = s.fair != null && mid != null ? Number(s.fair) - mid : null;
      return `<tr><td>${esc(rungLabel(t))}</td><td>${c(s.bid, 0)} / ${c(s.ask, 0)}</td><td>${c(s.fair)}</td><td class="${cls(edge)}">${c(edge)}</td><td>${esc(mine) || '<span class="muted">–</span>'}</td><td>${p && p.yes ? (p.yes > 0 ? "+" : "") + p.yes + " YES" : "–"}</td></tr>`;
    }).join("");
    const el = document.createElement("div");
    el.className = "card";
    el.style.marginBottom = "16px";
    el.innerHTML = `
      <div class="row"><h2 style="margin:0">${esc(w.away_team)} @ ${esc(w.home_team)}</h2>
        <span class="chip">${w.enabled ? "Active" : "Off"}</span><span class="muted">${when(w.kickoff)}</span></div>
      ${noEdgeWarning(w, upcoming)}
      <div class="stats">
        <div class="stat"><span class="muted">Lean</span><b>${esc(pickTeam)}</b></div>
        <div class="stat"><span class="muted">${w.my_home_margin != null ? "Your line (override)" : "YC line"}</span><b>${esc(w.away_team)} ${signed(ourAway(w))}</b></div>
        <div class="stat"><span class="muted">Market</span><b>${(() => { const g = upcoming.find((x) => String(x.id) === String(w.game_id)); return g ? esc(w.away_team) + " " + signed(marketAway(g)) : "–"; })()}</b></div>
        <div class="stat"><span class="muted">Worst / best</span><b><span class="${cls(worst)}">${usd(worst)}</span> / <span class="${cls(best)}">${usd(best)}</span></b></div>
        <div class="stat"><span class="muted">Max loss cap</span><b>${usd(Number(w.max_worst_case_loss))}</b></div>
        <div class="stat"><span class="muted">Resting / fills</span><b>${gOrders.length} / ${gFills.length}</b></div>
        <div class="stat"><span class="muted">Settled P&amp;L</span><b class="${cls(settledPnl)}">${settled.length ? usd(settledPnl) : "–"}</b></div>
      </div>
      ${curveSvg(curve)}
      ${outcomeTable(w, outcomes[w.game_id])}
      ${trustRow(w, defTrust)}
      <details ${rows ? "" : "hidden"}><summary>Ladder (${tickers.length} numbers)</summary>
        <div class="scroll"><table><tr><th>Number (YES)</th><th>Book bid / ask</th><th>Fair</th><th>Fair − mid</th><th>Our orders</th><th>Position</th></tr>${rows}</table></div>
      </details>
      <div class="row" style="margin-top:8px">
        <button data-act="toggle" data-id="${w.id}" data-on="${w.enabled ? 0 : 1}">${w.enabled ? "Turn off" : "Turn on"}</button>
        <span class="muted">Edges ${c(Number(w.pro_edge), 0)} / ${c(Number(w.anti_edge), 0)} / take ${c(Number(w.take_edge), 0)} · ${w.per_rung_cap} per number${w.profit_target != null ? ` · target ${usd(Number(w.profit_target))}` : ""}</span>
      </div>`;
    $("games").appendChild(el);
  }

  // Add-game form.
  const sel = $("addGame");
  const keep = sel.value;
  sel.innerHTML = upcoming.map((g) => `<option value="${esc(g.id)}">${esc(g.away_team)} @ ${esc(g.home_team)} · ${when(g.start_date)} · YC ${signed(g.yc_away_spread)} · Mkt ${signed(marketAway(g))}</option>`).join("");
  if (keep) sel.value = keep;
  updatePick();

  // Fills.
  const gameName = new Map(watchlist.map((w) => [w.game_id, `${w.away_team} @ ${w.home_team}`]));
  $("fills").innerHTML = `<tr><th>When</th><th>Game</th><th>Number</th><th>Side</th><th>Price</th><th>Fee</th><th>Fair</th><th>CLV</th><th>Result</th><th>P&amp;L</th></tr>` +
    (fills.length ? fills.map((f) => {
      const clv = f.close_mid == null ? null : f.action === "buy" ? f.close_mid - f.price : f.price - f.close_mid;
      const pnl = f.result == null ? null : (f.action === "buy" ? f.count * (f.result - f.price) : f.count * (f.price - f.result)) - f.fee;
      return `<tr><td>${when(f.filled_at)}</td><td>${esc(gameName.get(f.game_id) || f.game_id)}</td><td>${esc(rungLabel(f.ticker))}</td><td>${f.action === "buy" ? "Buy" : "Sell"} ${f.count}</td><td>${c(Number(f.price), 0)}</td><td>${c(Number(f.fee), 2)}</td><td>${c(f.fair_at_fill)}</td><td class="${cls(clv)}">${c(clv)}</td><td>${f.result == null ? "–" : f.result ? "YES" : "NO"}</td><td class="${cls(pnl)}">${usd(pnl)}</td></tr>`;
    }).join("") : '<tr><td colspan="10" class="muted">No fills yet.</td></tr>');

  $("runs").innerHTML = `<tr><th>Started</th><th>Games</th><th>Placed</th><th>Cancelled</th><th>Fills</th><th>Status</th></tr>` +
    (runs.length ? runs.map((r) => `<tr><td>${when(r.started_at)}</td><td>${r.games ?? "–"}</td><td>${r.orders_placed ?? "–"}</td><td>${r.orders_cancelled ?? "–"}</td><td>${r.fills ?? "–"}</td><td class="${r.error ? "bad" : ""}">${r.error ? esc(r.error.slice(0, 80)) : r.finished_at ? "ok" : "running"}</td></tr>`).join("") : '<tr><td colspan="6" class="muted">The bot has not run yet.</td></tr>');
}

function updatePick(gameChanged = false) {
  const g = data?.upcoming.find((x) => String(x.id) === $("addGame").value);
  const cur = $("addPick").value;
  $("addPick").innerHTML = g ? `<option value="away">${esc(g.away_team)} (away)</option><option value="home">${esc(g.home_team)} (home)</option>` : "";
  if (!g) return;
  $("addYc").value = g.yc_away_spread == null ? "no rating" : `${g.away_team} ${signed(g.yc_away_spread)}`;
  const ours = num($("addOverride").value) ?? g.yc_away_spread;
  const mkt = marketAway(g);
  if (gameChanged || !cur) $("addPick").value = ours != null && mkt != null && ours > mkt ? "home" : "away";
  else $("addPick").value = cur;
}

async function load() {
  // Don't redraw under someone mid-drag on a slider.
  if (document.activeElement?.matches?.('input[type="range"]')) return;
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

$("gateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  PW = $("pw").value;
  try { localStorage.setItem("botpw", PW); } catch {}
  load();
});
$("addGame").addEventListener("change", () => updatePick(true));
$("addOverride").addEventListener("change", () => updatePick(true));
$("killBtn").addEventListener("click", async () => {
  const on = !data.state?.kill_switch;
  if (on && !confirm("Turn the kill switch on? The bot cancels all resting orders on its next run and stops quoting.")) return;
  await api("/api/admin", { action: "kill", on }).catch((e) => alert(e.message));
  load();
});
$("trustDefault").addEventListener("input", () => { $("trustDefaultVal").textContent = $("trustDefault").value + "%"; });
$("trustDefault").addEventListener("change", async () => {
  await api("/api/admin", { action: "defaultTrust", value: Number($("trustDefault").value) / 100 }).catch((e) => alert(e.message));
  load();
});
$("games").addEventListener("input", (e) => {
  const r = e.target.closest("input[data-trust]");
  if (r) r.nextElementSibling.textContent = r.value + "%";
});
$("games").addEventListener("change", async (e) => {
  const slider = e.target.closest("input[data-trust]");
  const box = e.target.closest("input[data-trust-default]");
  if (slider) {
    await api("/api/admin", { action: "updateWatch", id: Number(slider.dataset.trust), ycpr_weight: Number(slider.value) / 100 }).catch((err) => alert(err.message));
  } else if (box) {
    const id = Number(box.dataset.trustDefault);
    const r = document.querySelector(`input[data-trust="${id}"]`);
    // Checked = follow the default (null); unchecked = keep the slider's value as this game's own setting.
    await api("/api/admin", { action: "updateWatch", id, ycpr_weight: box.checked ? null : Number(r.value) / 100 }).catch((err) => alert(err.message));
  } else return;
  load();
});
$("games").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  await api("/api/admin", { action: "updateWatch", id: Number(b.dataset.id), enabled: b.dataset.on === "1" }).catch((err) => alert(err.message));
  load();
});
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pick = $("addPick").value;
  const override = num($("addOverride").value); // away spread, or null to use YC
  const g = data.upcoming.find((x) => String(x.id) === $("addGame").value);
  const ours = override ?? g?.yc_away_spread ?? null;
  if (ours == null) return alert("No YC number for this game; enter an override away spread.");
  if (g && !favorsPick(pick, ours, marketAway(g))) {
    const team = pick === "home" ? g.home_team : g.away_team;
    if (!confirm(`Your number (${g.away_team} ${signed(ours)}) isn't better for ${team} than the market (${g.away_team} ${signed(marketAway(g))}). The bot won't add exposure unless it is. Save anyway?`)) return;
  }
  const cents = (id) => Number($(id).value) / 100;
  try {
    await api("/api/admin", {
      action: "addWatch",
      game_id: $("addGame").value,
      pick,
      my_home_margin: override, // away spread == home margin; null = follow YC
      ycpr_weight: $("addTrust").value === "" ? null : Number($("addTrust").value), // "" = follow the default
      max_worst_case_loss: Number($("addMax").value),
      per_rung_cap: Number($("addCap").value),
      profit_target: $("addTarget").value === "" ? null : Number($("addTarget").value),
      pro_edge: cents("addPro"), anti_edge: cents("addAnti"), take_edge: cents("addTake"), edge_step: cents("addStep"),
      stop_minutes_before: Number($("addStop").value),
      enabled: true,
    });
    $("addMsg").textContent = "Saved. The bot picks it up on its next run (within ~10 min).";
    load();
  } catch (err) {
    $("addMsg").textContent = err.message;
  }
});

if (PW) load(); else showGate();
setInterval(() => { if (PW && !document.hidden) load(); }, 30000);
