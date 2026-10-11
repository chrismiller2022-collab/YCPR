import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeIds, liveBets, projection, type OverlayContext, type OverlayState, type ScoreGame, type ScoreTeam } from "../../lib/overlay";
import "../../styles/overlay.css";

// Renders the score bug(s) into whatever box it's given — the full TV
// screen on /overlay, or the 16:9 preview on /overlay/control. Every
// size is a multiple of --u (1% of the box height × the chosen scale),
// so the preview is an exact miniature of the TV.

interface Props {
  state: OverlayState;
  contexts: Record<string, OverlayContext>;
  scores: Record<string, ScoreGame>;
  /** The control page's miniature: the expanded pop-up is position:fixed and would cover the page, so show a label instead. */
  preview?: boolean;
}

// The site's matchup pop-up, loaded only when something is expanded so the
// TV page stays light the rest of the time.
const MatchupHandicapPopup = lazy(() => import("../MatchupHandicapPopup"));

// "Expand": the same matchup pop-up as the Matchups page, over the TV. The
// remote can't reach the overlay, so the panel scrolls itself top to bottom,
// pauses, and starts over.
function ExpandedMatchup({ ctx }: { ctx: OverlayContext }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let pauseUntil = Date.now() + 10000; // time to read the header first
    let sized: HTMLElement | null = null;
    const timer = window.setInterval(() => {
      const panel = wrap.current?.querySelector<HTMLElement>(":scope > div > div");
      if (!panel) return;
      if (panel !== sized) {
        // The pop-up is a fixed 780px wide; scale it to ~80% of the screen
        // width (capped) so it reads from the couch, and keep it inside 90vh.
        const z = Math.max(1, Math.min(1.8, (window.innerWidth * 0.8) / 780));
        panel.style.setProperty("zoom", String(z));
        panel.style.maxHeight = `${90 / z}vh`;
        sized = panel;
      }
      if (Date.now() < pauseUntil) return;
      if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1) {
        pauseUntil = Date.now() + 6000;
        window.setTimeout(() => panel.scrollTo({ top: 0 }), 5000);
      } else {
        panel.scrollTop += 1;
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [ctx.game.id]);
  return (
    <div className="ob-expand" ref={wrap}>
      <Suspense fallback={null}>
        <MatchupHandicapPopup season={ctx.game.season} week={ctx.game.week} awayTeam={ctx.game.away_team} homeTeam={ctx.game.home_team} onClose={() => {}} />
      </Suspense>
    </div>
  );
}

// Same palette as odds.ts spreadColor (green favorite → gray pick'em → red
// underdog), copied so the TV bundle doesn't pull in odds.ts's tables.
function spreadColor(v: number): string {
  const c = Math.max(-15, Math.min(15, v));
  const to = c <= 0 ? [90, 168, 105] : [196, 92, 82];
  const k = Math.abs(c) / 15;
  return `rgb(${[143, 167, 154].map((n, i) => Math.round(n + (to[i] - n) * k)).join(",")})`;
}
const fmtSpread = (v: number | null) => (v == null ? "–" : v === 0 ? "PK" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtTotal = (v: number | null) => (v == null ? "–" : v.toFixed(1));

function Hit({ ok }: { ok: boolean | null }) {
  if (ok == null) return null;
  return <span className={`ob-hit ${ok ? "ok" : "no"}`}>{ok ? "✓" : "✗"}</span>;
}

const logoUrl = (espnId: string | null) => (espnId ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png` : null);
// ESPN sends each team's logo URL (NFL logos live elsewhere than college ones); fall back to the college path.
const teamLogo = (t: ScoreTeam | undefined) => t?.logo ?? logoUrl(t?.espnId ?? null);

function statusText(sb: ScoreGame | undefined, ctx: OverlayContext): string {
  if (!sb || sb.state === "pre") {
    const start = sb?.start ?? ctx.game.start_date;
    if (!start) return "";
    const d = new Date(start);
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  }
  return sb.detail;
}

function TeamRow({ team, fallbackName, hasBall, dim, showScore, timeouts, winPct }: { team: ScoreTeam | undefined; fallbackName: string; hasBall: boolean; dim: boolean; showScore: boolean; timeouts?: number | null; winPct?: number | null }) {
  const logo = teamLogo(team);
  return (
    <div className={`ob-team${dim ? " ob-dim" : ""}`}>
      <span className="ob-stripe" style={{ background: team?.color ? `#${team.color}` : "var(--ob-gold)" }} />
      {logo ? <img className="ob-logo" src={logo} alt="" /> : <span className="ob-logo" />}
      <span className="ob-abbr">
        {team?.rank ? <span className="ob-rank">{team.rank}</span> : null}
        {team?.abbrev ?? fallbackName}
        {!showScore && team?.record ? <span className="ob-record">{team.record}</span> : null}
      </span>
      {timeouts != null ? (
        <span className="ob-tos" title={`${timeouts} timeouts left`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < timeouts ? "on" : ""} />
          ))}
        </span>
      ) : null}
      {hasBall ? <span className="ob-ball" /> : null}
      {winPct != null ? <span className="ob-winpct">{Math.round(winPct * 100)}%</span> : null}
      <span className="ob-score">{showScore ? team?.score ?? "" : ""}</span>
    </div>
  );
}

