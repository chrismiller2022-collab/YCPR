import { useRef, useState } from "react";
import { fetchPulledTargets, pullBookSpreads, saveBookSnapshots, type SpreadPull } from "../../lib/api/bookSnapshots";
import { DEFAULT_SLOT_IDS, SNAPSHOT_SLOTS, matchEvents, slotTargetMs, weekAnchors, type SnapshotSlot } from "../../lib/drogba/openers";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { CELL, DIM, H3, NUM, P, f1, sgn } from "./shared";

const BOOK = "fanduel";
const DAY = 86_400_000;
const CREDITS_PER_SNAPSHOT = 10; // 1 market x 1 bookmaker, historical endpoint

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

export default function DrogbaFanDuelSection({ state }: { state: DrogbaState }) {
  const [testSeason, setTestSeason] = useState(2025);
  const [testWeek, setTestWeek] = useState(6);
  const [testSlot, setTestSlot] = useState("sun-10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PullSummary | null>(null);

  const [seasons, setSeasons] = useState<Record<number, boolean>>({ 2026: true, 2025: true });
  const [slots, setSlots] = useState<Record<string, boolean>>(Object.fromEntries(SNAPSHOT_SLOTS.map((s) => [s.id, DEFAULT_SLOT_IDS.includes(s.id)])));
  const [firstWeek, setFirstWeek] = useState(2);
  const [lastWeek, setLastWeek] = useState(15);
  const [cap, setCap] = useState(1000);
  const [reserve, setReserve] = useState(2000);
  const [log, setLog] = useState<string[]>([]);
  const stop = useRef(false);

  const anchors = weekAnchors(state.games);

  // One snapshot: pull, match to our games, save the rows and log the call. Returns a summary for the UI.
  async function pullOne(targetMs: number | null, season: number | null, week: number | null): Promise<{ pull: SpreadPull; summary: PullSummary }> {
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
      summary: {
        events: pull.totalEvents,
        withLine: pull.events.length,
        matched: matched.length,
        unmatched: unmatched.length,
        snapshotAt: snapAt,
        remaining: pull.quota.remaining,
        last: pull.quota.last,
        compare,
      },
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

  // The list of (season, week, slot) snapshots the backfill would take, minus ones already pulled / still in the future.
  async function plan(): Promise<{ season: number; week: number; slot: SnapshotSlot; targetMs: number }[]> {
    const done = await fetchPulledTargets(BOOK);
    const out: { season: number; week: number; slot: SnapshotSlot; targetMs: number }[] = [];
    const now = Date.now();
    for (const season of Object.keys(seasons).map(Number).filter((s) => seasons[s]).sort()) {
      for (let week = firstWeek; week <= lastWeek; week++) {
        const anchor = anchors.get(`${season}|${week}`);
        if (anchor == null) continue;
        for (const slot of SNAPSHOT_SLOTS) {
          if (!slots[slot.id]) continue;
          const t = slotTargetMs(anchor, slot);
          if (t > now || done.has(t)) continue;
          out.push({ season, week, slot, targetMs: t });
        }
      }
    }
    return out;
  }

  const [planned, setPlanned] = useState<number | null>(null);
  async function refreshPlan() {
    setBusy(true);
    setError(null);
    try {
      setPlanned((await plan()).length);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't read the pull log");
    } finally {
      setBusy(false);
    }
  }

  async function runBackfill() {
    stop.current = false;
    setBusy(true);
    setError(null);
    setMsg(null);
    setLog([]);
    const add = (l: string) => setLog((x) => [...x, l]);
    try {
      const todo = await plan();
      let spent = 0;
      let saved = 0;
      let remaining: number | null = null;
      for (const item of todo) {
        if (stop.current) {
          add("Stopped.");
          break;
        }
        if (spent + CREDITS_PER_SNAPSHOT > cap) {
          add(`Stopped: the next snapshot would pass this run's ${cap}-credit cap (spent ${spent}).`);
          break;
        }
        if (remaining != null && remaining - CREDITS_PER_SNAPSHOT < reserve) {
          add(`Stopped: ${remaining} credits left; keeping at least ${reserve} in reserve.`);
          break;
        }
        const { summary: s } = await pullOne(item.targetMs, item.season, item.week);
        spent += Number(s.last ?? CREDITS_PER_SNAPSHOT) || CREDITS_PER_SNAPSHOT;
        saved += s.matched;
        remaining = s.remaining == null ? remaining : Number(s.remaining);
        add(`${item.season} wk ${item.week} ${item.slot.id}: ${s.withLine} FanDuel lines, ${s.matched} matched (credits left ${s.remaining ?? "?"})`);
      }
      add(`Done. ~${spent} credits spent, ${saved} line-snapshots saved. Reloading ratings…`);
      state.reload();
    } catch (e: any) {
      setError(e?.message ?? "Backfill failed");
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
        FanDuel is DROGBA's default "open". Each pull takes one snapshot of FanDuel's spread for every game as of a timestamp — about {CREDITS_PER_SNAPSHOT} credits per snapshot, not per game — and stores it; a game's FanDuel open is
        its earliest snapshot from the Sunday of its week on. Lines posted weeks ahead are judged by what they showed that Sunday, so every game's open is the same moment. Everything here is manual and credit-capped.
        {state.fanduelGames > 0 ? ` FanDuel lines are on file for ${state.fanduelGames} games.` : " Nothing is stored yet."}
      </p>

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>1. Test one week (1 snapshot, ~{CREDITS_PER_SNAPSHOT} credits)</h3>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <select className="filter" value={testSeason} onChange={(e) => setTestSeason(Number(e.target.value))} disabled={busy}>
          {[2026, 2025, 2024, 2023, 2022, 2021].map((s) => (
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={CELL}>Game</th>
                  <th style={NUM}>FanDuel (home)</th>
                  <th style={NUM}>Bovada open (home)</th>
                </tr>
              </thead>
              <tbody>
                {summary.compare.slice(0, 15).map((c) => (
                  <tr key={c.game}>
                    <td style={CELL}>{c.game}</td>
                    <td style={NUM}>{f1(c.fd)}</td>
                    <td style={NUM}>{f1(c.bov)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 style={{ ...H3, fontSize: "0.9rem" }}>2. Backfill snapshots</h3>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
        {[2026, 2025, 2024, 2023, 2022, 2021].map((s) => (
          <label key={s} style={{ fontSize: "0.85rem" }}>
            <input type="checkbox" checked={!!seasons[s]} onChange={(e) => setSeasons({ ...seasons, [s]: e.target.checked })} disabled={busy} /> {s}
          </label>
        ))}
        <label style={{ fontSize: "0.85rem" }}>
          Weeks <input className="filter" type="number" min={1} max={15} value={firstWeek} onChange={(e) => setFirstWeek(Number(e.target.value))} style={{ width: "3.5rem" }} disabled={busy} /> to{" "}
          <input className="filter" type="number" min={1} max={15} value={lastWeek} onChange={(e) => setLastWeek(Number(e.target.value))} style={{ width: "3.5rem" }} disabled={busy} />
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
        {slotCount} snapshot{slotCount === 1 ? "" : "s"} per week. Snapshots already pulled (even ones that returned nothing) are skipped, so re-running never pays twice. Week 1 lines are posted months ahead, so its "Sunday" look isn't a true opener — hence
        the default start at week 2. The remaining-credit figure comes from The Odds API after the first call; the run stops if it would dip under your reserve.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="menu-btn" onClick={refreshPlan} disabled={busy}>
          Count what's left to pull
        </button>
        <button
          className="menu-btn"
          onClick={() => {
            if (window.confirm(`Pull FanDuel snapshots now? This spends real Odds API credits (about ${CREDITS_PER_SNAPSHOT} each), capped at ${cap} for this run.`)) runBackfill();
          }}
          disabled={busy || slotCount === 0}
        >
          Run FanDuel backfill
        </button>
        {busy && (
          <button className="menu-btn" onClick={() => (stop.current = true)}>
            Stop after this snapshot
          </button>
        )}
      </div>
      {planned != null && (
        <p style={P}>
          {planned} snapshot{planned === 1 ? "" : "s"} left to pull ≈ <strong>{planned * CREDITS_PER_SNAPSHOT}</strong> credits.
        </p>
      )}
      {log.length > 0 && <pre style={{ fontSize: "0.75rem", whiteSpace: "pre-wrap", color: "var(--chalk-dim)" }}>{log.join("\n")}</pre>}

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
