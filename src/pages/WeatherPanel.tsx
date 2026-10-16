import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Home,
  MapPin,
  Moon,
  Navigation,
  Sun,
  Wind,
} from "lucide-react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import { useLoadToken } from "../lib/staleGuard";
import TeamLink from "../components/TeamLink";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { invalidateCache } from "../lib/api/cache";
import { pickLine } from "../lib/matchupsCompute";
import {
  fetchGameVenues,
  fetchTeamVenues,
  fetchVenuesByIds,
  pullVenues,
  resolveGameLocation,
  type GameLocation,
  type GameVenueRow,
} from "../lib/api/gameWeather";
import {
  FLAG_LABELS,
  WEATHER_THRESHOLDS,
  compassDir,
  fetchWeatherForKickoffs,
  summarizeGameWeather,
  weatherKind,
  weatherLabel,
  weatherSourceFor,
  type GameWeatherSummary,
  type WeatherFlag,
} from "../lib/weather";

// A TBD kickoff has only a date; its weather window covers noon through 11pm Eastern (16:00–03:00 UTC).
const TBD_WINDOW_START_UTC_HOUR = 16;
export const TBD_WINDOW_HOURS = 12;

interface Card {
  game: GameWithLines;
  venue: GameVenueRow | undefined;
  location: GameLocation | null;
  tbd: boolean;
  /** Kickoff used for the weather window (a TBD game's is the start of its window). */
  windowStart: string | null;
  weather: GameWeatherSummary | null;
  /** Why there's no weather, when there isn't any. */
  missing: string | null;
}

const FLAG_COLORS: Record<WeatherFlag, string> = {
  wind: "#7fc8f8",
  rain: "#5b9bd5",
  snow: "#e8f1ff",
  storms: "#ffc857",
  cold: "#9ad1ff",
  freezing: "#c6e4ff",
  hot: "#ff8a5c",
};

const FLAG_WEIGHT: Record<WeatherFlag, number> = { storms: 4, snow: 4, wind: 3, rain: 2, freezing: 2, cold: 1, hot: 1 };

function impactScore(c: Card): number {
  if (!c.weather || c.location?.dome) return -1;
  return c.weather.flags.reduce((a, f) => a + FLAG_WEIGHT[f], 0) + (c.weather.avgWind ?? 0) / 10;
}

export function WeatherIcon({ code, isDay, size = 20 }: { code: number | null; isDay?: boolean | null; size?: number }) {
  const props = { size, strokeWidth: 1.8 };
  const night = isDay === false;
  switch (weatherKind(code)) {
    case "clear":
      return night ? <Moon {...props} color="#8a90c8" /> : <Sun {...props} color="#f0a500" />;
    case "partly":
      return night ? <CloudMoon {...props} color="#8a90c8" /> : <CloudSun {...props} color="#e7a923" />;
    case "cloudy":
      return <Cloud {...props} color="#9a9cb8" />;
    case "fog":
      return <CloudFog {...props} color="#9a9cb8" />;
    case "drizzle":
      return <CloudDrizzle {...props} color="#8fbef0" />;
    case "rain":
      return <CloudRain {...props} color="#5b9bd5" />;
    case "snow":
      return <CloudSnow {...props} color="#7fa6d6" />;
    case "storm":
      return <CloudLightning {...props} color="#ffc857" />;
    default:
      return <Cloud {...props} color="var(--chalk-dim)" />;
  }
}

/** Arrow pointing where the wind is blowing TO (meteorological direction is where it comes FROM). */
function WindArrow({ deg }: { deg: number | null }) {
  if (deg == null) return null;
  // lucide's Navigation arrow points to the north-east (45°) at rest.
  return <Navigation size={12} strokeWidth={2} style={{ transform: `rotate(${deg + 180 - 45}deg)`, verticalAlign: "-1px" }} />;
}

