import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { scoreWatchability, DEFAULT_WEIGHTS, type WatchabilityInput } from "../lib/watchability";

// Order matters — channels render in this order, top to bottom, and a
// channel with zero games in the current week/filter is skipped
// entirely rather than showing an empty row.
const CHANNEL_ORDER = [
  "NBC",
  "ABC",
  "CBS",
  "FOX",
  "ESPN",
  "ESPN2",
  "SECN",
  "ESPNU",
  "FS1",
  "CBS Sports Network",
  "Big Ten Network",
  "ACC Network",
  "TNT",
  "Streaming/ESPN+",
];

// CFBD's outlet strings don't always match these labels exactly (case,
// spacing, "ESPN 2" vs "ESPN2", etc.) — normalize both sides before
// comparing so a game actually lands in the right row instead of being
// silently dropped for a cosmetic mismatch.
function normalizeOutlet(outlet: string): string {
  const o = outlet.trim().toUpperCase().replace(/\s+/g, "");
  if (o === "ESPN2") return "ESPN2";
  if (o === "SECNETWORK" || o === "SECN") return "SECN";
  if (o === "CBSSPORTSNETWORK" || o === "CBSSN") return "CBSSPORTSNETWORK";
  if (o === "BIGTENNETWORK" || o === "BTN") return "BIGTENNETWORK";
  if (o === "ACCNETWORK" || o === "ACCN") return "ACCNETWORK";
  if (o.includes("ESPN+") || o.includes("ESPNPLUS")) return "STREAMING/ESPN+";
  return o;
}
const NORMALIZED_CHANNEL_ORDER = CHANNEL_ORDER.map((c) => ({ label: c, key: normalizeOutlet(c) }));

const SLOT_MINUTES = 15;
const GAME_LENGTH_MINUTES = 3.5 * 60;

interface TvGame {
  game: GameWithLines;
  channelKey: string;
  startMinutes: number;
  mySpread: number | null;
  myTotal: number | null;
  watchability: number | null;
}

function etMinutesSinceMidnight(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hour * 60 + minute;
}

