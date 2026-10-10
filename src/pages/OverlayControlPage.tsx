import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import OverlayView from "../components/overlay/OverlayView";
import { supabase } from "../lib/supabaseClient";
import { espnDate, saveOverlayState, useOverlayData, useOverlayState, type OverlayState } from "../lib/overlay";

// Remote for the TV score bug — open on a laptop or phone. Every change
// saves straight to overlay_state, and the TV picks it up over Realtime.

interface SlateGame {
  id: string;
  start_date: string | null;
  home_team: string;
  away_team: string;
  tv_outlet: string | null;
  bets: number;
  locked: boolean;
}

const PASSWORD_KEY = "admin_password";

function etDateInput(d: Date): string {
  const s = espnDate(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

async function fetchSlate(day: string): Promise<SlateGame[]> {
  // An Eastern calendar day runs ~04:00–05:00 UTC to the same time next
  // day; 09:00 UTC on both ends also catches late West Coast kickoffs.
  const from = new Date(`${day}T09:00:00Z`);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const { data: games, error } = await supabase
    .from("games")
    .select("id, start_date, home_team, away_team, tv_outlet")
    .gte("start_date", from.toISOString())
    .lt("start_date", to.toISOString())
    .order("start_date")
    .order("id");
  if (error) throw error;
  const ids = (games ?? []).map((g: any) => g.id);
  if (!ids.length) return [];
  const [bets, locks] = await Promise.all([
    supabase.from("placed_bets").select("game_id").in("game_id", ids),
    supabase.from("game_projection_locks").select("game_id").in("game_id", ids),
  ]);
  const betCount: Record<string, number> = {};
  for (const b of bets.data ?? []) betCount[b.game_id] = (betCount[b.game_id] ?? 0) + 1;
  const locked = new Set((locks.data ?? []).map((l: any) => l.game_id));
  return (games ?? []).map((g: any) => ({ ...g, bets: betCount[g.id] ?? 0, locked: locked.has(g.id) }));
}

function PasswordGate({ onOk }: { onOk: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    const res = await fetch("/api/admin-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw, action: "checkPassword" }),
    });
    if (!res.ok) {
      setErr("Incorrect password");
      return;
    }
    sessionStorage.setItem(PASSWORD_KEY, pw);
    onOk(pw);
  };
  return (
    <div className="oc-gate">
      <h1>TV Score Bug</h1>
      <p>Enter the admin password to control the overlay.</p>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
      <button onClick={submit}>Unlock</button>
      {err ? <div className="oc-error">{err}</div> : null}
    </div>
  );
}

export default function OverlayControlPage() {
  const [params] = useSearchParams();
  const screen = params.get("screen") || "default";
  const [password, setPassword] = useState<string | null>(() => sessionStorage.getItem(PASSWORD_KEY));
  const holdUntil = useRef(0);
  const [state, setState] = useOverlayState(screen, holdUntil);
  const { contexts, scores } = useOverlayData(state, false);
  const [day, setDay] = useState(() => etDateInput(new Date()));
  const [slate, setSlate] = useState<SlateGame[]>([]);
  const [slateErr, setSlateErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const pending = useRef<Partial<OverlayState>>({});
  const saveTimer = useRef(0);

  // The site's index.html pins a 1080px desktop viewport; this page is
  // meant for a phone too, so use the real device width while it's open.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const prev = meta?.getAttribute("content");
    meta?.setAttribute("content", "width=device-width, initial-scale=1");
    return () => {
      if (meta && prev) meta.setAttribute("content", prev);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSlateErr(null);
    fetchSlate(day)
      .then((s) => !cancelled && setSlate(s))
      .catch((e) => !cancelled && setSlateErr(e.message ?? "Couldn't load games"));
    return () => {
      cancelled = true;
    };
  }, [day]);

  // Changes apply locally at once; the save is batched so dragging a
  // slider sends one request, not fifty.
  const update = (patch: Partial<OverlayState>) => {
    if (!state || !password) return;
    setState({ ...state, ...patch });
    holdUntil.current = Date.now() + 3000;
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(saveTimer.current);
    setSaveMsg("Saving…");
    saveTimer.current = window.setTimeout(async () => {
      const body = pending.current;
      pending.current = {};
      try {
        await saveOverlayState(screen, body, password);
        setSaveMsg("Saved");
      } catch (e: any) {
        setSaveMsg(e.message ?? "Save failed");
        if (/password/i.test(e.message ?? "")) {
          sessionStorage.removeItem(PASSWORD_KEY);
          setPassword(null);
        }
      }
    }, 350);
  };

  const selected = new Set(state?.game_ids ?? []);
  const toggleGame = (id: string) => {
    if (!state) return;
    const next = selected.has(id) ? state.game_ids.filter((g) => g !== id) : [...state.game_ids, id];
    update({ game_ids: next });
  };

  const visibleSlate = useMemo(() => {
    const q = query.trim().toLowerCase();
    return slate.filter(
      (g) => (!onlyMine || g.bets > 0 || g.locked) && (!q || g.home_team.toLowerCase().includes(q) || g.away_team.toLowerCase().includes(q))
    );
  }, [slate, query, onlyMine]);

  if (!password) return <div className="page oc-page"><PasswordGate onOk={setPassword} /></div>;
  if (!state) return <div className="page oc-page"><div className="oc-gate">Loading…</div></div>;

  const selectedOffSlate = state.game_ids.filter((id) => !slate.some((g) => g.id === id));

  return (
    <div className="page oc-page">
      <div className="oc-wrap">
        <div className="oc-head">
          <h1>TV Score Bug</h1>
          <span className="oc-save">{saveMsg}</span>
        </div>

        <div className="oc-preview">
          <OverlayView state={state} contexts={contexts} scores={scores} />
          {!state.visible ? <div className="oc-hidden-tag">Hidden on TV</div> : null}
        </div>

        <div className="oc-row">
          <button className={`oc-big ${state.visible ? "on" : ""}`} onClick={() => update({ visible: !state.visible })}>
            {state.visible ? "Showing — tap to hide" : "Hidden — tap to show"}
          </button>
          <button
            className={`oc-big ${state.fullscreen ? "on" : ""}`}
            onClick={() => update(state.fullscreen ? { fullscreen: false } : { fullscreen: true, visible: true })}
          >
            {state.fullscreen ? "Full scoreboard — tap for normal" : "Normal — tap for full scoreboard"}
          </button>
        </div>

        <section className="oc-section">
          <h2>Layout</h2>
          <div className="oc-seg">
            {(["corner", "ticker"] as const).map((l) => (
              <button key={l} className={state.layout === l ? "on" : ""} onClick={() => update({ layout: l })}>
                {l === "corner" ? "Corner bug" : "Ticker"}
              </button>
            ))}
          </div>
          {state.layout === "corner" ? (
            <>
              <div className="oc-label">Corner</div>
              <div className="oc-corners">
                {(["tl", "tr", "bl", "br"] as const).map((p) => (
                  <button key={p} className={state.position === p ? "on" : ""} onClick={() => update({ position: p })}>
                    {{ tl: "↖ Top left", tr: "↗ Top right", bl: "↙ Bottom left", br: "↘ Bottom right" }[p]}
                  </button>
                ))}
              </div>
              <div className="oc-label">With several games</div>
              <div className="oc-seg">
                {[0, 8, 12, 20].map((s) => (
                  <button key={s} className={state.rotate_seconds === s ? "on" : ""} onClick={() => update({ rotate_seconds: s })}>
                    {s === 0 ? "Stack" : `Rotate ${s}s`}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="oc-label">Ticker position</div>
              <div className="oc-seg">
                {(["bottom", "top"] as const).map((t) => (
                  <button key={t} className={state.ticker_position === t ? "on" : ""} onClick={() => update({ ticker_position: t })}>
                    {t === "bottom" ? "↓ Bottom" : "↑ Top"}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className="oc-slider">
            <span>Size {Math.round(state.scale * 100)}%</span>
            <input type="range" min={0.6} max={1.6} step={0.05} value={state.scale} onChange={(e) => update({ scale: Number(e.target.value) })} />
          </label>
          <label className="oc-slider">
            <span>Spoiler delay {state.delay_seconds}s</span>
            <input type="range" min={0} max={120} step={5} value={state.delay_seconds} onChange={(e) => update({ delay_seconds: Number(e.target.value) })} />
          </label>
          <div className="oc-hint">Holds score updates back so the bug doesn't beat your stream. YouTube TV usually runs 30–90s behind.</div>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_lines} onChange={(e) => update({ show_lines: e.target.checked })} /> Show line and my numbers
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_bets} onChange={(e) => update({ show_bets: e.target.checked })} /> Show my bets
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.flash_swings} onChange={(e) => update({ flash_swings: e.target.checked })} /> Flash when a bet flips
          </label>
          <div className="oc-label">Live detail</div>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_last_play} onChange={(e) => update({ show_last_play: e.target.checked })} /> Last play
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_timeouts} onChange={(e) => update({ show_timeouts: e.target.checked })} /> Timeouts left
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_win_prob} onChange={(e) => update({ show_win_prob: e.target.checked })} /> Live win probability
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_network} onChange={(e) => update({ show_network: e.target.checked })} /> TV network (before kickoff)
          </label>
          <div className="oc-label">Size of each game</div>
          <label className="oc-check">
            <input type="checkbox" checked={state.compact} onChange={(e) => update({ compact: e.target.checked })} /> Compact: score and clock only
          </label>
          <div className="oc-hint">Compact applies to the corner bug and ticker. The full scoreboard always shows everything.</div>
        </section>

        <section className="oc-section">
          <h2>Games ({state.game_ids.length} on TV)</h2>
          <div className="oc-row oc-filters">
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <input type="search" placeholder="Search team" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="oc-check">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only my bets / locks
            </label>
          </div>
          <div className="oc-row">
            <button
              onClick={() => {
                const add = slate.filter((g) => g.bets > 0 && !selected.has(g.id)).map((g) => g.id);
                update({ game_ids: [...state.game_ids, ...add] });
              }}
            >
              Add every game I bet
            </button>
            <button onClick={() => update({ game_ids: [] })}>Clear all</button>
          </div>
          {selectedOffSlate.length ? (
            <div className="oc-hint">
              {selectedOffSlate.length} selected game{selectedOffSlate.length > 1 ? "s are" : " is"} from another day.{" "}
              <button className="oc-link" onClick={() => update({ game_ids: state.game_ids.filter((id) => !selectedOffSlate.includes(id)) })}>
                Remove
              </button>
            </div>
          ) : null}
          {slateErr ? <div className="oc-error">{slateErr}</div> : null}
          {!slateErr && slate.length === 0 ? <div className="oc-hint">No games on this date.</div> : null}
          <ul className="oc-games">
            {visibleSlate.map((g) => (
              <li key={g.id} className={selected.has(g.id) ? "on" : ""} onClick={() => toggleGame(g.id)}>
                <input type="checkbox" readOnly checked={selected.has(g.id)} />
                <span className="oc-time">
                  {g.start_date ? new Date(g.start_date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}
                </span>
                <span className="oc-match">
                  {g.away_team} @ {g.home_team}
                </span>
                <span className="oc-tags">
                  {g.bets ? <span className="oc-tag bet">{g.bets} bet{g.bets > 1 ? "s" : ""}</span> : null}
                  {g.locked ? <span className="oc-tag">locked</span> : null}
                  {g.tv_outlet ? <span className="oc-tag tv">{g.tv_outlet}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
