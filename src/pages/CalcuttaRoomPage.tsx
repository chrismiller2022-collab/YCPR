import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles/calcutta.css";
import { nextMin, roomBid, roomJoin, roomOut, roomStatus, saveRoomLogin, savedRoomLogin, useLiveRoom, type LiveRoomState } from "../lib/calcutta/room";
import { fmt$ } from "../lib/calcutta/ui";

// The live room (/calcutta/room/:id): one link for everyone. Pick your name,
// set a 4-digit PIN the first time (enter it on later visits or another
// device), then bid from here — the big button or the spacebar. Bids go to
// the host's Stage, which takes them in the order they arrive.

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function CalcuttaRoomPage() {
  const { id } = useParams();
  const { state, offset, loaded, error } = useLiveRoom(id);
  const [login, setLogin] = useState(() => (id ? savedRoomLogin(id) : null));
  useEffect(() => {
    document.title = state ? `${state.name} · Live room` : "Calcutta live room";
  }, [state?.name]);

  if (!id) return null;
  if (!loaded) return <div className="cal-room cal-room-center">Connecting…</div>;
  if (!state || !state.roomOpen)
    return (
      <div className="cal-room cal-room-center">
        <div className="cal-room-big">Waiting for the host</div>
        <div className="dim">The room opens when the host turns on the live room and opens the auction. This page updates by itself.</div>
        {error && <div className="cal-room-err">{error}</div>}
      </div>
    );
  const me = login ? state.participants.find((p) => p.id === login.participantId) : null;
  if (!login || !me)
    return (
      <JoinScreen
        auctionId={id}
        state={state}
        onJoined={(v) => {
          saveRoomLogin(id, v);
          setLogin(v);
        }}
      />
    );
  return (
    <BidScreen
      state={state}
      offset={offset}
      meId={login.participantId}
      token={login.token}
      onSignOut={() => {
        saveRoomLogin(id, null);
        setLogin(null);
      }}
    />
  );
}

function JoinScreen({ auctionId, state, onJoined }: { auctionId: string; state: LiveRoomState; onJoined: (v: { token: string; participantId: string; name: string }) => void }) {
  const [claimed, setClaimed] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    roomStatus(auctionId)
      .then((r) => setClaimed(r.claimed))
      .catch((e) => setErr(e?.message ?? "Couldn't load the room"));
  }, [auctionId, pick]);
  const person = state.participants.find((p) => p.id === pick);
  const isClaimed = !!pick && !!claimed?.includes(pick);
  const submit = async () => {
    setErr(null);
    if (!/^\d{4}$/.test(pin)) return setErr("PIN is 4 digits");
    if (!isClaimed && pin !== pin2) return setErr("The two PINs don't match");
    setBusy(true);
    try {
      onJoined(await roomJoin(auctionId, pick!, pin, isClaimed ? "login" : "claim"));
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't sign in");
      roomStatus(auctionId).then((r) => setClaimed(r.claimed)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cal-room">
      <div className="cal-room-head">
        <div className="cal-stage-eyebrow">{state.format} Calcutta · live room</div>
        <div className="cal-room-title">{state.name}</div>
      </div>
      {!pick ? (
        <section className="cal-room-card">
          <div className="cal-room-h">Who are you?</div>
          <div className="cal-room-names">
            {state.participants.map((p) => (
              <button key={p.id} className="cal-room-name" style={{ ["--pc" as any]: p.color }} onClick={() => setPick(p.id)}>
                {p.name}
                <span className="dim">{claimed?.includes(p.id) ? "sign in" : "set PIN"}</span>
              </button>
            ))}
          </div>
          <div className="dim">Not on the list? Ask the host to add you.</div>
        </section>
      ) : (
        <section className="cal-room-card">
          <div className="cal-room-h" style={{ color: person?.color }}>
            {person?.name}
          </div>
          <div className="dim">{isClaimed ? "Enter your 4-digit PIN." : "First time here — pick a 4-digit PIN. You'll use it if you come back on another device."}</div>
          <input className="cal-room-pin" inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus />
          {!isClaimed && (
            <input className="cal-room-pin" inputMode="numeric" maxLength={4} placeholder="Again" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && submit()} />
          )}
          {err && <div className="cal-room-err">{err}</div>}
          <div className="cal-room-row">
            <button className="cal-room-btn primary" disabled={busy} onClick={submit}>
              {busy ? "…" : isClaimed ? "Sign in" : "Set PIN & join"}
            </button>
            <button
              className="cal-room-btn"
              onClick={() => {
                setPick(null);
                setPin("");
                setPin2("");
                setErr(null);
              }}
            >
              Back
            </button>
          </div>
          {isClaimed && <div className="dim">Forgot it? The host can reset your PIN.</div>}
        </section>
      )}
    </div>
  );
}

