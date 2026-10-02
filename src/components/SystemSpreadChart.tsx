import { type GameWithLines } from "../lib/api/gamesLines";
import { RATING_SYSTEMS } from "../lib/ratingSystems";
import { type MultiSystemGameRow } from "../lib/multiRatingMatchups";

// Dot plot of every rating system's projected away-oriented spread for a
// game (negative = away favored), with Vegas and the final result as ticks.
// Shared by the Rating Systems Matchups Spread Chart tab (many rows on one
// shared axis) and the matchup preview popup (just that game).

function fmtSpread(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

export const CHART_WIDTH = 900;
export const CHART_ROW_HEIGHT = 40;
const TICK_STEP = 7;

export function actualAwaySpread(game: GameWithLines): number | null {
  if (!game.completed || game.away_points == null || game.home_points == null) return null;
  return game.home_points - game.away_points; // away wins by X -> -X, same convention as projAwaySpread
}

export interface ChartDomain {
  min: number;
  max: number;
  ticks: number[];
}

export function computeDomain(rows: MultiSystemGameRow[]): ChartDomain {
  const values: number[] = [];
  for (const r of rows) {
    if (r.vegasAwaySpread != null) values.push(r.vegasAwaySpread);
    const act = actualAwaySpread(r.game);
    if (act != null) values.push(act);
    for (const s of RATING_SYSTEMS) {
      const v = r.systems[s.key]?.projAwaySpread;
      if (v != null) values.push(v);
    }
  }
  if (values.length === 0) return { min: -7, max: 7, ticks: [7, 0, -7] };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = Math.floor((rawMin - TICK_STEP) / TICK_STEP) * TICK_STEP;
  const max = Math.ceil((rawMax + TICK_STEP) / TICK_STEP) * TICK_STEP;
  const ticks: number[] = [];
  for (let t = max; t >= min; t -= TICK_STEP) ticks.push(t);
  return { min, max, ticks };
}

// Left = domain.max (positive / away underdog), right = domain.min
// (negative / away favorite) — matches the reference chart's orientation.
function xPct(value: number, domain: ChartDomain): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 50;
  return ((domain.max - value) / span) * 100;
}

export function SpreadChartHeader({ domain, minWidth = CHART_WIDTH }: { domain: ChartDomain; minWidth?: number }) {
  return (
    <div style={{ position: "relative", height: 24, minWidth, borderBottom: "1px solid var(--hash)" }}>
      {domain.ticks.map((t) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: `${xPct(t, domain)}%`,
            transform: "translateX(-50%)",
            fontSize: "0.68rem",
            color: "var(--chalk-dim)",
            whiteSpace: "nowrap",
          }}
        >
          {t.toFixed(1)}
        </div>
      ))}
    </div>
  );
}

export function SpreadChartRow({
  row,
  domain,
  minWidth = CHART_WIDTH,
  height = CHART_ROW_HEIGHT,
  jitterStep = 4,
}: {
  row: MultiSystemGameRow;
  domain: ChartDomain;
  minWidth?: number;
  height?: number;
  jitterStep?: number;
}) {
  const act = actualAwaySpread(row.game);

  return (
    <div
      style={{
        position: "relative",
        height,
        minWidth,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {domain.ticks.map((t) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: `${xPct(t, domain)}%`,
            top: 0,
            bottom: 0,
            borderLeft: t === 0 ? "1px dashed rgba(255,255,255,0.25)" : "1px dashed rgba(255,255,255,0.08)",
          }}
        />
      ))}

      {row.vegasAwaySpread != null && (
        <div
          className="cell-tip cell-tip-above"
          data-tip={`Vegas: ${fmtSpread(row.vegasAwaySpread)}`}
          style={{
            position: "absolute",
            left: `${xPct(row.vegasAwaySpread, domain)}%`,
            top: 4,
            bottom: 4,
            width: 2,
            background: "#f4f2ea",
            transform: "translateX(-50%)",
          }}
        />
      )}

      {act != null && (
        <div
          className="cell-tip cell-tip-above"
          data-tip={`Result: ${fmtSpread(act)}`}
          style={{
            position: "absolute",
            left: `${xPct(act, domain)}%`,
            top: 4,
            bottom: 4,
            width: 2,
            background: "#3ecf5e",
            transform: "translateX(-50%)",
          }}
        />
      )}

      {RATING_SYSTEMS.map((s, i) => {
        const v = row.systems[s.key]?.projAwaySpread;
        if (v == null) return null;
        const isYc = s.key === "yc";
        const jitter = ((i % 5) - 2) * jitterStep;
        return (
          <div
            key={s.key}
            className="cell-tip cell-tip-above"
            data-tip={`${s.label}: ${fmtSpread(v)}`}
            style={{
              position: "absolute",
              left: `${xPct(v, domain)}%`,
              top: `calc(50% + ${jitter}px)`,
              transform: "translate(-50%, -50%)",
              zIndex: isYc ? 5 : 1,
            }}
          >
            {isYc ? (
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--gold)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #14152b",
                  fontSize: "0.65rem",
                  lineHeight: 1,
                  color: "#14152b",
                }}
              >
                ★
              </div>
            ) : (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(0,0,0,0.4)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

