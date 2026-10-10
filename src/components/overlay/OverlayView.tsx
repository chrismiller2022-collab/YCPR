import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { liveBets, spreadLabel, type OverlayContext, type OverlayState, type ScoreGame, type ScoreTeam } from "../../lib/overlay";
import "../../styles/overlay.css";

// Renders the score bug(s) into whatever box it's given — the full TV
// screen on /overlay, or the 16:9 preview on /overlay/control. Every
// size is a multiple of --u (1% of the box height × the chosen scale),
// so the preview is an exact miniature of the TV.

interface Props {
  state: OverlayState;
  contexts: Record<string, OverlayContext>;
  scores: Record<string, ScoreGame>;
}

const logoUrl = (espnId: string | null) => (espnId ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png` : null);

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

function TeamRow({ team, fallbackName, hasBall, dim, showScore }: { team: ScoreTeam | undefined; fallbackName: string; hasBall: boolean; dim: boolean; showScore: boolean }) {
  const logo = logoUrl(team?.espnId ?? null);
  return (
    <div className={`ob-team${dim ? " ob-dim" : ""}`}>
      <span className="ob-stripe" style={{ background: team?.color ? `#${team.color}` : "var(--ob-gold)" }} />
      {logo ? <img className="ob-logo" src={logo} alt="" /> : <span className="ob-logo" />}
      <span className="ob-abbr">
        {team?.rank ? <span className="ob-rank">{team.rank}</span> : null}
        {team?.abbrev ?? fallbackName}
      </span>
      {hasBall ? <span className="ob-ball" /> : null}
      <span className="ob-score">{showScore ? team?.score ?? "" : ""}</span>
    </div>
  );
}

function Card({ ctx, sb, state, maxBets = 4 }: { ctx: OverlayContext; sb: ScoreGame | undefined; state: OverlayState; maxBets?: number }) {
  const homeAbbr = sb?.home.abbrev ?? ctx.game.home_team;
  const awayAbbr = sb?.away.abbrev ?? ctx.game.away_team;
  const final = sb?.state === "post";
  const started = !!sb && sb.state !== "pre"; // ESPN reports 0–0 before kickoff
  const hs = sb?.home.score ?? 0;
  const as = sb?.away.score ?? 0;
  const bets = state.show_bets ? liveBets(ctx, sb) : [];
  const line = spreadLabel(ctx.line?.spread ?? null, homeAbbr, awayAbbr);
  const mine = spreadLabel(ctx.myHomeSpread, homeAbbr, awayAbbr);
  const total = ctx.line?.over_under ?? null;

  return (
    <div className="ob-card">
      <TeamRow team={sb?.away} fallbackName={ctx.game.away_team} hasBall={sb?.state === "in" && sb.possession === sb.away.espnId} dim={final && as < hs} showScore={started} />
      <TeamRow team={sb?.home} fallbackName={ctx.game.home_team} hasBall={sb?.state === "in" && sb.possession === sb.home.espnId} dim={final && hs < as} showScore={started} />
      <div className={`ob-status${sb?.redZone ? " ob-redzone" : ""}`}>
        <span>{statusText(sb, ctx)}</span>
        {sb?.state === "in" && sb.downDistance ? <span className="ob-dd">{sb.downDistance}</span> : null}
      </div>
      {state.show_lines && (line || total != null || mine || ctx.myTotal != null) ? (
        <div className="ob-lines">
          {line || total != null ? (
            <span>
              <b>Line</b> {line ?? ""}
              {total != null ? ` · ${total}` : ""}
            </span>
          ) : null}
          {mine || ctx.myTotal != null ? (
            <span>
              <b>Mine</b> {mine ?? ""}
              {ctx.myTotal != null ? ` · ${Math.round(ctx.myTotal * 2) / 2}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      {bets.length ? (
        <div className="ob-bets">
          {bets.slice(0, maxBets).map((b) => (
            <span key={b.key} className={`ob-bet ob-${b.status}`}>
              <span className="ob-dot" />
              {b.label}
              {b.count > 1 ? <span className="ob-note">×{b.count}</span> : null}
              {b.note ? <span className="ob-note">{b.note}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TickerItem({ ctx, sb, state }: { ctx: OverlayContext; sb: ScoreGame | undefined; state: OverlayState }) {
  const bets = state.show_bets ? liveBets(ctx, sb) : [];
  const side = (t: ScoreTeam | undefined, fallback: string) => (
    <span className="ot-team">
      {t?.espnId ? <img className="ot-logo" src={logoUrl(t.espnId)!} alt="" /> : null}
      {t?.abbrev ?? fallback}
      <b>{sb && sb.state !== "pre" ? t?.score ?? "" : ""}</b>
    </span>
  );
  return (
    <span className="ot-item">
      {side(sb?.away, ctx.game.away_team)}
      {side(sb?.home, ctx.game.home_team)}
      <span className="ot-status">{statusText(sb, ctx)}</span>
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

// "Full scoreboard": every selected game in one opaque grid covering ~90%
// of the screen. Card size shrinks with the number of rows so up to ~16
// games still fit without scrolling.
function FullBoard({ ids, contexts, scores, state, unit }: { ids: string[]; contexts: Record<string, OverlayContext>; scores: Record<string, ScoreGame>; state: OverlayState; unit: number }) {
  const n = ids.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  // ~24 units is a typical card with lines and a couple of bets; fit the rows into the ~78 units below the header.
  const fit = Math.min(1.5, 78 / (rows * 24));
  const live = ids.filter((id) => scores[id]?.state === "in").length;
  const final = ids.filter((id) => scores[id]?.state === "post").length;
  return (
    <div className="ob-full" style={{ ["--u" as any]: `${unit * fit}px` }}>
      <div className="ob-full-head">
        <span className="ob-full-title">YCPR Scoreboard</span>
        <span className="ob-full-meta">
          {n} game{n === 1 ? "" : "s"}
          {live ? ` · ${live} live` : ""}
          {final ? ` · ${final} final` : ""}
        </span>
      </div>
      <div className="ob-full-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {ids.map((id) => (
          <Card key={id} ctx={contexts[id]} sb={scores[id]} state={state} maxBets={8} />
        ))}
      </div>
    </div>
  );
}

export default function OverlayView({ state, contexts, scores }: Props) {
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

  const ids = state.game_ids.filter((id) => contexts[id]);
  const rotate = state.layout === "corner" && state.rotate_seconds > 0 && ids.length > 1;

  useEffect(() => {
    if (!rotate) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), state.rotate_seconds * 1000);
    return () => window.clearInterval(timer);
  }, [rotate, state.rotate_seconds]);

  const u = (height / 100) * (state.scale || 1);
  const shown = rotate ? [ids[tick % ids.length]] : ids.slice(0, 4);

  return (
    <div className="ob-root" ref={box} style={{ ["--u" as any]: `${u}px` }}>
      {state.visible && ids.length > 0 ? (
        state.fullscreen ? (
          <FullBoard ids={ids} contexts={contexts} scores={scores} state={state} unit={height / 100} />
        ) : state.layout === "ticker" ? (
          <Ticker top={state.ticker_position === "top"} items={ids.map((id) => <TickerItem key={id} ctx={contexts[id]} sb={scores[id]} state={state} />)} />
        ) : (
          <div className={`ob-corner ob-${state.position}`}>
            {shown.map((id) => (
              <Card key={id} ctx={contexts[id]} sb={scores[id]} state={state} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
