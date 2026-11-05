import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles/calcutta.css";
import {
  addTime,
  currentLot,
  highBid,
  incrementFor,
  lotBids,
  lotName,
  lotTeams,
  minNextBid,
  netPot,
  openLot,
  ownerSummaries,
  participantById,
  passCurrent,
  pendingLots,
  placeBid,
  potTotal,
  remainingMs,
  sellCurrent,
  sortedLots,
  startClock,
  tick,
  togglePause,
  undoLastBid,
  type Result,
} from "../lib/calcutta/engine";
import { formatDef, roundSlots } from "../lib/calcutta/formats";
import { dispatch as storeDispatch, fetchCloudAuction, useAuction, useSyncState, writeAuction } from "../lib/calcutta/store";
import type { CalcuttaAuction } from "../lib/calcutta/types";
import { LotLogos, TeamBadge, fmt$, fmtPayout, seedLabel } from "../lib/calcutta/ui";

// The screen-shared auction window (/calcutta/stage/:id). Everything on it
// is safe for the room to see — no model numbers ever render here. The
// auctioneer drives it from the keyboard:
//
//   letter        bid for that attendee (min next bid, or the typed amount)
//   0-9           type a jump amount, then press the bidder's letter
//   Esc           clear the typed amount
//   Space         start / pause / resume the clock
//   Enter         open next lot · confirm SOLD · pass a lot with no bids
//   Ctrl/⌘+Z      undo the last bid
//   + / =         +10 seconds
//   /             toggle the owners board
//   `             hide / show the controls (clean view)

