import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAdminWeek } from "../lib/adminWeek";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { espnDate, fetchOverlayContext, liveBets, useDelayed, useScoreboard, type OverlayContext, type ScoreGame } from "../lib/overlay";
import { gradePick, usePoolPicksForGames } from "../lib/pools";

// Admin Scoreboard: a tile per game, live from ESPN (same feed and polling as the TV overlay), for the admin week's
// games as CFBD assigns them (so a Tuesday or Friday game lands in the right week). Tiles scale with a size slider and
// reflow to fit the screen. A tile flashes on a score, on entering the red zone and on a 30+ yard play.

type Show = "all" | "selected" | "action";
type Matchup = "fbs" | "all" | "fcs" | "cross";
type Detail = "field" | "down" | "lastPlay" | "winProb" | "lines" | "bets" | "pools";

interface Settings {
  show: Show;
  matchup: Matchup;
  details: Record<Detail, boolean>;
  delay: number;
  size: number | null; // tile min width in px; null = fit 4 across
  selected: string[];
}

const DETAILS: { key: Detail; label: string }[] = [
  { key: "field", label: "Field position" },
  { key: "down", label: "Down & distance" },
  { key: "lastPlay", label: "Last play" },
  { key: "winProb", label: "Win probability" },
  { key: "lines", label: "Lines (Vegas, mine)" },
  { key: "bets", label: "My bets" },
  { key: "pools", label: "Pool picks" },
];

const DEFAULTS: Settings = {
  show: "all",
  matchup: "fbs",
  details: { field: true, down: true, lastPlay: false, winProb: false, lines: true, bets: true, pools: true },
  delay: 0,
  size: null,
  selected: [],
};

