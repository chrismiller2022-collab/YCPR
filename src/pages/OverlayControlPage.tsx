import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import OverlayView from "../components/overlay/OverlayView";
import { supabase } from "../lib/supabaseClient";
import { passkeysSupported, restorePasskeySession, signInWithPasskey } from "../lib/adminAuth";
import { espnDate, fetchScoreboard, needsFantasy, saveOverlayState, useOverlayData, useOverlayState, type OverlayState, type ScoreGame } from "../lib/overlay";
import { POOLS, usePoolPicksForGames, usePoolsBoard } from "../lib/pools";
import { fetchSleeperLeagues, useSleeper, type SleeperLeagueInfo } from "../lib/sleeper";

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

// NFL picker: one ESPN week at a time (no Supabase data for NFL). Changing
// the week here also moves the TV to that week.
function NflGames({ state, update }: { state: OverlayState; update: (p: Partial<OverlayState>) => void }) {
  const [games, setGames] = useState<ScoreGame[]>([]);
  const [week, setWeek] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetchScoreboard(`league=nfl${state.nfl_week ? `&week=${state.nfl_week}` : ""}`)
      .then((r) => {
        if (cancelled) return;
        setGames([...r.games].sort((a, b) => a.start.localeCompare(b.start)));
        setWeek(r.week);
      })
      .catch((e) => !cancelled && setErr(e.message ?? "Couldn't load NFL games"));
    return () => {
      cancelled = true;
    };
  }, [state.nfl_week]);

  const selected = new Set(state.nfl_game_ids);
  const toggle = (id: string) => update({ nfl_game_ids: selected.has(id) ? state.nfl_game_ids.filter((g) => g !== id) : [...state.nfl_game_ids, id] });
  const offWeek = state.nfl_game_ids.filter((id) => !games.some((g) => g.id === id));
  const status = (g: ScoreGame) =>
    g.state === "pre"
      ? new Date(g.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
      : `${g.away.abbrev} ${g.away.score} – ${g.home.abbrev} ${g.home.score} · ${g.detail}`;

  return (
    <section className="oc-section">
      <h2>NFL games ({state.nfl_game_ids.length} on TV)</h2>
      <div className="oc-row">
        <button disabled={!week || week <= 1} onClick={() => week && update({ nfl_week: week - 1 })}>
          ◀
        </button>
        <b>Week {week ?? "…"}</b>
        <button disabled={!week || week >= 18} onClick={() => week && update({ nfl_week: week + 1 })}>
          ▶
        </button>
        {state.nfl_week != null ? <button onClick={() => update({ nfl_week: null })}>This week</button> : null}
      </div>
      <div className="oc-row">
        <button onClick={() => update({ nfl_game_ids: [...state.nfl_game_ids, ...games.filter((g) => !selected.has(g.id)).map((g) => g.id)] })}>Add all</button>
        <button onClick={() => update({ nfl_game_ids: [] })}>Clear all</button>
      </div>
      {offWeek.length ? (
        <div className="oc-hint">
          {offWeek.length} selected game{offWeek.length > 1 ? "s are" : " is"} from another week.{" "}
          <button className="oc-link" onClick={() => update({ nfl_game_ids: state.nfl_game_ids.filter((id) => !offWeek.includes(id)) })}>
            Remove
          </button>
        </div>
      ) : null}
      {err ? <div className="oc-error">{err}</div> : null}
      <ul className="oc-games">
        {games.map((g) => (
          <li key={g.id} className={selected.has(g.id) ? "on" : ""} onClick={() => toggle(g.id)}>
            <input type="checkbox" readOnly checked={selected.has(g.id)} />
            <span className="oc-time">{g.state === "in" ? "LIVE" : g.state === "post" ? "Final" : ""}</span>
            <span className="oc-match">
              {g.away.name} @ {g.home.name}
            </span>
            <span className="oc-tags">
              <span className="oc-tag">{status(g)}</span>
              {g.odds?.details ? <span className="oc-tag bet">{g.odds.details}</span> : null}
              {g.network ? <span className="oc-tag tv">{g.network}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Sleeper: username, then a checklist of that user's leagues this season.
// No leagues ticked = all of them.
function SleeperSection({ state, update }: { state: OverlayState; update: (p: Partial<OverlayState>) => void }) {
  const [name, setName] = useState(state.sleeper_username ?? "");
  const [leagues, setLeagues] = useState<SleeperLeagueInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!state.sleeper_username) return setLeagues([]);
    let cancelled = false;
    setErr(null);
    fetchSleeperLeagues(state.sleeper_username)
      .then((l) => !cancelled && setLeagues(l))
      .catch((e) => !cancelled && setErr(e.message ?? "Couldn't load leagues"));
    return () => {
      cancelled = true;
    };
  }, [state.sleeper_username]);

  const saveName = () => {
    const v = name.trim() || null;
    if (v !== state.sleeper_username) update({ sleeper_username: v, sleeper_league_ids: [] });
  };
  const all = state.sleeper_league_ids.length === 0;
  const isOn = (id: string) => all || state.sleeper_league_ids.includes(id);
  const toggle = (id: string) => {
    const current = all ? leagues.map((l) => l.id) : state.sleeper_league_ids;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    // Everything ticked again collapses back to "all".
    update({ sleeper_league_ids: next.length === leagues.length ? [] : next });
  };

  return (
    <section className="oc-section">
      <h2>Fantasy (Sleeper)</h2>
      <div className="oc-row">
        <input type="search" placeholder="Sleeper username" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && saveName()} />
      </div>
      {err ? <div className="oc-error">{err}</div> : null}
      {leagues.length ? (
        <>
          <div className="oc-label">Leagues to include{all ? " (all)" : ` (${state.sleeper_league_ids.length} of ${leagues.length})`}</div>
          {leagues.map((l) => (
            <label key={l.id} className="oc-check">
              <input type="checkbox" checked={isOn(l.id)} onChange={() => toggle(l.id)} /> {l.name}
            </label>
          ))}
          <label className="oc-check">
            <input type="checkbox" checked={state.show_fantasy_players} onChange={(e) => update({ show_fantasy_players: e.target.checked })} /> Show my players on NFL game cards
          </label>
        </>
      ) : null}
    </section>
  );
}

function PasswordGate({ onOk }: { onOk: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const passkey = async () => {
    setErr(null);
    try {
      await signInWithPasskey();
      onOk(sessionStorage.getItem(PASSWORD_KEY) ?? "");
    } catch (e: any) {
      setErr(e?.message ?? "Passkey sign-in failed");
    }
  };
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
      {passkeysSupported() ? <button onClick={passkey}>Sign in with passkey</button> : null}
      {err ? <div className="oc-error">{err}</div> : null}
    </div>
  );
}

export default function OverlayControlPage() {
  const [params] = useSearchParams();
  const screen = params.get("screen") || "default";
  const [password, setPassword] = useState<string | null>(() => {
    restorePasskeySession(); // a device signed in with a passkey in the last 14 days is already signed in
    return sessionStorage.getItem(PASSWORD_KEY);
  });
  const holdUntil = useRef(0);
  const [state, setState] = useOverlayState(screen, holdUntil);
  const { contexts, scores } = useOverlayData(state, false);
  const fantasy = useSleeper(state?.sleeper_username ?? null, state?.sleeper_league_ids ?? [], needsFantasy(state));
  const cfbOn = !!state && state.league !== "nfl" && state.visible;
  const poolPicks = usePoolPicksForGames(cfbOn ? state!.game_ids : [], state?.pool_keys ?? [], cfbOn && state!.pick_source !== "bets");
  const pools = usePoolsBoard(state?.pool_keys ?? [], !!state?.visible && !!state?.pools_full);
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
          <OverlayView state={state} contexts={contexts} scores={scores} preview fantasy={fantasy} poolPicks={poolPicks} pools={pools} />
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
        <div className="oc-row">
          <button className={`oc-big ${state.pools_full ? "on" : ""}`} onClick={() => update(state.pools_full ? { pools_full: false } : { pools_full: true, fantasy_full: false, visible: true })}>
            {state.pools_full ? "Pools full screen — tap to close" : "Pools full screen"}
          </button>
        </div>
        {state.sleeper_username ? (
          <div className="oc-row">
            <button className={`oc-big ${state.fantasy_full ? "on" : ""}`} onClick={() => update(state.fantasy_full ? { fantasy_full: false } : { fantasy_full: true, pools_full: false, visible: true })}>
              {state.fantasy_full ? "Fantasy full screen — tap to close" : "Fantasy full screen"}
            </button>
          </div>
        ) : null}
        {state.league !== "nfl" && state.game_ids.some((id) => contexts[id]) ? (
          <div className="oc-expand">
            <div className="oc-label">Expand a game into its matchup pop-up on the TV</div>
            <div className="oc-expand-list">
              {state.game_ids
                .filter((id) => contexts[id])
                .map((id) => {
                  const g = contexts[id].game;
                  const on = state.expand_game_id === id;
                  return (
                    <button key={id} className={on ? "on" : ""} onClick={() => update({ expand_game_id: on ? null : id, visible: true })}>
                      {on ? "✕ Close " : "⤢ "}
                      {scores[id]?.away.abbrev ?? g.away_team} @ {scores[id]?.home.abbrev ?? g.home_team}
                    </button>
                  );
                })}
            </div>
          </div>
        ) : null}
        <div className="oc-seg oc-league">
          {(["cfb", "nfl"] as const).map((l) => (
            <button key={l} className={state.league === l ? "on" : ""} onClick={() => update({ league: l })}>
              {l === "cfb" ? "College" : "NFL"}
            </button>
          ))}
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
            <span>Full scoreboard background {Math.round((state.full_opacity ?? 1) * 100)}%</span>
            <input type="range" min={0.3} max={1} step={0.05} value={state.full_opacity ?? 1} onChange={(e) => update({ full_opacity: Number(e.target.value) })} />
          </label>
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
            <input type="checkbox" checked={state.show_lines} onChange={(e) => update({ show_lines: e.target.checked })} /> Show Vegas vs. my numbers (spread, total, proj cover, proj score)
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_bets} onChange={(e) => update({ show_bets: e.target.checked })} /> Show my bets
          </label>
          <div className="oc-label">Chips on each game</div>
          <div className="oc-seg">
            {(["bets", "pools", "both"] as const).map((k) => (
              <button key={k} className={state.pick_source === k ? "on" : ""} onClick={() => update({ pick_source: k })}>
                {k === "bets" ? "My bets" : k === "pools" ? "Pool picks" : "Both"}
              </button>
            ))}
          </div>
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
            <input type="checkbox" checked={state.show_field} onChange={(e) => update({ show_field: e.target.checked })} /> Field position
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_win_prob} onChange={(e) => update({ show_win_prob: e.target.checked })} /> Live win probability (beside the score)
          </label>
          <label className="oc-check">
            <input type="checkbox" checked={state.show_cover_prob} onChange={(e) => update({ show_cover_prob: e.target.checked })} /> Live cover / over % on my bets and calls
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

        {state.league === "nfl" ? <NflGames state={state} update={update} /> : (
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
        )}
        <section className="oc-section">
          <h2>Pools</h2>
          <div className="oc-label">Pools to include{state.pool_keys.length ? ` (${state.pool_keys.length} of ${POOLS.length})` : " (all)"}</div>
          {POOLS.map((p) => {
            const all = state.pool_keys.length === 0;
            const on = all || state.pool_keys.includes(p.key);
            return (
              <label key={p.key} className="oc-check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const cur = all ? POOLS.map((x) => x.key as string) : state.pool_keys;
                    const next = cur.includes(p.key) ? cur.filter((k) => k !== p.key) : [...cur, p.key];
                    update({ pool_keys: next.length === POOLS.length ? [] : next });
                  }}
                />{" "}
                {p.name}
              </label>
            );
          })}
          <div className="oc-hint">Used by the Pools full screen and by "Pool picks" chips. Confidence pools and Survivor aren't included.</div>
        </section>
        <SleeperSection state={state} update={update} />
      </div>
    </div>
  );
}