// Field position: a mini field with each end zone in its team's color
// (away on the left, home on the right, matching the card's order), the
// ball where it is in the color of the team that has it, an arrow for the
// direction they're going, a yellow first-down line and the red zone
// shaded. ESPN's yardLine is yards from the home goal line.
function FieldBar({ sb }: { sb: ScoreGame }) {
  if (sb.yardLine == null) return null;
  const homeBall = sb.possession != null && sb.possession === sb.home.espnId;
  const awayBall = sb.possession != null && sb.possession === sb.away.espnId;
  const x = (yards: number) => `${100 - Math.max(0, Math.min(100, yards))}%`; // % from the left (away) goal line
  const color = (t: ScoreTeam) => (t.color ? `#${t.color}` : "var(--ob-dim)");
  // Offense attacks the away goal (left) when home has the ball.
  const toGo = sb.distance != null && (homeBall || awayBall) ? sb.yardLine + (homeBall ? sb.distance : -sb.distance) : null;
  return (
    <div className="ob-field">
      <span className="ob-ez" style={{ background: color(sb.away) }}>{sb.away.abbrev}</span>
      <span className="ob-turf">
        {awayBall ? <span className="ob-rz" style={{ left: "80%", right: 0 }} /> : null}
        {homeBall ? <span className="ob-rz" style={{ left: 0, right: "80%" }} /> : null}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
          <span key={y} className={`ob-yd${y === 50 ? " mid" : ""}`} style={{ left: `${y}%` }} />
        ))}
        {toGo != null && toGo > 0 && toGo < 100 ? <span className="ob-togo" style={{ left: x(toGo) }} /> : null}
        <span
          className={`ob-fball${homeBall ? " left" : awayBall ? " right" : ""}`}
          style={{ left: x(sb.yardLine), background: homeBall ? color(sb.home) : awayBall ? color(sb.away) : "var(--ob-chalk)" }}
        />
      </span>
      <span className="ob-ez" style={{ background: color(sb.home) }}>{sb.home.abbrev}</span>
    </div>
  );
}