const STORE = "admin_scoreboard_settings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return DEFAULTS;
    const s = JSON.parse(raw);
    return { ...DEFAULTS, ...s, details: { ...DEFAULTS.details, ...(s.details ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

const isFbs = (c: string | null) => (c ?? "").toLowerCase() === "fbs";
const isFcs = (c: string | null) => (c ?? "").toLowerCase() === "fcs";

function matchesMatchup(g: GameWithLines, m: Matchup): boolean {
  const h = g.home_classification;
  const a = g.away_classification;
  if (m === "all") return true;
  if (m === "fbs") return isFbs(h) && isFbs(a);
  if (m === "fcs") return isFcs(h) && isFcs(a);
  return (isFbs(h) && !isFbs(a)) || (!isFbs(h) && isFbs(a));
}

// Yards gained on a play, from ESPN's last-play text ("… pass complete to X for 34 yds", "45 Yd Run"). Kicks and
// penalties don't count as big plays.
function bigPlayYards(text: string | null | undefined): number | null {
  if (!text || /punt|kickoff|kick off|penalty|field goal|extra point/i.test(text)) return null;
  const m = /\bfor (\d+) (?:yds?|yards?)\b/i.exec(text) ?? /\b(\d+)[ -](?:yd|yard)s? (?:run|pass|rush|reception|td|touchdown|return)/i.exec(text);
  return m ? Number(m[1]) : null;
}

type Flash = { kind: "score" | "redzone" | "bigplay"; label: string; until: number };

function fmtKick(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const signed = (v: number) => (v === 0 ? "PK" : `${v > 0 ? "+" : ""}${Math.round(v * 2) / 2}`);

export default function ScoreboardPanel() {
  const season = new Date().getFullYear();
  const { week } = useAdminWeek();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [contexts, setContexts] = useState<Record<string, OverlayContext>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(1200);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
    } catch {
      /* private mode: settings just don't persist */
    }
  }, [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setGridWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season, week)
      .then((g) => !cancelled && setGames(g))
      .catch(() => !cancelled && setGames([]));
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  const pool = useMemo(() => games.filter((g) => matchesMatchup(g, settings.matchup)), [games, settings.matchup]);
  const poolIds = useMemo(() => pool.map((g) => g.id), [pool]);

  useEffect(() => {
    if (poolIds.length === 0) return setContexts({});
    let cancelled = false;
    const load = () =>
      fetchOverlayContext(poolIds)
        .then((c) => !cancelled && setContexts(c))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [poolIds.join(",")]);

  const picks = usePoolPicksForGames(poolIds, [], true);

  const shown = useMemo(() => {
    if (settings.show === "selected") return pool.filter((g) => settings.selected.includes(g.id));
    if (settings.show === "action") return pool.filter((g) => (contexts[g.id]?.bets.length ?? 0) > 0 || (picks[g.id]?.length ?? 0) > 0);
    return pool;
  }, [pool, settings.show, settings.selected, contexts, picks]);
  const shownIds = shown.map((g) => g.id);

  const dates = useMemo(() => Array.from(new Set(shown.map((g) => g.start_date).filter((d): d is string => !!d).map(espnDate))).sort().join(","), [shown]);
  const { games: live, fetchedAt } = useScoreboard(dates ? `dates=${dates}` : null, shownIds);
  const scores = useDelayed(live, fetchedAt, settings.delay);

  // Flash on change: compare each poll with the previous one the tiles showed.
  const prev = useRef<Record<string, ScoreGame>>({});
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  useEffect(() => {
    const now = Date.now();
    const next: Record<string, Flash> = {};
    for (const [id, g] of Object.entries(scores)) {
      const p = prev.current[id];
      if (!p || g.state !== "in") continue;
      const scored = (g.home.score ?? 0) !== (p.home.score ?? 0) || (g.away.score ?? 0) !== (p.away.score ?? 0);
      const yards = g.lastPlay !== p.lastPlay ? bigPlayYards(g.lastPlay) : null;
      if (scored) {
        const team = (g.home.score ?? 0) !== (p.home.score ?? 0) ? g.home : g.away;
        next[id] = { kind: "score", label: `${team.abbrev ?? "Score"} scores`, until: now + 8000 };
      } else if (yards != null && yards >= 30) next[id] = { kind: "bigplay", label: `${yards}-yard play`, until: now + 8000 };
      else if (g.redZone && !p.redZone) next[id] = { kind: "redzone", label: "Red zone", until: now + 8000 };
    }
    prev.current = scores;
    if (Object.keys(next).length) setFlashes((f) => ({ ...f, ...next }));
  }, [scores]);
  useEffect(() => {
    const t = window.setInterval(() => setFlashes((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v.until > Date.now()))), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Live games first, then upcoming by kickoff, then finals.
  const ordered = useMemo(() => {
    const rank = (g: GameWithLines) => {
      const s = scores[g.id]?.state ?? (g.completed ? "post" : "pre");
      return s === "in" ? 0 : s === "pre" ? 1 : 2;
    };
    return [...shown].sort((a, b) => rank(a) - rank(b) || (a.start_date ?? "").localeCompare(b.start_date ?? ""));
  }, [shown, scores]);

  const fit = Math.max(220, Math.min(380, Math.floor(gridWidth / 4) - 12));
  const tileMin = settings.size ?? fit;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Scoreboard · Week {week}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem", fontSize: "0.82rem" }}>
        <span style={{ color: "var(--chalk-dim)" }}>
          {ordered.length} games · {Object.values(scores).filter((g) => g.state === "in" && shownIds.includes(g.id)).length} live
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          Tile size
          <input type="range" min={180} max={640} step={10} value={tileMin} onChange={(e) => set("size", Number(e.target.value))} aria-label="Tile size" />
          <button className="admin-link" onClick={() => set("size", null)} disabled={settings.size == null}>
            fit
          </button>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          Delay {settings.delay}s
          <input type="range" min={0} max={120} step={5} value={settings.delay} onChange={(e) => set("delay", Number(e.target.value))} aria-label="Delay seconds" />
        </label>
      </div>

      <div ref={gridRef} className="sb-grid" style={{ "--sb-tile": `${tileMin}px`, "--sb-scale": String(tileMin / 280) } as CSSProperties}>
        {ordered.map((g) => (
          <Tile
            key={g.id}
            game={g}
            sb={scores[g.id]}
            ctx={contexts[g.id]}
            picks={picks[g.id] ?? []}
            details={settings.details}
            flash={flashes[g.id]}
          />
        ))}
        {ordered.length === 0 && <div className="empty matchups-empty">No games for these settings.</div>}
      </div>

      <div className="admin-panel" style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", fontSize: "0.85rem" }}>
          <span style={{ fontWeight: 700 }}>Show</span>
          {(
            [
              ["all", "All games"],
              ["selected", "Selected"],
              ["action", "Bets + pool picks"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              <input type="radio" name="sb-show" checked={settings.show === k} onChange={() => set("show", k)} />
              {label}
            </label>
          ))}
          <span style={{ fontWeight: 700, marginLeft: "0.5rem" }}>Games</span>
          <select value={settings.matchup} onChange={(e) => set("matchup", e.target.value as Matchup)} aria-label="Which games">
            <option value="fbs">FBS vs FBS</option>
            <option value="all">All college</option>
            <option value="fcs">FCS vs FCS</option>
            <option value="cross">FBS vs FCS</option>
          </select>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", fontSize: "0.82rem" }}>
          <span style={{ fontWeight: 700 }}>On each tile</span>
          {DETAILS.map((d) => (
            <label key={d.key} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              <input type="checkbox" checked={settings.details[d.key]} onChange={(e) => set("details", { ...settings.details, [d.key]: e.target.checked })} />
              {d.label}
            </label>
          ))}
        </div>
        <details open={settings.show === "selected"}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.85rem" }}>
            Pick games ({settings.selected.filter((id) => poolIds.includes(id)).length} selected)
          </summary>
          <div style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0" }}>
            <button className="admin-link" onClick={() => set("selected", poolIds)}>
              Select all
            </button>
            <button className="admin-link" onClick={() => set("selected", [])}>
              Clear
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.25rem 1rem", fontSize: "0.8rem" }}>
            {[...pool]
              .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))
              .map((g) => (
                <label key={g.id} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={settings.selected.includes(g.id)}
                    onChange={(e) => set("selected", e.target.checked ? [...settings.selected, g.id] : settings.selected.filter((x) => x !== g.id))}
                  />
                  <span style={{ color: "var(--chalk-dim)", minWidth: "5.5rem" }}>{fmtKick(g.start_date)}</span>
                  {g.away_team} @ {g.home_team}
                </label>
              ))}
          </div>
        </details>
      </div>
    </div>
  );
}

function TeamRow({ name, sbTeam, poss, winner }: { name: string; sbTeam?: ScoreGame["home"]; poss: boolean; winner: boolean }) {
  return (
    <div className="sb-team">
      {sbTeam?.logo ? <img src={sbTeam.logo} alt="" className="sb-logo" /> : <span className="sb-logo" />}
      <span className="sb-name" style={{ fontWeight: winner ? 800 : 600 }}>
        {sbTeam?.rank && sbTeam.rank <= 25 ? <span className="sb-rank">{sbTeam.rank}</span> : null}
        {name}
        {poss && <span className="sb-poss" aria-label="has the ball" />}
      </span>
      <span className="sb-score" style={{ fontWeight: winner ? 800 : 600 }}>
        {sbTeam?.score ?? ""}
      </span>
    </div>
  );
}

function Tile({
  game: g,
  sb,
  ctx,
  picks,
  details,
  flash,
}: {
  game: GameWithLines;
  sb: ScoreGame | undefined;
  ctx: OverlayContext | undefined;
  picks: ReturnType<typeof usePoolPicksForGames>[string];
  details: Record<Detail, boolean>;
  flash: Flash | undefined;
}) {
  const state = sb?.state ?? (g.completed ? "post" : "pre");
  const homePts = sb?.home.score ?? g.home_points;
  const awayPts = sb?.away.score ?? g.away_points;
  const final = state === "post";
  const homeWin = final && homePts != null && awayPts != null && homePts > awayPts;
  const awayWin = final && homePts != null && awayPts != null && awayPts > homePts;
  const possHome = state === "in" && sb?.possession != null && sb.possession === sb.home.espnId;
  const possAway = state === "in" && sb?.possession != null && sb.possession === sb.away.espnId;
  const status = state === "in" ? `Q${sb?.period ?? ""} ${sb?.clock ?? ""}`.trim() : state === "post" ? sb?.detail ?? "Final" : fmtKick(g.start_date);
  const line = ctx?.line ?? null;
  const bets = details.bets && ctx ? liveBets(ctx, sb) : [];
  const lite = { homeTeam: g.home_team, awayTeam: g.away_team, homeSpread: line?.spread ?? null, total: line?.over_under ?? null, final: g.completed && g.home_points != null && g.away_points != null ? { home: g.home_points, away: g.away_points } : null };
  const graded = details.pools ? picks.map((p) => gradePick(p, lite, sb)) : [];
  const statusColor = (s: string) => (s === "up" ? "var(--c-ok)" : s === "down" ? "var(--c-err)" : "var(--chalk-dim)");

  return (
    <div className={`sb-tile${flash ? ` sb-flash sb-flash-${flash.kind}` : ""}${state === "in" && sb?.redZone ? " sb-redzone" : ""}`}>
      <div className="sb-head">
        <span style={{ color: state === "in" ? "var(--c-err)" : "var(--chalk-dim)", fontWeight: state === "in" ? 700 : 500 }}>{status}</span>
        <span style={{ color: "var(--chalk-dim)" }}>{sb?.network ?? ""}</span>
      </div>
      {flash && <div className={`sb-flash-label sb-flash-label-${flash.kind}`}>{flash.label}</div>}
      <TeamRow name={sb?.away.abbrev ?? g.away_team} sbTeam={sb ? { ...sb.away, score: awayPts } : undefined} poss={possAway} winner={awayWin} />
      <TeamRow name={sb?.home.abbrev ?? g.home_team} sbTeam={sb ? { ...sb.home, score: homePts } : undefined} poss={possHome} winner={homeWin} />

      {state === "in" && details.field && sb?.yardLine != null && (
        <div className="sb-field" title={sb.possessionText ?? undefined}>
          <div className="sb-field-rz sb-field-rz-l" />
          <div className="sb-field-rz sb-field-rz-r" />
          <div className="sb-ball" style={{ left: `${100 - Math.max(0, Math.min(100, sb.yardLine))}%` }} />
        </div>
      )}
      {state === "in" && details.down && sb?.downDistance && (
        <div className="sb-line">
          {sb.downDistance}
          {sb.possessionText ? ` · ${sb.possessionText}` : ""}
        </div>
      )}
      {details.lastPlay && sb?.lastPlay && <div className="sb-line sb-dim">{sb.lastPlay}</div>}
      {details.winProb && state === "in" && sb?.homeWinPct != null && (
        <div className="sb-line sb-dim">
          Win prob: {sb.home.abbrev} {Math.round(sb.homeWinPct * 100)}%
        </div>
      )}
      {details.lines && (line?.spread != null || ctx?.myHomeSpread != null) && (
        <div className="sb-line sb-dim">
          {line?.spread != null && `Vegas ${sb?.home.abbrev ?? g.home_team} ${signed(line.spread)}`}
          {line?.over_under != null && ` · O/U ${line.over_under}`}
          {ctx?.myHomeSpread != null && ` · Mine ${signed(ctx.myHomeSpread)}`}
        </div>
      )}
      {bets.length > 0 && (
        <div className="sb-chips">
          {bets.map((b) => (
            <span key={b.key} className="sb-chip" style={{ borderColor: statusColor(b.status), color: statusColor(b.status) }} title={b.note ?? undefined}>
              {b.label}
              {b.prob != null ? ` ${Math.round(b.prob * 100)}%` : ""}
            </span>
          ))}
        </div>
      )}
      {graded.length > 0 && (
        <div className="sb-chips">
          {graded.map((p, i) => (
            <span key={i} className="sb-chip" style={{ borderColor: statusColor(p.status), color: statusColor(p.status) }}>
              {p.def.tag} {p.label}
              {p.result ? ` ${p.result}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