function fmtTime(minutesSinceMidnight: number): string {
  const h24 = Math.floor(minutesSinceMidnight / 60) % 24;
  const m = minutesSinceMidnight % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

export default function TvGuidePanel() {
  const season = new Date().getFullYear();
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGamesWithLines(season)
      .then((rows) => {
        if (!cancelled) setGames(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const weekNumbers = useMemo(() => Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b), [games]);
  useEffect(() => {
    if (week == null && weekNumbers.length > 0) setWeek(weekNumbers[0]);
  }, [weekNumbers, week]);

  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbers, season);
  const { rows: totalsRows } = useGameTotalsEngine(season);
  const totalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsRows) {
      const t = r.projection?.projectedTotal;
      if (t != null) map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, t);
    }
    return map;
  }, [totalsRows]);

  const weekGames = useMemo(() => {
    return games.filter((g) => g.week === week && g.tv_outlet && g.start_date);
  }, [games, week]);

  // Default watchability, normalized against exactly this week's (or
  // this week+Saturdays-only) games — not whatever's been customized on
  // the main Watchability tab, and not the full season.
  const watchabilityInputs: WatchabilityInput[] = useMemo(
    () =>
      weekGames.map((g) => {
        const computed = computeRow(g, ratingsByWeek[g.week] ?? {});
        const avgRating = computed.awayTeam && computed.homeTeam ? (computed.awayTeam.rating + computed.homeTeam.rating) / 2 : null;
        return {
          gameId: g.id,
          week: g.week,
          awayTeam: g.away_team,
          homeTeam: g.home_team,
          startDate: g.start_date,
          avgRating,
          mySpread: computed.projAwaySpread,
          myTotal: totalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
          combinedProjWins: null,
          isConferenceGame: g.conference_game,
        };
      }),
    [weekGames, ratingsByWeek, totalByGame]
  );
  const watchabilityByGame = useMemo(() => {
    const scored = scoreWatchability(watchabilityInputs, DEFAULT_WEIGHTS);
    return new Map(scored.map((s) => [s.gameId, s.score]));
  }, [watchabilityInputs]);

  const tvGames: TvGame[] = useMemo(() => {
    return weekGames
      .map((g) => {
        const channelKey = normalizeOutlet(g.tv_outlet!);
        if (!NORMALIZED_CHANNEL_ORDER.some((c) => c.key === channelKey)) return null;
        const computed = computeRow(g, ratingsByWeek[g.week] ?? {});
        return {
          game: g,
          channelKey,
          startMinutes: etMinutesSinceMidnight(g.start_date!),
          mySpread: computed.projAwaySpread,
          myTotal: totalByGame.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
          watchability: watchabilityByGame.get(g.id) ?? null,
        };
      })
      .filter((g): g is TvGame => g != null);
  }, [weekGames, ratingsByWeek, totalByGame, watchabilityByGame]);

  const activeChannels = useMemo(
    () => NORMALIZED_CHANNEL_ORDER.filter((c) => tvGames.some((g) => g.channelKey === c.key)),
    [tvGames]
  );

  const { axisStart, slotCount } = useMemo(() => {
    if (tvGames.length === 0) return { axisStart: 12 * 60, slotCount: Math.round(GAME_LENGTH_MINUTES / SLOT_MINUTES) };
    const starts = tvGames.map((g) => g.startMinutes);
    const earliest = Math.min(...starts) - (Math.min(...starts) % SLOT_MINUTES);
    const latest = Math.max(...starts) + GAME_LENGTH_MINUTES;
    const end = Math.ceil(latest / SLOT_MINUTES) * SLOT_MINUTES;
    return { axisStart: earliest, slotCount: Math.max(1, Math.round((end - earliest) / SLOT_MINUTES)) };
  }, [tvGames]);

  const slots = useMemo(() => Array.from({ length: slotCount + 1 }, (_, i) => axisStart + i * SLOT_MINUTES), [slotCount, axisStart]);

  const COL_WIDTH = 34;
  const ROW_HEIGHT = 64;
  const CHANNEL_COL_WIDTH = 130;

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select value={week ?? ""} onChange={(e) => setWeek(parseInt(e.target.value, 10))}>
          {weekNumbers.map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : activeChannels.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No games with a known TV outlet for this selection yet.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <div style={{ display: "inline-block", minWidth: "100%" }}>
            <div style={{ display: "flex", position: "sticky", top: 0, background: "var(--turf-panel)", zIndex: 2, borderBottom: "1px solid var(--hash)" }}>
              <div style={{ width: CHANNEL_COL_WIDTH, flexShrink: 0, borderRight: "1px solid var(--hash)" }} />
              {slots.map((m, i) => (
                <div
                  key={i}
                  style={{
                    width: COL_WIDTH,
                    flexShrink: 0,
                    fontSize: "0.62rem",
                    color: "var(--chalk-dim)",
                    textAlign: "center",
                    borderLeft: m % 60 === 0 ? "1px solid var(--hash)" : "1px solid rgba(255,255,255,0.04)",
                    padding: "0.3rem 0",
                  }}
                >
                  {m % 30 === 0 ? fmtTime(m) : ""}
                </div>
              ))}
            </div>

            {activeChannels.map((channel) => (
              <div key={channel.key} style={{ display: "flex", borderBottom: "1px solid var(--hash)", position: "relative", height: ROW_HEIGHT }}>
                <div
                  style={{
                    width: CHANNEL_COL_WIDTH,
                    flexShrink: 0,
                    borderRight: "1px solid var(--hash)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 0.6rem",
                    fontWeight: 700,
                    fontSize: "0.82rem",
                    position: "sticky",
                    left: 0,
                    background: "var(--turf-panel)",
                  }}
                >
                  {channel.label}
                </div>
                <div style={{ position: "relative", width: slotCount * COL_WIDTH, flexShrink: 0 }}>
                  {slots.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: i * COL_WIDTH,
                        top: 0,
                        bottom: 0,
                        width: COL_WIDTH,
                        borderLeft: m % 60 === 0 ? "1px solid var(--hash)" : "1px solid rgba(255,255,255,0.04)",
                      }}
                    />
                  ))}
                  {tvGames
                    .filter((g) => g.channelKey === channel.key)
                    .map((g) => {
                      const left = ((g.startMinutes - axisStart) / SLOT_MINUTES) * COL_WIDTH;
                      const width = (GAME_LENGTH_MINUTES / SLOT_MINUTES) * COL_WIDTH;
                      return (
                        <div
                          key={g.game.id}
                          style={{
                            position: "absolute",
                            left,
                            width: width - 4,
                            top: 4,
                            bottom: 4,
                            background: "rgba(255,200,87,0.1)",
                            border: "1px solid rgba(255,200,87,0.35)",
                            borderRadius: 6,
                            padding: "0.3rem 0.4rem",
                            overflow: "hidden",
                            fontSize: "0.7rem",
                          }}
                          title={`${g.game.away_team} @ ${g.game.home_team}`}
                        >
                          <div style={{ fontWeight: 700, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            <TeamLogo team={g.game.away_team} size={14} /> {g.game.away_team}
                            <span style={{ color: "var(--chalk-dim)" }}>@</span>
                            <TeamLogo team={g.game.home_team} size={14} /> {g.game.home_team}
                          </div>
                          <div style={{ color: "var(--chalk-dim)", whiteSpace: "nowrap", marginTop: "0.15rem" }}>
                            {fmtTime(g.startMinutes)} · {fmtSpread(g.mySpread)} · {g.myTotal != null ? g.myTotal.toFixed(1) : "–"} ·{" "}
                            {g.watchability != null ? g.watchability.toFixed(1) : "–"}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