function BidScreen({ state, offset, meId, token, onSignOut }: { state: LiveRoomState; offset: number; meId: string; token: string; onSignOut: () => void }) {
  const now = useNow(200);
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState<{ requestId: number | null; at: number } | null>(null);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const me = state.participants.find((p) => p.id === meId)!;
  const lot = state.lot;
  const iAmHigh = state.high?.participantId === meId;
  const iAmOut = state.outIds.includes(meId);
  const open = !!lot && state.phase !== "sold" && state.phase !== "idle";
  const customAmt = custom.trim() ? Number(custom) : null;
  const amount = customAmt && customAmt >= state.minNext ? customAmt : state.minNext;
  const canBid = open && !iAmHigh && !iAmOut && !me.capped && !(pending && now - pending.at < 1500 && pending.requestId == null);

  const hostNow = now + offset;
  const left = state.phase === "running" && state.endsAt ? Math.max(0, state.endsAt - hostNow) : state.phase === "expired" ? 0 : state.remainingMs ?? 0;
  const secs = Math.ceil(left / 1000);
  const going = state.phase === "running" && state.high ? (secs <= state.goingTwiceAt ? "Going twice…" : secs <= state.goingOnceAt ? "Going once…" : null) : null;

  // Show what happened to my last request once the Stage has processed it.
  useEffect(() => {
    if (!pending?.requestId) return;
    const o = state.outcomes.find((x) => x.requestId === pending.requestId);
    if (!o) return;
    setFlash({ text: o.ok ? (o.text.includes("bowed out") || o.text.includes("back in") ? o.text : "You're the high bidder") : o.text, ok: o.ok });
    setPending(null);
  }, [state.outcomes, pending?.requestId]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => setCustom(""), [lot?.id]);

  const send = async (kind: "bid" | "out") => {
    if (kind === "bid" && !canBid) return;
    setPending({ requestId: null, at: Date.now() });
    try {
      const r = kind === "bid" ? await roomBid(token, lot?.id ?? null, amount) : await roomOut(token, lot?.id ?? null);
      setPending({ requestId: r.requestId, at: Date.now() });
      if (kind === "bid") setCustom("");
    } catch (e: any) {
      setPending(null);
      setFlash({ text: e?.message ?? "Bid didn't send", ok: false });
      if (/sign in again/i.test(e?.message ?? "")) onSignOut();
    }
  };

  // Spacebar = bid (desktop).
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        void sendRef.current("bid");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const step = nextMin(state, state.high?.amount ?? null) - (state.high?.amount ?? 0);
  const bidLabel = !open
    ? state.status === "complete"
      ? "Auction over"
      : "Waiting for the next team"
    : iAmHigh
      ? "You're the high bidder"
      : iAmOut
        ? "You bowed out"
        : me.capped
          ? `You're at the max ${state.maxTeams} teams`
          : pending && !pending.requestId
            ? "Sending…"
            : `BID ${fmt$(amount)}`;
  const sorted = useMemo(() => [...state.participants].sort((x, y) => y.spent - x.spent), [state.participants]);

  return (
    <div className="cal-room">
      <div className="cal-room-head">
        <div>
          <div className="cal-stage-eyebrow">{state.name}</div>
          <div className="cal-room-me" style={{ color: me.color }}>
            {me.name}{" "}
            <button className="cal-room-link" onClick={onSignOut}>
              not you?
            </button>
          </div>
        </div>
        <div className="cal-room-pot">
          <div className="cal-stage-eyebrow">Pot</div>
          <div className="money">{fmt$(state.pot)}</div>
        </div>
      </div>

      <section className={`cal-room-card cal-room-lot ${state.phase}`}>
        {lot ? (
          <>
            <div className="cal-room-lothead">
              <span className="cal-logos">
                {lot.teams.map((t) => (t.logo ? <img key={t.name} src={t.logo} alt="" width={46} height={46} style={{ objectFit: "contain" }} /> : null))}
              </span>
              <div>
                <div className="cal-stage-eyebrow">
                  Lot {lot.order} of {lot.total}
                  {lot.teams.length === 1 && lot.teams[0].seed != null ? ` · ${lot.teams[0].group ? `${lot.teams[0].group} ` : ""}#${lot.teams[0].seed}` : ""}
                </div>
                <div className="cal-room-lotname">{lot.name}</div>
              </div>
            </div>
            <div className="cal-room-bidrow">
              <div>
                <div className="cal-room-amt">{state.high ? fmt$(state.high.amount) : fmt$(state.minNext)}</div>
                <div className="cal-room-who" style={{ color: state.high?.color }}>
                  {state.phase === "sold" ? `SOLD to ${state.high?.name}` : state.high ? state.high.name : "Opening bid"}
                </div>
              </div>
              {state.phase !== "sold" && (
                <div className={`cal-room-clock ${secs <= state.goingTwiceAt && state.phase === "running" ? "danger" : secs <= state.goingOnceAt && state.phase === "running" ? "warn" : ""}`}>
                  <div className="cal-room-secs">{state.phase === "running" || state.phase === "expired" ? secs : "–"}</div>
                  <div className="dim">{going ?? (state.phase === "paused" ? "Paused" : state.phase === "ready" ? "Ready" : state.phase === "expired" ? "SOLD?" : "")}</div>
                </div>
              )}
            </div>
            {state.trail.length > 0 && (
              <div className="cal-room-trail">
                {state.trail.map((b, i) => (
                  <span key={i} style={{ color: b.color }}>
                    {b.name} {fmt$(b.amount)}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="cal-room-center">
            <div className="cal-room-big">{state.status === "complete" ? "Auction complete" : "Next team coming up"}</div>
            {state.upNext.length > 0 && <div className="dim">Up next: {state.upNext.join(" · ")}</div>}
          </div>
        )}
      </section>

      <button className={`cal-room-bid ${canBid ? "" : "off"}`} disabled={!canBid} onClick={() => send("bid")}>
        {bidLabel}
        {canBid && <span className="cal-room-bidhint">or press Space</span>}
      </button>

      {open && !iAmHigh && !me.capped && (
        <div className="cal-room-row">
          {[2, 5].map((m) => (
            <button key={m} className="cal-room-btn" onClick={() => setCustom(String((state.high?.amount ?? 0) + step * m))}>
              +{fmt$(step * m)}
            </button>
          ))}
          <input
            className="cal-room-amtin"
            inputMode="numeric"
            placeholder={`$${state.minNext}+`}
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 7))}
            onKeyDown={(e) => e.key === "Enter" && send("bid")}
          />
          <button className="cal-room-btn" onClick={() => send("out")}>
            {iAmOut ? "I'm back in" : "I'm out"}
          </button>
        </div>
      )}
      {customAmt != null && customAmt < state.minNext && <div className="cal-room-err">Minimum is {fmt$(state.minNext)}</div>}
      {flash && <div className={`cal-room-flash ${flash.ok ? "ok" : "bad"}`}>{flash.text}</div>}

      <section className="cal-room-card">
        <div className="cal-room-row" style={{ justifyContent: "space-between" }}>
          <span>
            You: <b>{fmt$(me.spent)}</b> · {me.teams} {me.teams === 1 ? "team" : "teams"}
            {state.maxTeams ? ` of ${state.maxTeams} max` : ""}
            {me.buyInLeft > 0 ? ` · ${fmt$(me.buyInLeft)} buy-in left` : ""}
          </span>
        </div>
        {state.sold.length > 0 && (
          <>
            <div className="cal-stage-eyebrow" style={{ marginTop: 8 }}>
              Just sold
            </div>
            {state.sold.map((s, i) => (
              <div key={i} className="cal-room-line">
                <span>{s.name}</span>
                <span style={{ color: s.color }}>{s.winner}</span>
                <span className="money">{fmt$(s.price)}</span>
              </div>
            ))}
          </>
        )}
        <div className="cal-stage-eyebrow" style={{ marginTop: 8 }}>
          Room
        </div>
        {sorted.map((p) => (
          <div key={p.id} className="cal-room-line">
            <span style={{ color: p.color, fontWeight: p.id === meId ? 900 : 600 }}>{p.name}</span>
            <span className="dim">
              {p.teams} {p.teams === 1 ? "team" : "teams"}
            </span>
            <span className="money">{fmt$(p.spent)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