// Tile-style block, same layout as the social graphics (MatchupGridGraphic):
// spread on the left, total on the right; Vegas, YCPR, my call; then the
// final ATS / O-U result with a ✓/✗ on my calls once the game is over; and
// my projected score.
function ProjBlock({ ctx, sb, showProb }: { ctx: OverlayContext; sb: ScoreGame | undefined; showProb: boolean }) {
  const p = projection(ctx, sb);
  if (p.vegasAwaySpread == null && p.myAwaySpread == null && p.vegasTotal == null && p.myTotal == null) return null;
  const team = (side: "away" | "home") => {
    const t = side === "away" ? sb?.away : sb?.home;
    const logo = teamLogo(t);
    const name = t?.abbrev ?? (side === "away" ? ctx.game.away_team : ctx.game.home_team);
    return logo ? <img className="ob-mini-logo" src={logo} alt={name} /> : <b>{name}</b>;
  };
  const final = p.atsResult != null || p.totalResult != null;
  const coverHit = final && p.projCover && p.atsResult ? (p.atsResult === "push" ? null : p.projCover === p.atsResult) : null;
  const totalHit = final && p.projTotal && p.totalResult ? (p.totalResult === "Push" ? null : p.projTotal === p.totalResult) : null;
  const awayName = sb?.away.abbrev ?? ctx.game.away_team;
  const homeName = sb?.home.abbrev ?? ctx.game.home_team;
  // NFL (and any college game without a lock) has no YCPR numbers: just Vegas, then results.
  const mine = p.myAwaySpread != null || p.myTotal != null;
  return (
    <div className="ob-proj">
      <span>
        <i>Vegas</i> {fmtSpread(p.vegasAwaySpread)}
      </span>
      <span>
        <i>Vegas Total</i> {fmtTotal(p.vegasTotal)}
      </span>
      {mine ? (
        <>
      <span>
        <i>YCPR</i> <b style={p.myAwaySpread != null ? { color: spreadColor(p.myAwaySpread) } : undefined}>{fmtSpread(p.myAwaySpread)}</b>
      </span>
      <span>
        <i>YCPR Total</i> <b>{fmtTotal(p.myTotal)}</b>
      </span>
      <span>
        <i>Proj Cover</i> {p.projCover ? team(p.projCover) : "–"}
        <Hit ok={coverHit} />
        {showProb && p.coverProb != null ? <span className="ob-prob">{Math.round(p.coverProb * 100)}%</span> : null}
      </span>
      <span>
        <i>Proj</i> <b>{p.projTotal ?? "–"}</b>
        <Hit ok={totalHit} />
        {showProb && p.totalProb != null ? <span className="ob-prob">{Math.round(p.totalProb * 100)}%</span> : null}
      </span>
        </>
      ) : null}
      {final ? (
        <>
          <span>
            <i>ATS</i> {p.atsResult === "push" ? <b>Push</b> : p.atsResult ? team(p.atsResult) : "–"}
          </span>
          <span>
            <i>Result</i> <b>{p.totalResult ?? "–"}</b>
          </span>
        </>
      ) : null}
      {p.projAway != null && p.projHome != null ? (
        <span className="ob-proj-score">
          <i>Proj score</i> {awayName} {Math.round(p.projAway)} – {homeName} {Math.round(p.projHome)}
        </span>
      ) : null}
    </div>
  );
}

