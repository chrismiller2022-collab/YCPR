import { useEffect, useState } from "react";
import type { GameWithLines } from "../lib/api/gamesLines";
import { fetchGameVenues, fetchTeamVenues, fetchVenuesByIds, resolveGameLocation, type GameLocation } from "../lib/api/gameWeather";
import { compassDir, fetchWeatherForKickoffs, summarizeGameWeather, weatherLabel, weatherSourceFor, FLAG_LABELS, type GameWeatherSummary } from "../lib/weather";
import { TBD_WINDOW_HOURS, WeatherIcon, windowStartFor } from "../pages/WeatherPanel";

// One-line game-day weather for the matchup pop-up: Open-Meteo at the game's venue (same location rules and numbers
// as the admin Game Weather page). Renders nothing when there's no game, no stadium coordinates, or no forecast yet.
export default function GameWeatherStrip({ game, season, week }: { game: GameWithLines | null; season: number; week: number }) {
  const [state, setState] = useState<{ location: GameLocation; weather: GameWeatherSummary | null; note: string | null } | null>(null);

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    (async () => {
      const [gameVenues, teamVenues] = await Promise.all([fetchGameVenues(season, week), fetchTeamVenues()]);
      const gv = gameVenues[game.id];
      const venues = await fetchVenuesByIds(gv?.venue_id != null ? [gv.venue_id] : []);
      const location = resolveGameLocation(game, gv, venues, teamVenues);
      if (!location) return;
      const tbd = !!gv?.start_time_tbd;
      const start = windowStartFor(game, tbd);
      if (!start || !weatherSourceFor(start)) {
        if (!cancelled) setState({ location, weather: null, note: "Forecast opens about 16 days before kickoff." });
        return;
      }
      const series = await fetchWeatherForKickoffs([{ key: game.id, point: location, kickoff: start }]);
      const s = series.get(game.id);
      const weather = s ? summarizeGameWeather(s.series, s.source, start, tbd ? TBD_WINDOW_HOURS : 4) : null;
      if (!cancelled) setState({ location, weather, note: weather ? null : "No weather available for this kickoff." });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [game, season, week]);

  if (!state) return null;
  const { location, weather: w, note } = state;
  const where = `${location.name ?? "Stadium"}${location.city ? ` · ${location.city}${location.state ? `, ${location.state}` : ""}` : ""}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.5rem 0.7rem", margin: "0 0 1rem", border: "1px solid var(--hash)", borderRadius: 8, fontSize: "0.8rem" }}>
      {w ? (
        <>
          <WeatherIcon code={w.code} isDay={w.kickoff.isDay} size={22} />
          <b>{weatherLabel(w.code)}</b>
          <span>{w.kickoff.temp != null ? `${Math.round(w.kickoff.temp)}°F` : "–"}</span>
          <span style={{ color: "var(--chalk-dim)" }}>
            Wind {w.avgWind != null ? Math.round(w.avgWind) : "–"} mph {compassDir(w.kickoff.windDir)} · gusts {w.maxGust != null ? Math.round(w.maxGust) : "–"} · rain{" "}
            {w.maxPrecipProb != null ? `${Math.round(w.maxPrecipProb)}%` : w.totalPrecip > 0 ? "yes" : "0%"}
          </span>
          {!location.dome &&
            w.flags.map((f) => (
              <span key={f} style={{ padding: "0.05rem 0.45rem", borderRadius: 999, background: "var(--gold-dim)", color: "var(--chalk)", fontWeight: 700, fontSize: "0.7rem" }}>
                {FLAG_LABELS[f]}
              </span>
            ))}
        </>
      ) : (
        <span style={{ color: "var(--chalk-dim)" }}>{note}</span>
      )}
      <span style={{ color: "var(--chalk-dim)", marginLeft: "auto" }}>
        {where}
        {location.dome ? " · dome" : ""}
      </span>
    </div>
  );
}