function useNow(intervalMs = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

let audioCtx: AudioContext | null = null;
function tone(freq: number, ms: number, gain = 0.15, type: OscillatorType = "sine", delay = 0) {
  try {
    audioCtx = audioCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  } catch {
    // no audio available
  }
}
const sounds = {
  goingOnce: () => tone(660, 180),
  goingTwice: () => {
    tone(660, 140);
    tone(660, 140, 0.15, "sine", 0.18);
  },
  sold: () => {
    tone(140, 220, 0.4, "triangle");
    tone(110, 320, 0.4, "triangle", 0.25);
  },
  bid: () => tone(990, 60, 0.06),
};

export default function CalcuttaStagePage() {
  const { id } = useParams();
  const auction = useAuction(id);
  const [loadState, setLoadState] = useState<"local" | "loading" | "missing">("local");

  useEffect(() => {
    if (!id || auction || loadState !== "local") return;
    setLoadState("loading");
    fetchCloudAuction(id)
      .then((doc) => {
        if (doc) writeAuction(doc, { cloud: false });
        else setLoadState("missing");
      })
      .catch(() => setLoadState("missing"));
  }, [id, auction, loadState]);

  useEffect(() => {
    document.title = auction ? `${auction.name} · Stage` : "Calcutta Stage";
  }, [auction?.name]);

  if (!auction) {
    return <div className="cal-stage cal-stage-empty">{loadState === "missing" ? "Auction not found on this computer or in the cloud." : "Loading…"}</div>;
  }
  return <Stage auction={auction} />;
}

function Stage({ auction: a }: { auction: CalcuttaAuction }) {
  const now = useNow();
  const [typed, setTyped] = useState("");
  const [flash, setFlash] = useState<{ text: string; kind: "err" | "info"; at: number } | null>(null);
  const [board, setBoard] = useState(false);
  const [controls, setControls] = useState(true);
  const sync = useSyncState(a.id);

  const act = (fn: (x: CalcuttaAuction, now: number) => Result) => {
    const err = storeDispatch(a.id, fn);
    if (err) setFlash({ text: err, kind: "err", at: Date.now() });
    return !err;
  };

  // Clock expiry — only the Stage drives it.
  useEffect(() => {
    if (a.live.phase === "running" && a.live.endsAt != null && now >= a.live.endsAt) storeDispatch(a.id, tick);
  }, [now, a.live.phase, a.live.endsAt, a.id]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const lot = currentLot(a);
  const high = highBid(a, lot?.id);
  const highP = participantById(a, high?.participantId);
  const minNext = minNextBid(a);
  const left = remainingMs(a.live, now);
  const secs = Math.ceil(left / 1000);
  const phase = a.live.phase;
  const pending = pendingLots(a);
  const typedAmount = typed ? Number(typed) : null;

  // ---- sounds on threshold crossings ----
  const prev = useRef<{ secs: number; phase: string; bids: number }>({ secs, phase, bids: 0 });
  const bidsOnLot = lotBids(a, lot?.id).length;
  useEffect(() => {
    const p = prev.current;
    if (a.settings.sound) {
      if (phase === "running" && p.phase === "running" && p.secs > a.settings.goingOnceAt && secs <= a.settings.goingOnceAt && secs > a.settings.goingTwiceAt) sounds.goingOnce();
      if (phase === "running" && p.phase === "running" && p.secs > a.settings.goingTwiceAt && secs <= a.settings.goingTwiceAt) sounds.goingTwice();
      if (phase === "sold" && p.phase !== "sold") sounds.sold();
      if (bidsOnLot > p.bids && p.phase !== "idle") sounds.bid();
    }
    prev.current = { secs, phase, bids: bidsOnLot };
  }, [secs, phase, bidsOnLot, a.settings]);

  const bidFor = (participantId: string) => {
    if (act((x, t) => placeBid(x, participantId, typedAmount, t))) setTyped("");
  };

  const enter = () => {
    if (phase === "idle" || phase === "sold") return act((x, t) => openLot(x, null, t));
    if (phase === "expired") return high ? act(sellCurrent) : act(passCurrent);
    if (phase === "ready" && !high) return act(startClock);
    setFlash({ text: high ? "Clock still running — use Sell now to close early" : "No bids yet", kind: "info", at: Date.now() });
  };

  // ---- keyboard ----
  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  handler.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") {
      e.preventDefault();
      act(undoLastBid);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(k)) {
      setTyped((t) => (t + k).replace(/^0+/, "").slice(0, 7));
      return;
    }
    if (k === "Backspace") {
      setTyped((t) => t.slice(0, -1));
      return;
    }
    if (k === "Escape") {
      setTyped("");
      return;
    }
    if (k === " ") {
      e.preventDefault();
      act(togglePause);
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      enter();
      return;
    }
    if (k === "+" || k === "=") {
      act((x, t) => addTime(x, 10, t));
      return;
    }
    if (k === "/") {
      e.preventDefault();
      setBoard((b) => !b);
      return;
    }
    if (k === "`") {
      setControls((c) => !c);
      return;
    }
    if (/^[a-zA-Z]$/.test(k)) {
      const p = a.participants.find((x) => x.hotkey === k.toLowerCase());
      if (p) bidFor(p.id);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => handler.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const pot = potTotal(a);
  const soldCount = a.lots.filter((l) => l.status === "sold").length;
  const summaries = useMemo(() => ownerSummaries(a), [a]);
  const recent = useMemo(
    () =>
      sortedLots(a)
        .filter((l) => l.status === "sold")
        .sort((x, y) => (y.soldAt ?? 0) - (x.soldAt ?? 0))
        .slice(0, 5),
    [a],
  );
  const step = high ? incrementFor(a.settings, high.amount) : a.settings.openingMin;
  const goingText =
    phase === "running" && high ? (secs <= a.settings.goingTwiceAt ? "Going twice…" : secs <= a.settings.goingOnceAt ? "Going once…" : null) : null;
  const totalClock = Math.max(a.settings.timerStart, a.settings.timerReset) * 1000;
  const clockFrac = Math.max(0, Math.min(1, left / totalClock));
  const clockClass = phase === "running" ? (secs <= a.settings.goingTwiceAt ? "danger" : secs <= a.settings.goingOnceAt ? "warn" : "") : phase;

  return (
    <div className={`cal-stage ${controls ? "" : "clean"}`}>
      <header className="cal-stage-top">
        <div className="cal-stage-name">
          <div className="cal-stage-eyebrow">{formatDef(a.format).label} Calcutta</div>
          <div className="cal-stage-title">{a.name}</div>
        </div>
        <div className="cal-stage-pot">
          <div className="cal-stage-eyebrow">Pot</div>
          <div className="cal-stage-potv">{fmt$(pot)}</div>
          <div className="cal-stage-eyebrow">
            {soldCount}/{a.lots.length} sold{a.settings.rakePct ? ` · ${fmt$(netPot(a))} after rake` : ""}
          </div>
        </div>
      </header>

      {board ? (
        <BoardView a={a} summaries={summaries} />
      ) : (
        <main className="cal-stage-main">
          <section className={`cal-lot ${phase}`}>
            {!lot || phase === "idle" ? (
              a.status === "complete" || pending.length === 0 ? (
                <div className="cal-lot-center">
                  <div className="cal-lot-big">Auction complete</div>
                  <div className="cal-lot-sub">Final pot {fmt$(pot)} · press / for the owners board</div>
                </div>
              ) : (
                <div className="cal-lot-center">
                  <div className="cal-stage-eyebrow">Up next</div>
                  <div className="cal-lot-logos">
                    <LotLogos auction={a} lot={pending[0]} size={120} />
                  </div>
                  <div className="cal-lot-big">{lotName(a, pending[0])}</div>
                  <div className="cal-lot-sub">{lotTeams(a, pending[0]).map(seedLabel).join(" · ")}</div>
                  {controls && <div className="cal-hint">Enter to open bidding</div>}
                </div>
              )
            ) : (
              <>
                <div className="cal-lot-head">
                  <div className="cal-lot-logos">
                    <LotLogos auction={a} lot={lot} size={110} />
                  </div>
                  <div>
                    <div className="cal-stage-eyebrow">
                      Lot {lot.order} of {a.lots.length} · {lotTeams(a, lot).map(seedLabel).join(" · ")}
                    </div>
                    <div className="cal-lot-big">{lotName(a, lot)}</div>
                    {lot.teamIds.length > 1 && <div className="cal-lot-sub">{lotTeams(a, lot).map((t) => t.name).join(" · ")}</div>}
                  </div>
                </div>

                <div className="cal-bidline">
                  {phase === "sold" ? (
                    <div className="cal-sold" style={{ borderColor: highP?.color }}>
                      <div className="cal-sold-word">SOLD</div>
                      <div className="cal-sold-to">
                        to <span style={{ color: highP?.color }}>{highP?.name}</span> for {fmt$(high?.amount)}
                      </div>
                    </div>
                  ) : high ? (
                    <>
                      <div className="cal-bid-amount">{fmt$(high.amount)}</div>
                      <div className="cal-bid-who" style={{ background: highP?.color }}>
                        {highP?.name}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="cal-bid-amount dim">{fmt$(a.settings.openingMin)}</div>
                      <div className="cal-bid-who empty">Opening bid</div>
                    </>
                  )}
                </div>

                {phase !== "sold" && (
                  <div className="cal-clock">
                    <div className={`cal-clock-bar ${clockClass}`}>
                      <div style={{ width: `${clockFrac * 100}%` }} />
                    </div>
                    <div className="cal-clock-row">
                      <span className={`cal-clock-secs ${clockClass}`}>{phase === "expired" ? "0" : secs}s</span>
                      <span className="cal-going">
                        {phase === "paused" && "Paused"}
                        {phase === "ready" && (controls ? "Space to start the clock" : "")}
                        {phase === "expired" && (high ? "SOLD?" : "No bids")}
                        {goingText}
                      </span>
                      <span className="cal-next">
                        Next bid <b>{fmt$(minNext)}</b>
                      </span>
                    </div>
                    {phase === "expired" && controls && (
                      <div className="cal-hint">{high ? "Enter to sell · any bid keeps it going · + adds 10s" : "Enter to pass · any bid opens it · + adds 10s"}</div>
                    )}
                  </div>
                )}
                {phase === "sold" && controls && <div className="cal-hint">Enter for the next lot</div>}

                <BidTrail a={a} lotId={lot.id} />
              </>
            )}
          </section>

          <aside className="cal-side">
            <div className="cal-side-block">
              <div className="cal-stage-eyebrow">Up next</div>
              {pending
                .filter((l) => l.id !== lot?.id)
                .slice(0, phase === "idle" ? 5 : 4)
                .slice(phase === "idle" ? 1 : 0)
                .map((l) => (
                  <div key={l.id} className="cal-side-row">
                    <LotLogos auction={a} lot={l} size={26} />
                    <span className="grow">{lotName(a, l)}</span>
                    <span className="dim">{lotTeams(a, l).map(seedLabel).join(", ")}</span>
                  </div>
                ))}
              {pending.length === 0 && <div className="dim">—</div>}
            </div>
            <div className="cal-side-block">
              <div className="cal-stage-eyebrow">Just sold</div>
              {recent.map((l) => {
                const p = participantById(a, l.winnerId);
                return (
                  <div key={l.id} className="cal-side-row">
                    <LotLogos auction={a} lot={l} size={26} />
                    <span className="grow">{lotName(a, l)}</span>
                    <span style={{ color: p?.color, fontWeight: 700 }}>{p?.name}</span>
                    <span className="money">{fmt$(l.price)}</span>
                  </div>
                );
              })}
              {recent.length === 0 && <div className="dim">—</div>}
            </div>
          </aside>
        </main>
      )}

      <section className="cal-bidders">
        {a.participants.map((p) => {
          const s = summaries.find((x) => x.participant.id === p.id);
          const isHigh = high?.participantId === p.id && phase !== "sold";
          return (
            <button
              key={p.id}
              className={`cal-bidder ${isHigh ? "high" : ""}`}
              style={{ ["--pc" as any]: p.color }}
              onClick={() => bidFor(p.id)}
              disabled={!lot || phase === "idle" || phase === "sold"}
            >
              {controls && <span className="cal-bidder-key">{p.hotkey.toUpperCase()}</span>}
              <span className="cal-bidder-name">{p.name}</span>
              <span className="cal-bidder-meta">
                {s?.owed ? fmt$(s.owed) : "$0"} · {s?.lots.length ?? 0} {s?.lots.length === 1 ? "team" : "teams"}
              </span>
            </button>
          );
        })}
      </section>

      {controls && (
        <footer className="cal-controls">
          <div className="cal-typed">
            <span className="dim">Jump to</span>
            <span className={`cal-typed-v ${typed ? (typedAmount! >= minNext ? "ok" : "bad") : ""}`}>{typed ? fmt$(typedAmount) : "type $"}</span>
            {[2, 5, 10].map((m) => (
              <button key={m} className="cal-cbtn" disabled={!lot || phase === "sold" || phase === "idle"} onClick={() => setTyped(String((high?.amount ?? 0) + step * m))}>
                +{fmt$(step * m)}
              </button>
            ))}
            {typed && (
              <button className="cal-cbtn" onClick={() => setTyped("")}>
                Clear (Esc)
              </button>
            )}
          </div>
          <div className="cal-cbtns">
            <button className="cal-cbtn" onClick={() => act(undoLastBid)} disabled={!high || phase === "sold"}>
              Undo bid (⌘Z)
            </button>
            <button className="cal-cbtn" onClick={() => act(togglePause)} disabled={!["ready", "running", "paused"].includes(phase)}>
              {phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start"} (Space)
            </button>
            <button className="cal-cbtn" onClick={() => act((x, t) => addTime(x, 10, t))} disabled={!["ready", "running", "paused", "expired"].includes(phase)}>
              +10s (+)
            </button>
            <button className="cal-cbtn primary" onClick={() => act(sellCurrent)} disabled={!high || phase === "sold" || phase === "idle"}>
              {phase === "expired" ? "Sell (Enter)" : "Sell now"}
            </button>
            <button className="cal-cbtn" onClick={() => act(passCurrent)} disabled={!lot || !!high || phase === "sold" || phase === "idle"}>
              Pass
            </button>
            <button className="cal-cbtn primary" onClick={() => act((x, t) => openLot(x, null, t))} disabled={!(phase === "idle" || phase === "sold") || pending.length === 0}>
              Next lot (Enter)
            </button>
            <button className="cal-cbtn" onClick={() => setBoard((b) => !b)}>
              {board ? "Auction" : "Board"} (/)
            </button>
            <button className="cal-cbtn" onClick={() => setControls(false)}>
              Hide controls (`)
            </button>
            <button className="cal-cbtn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>
              Fullscreen
            </button>
            <span className={`cal-sync ${sync.state}`} title={sync.message ?? ""}>
              ● {sync.state === "error" ? "local only" : sync.state === "saved" ? "saved" : sync.state === "idle" ? "" : "saving"}
            </span>
          </div>
        </footer>
      )}

      {flash && <div className={`cal-flash ${flash.kind}`}>{flash.text}</div>}
    </div>
  );
}

function BidTrail({ a, lotId }: { a: CalcuttaAuction; lotId: string }) {
  const bids = lotBids(a, lotId).slice(-8).reverse();
  if (!bids.length) return null;
  return (
    <div className="cal-trail">
      {bids.map((b, i) => {
        const p = participantById(a, b.participantId);
        return (
          <span key={b.id} className={`cal-trail-item ${i === 0 ? "top" : ""}`} style={{ borderColor: p?.color }}>
            <span style={{ color: p?.color }}>{p?.name}</span> {fmt$(b.amount)}
          </span>
        );
      })}
    </div>
  );
}

function BoardView({ a, summaries }: { a: CalcuttaAuction; summaries: ReturnType<typeof ownerSummaries> }) {
  const np = netPot(a);
  const def = formatDef(a.format);
  const unsold = sortedLots(a).filter((l) => l.status !== "sold");
  return (
    <main className="cal-board">
      <div className="cal-board-owners">
        {summaries.map((s) => (
          <div key={s.participant.id} className="cal-owner" style={{ ["--pc" as any]: s.participant.color }}>
            <div className="cal-owner-head">
              <span className="cal-owner-name">{s.participant.name}</span>
              <span className="money">{fmt$(s.owed)}</span>
            </div>
            {s.lots.length === 0 && <div className="dim">—</div>}
            {s.lots.map((x) => (
              <div key={x.lot.id} className="cal-owner-team">
                {lotTeams(a, x.lot).map((t) => (
                  <TeamBadge key={t.id} team={t} size={24} />
                ))}
                <span className="grow">
                  {lotName(a, x.lot)}
                  {x.pct < 100 ? ` (${Math.round(x.pct * 10) / 10}%)` : ""}
                </span>
                <span className="dim">{fmt$(x.lot.price)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <aside className="cal-side">
        <div className="cal-side-block">
          <div className="cal-stage-eyebrow">Payouts at current pot</div>
          {def.rounds.map((r) => {
            const pct = a.payouts.roundPct[r.key] ?? 0;
            return (
              <div key={r.key} className="cal-side-row">
                <span className="grow">{r.label}</span>
                <span className="dim">
                  {pct}% × {roundSlots(a.format, r.key, a.payouts, a.field)}
                </span>
                <span className="money">{fmtPayout((pct / 100) * np)}</span>
              </div>
            );
          })}
          {a.payouts.props.map((p) => (
            <div key={p.id} className="cal-side-row">
              <span className="grow">{p.label}</span>
              <span className="dim">{p.pct}%</span>
              <span className="money">{fmtPayout((p.pct / 100) * np)}</span>
            </div>
          ))}
        </div>
        {unsold.length > 0 && (
          <div className="cal-side-block">
            <div className="cal-stage-eyebrow">Still to go</div>
            {unsold.map((l) => (
              <div key={l.id} className="cal-side-row">
                <LotLogos auction={a} lot={l} size={22} />
                <span className="grow">{lotName(a, l)}</span>
                <span className="dim">{l.status === "unsold" ? "unsold" : ""}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </main>
  );
}