function Card({ ctx, sb, state, maxBets = 4, full = false, flips }: { ctx: OverlayContext; sb: ScoreGame | undefined; state: OverlayState; maxBets?: number; full?: boolean; flips?: Set<string> }) {
  // Compact (score + clock only) applies to the corner bug; the full scoreboard always shows everything.
  const compact = state.compact && !full;
  const live = sb?.state === "in";
  const homeAbbr = sb?.home.abbrev ?? ctx.game.home_team;
  const awayAbbr = sb?.away.abbrev ?? ctx.game.away_team;
  const final = sb?.state === "post";
  const started = !!sb && sb.state !== "pre"; // ESPN reports 0–0 before kickoff
  const hs = sb?.home.score ?? 0;
  const as = sb?.away.score ?? 0;
  const bets = state.show_bets && !compact ? liveBets(ctx, sb) : [];
  const flashing = bets.some((b) => flips?.has(`${ctx.game.id}|${b.key}`));
  const tos = live && state.show_timeouts && !compact ? sb?.timeouts ?? null : null;
  const winPct = live && state.show_win_prob && !compact && sb?.homeWinPct != null ? sb.homeWinPct : null;
  const lastPlay = live && state.show_last_play && !compact ? sb?.lastPlay ?? null : null;
  const network = !started && state.show_network ? sb?.network ?? null : null;

  return (
    <div className={`ob-card${flashing ? " ob-flash" : ""}`}>
      <TeamRow team={sb?.away} fallbackName={ctx.game.away_team} hasBall={live && sb!.possession === sb!.away.espnId} dim={final && as < hs} showScore={started} timeouts={tos?.away} winPct={winPct != null ? 1 - winPct : null} />
      <TeamRow team={sb?.home} fallbackName={ctx.game.home_team} hasBall={live && sb!.possession === sb!.home.espnId} dim={final && hs < as} showScore={started} timeouts={tos?.home} winPct={winPct} />
      <div className={`ob-status${sb?.redZone ? " ob-redzone" : ""}`}>
        <span>{statusText(sb, ctx)}</span>
        {live && sb?.downDistance ? <span className="ob-dd">{sb.downDistance}</span> : null}
        {network ? <span className="ob-dd">{network}</span> : null}
      </div>
      {live && state.show_field && !compact && sb ? <FieldBar sb={sb} /> : null}
      {lastPlay ? <div className="ob-play">{lastPlay}</div> : null}
      {state.show_lines && !compact ? <ProjBlock ctx={ctx} sb={sb} showProb={state.show_cover_prob} /> : null}
      {bets.length ? (
        <div className="ob-bets">
          {bets.slice(0, maxBets).map((b) => (
            <span key={b.key} className={`ob-bet ob-${b.status}${flips?.has(`${ctx.game.id}|${b.key}`) ? " ob-flip" : ""}`}>
              <span className="ob-dot" />
              {b.label}
              {b.count > 1 ? <span className="ob-note">×{b.count}</span> : null}
              {b.note ? <span className="ob-note">{b.note}</span> : null}
              {state.show_cover_prob && b.prob != null ? <span className="ob-prob">{Math.round(b.prob * 100)}%</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TickerItem({ ctx, sb, state }: { ctx: OverlayContext; sb: ScoreGame | undefined; state: OverlayState }) {
  const bets = state.show_bets && !state.compact ? liveBets(ctx, sb) : [];
  const network = state.show_network && (!sb || sb.state === "pre") ? sb?.network ?? null : null;
  const side = (t: ScoreTeam | undefined, fallback: string) => (
    <span className="ot-team">
      {teamLogo(t) ? <img className="ot-logo" src={teamLogo(t)!} alt="" /> : null}
      {t?.abbrev ?? fallback}
      <b>{sb && sb.state !== "pre" ? t?.score ?? "" : ""}</b>
    </span>
  );
  return (
    <span className="ot-item">
      {side(sb?.away, ctx.game.away_team)}
      {side(sb?.home, ctx.game.home_team)}
      <span className="ot-status">
        {statusText(sb, ctx)}
        {network ? ` · ${network}` : ""}
      </span>
      {bets.map((b) => (
        <span key={b.key} className={`ob-bet ob-${b.status}`}>
          <span className="ob-dot" />
          {b.label}
          {b.note ? <span className="ob-note">{b.note}</span> : null}
        </span>
      ))}
    </span>
  );
}

function Ticker({ items, top }: { items: JSX.Element[]; top: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);

  // Only scroll when the row doesn't fit; the duration scales with
  // length so it reads at the same speed however many games there are.
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const w = scroll ? i.scrollWidth / 2 : i.scrollWidth;
    setScroll(w > o.clientWidth ? w : 0);
  });

  const style = scroll ? { animationDuration: `${Math.max(20, scroll / 60)}s` } : undefined;
  return (
    <div className={`ot-bar${top ? " ot-top" : ""}`} ref={outer}>
      <div className={`ot-track${scroll ? " ot-scroll" : ""}`} ref={inner} style={style}>
        {items}
        {scroll ? items.map((el, k) => <span key={`dup${k}`}>{el}</span>) : null}
      </div>
    </div>
  );
}

// Bet-swing flash: remembers each live bet's last status and, when one
// flips between covering and not covering, flags it for ~8 seconds. Runs
// on the same (spoiler-delayed) scores the bug draws, so the flash lands
// with the play, not before it.
function useSwingFlips(ids: string[], contexts: Record<string, OverlayContext>, scores: Record<string, ScoreGame>, enabled: boolean): Set<string> {
  const prev = useRef<Map<string, string>>(new Map());
  const [flips, setFlips] = useState<Set<string>>(new Set());

  useEffect(() => {
    const changed: string[] = [];
    for (const id of ids) {
      const ctx = contexts[id];
      const sb = scores[id];
      if (!ctx || !sb) continue;
      for (const b of liveBets(ctx, sb)) {
        const key = `${id}|${b.key}`;
        // Remember the game state too: only a change seen while the game was
        // live both times counts (not e.g. a stored final giving way to ESPN).
        const now = `${sb.state}:${b.status}`;
        const before = prev.current.get(key);
        prev.current.set(key, now);
        if (enabled && (now === "in:up" || now === "in:down") && (before === "in:up" || before === "in:down") && before !== now) {
          changed.push(key);
        }
      }
    }
    if (!changed.length) return;
    setFlips((cur) => new Set([...cur, ...changed]));
    const timer = window.setTimeout(() => setFlips((cur) => new Set([...cur].filter((k) => !changed.includes(k)))), 8000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, contexts, enabled]);

  return flips;
}

// "Full scoreboard": every selected game in one opaque grid covering ~90%
// of the screen. Card size shrinks with the number of rows so up to ~16
// games still fit without scrolling.
function FullBoard({ ids, contexts, scores, state, unit, flips }: { ids: string[]; contexts: Record<string, OverlayContext>; scores: Record<string, ScoreGame>; state: OverlayState; unit: number; flips: Set<string> }) {
  const n = ids.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  // Start from an estimate (~30 units per card), then measure: if the grid
  // overflows the panel, shrink until it fits; if there's lots of room
  // after a shrink, grow back. Card heights vary with bets/last play.
  const guess = Math.min(1.5, 78 / (rows * 30));
  const grid = useRef<HTMLDivElement>(null);
  const [adj, setAdj] = useState(1);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el || !el.clientHeight) return;
    const ratio = el.clientHeight / el.scrollHeight;
    if (ratio < 0.995) setAdj((a) => a * ratio * 0.98);
    else if (ratio > 1.2 && adj < 1) setAdj((a) => Math.min(1, a * Math.min(ratio, 1.15)));
  });
  const fit = guess * adj;
  const live = ids.filter((id) => scores[id]?.state === "in").length;
  const final = ids.filter((id) => scores[id]?.state === "post").length;
  return (
    <div className="ob-full" style={{ ["--u" as any]: `${unit * fit}px`, ["--ob-full-a" as any]: state.full_opacity ?? 1 }}>
      <div className="ob-full-head">
        <span className="ob-full-title">{state.league === "nfl" ? "NFL Scoreboard" : "YCPR Scoreboard"}</span>
        <span className="ob-full-meta">
          {n} game{n === 1 ? "" : "s"}
          {live ? ` · ${live} live` : ""}
          {final ? ` · ${final} final` : ""}
        </span>
      </div>
      <div className="ob-full-grid" ref={grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {ids.map((id) => (
          <Card key={id} ctx={contexts[id]} sb={scores[id]} state={state} maxBets={8} full flips={flips} />
        ))}
      </div>
    </div>
  );
}

export default function OverlayView({ state, contexts, scores, preview = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const ids = activeIds(state).filter((id) => contexts[id]);
  const rotate = state.layout === "corner" && state.rotate_seconds > 0 && ids.length > 1;
  const flips = useSwingFlips(ids, contexts, scores, state.flash_swings);

  useEffect(() => {
    if (!rotate) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), state.rotate_seconds * 1000);
    return () => window.clearInterval(timer);
  }, [rotate, state.rotate_seconds]);

  const u = (height / 100) * (state.scale || 1);
  const shown = rotate ? [ids[tick % ids.length]] : ids.slice(0, 4);
  // College only: the pop-up runs on this site's ratings.
  const expanded = state.league !== "nfl" && state.expand_game_id ? contexts[state.expand_game_id] : undefined;

  return (
    <div className="ob-root" ref={box} style={{ ["--u" as any]: `${u}px` }}>
      {state.visible && expanded ? (
        preview ? (
          <div className="ob-expand-tag">
            Matchup pop-up on TV: {expanded.game.away_team} @ {expanded.game.home_team}
          </div>
        ) : (
          <ExpandedMatchup ctx={expanded} />
        )
      ) : state.visible && ids.length > 0 ? (
        state.fullscreen ? (
          <FullBoard ids={ids} contexts={contexts} scores={scores} state={state} unit={height / 100} flips={flips} />
        ) : state.layout === "ticker" ? (
          <Ticker top={state.ticker_position === "top"} items={ids.map((id) => <TickerItem key={id} ctx={contexts[id]} sb={scores[id]} state={state} />)} />
        ) : (
          <div className={`ob-corner ob-${state.position}`}>
            {shown.map((id) => (
              <Card key={id} ctx={contexts[id]} sb={scores[id]} state={state} flips={flips} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