const fmtT = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)}°`);
const fmtMph = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)}`);
const fmtIn = (v: number) => (v >= 0.995 ? v.toFixed(1) : v.toFixed(2).replace(/^0/, ""));

function fmtKickoff(iso: string | null, tbd: boolean) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
  if (tbd) return `${day} · Time TBD`;
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function lineLabel(g: GameWithLines): string | null {
  const line = pickLine(g.lines);
  if (!line) return null;
  const bits: string[] = [];
  if (line.spread != null) {
    // CFBD spreads are from the home side: negative = home favored.
    if (line.spread === 0) bits.push("PK");
    else if (line.spread < 0) bits.push(`${g.home_team} ${line.spread}`);
    else bits.push(`${g.away_team} -${line.spread}`);
  }
  if (line.over_under != null) bits.push(`O/U ${line.over_under}`);
  return bits.length ? bits.join(" · ") : null;
}

export function windowStartFor(g: GameWithLines, tbd: boolean): string | null {
  if (!g.start_date) return null;
  if (!tbd) return g.start_date;
  // TBD start dates are stored as midnight-ish of the game date; anchor on that date's afternoon instead.
  const d = new Date(Date.parse(g.start_date) + 6 * 3600 * 1000);
  d.setUTCHours(TBD_WINDOW_START_UTC_HOUR, 0, 0, 0);
  return d.toISOString();
}

const chip = (bg: string, fg = "#1f2041"): CSSProperties => ({
  display: "inline-block",
  padding: "0.08rem 0.45rem",
  borderRadius: 999,
  fontSize: "0.68rem",
  fontWeight: 700,
  background: bg,
  color: fg,
  letterSpacing: "0.02em",
});

const statLabel: CSSProperties = { fontSize: "0.64rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.05em" };
const statValue: CSSProperties = { fontSize: "0.92rem", fontWeight: 700 };

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
      {sub != null && <div style={{ fontSize: "0.68rem", color: "var(--chalk-dim)" }}>{sub}</div>}
    </div>
  );
}

