import { useMemo, useRef, useState } from "react";
import { fetchPulledTargets, pullBookSpreads, saveBookSnapshots, type SpreadPull } from "../../lib/api/bookSnapshots";
import { DEFAULT_SLOT_IDS, SNAPSHOT_SLOTS, matchEvents, slotTargetMs, weekAnchors } from "../../lib/drogba/openers";
import type { DGame } from "../../lib/drogba/dataset";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P, f1, sgn } from "./shared";

const BOOK = "fanduel";
const DAY = 86_400_000;
const CREDITS_PER_SNAPSHOT = 10; // 1 market x 1 bookmaker, historical endpoint
const ALL_SEASONS = [2026, 2025, 2024, 2023, 2022, 2021];

interface PullSummary {
  events: number;
  withLine: number;
  matched: number;
  unmatched: number;
  snapshotAt: string | null;
  remaining: string | null;
  last: string | null;
  compare: { game: string; fd: number; bov: number | null }[];
}

const etTime = (ms: number | null) =>
  ms == null ? "TBD" : new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function DrogbaFanDuelSection({ state }: { state: DrogbaState }) {
  const [testSeason, setTestSeason] = useState(2025);
  const [testWeek, setTestWeek] = useState(6);
  const [testSlot, setTestSlot] = useState("sun-10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PullSummary | null>(null);

  const [seasons, setSeasons] = useState<Record<number, boolean>>({ 2021: true, 2022: true, 2023: true, 2024: true, 2025: true, 2026: true });
  const [slots, setSlots] = useState<Record<string, boolean>>(Object.fromEntries(SNAPSHOT_SLOTS.map((s) => [s.id, DEFAULT_SLOT_IDS.includes(s.id)])));
  const [firstWeek, setFirstWeek] = useState(1);
  const [lastWeek, setLastWeek] = useState(15);
  const [cap, setCap] = useState(1500);
  const [reserve, setReserve] = useState(2000);
  const [log, setLog] = useState<string[]>([]);
  const [planned, setPlanned] = useState<number | null>(null);
  const stop = useRef(false);

  const anchors = useMemo(() => weekAnchors(state.games), [state.games]);

  // FBS-vs-FBS games grouped by season/week, with which ones have no FanDuel open on file. Only weeks whose
  // Sunday-morning window has already passed count.
  const weeks = useMemo(() => {
    const now = Date.now();
    const m = new Map<string, { season: number; week: number; games: DGame[]; missing: DGame[] }>();
    for (const g of state.games) {
      if (!g.homeFbs || !g.awayFbs) continue;
      const anchor = anchors.get(`${g.season}|${g.week}`);
      if (anchor == null || anchor - 6 * DAY + 16 * 3_600_000 > now) continue;
      const key = `${g.season}|${g.week}`;
      const w = m.get(key) ?? { season: g.season, week: g.week, games: [], missing: [] };
      w.games.push(g);
      if (!state.fanduelLines.has(g.id)) w.missing.push(g);
      m.set(key, w);
    }
    return Array.from(m.values()).sort((a, b) => a.season - b.season || a.week - b.week);
  }, [state.games, state.fanduelLines, anchors]);

  const bySeason = useMemo(() => {
    const out = new Map<number, { games: number; missing: number; weeks: typeof weeks }>();
    for (const w of weeks) {
      const s = out.get(w.season) ?? { games: 0, missing: 0, weeks: [] };
      s.games += w.games.length;
      s.missing += w.missing.length;
      s.weeks.push(w);
      out.set(w.season, s);
    }
    return Array.from(out.entries()).sort((a, b) => b[0] - a[0]);
  }, [weeks]);

  // How many games had their FanDuel open first seen at each Eastern hour (everything before 6am and after 4pm is grouped).
  const firstSeen = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const w of weeks) {
      for (const g of w.games) {
        const f = state.fanduelLines.get(g.id);
        if (!f) continue;
        // Snapshots land a few minutes before their target time (5:55 for a 6:00 slot), so round to the nearest hour.
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(f.openAt));
        const h0 = Number(parts.find((p) => p.type === "hour")?.value) % 24;
        const m0 = Number(parts.find((p) => p.type === "minute")?.value);
        const hour = (h0 + (m0 >= 30 ? 1 : 0)) % 24;
        const label = hour < 6 ? "Before 6am" : hour > 16 ? "After 4pm" : `${hour === 12 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"} hour`;
        counts.set(label, (counts.get(label) ?? 0) + 1);
        total++;
      }
    }
    const order = ["Before 6am", "6am hour", "7am hour", "8am hour", "9am hour", "10am hour", "11am hour", "12pm hour", "1pm hour", "2pm hour", "3pm hour", "4pm hour", "After 4pm"];
    return { rows: order.filter((l) => counts.has(l)).map((l) => ({ label: l, n: counts.get(l)! })), total };
  }, [weeks, state.fanduelLines]);

  // One snapshot: pull, match to our games, save the rows and log the call.
  async function pullOne(targetMs: number | null, season: number | null, week: number | null): Promise<{ pull: SpreadPull; summary: PullSummary; matchedIds: string[]; snapMs: number }> {
    const pull = await pullBookSpreads(BOOK, targetMs == null ? null : new Date(targetMs).toISOString());
    const snapAt = pull.timestamp ?? new Date().toISOString();
    const snapMs = Date.parse(snapAt);
    const candidates = state.games.filter((g) => g.startMs != null && g.startMs >= snapMs - DAY && g.startMs <= snapMs + 21 * DAY && (season == null || g.season === season));
    const { matched, unmatched } = matchEvents(pull.events, candidates);
    const rows = matched.map((m) => ({
      game_id: m.game.id,
      book: BOOK,
      snapshot_at: snapAt,
      season: m.game.season,
      week: m.game.week,
      home_spread: m.homeSpread,
      home_price: m.homePrice,
      away_price: m.awayPrice,
      is_historical: targetMs != null,
    }));
    await saveBookSnapshots(rows, {
      book: BOOK,
      target_at: new Date(targetMs ?? snapMs).toISOString(),
      snapshot_at: snapAt,
      season,
      week,
      events: pull.totalEvents,
      matched: matched.length,
      credits_last: pull.quota.last,
      credits_remaining: pull.quota.remaining,
    });
    const compare = matched
      .filter((m) => week == null || m.game.week === week)
      .map((m) => ({ game: `${m.game.away} @ ${m.game.home}`, fd: m.homeSpread, bov: state.bovadaOpen.get(m.game.id) ?? null }));
    return {
      pull,
      matchedIds: matched.map((m) => m.game.id),
      snapMs,
      summary: { events: pull.totalEvents, withLine: pull.events.length, matched: matched.length, unmatched: unmatched.length, snapshotAt: snapAt, remaining: pull.quota.remaining, last: pull.quota.last, compare },
    };
  }

  async function runTest() {
    setBusy(true);
    setError(null);
    setMsg(null);
    setSummary(null);
    try {
      const anchor = anchors.get(`${testSeason}|${testWeek}`);
      if (anchor == null) throw new Error(`No games found for ${testSeason} week ${testWeek}`);
      const slot = SNAPSHOT_SLOTS.find((s) => s.id === testSlot)!;
      const { summary: s } = await pullOne(slotTargetMs(anchor, slot), testSeason, testWeek);
      setSummary(s);
      state.reload();
    } catch (e: any) {
      setError(e?.message ?? "Test pull failed");
    } finally {
      setBusy(false);
    }
  }

  async function runLive() {
    setBusy(true);
    setError(null);
    setMsg(null);
    setSummary(null);
    try {
      const { summary: s } = await pullOne(null, null, null);
      setSummary(s);
      setMsg("Saved FanDuel's current lines as a new snapshot.");
      state.reload();
    } catch (e: any) {
      setError(e?.message ?? "Live pull failed");
    } finally {
      setBusy(false);
    }
  }

  const picked = (w: { season: number; week: number }) => seasons[w.season] && w.week >= firstWeek && w.week <= lastWeek;

  // Upper bound on what filling the gaps would cost: every not-yet-pulled Sunday slot in every week that has a gap.
  async function countRemaining() {
    setBusy(true);
    setError(null);
    try {
      const done = await fetchPulledTargets(BOOK);
      const now = Date.now();
      let n = 0;
      for (const w of weeks) {
        if (!picked(w) || w.missing.length === 0) continue;
        const anchor = anchors.get(`${w.season}|${w.week}`)!;
        for (const slot of SNAPSHOT_SLOTS) {
          if (!slots[slot.id]) continue;
          const t = slotTargetMs(anchor, slot);
          if (t <= now && !done.has(t)) n++;
        }
      }
      setPlanned(n);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't read the pull log");
    } finally {
      setBusy(false);
    }
  }

  // For each week with at least one game missing, pull the Sunday slots that haven't been pulled yet, earliest first,
  // and stop that week as soon as every FBS game has a FanDuel line.
  async function runFill() {
    stop.current = false;
    setBusy(true);
    setError(null);
    setMsg(null);
    setLog([]);
    const add = (l: string) => setLog((x) => [...x, l]);
    try {
      const done = await fetchPulledTargets(BOOK);
      const covered = new Set(state.fanduelLines.keys());
      const now = Date.now();
      let spent = 0;
      let remaining: number | null = null;
      let halted = false;
      for (const w of weeks) {
        if (halted || stop.current) break;
        if (!picked(w) || w.games.every((g) => covered.has(g.id))) continue;
        const anchor = anchors.get(`${w.season}|${w.week}`)!;
        const windowStart = anchor - 6 * DAY;
        for (const slot of SNAPSHOT_SLOTS) {
          if (!slots[slot.id]) continue;
          if (w.games.every((g) => covered.has(g.id))) break;
          const t = slotTargetMs(anchor, slot);
          if (t > now || done.has(t)) continue;
          if (stop.current) {
            add("Stopped.");
            halted = true;
            break;
          }
          if (spent + CREDITS_PER_SNAPSHOT > cap) {
            add(`Stopped: the next snapshot would pass this run's ${cap}-credit cap (spent ${spent}).`);
            halted = true;
            break;
          }
          if (remaining != null && remaining - CREDITS_PER_SNAPSHOT < reserve) {
            add(`Stopped: ${remaining} credits left; keeping at least ${reserve} in reserve.`);
            halted = true;
            break;
          }
          const r = await pullOne(t, w.season, w.week);
          done.add(t);
          spent += Number(r.summary.last ?? CREDITS_PER_SNAPSHOT) || CREDITS_PER_SNAPSHOT;
          remaining = r.summary.remaining == null ? remaining : Number(r.summary.remaining);
          if (r.snapMs >= windowStart) for (const id of r.matchedIds) covered.add(id);
          const stillMissing = w.games.filter((g) => !covered.has(g.id)).length;
          add(`${w.season} wk ${w.week} ${slot.label}: ${r.summary.withLine} FanDuel lines, ${r.summary.matched} matched, ${stillMissing} of ${w.games.length} games still missing (credits left ${r.summary.remaining ?? "?"})`);
        }
      }
      add(`Done. ~${spent} credits spent. Reloading ratings…`);
      state.reload();
    } catch (e: any) {
      setError(e?.message ?? "Fill failed");
    } finally {
      setBusy(false);
    }
  }

  const slotCount = SNAPSHOT_SLOTS.filter((s) => slots[s.id]).length;
  const cmp = summary?.compare.filter((c) => c.bov != null) ?? [];
  const same = cmp.filter((c) => c.fd === c.bov).length;
  const avgAbs = cmp.length ? cmp.reduce((a, c) => a + Math.abs(c.fd - c.bov!), 0) / cmp.length : null;
  const avgSigned = cmp.length ? cmp.reduce((a, c) => a + (c.fd - c.bov!), 0) / cmp.length : null;

  return (
    <div>
      <h3 style={H3}>FanDuel openers (The Odds API)</h3>
      <p style={P}>
        FanDuel is DROGBA's default "open"; the closing line is Bovada's (it exists for every game). Each pull takes one snapshot of FanDuel's spread for every game as of a timestamp — about {CREDITS_PER_SNAPSHOT} credits per snapshot, not per game. A game's
        FanDuel open is its earliest snapshot from the Sunday of its week on. Everything here is manual and credit-capped.
        {state.fanduelGames > 0 ? ` FanDuel lines are on file for ${state.fanduelGames} games.` : " Nothing is stored yet."}
      </p>

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>Coverage: FBS-vs-FBS games with no FanDuel open on file</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>Season</th>
              <th style={NUM}>Games</th>
              <th style={NUM}>With FanDuel open</th>
              <th style={NUM}>Missing</th>
            </tr>
          </thead>
          <tbody>
            {bySeason.map(([season, s]) => (
              <tr key={season}>
                <td style={CELL}>{season}</td>
                <td style={NUM}>{s.games}</td>
                <td style={NUM}>{s.games - s.missing} ({s.games ? Math.round((100 * (s.games - s.missing)) / s.games) : 0}%)</td>
                <td style={NUM}>{s.missing}</td>
              </tr>
            ))}
            {bySeason.length === 0 && (
              <tr>
                <td style={CELL} colSpan={4}>{state.loading || state.building ? "Loading…" : "No games"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {bySeason.map(([season, s]) => (
        <details key={season} style={{ marginTop: "0.4rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.82rem" }}>
            {season}: {s.missing} missing games across {s.weeks.filter((w) => w.missing.length > 0).length} weeks
          </summary>
          {s.weeks
            .filter((w) => w.missing.length > 0)
            .map((w) => (
              <details key={w.week} style={{ marginLeft: "1rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>
                  Week {w.week}: {w.missing.length} of {w.games.length} missing
                </summary>
                <ul style={{ fontSize: "0.78rem", margin: "0.2rem 0 0.4rem 1rem" }}>
                  {w.missing.map((g) => (
                    <li key={g.id}>{g.away} @ {g.home} — {etTime(g.startMs)} ET</li>
                  ))}
                </ul>
              </details>
            ))}
        </details>
      ))}

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>When FanDuel's open was first seen (Eastern time, Sunday)</h3>
      <p style={DIM}>Each game's FanDuel open is the earliest snapshot we have. This shows which looks are doing the work, so you can tell whether a later one is worth pulling.</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={CELL}>First seen at</th>
              <th style={NUM}>Games</th>
              <th style={NUM}>Share</th>
            </tr>
          </thead>
          <tbody>
            {firstSeen.rows.map((r) => (
              <tr key={r.label}>
                <td style={CELL}>{r.label}</td>
                <td style={NUM}>{r.n}</td>
                <td style={NUM}>{firstSeen.total ? Math.round((100 * r.n) / firstSeen.total) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>1. Fill the gaps (Sunday 6am – 4pm ET)</h3>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
        {ALL_SEASONS.map((s) => (
          <label key={s} style={{ fontSize: "0.85rem" }}>
            <input type="checkbox" checked={!!seasons[s]} onChange={(e) => setSeasons({ ...seasons, [s]: e.target.checked })} disabled={busy} /> {s}
          </label>
        ))}
        <label style={{ fontSize: "0.85rem" }}>
          Weeks <input className="filter" type="number" min={1} max={16} value={firstWeek} onChange={(e) => setFirstWeek(Number(e.target.value))} style={{ width: "3.5rem" }} disabled={busy} /> to{" "}
          <input className="filter" type="number" min={1} max={16} value={lastWeek} onChange={(e) => setLastWeek(Number(e.target.value))} style={{ width: "3.5rem" }} disabled={busy} />
        </label>
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
        {SNAPSHOT_SLOTS.map((s) => (
          <label key={s.id} style={{ fontSize: "0.85rem" }}>
            <input type="checkbox" checked={!!slots[s.id]} onChange={(e) => setSlots({ ...slots, [s.id]: e.target.checked })} disabled={busy} /> {s.label}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Max credits this run <input className="filter" type="number" step={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} style={{ width: "5rem" }} disabled={busy} />
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Always keep at least <input className="filter" type="number" step={500} value={reserve} onChange={(e) => setReserve(Number(e.target.value))} style={{ width: "5rem" }} disabled={busy} /> credits unspent
        </label>
      </div>
      <p style={DIM}>
        Only weeks that have at least one missing FBS game are touched. Within a week it pulls the selected Sunday slots that haven't been pulled yet, earliest first, and stops that week as soon as every game has a FanDuel line. Slots already pulled
        (even ones that returned nothing) are skipped, so re-running never pays twice. Early seasons may stay incomplete: The Odds API's older history is sparser, and if FanDuel had no line up in the archive the game stays in the missing list above.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="menu-btn" onClick={countRemaining} disabled={busy}>
          Count the most this could cost
        </button>
        <button
          className="menu-btn"
          onClick={() => {
            if (window.confirm(`Pull FanDuel Sunday snapshots for the weeks with gaps? This spends real Odds API credits (about ${CREDITS_PER_SNAPSHOT} each), capped at ${cap} for this run.`)) runFill();
          }}
          disabled={busy || slotCount === 0}
        >
          Fill the gaps
        </button>
        {busy && (
          <button className="menu-btn" onClick={() => (stop.current = true)}>
            Stop after this snapshot
          </button>
        )}
      </div>
      {planned != null && (
        <p style={P}>
          At most {planned} snapshot{planned === 1 ? "" : "s"} ≈ <strong>{planned * CREDITS_PER_SNAPSHOT}</strong> credits (usually less, since each week stops once it's complete).
        </p>
      )}
      {log.length > 0 && <pre style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", color: "var(--chalk-dim)" }}>{log.join("\n")}</pre>}

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>2. Test one snapshot (~{CREDITS_PER_SNAPSHOT} credits)</h3>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <select className="filter" value={testSeason} onChange={(e) => setTestSeason(Number(e.target.value))} disabled={busy}>
          {ALL_SEASONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="filter" value={testWeek} onChange={(e) => setTestWeek(Number(e.target.value))} disabled={busy}>
          {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        <select className="filter" value={testSlot} onChange={(e) => setTestSlot(e.target.value)} disabled={busy}>
          {SNAPSHOT_SLOTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <button className="menu-btn" onClick={runTest} disabled={busy}>
          {busy ? "Working…" : "Run test pull"}
        </button>
      </div>
      {summary && (
        <div style={{ marginTop: "0.5rem" }}>
          <p style={P}>
            Snapshot taken {summary.snapshotAt}. The Odds API listed {summary.events} games; {summary.withLine} had a FanDuel spread; {summary.matched} matched to your games ({summary.unmatched} didn't). Credits used {summary.last ?? "?"}, remaining{" "}
            <strong>{summary.remaining ?? "?"}</strong>.
          </p>
          {cmp.length > 0 && (
            <p style={P}>
              Against Bovada's open for the same games ({cmp.length} compared): identical in {same}; average gap {f1(avgAbs, 2)} pts; FanDuel minus Bovada averages {sgn(avgSigned, 2)} (negative = FanDuel makes the home team a bigger favorite).
            </p>
          )}
        </div>
      )}

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>3. This week, live (1 credit)</h3>
      <p style={DIM}>Captures FanDuel's current lines as a new snapshot. Press it Sunday morning to record the opener as it posts.</p>
      <button className="menu-btn" onClick={runLive} disabled={busy}>
        Pull FanDuel's current lines
      </button>

      {msg && <p style={P}>{msg}</p>}
      {error && <p style={{ color: "crimson", fontSize: "0.85rem" }}>{error}</p>}
    </div>
  );
}