function MatchupCard({ c }: { c: Card }) {
  const g = c.game;
  const w = c.weather;
  const line = lineLabel(g);
  const T = WEATHER_THRESHOLDS;
  const past = c.windowStart != null && Date.parse(c.windowStart) < Date.now();
  const windy = w != null && ((w.avgWind ?? 0) >= T.windSustained || (w.maxGust ?? 0) >= T.windGust);

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 10, background: "var(--turf-panel)", padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
        <span>{fmtKickoff(c.tbd ? c.windowStart : g.start_date, c.tbd)}</span>
        <span>{g.tv_outlet ?? ""}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        {[
          { team: g.away_team, points: g.away_points },
          { team: g.home_team, points: g.home_points },
        ].map((t, i) => (
          <div key={t.team} style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontWeight: 700 }}>
            <span style={{ fontSize: "0.68rem", color: "var(--chalk-dim)", width: 14 }}>{i === 0 ? "" : g.neutral_site ? "vs" : "@"}</span>
            <TeamLink team={t.team} size={22} />
            {g.completed && t.points != null && <span style={{ marginLeft: "auto" }}>{t.points}</span>}
          </div>
        ))}
        {line && <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{line}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", fontSize: "0.72rem" }}>
        {c.location?.source === "home" ? <Home size={12} /> : <MapPin size={12} />}
        <span>
          {c.location?.name ?? c.venue?.venue ?? "Venue unknown"}
          {c.location?.city ? ` · ${c.location.city}${c.location.state ? `, ${c.location.state}` : ""}` : ""}
        </span>
        {g.neutral_site && <span style={chip("var(--turf-panel-2)", "var(--chalk)")}>Neutral</span>}
        {c.location?.dome && <span style={chip("var(--gold)")}>Dome</span>}
        {c.location?.source === "home" && (
          <span style={{ color: "var(--chalk-dim)" }} title="CFBD hasn't listed a venue for this game yet, so this uses the home team's stadium.">
            (home stadium)
          </span>
        )}
      </div>

      {w ? (
        <div style={{ borderTop: "1px solid var(--hash)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.55rem", opacity: c.location?.dome ? 0.55 : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <WeatherIcon code={w.code} isDay={w.kickoff.isDay} size={34} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{weatherLabel(w.code)}</div>
              <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>
                {c.location?.dome ? "Outside the dome · " : ""}
                {past ? "Observed" : "Forecast"}
                {c.tbd ? " · noon–11pm ET" : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1 }}>{fmtT(w.kickoff.temp)}</div>
              <div style={{ fontSize: "0.68rem", color: "var(--chalk-dim)" }}>feels {fmtT(w.kickoff.feelsLike)}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem" }}>
            <Stat
              label="Wind"
              value={
                <span style={{ color: windy ? "var(--c-info)" : undefined }}>
                  {fmtMph(w.avgWind)} <span style={{ fontSize: "0.7rem", fontWeight: 400 }}>mph</span>
                </span>
              }
              sub={
                <>
                  {compassDir(w.kickoff.windDir)} <WindArrow deg={w.kickoff.windDir} /> · G{fmtMph(w.maxGust)}
                </>
              }
            />
            <Stat
              label="Precip"
              value={w.maxPrecipProb != null ? `${Math.round(w.maxPrecipProb)}%` : w.totalPrecip > 0 ? "Yes" : "0%"}
              sub={w.totalSnow > 0 ? `${fmtIn(w.totalSnow)}" snow` : `${fmtIn(w.totalPrecip)}"`}
            />
            <Stat label="Temp" value={`${fmtT(w.tempLow)}–${fmtT(w.tempHigh)}`} sub="game window" />
            <Stat label="Clouds" value={w.avgCloud != null ? `${Math.round(w.avgCloud)}%` : "–"} sub={w.kickoff.humidity != null ? `${Math.round(w.kickoff.humidity)}% RH` : undefined} />
          </div>

          <div style={{ display: "flex", gap: "0.3rem", overflowX: "auto" }}>
            {w.hours.map((h) => (
              <div key={h.time} style={{ flex: "1 0 52px", textAlign: "center", background: "var(--turf)", borderRadius: 6, padding: "0.3rem 0.2rem", fontSize: "0.66rem" }}>
                <div style={{ color: "var(--chalk-dim)" }}>{new Date(`${h.time}:00Z`).toLocaleTimeString(undefined, { hour: "numeric" })}</div>
                <div style={{ margin: "0.15rem 0" }}>
                  <WeatherIcon code={h.code} isDay={h.isDay} size={16} />
                </div>
                <div style={{ fontWeight: 700 }}>{fmtT(h.temp)}</div>
                <div style={{ color: "var(--chalk-dim)", display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                  <Wind size={9} />
                  {fmtMph(h.wind)}
                </div>
                {h.precipProb != null && h.precipProb > 0 && (
                  <div style={{ color: "#8fbef0", display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    <Droplets size={9} />
                    {Math.round(h.precipProb)}%
                  </div>
                )}
              </div>
            ))}
          </div>

          {w.flags.length > 0 && !c.location?.dome && (
            <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
              {w.flags.map((f) => (
                <span key={f} style={chip(FLAG_COLORS[f])}>
                  {FLAG_LABELS[f]}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ borderTop: "1px solid var(--hash)", paddingTop: "0.6rem", fontSize: "0.75rem", color: "var(--chalk-dim)" }}>{c.missing ?? "No weather."}</div>
      )}
    </div>
  );
}

export default function WeatherPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);

  const [fbsOnly, setFbsOnly] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<"kickoff" | "impact">("kickoff");

  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const { next, isCurrent } = useLoadToken();

  useEffect(() => {
    const token = next();
    setLoading(true);
    setError(null);
    setWeatherError(null);
    (async () => {
      const [games, gameVenues, teamVenues] = await Promise.all([fetchGamesWithLines(season, week), fetchGameVenues(season, week), fetchTeamVenues()]);
      const tracked = games.filter((g) => {
        const h = (g.home_classification ?? "").toLowerCase();
        const a = (g.away_classification ?? "").toLowerCase();
        return h === "fbs" || a === "fbs" || h === "fcs" || a === "fcs";
      });
      const venueIds = tracked.map((g) => gameVenues[g.id]?.venue_id).filter((x): x is number => x != null);
      const venues = await fetchVenuesByIds(venueIds);

      const base: Card[] = tracked.map((g) => {
        const venue = gameVenues[g.id];
        const tbd = !!venue?.start_time_tbd;
        const location = resolveGameLocation(g, venue, venues, teamVenues);
        const windowStart = windowStartFor(g, tbd);
        let missing: string | null = null;
        if (!location) missing = g.neutral_site ? "Neutral site with no venue coordinates — run Pull stadiums." : "No stadium coordinates for the home team — run Pull stadiums.";
        else if (!windowStart) missing = "No kickoff date.";
        else if (!weatherSourceFor(windowStart)) missing = "Forecast opens about 16 days before kickoff.";
        return { game: g, venue, location, tbd, windowStart, weather: null, missing };
      });
      if (!isCurrent(token)) return;
      setCards(base);

      const reqs = base
        .filter((c) => c.location && c.windowStart && !c.missing)
        .map((c) => ({ key: c.game.id, point: { latitude: c.location!.latitude, longitude: c.location!.longitude }, kickoff: c.windowStart! }));
      if (reqs.length === 0) return;
      try {
        const series = await fetchWeatherForKickoffs(reqs);
        if (!isCurrent(token)) return;
        setCards(
          base.map((c) => {
            const s = series.get(c.game.id);
            if (!s || !c.windowStart) return c;
            const weather = summarizeGameWeather(s.series, s.source, c.windowStart, c.tbd ? TBD_WINDOW_HOURS : 4);
            return { ...c, weather, missing: weather ? null : "Open-Meteo returned no hours for this kickoff." };
          })
        );
      } catch (e: any) {
        if (isCurrent(token)) setWeatherError(e.message ?? "Weather fetch failed");
      }
    })()
      .catch((e: any) => {
        if (!isCurrent(token)) return;
        const msg = e?.message ?? "Failed to load";
        setError(/team_venues|venues|venue_id|start_time_tbd/.test(msg) ? `${msg} — the venues migration (supabase/migrations/venues_and_game_weather.sql) may not be applied yet.` : msg);
      })
      .finally(() => {
        if (isCurrent(token)) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, reloadTick]);

  const shown = useMemo(() => {
    let list = cards;
    if (fbsOnly) list = list.filter((c) => c.game.home_classification === "fbs" || c.game.away_classification === "fbs");
    if (flaggedOnly) list = list.filter((c) => c.weather && c.weather.flags.length > 0 && !c.location?.dome);
    if (sort === "impact") list = [...list].sort((a, b) => impactScore(b) - impactScore(a));
    return list;
  }, [cards, fbsOnly, flaggedOnly, sort]);

  const counts = useMemo(() => {
    const scope = fbsOnly ? cards.filter((c) => c.game.home_classification === "fbs" || c.game.away_classification === "fbs") : cards;
    return {
      games: scope.length,
      withWeather: scope.filter((c) => c.weather).length,
      noLocation: scope.filter((c) => !c.location).length,
      flagged: scope.filter((c) => c.weather && c.weather.flags.length > 0 && !c.location?.dome).length,
      domes: scope.filter((c) => c.location?.dome).length,
    };
  }, [cards, fbsOnly]);

  async function handlePull(wholeSeason: boolean) {
    if (!window.confirm(`Pull stadiums from CFBD (3 requests: venues, team home stadiums, and ${wholeSeason ? `every ${season} game` : `week ${week} games`})?`)) return;
    setPulling(true);
    setPullMsg(null);
    setPullError(null);
    try {
      const r = await pullVenues(season, wholeSeason ? null : week);
      const v = r.venues;
      setPullMsg(
        (v ? `${v.venues} venues (${v.withCoords} with coordinates) · ${v.teams} team stadiums · ${v.gamesWithVenue} of ${v.games} games have a venue` : "Done") +
          (r.warnings?.length ? ` — ${r.warnings.join(" ")}` : "")
      );
      invalidateCache();
      setReloadTick((n) => n + 1);
    } catch (e: any) {
      setPullError(e.message ?? "Pull failed");
    } finally {
      setPulling(false);
    }
  }

  function refreshWeather() {
    invalidateCache();
    setReloadTick((n) => n + 1);
  }

  const T = WEATHER_THRESHOLDS;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Game Weather</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Weather for each game from Open-Meteo, at the venue CFBD lists for the game (neutral sites included), or the home team's stadium when no
        venue is listed. Conditions cover kickoff through the next three hours. Flags: wind ≥ {T.windSustained} mph sustained or gusts ≥{" "}
        {T.windGust}, ≥ {T.rainProb}% chance of rain or ≥ {T.rainAmount}" falling, snow, storms, kickoff ≤ {T.cold}°F or ≥ {T.hot}°F. Forecasts
        start about 16 days out; past games show what happened. Domes are marked and not flagged.
      </p>

      <div style={{ display: "flex", gap: "0.9rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <label style={{ fontSize: "0.85rem" }}>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 70 }} />
        </label>
        <label style={{ fontSize: "0.85rem" }}>
          Week <input type="number" min={1} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 60 }} />
        </label>
        <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={fbsOnly} onChange={(e) => setFbsOnly(e.target.checked)} />
          FBS games only
        </label>
        <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          Flagged only
        </label>
        <label style={{ fontSize: "0.82rem" }}>
          Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as "kickoff" | "impact")}>
            <option value="kickoff">Kickoff</option>
            <option value="impact">Weather impact</option>
          </select>
        </label>
        <button className="menu-btn" onClick={refreshWeather} disabled={loading}>
          {loading ? "Loading…" : "Refresh weather"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.9rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem", padding: "0.75rem", border: "1px solid var(--hash)", borderRadius: 8, background: "var(--turf-panel)" }}>
        <button className="menu-btn" onClick={() => handlePull(false)} disabled={pulling}>
          {pulling ? "Pulling…" : `Pull stadiums (week ${week})`}
        </button>
        <button className="menu-btn" onClick={() => handlePull(true)} disabled={pulling}>
          Pull stadiums (whole season)
        </button>
        <span style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>
          CFBD venues + each team's home stadium + the venue for each game. Stadiums rarely change; run it once a season, and again for a week
          whose neutral-site games show no venue.
        </span>
      </div>
      {pullMsg && <p style={{ color: "var(--c-ok)", fontSize: "0.82rem" }}>{pullMsg}</p>}
      {pullError && <p style={{ color: "var(--c-err)", fontSize: "0.82rem" }}>{pullError}</p>}
      {error && <p style={{ color: "var(--c-err)" }}>{error}</p>}
      {weatherError && <p style={{ color: "var(--c-err)", fontSize: "0.82rem" }}>{weatherError}</p>}

      {!loading && cards.length > 0 && (
        <p style={{ fontSize: "0.8rem", color: "var(--chalk-dim)" }}>
          {counts.games} games · {counts.withWeather} with weather · {counts.flagged} flagged · {counts.domes} in domes
          {counts.noLocation > 0 ? ` · ${counts.noLocation} without a location` : ""}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "0.8rem" }}>
        {shown.map((c) => (
          <MatchupCard key={c.game.id} c={c} />
        ))}
      </div>
      {shown.length === 0 && <p className="empty">{loading ? "Loading…" : cards.length ? "No games match the filters." : "No games for that week."}</p>}
    </div>
  );
}
