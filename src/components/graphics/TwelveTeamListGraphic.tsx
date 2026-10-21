import type { CSSProperties } from "react";
import GraphicFrame, { AutoTag, fmtRating, GOLD, Logo } from "./GraphicFrame";
import type { RankedRow, SeededEntry } from "../../lib/playoffGraphics";

// Projected / actual 12-team CFP field as a list, for the Weekly Image Dump.
// variant "text"  — seed, team, conf, bid, rank, rating; no logos.
// variant "logos" — same with team logos.
// variant "lines" — left: the ranking (top 12 + any field team ranked
//   lower, gaps marked); right: seed slots 1-12; an SVG connector runs from
//   each field team's ranking position to its seed slot, so auto-bids
//   pulling a team up (and bumping a top-12 team out) are visible.

export type TwelveTeamListVariant = "text" | "logos" | "lines";

const HEAD: CSSProperties = {
  padding: "4px 8px",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.55)",
  borderBottom: "1px solid rgba(255,255,255,0.25)",
  textAlign: "left",
  whiteSpace: "nowrap",
};
const CELL: CSSProperties = { padding: "5px 8px", fontSize: 13, whiteSpace: "nowrap", textAlign: "left" };

export default function TwelveTeamListGraphic({
  eyebrow,
  header,
  subtitle,
  field,
  variant,
  ranking,
  rankLabel = "RK",
  rankingTitle = "RANKING",
  valueDecimals = 1,
  flipRating = true,
}: {
  eyebrow: string;
  header: string;
  subtitle?: string;
  /** 12 seeded entries (build12FromResumeSoFar / build12FromMonteCarlo). */
  field: SeededEntry[];
  variant: TwelveTeamListVariant;
  /** Full ranking the field was built from — needed for "lines" (left column + teams bumped out). */
  ranking?: RankedRow[];
  /** Column header for sourceRank in text/logos ("RSF" etc.). */
  rankLabel?: string;
  /** Left-column title for "lines", e.g. "RESUME SO FAR". */
  rankingTitle?: string;
  valueDecimals?: number;
  /** Show power rating as -rating (higher = better). Default true. */
  flipRating?: boolean;
}) {
  const seeds = [...field].sort((a, b) => a.seed - b.seed);
  return (
    <GraphicFrame eyebrow={eyebrow} header={header} subtitle={subtitle}>
      {variant === "lines" ? (
        <LinesView seeds={seeds} ranking={ranking} rankingTitle={rankingTitle} valueDecimals={valueDecimals} />
      ) : (
        <ListTable seeds={seeds} withLogos={variant === "logos"} rankLabel={rankLabel} flipRating={flipRating} />
      )}
      <Legend lines={variant === "lines"} />
    </GraphicFrame>
  );
}

function ListTable({ seeds, withLogos, rankLabel, flipRating }: { seeds: SeededEntry[]; withLogos: boolean; rankLabel: string; flipRating: boolean }) {
  const hasRank = seeds.some((s) => s.sourceRank != null);
  return (
    <table style={{ borderCollapse: "collapse", margin: "0 auto", minWidth: 520 }}>
      <thead>
        <tr>
          <th style={{ ...HEAD, textAlign: "center" }}>SEED</th>
          <th style={HEAD}>TEAM</th>
          <th style={HEAD}>CONF</th>
          <th style={HEAD}>BID</th>
          {hasRank && <th style={{ ...HEAD, textAlign: "right" }}>{rankLabel}</th>}
          <th style={{ ...HEAD, textAlign: "right" }}>RATING</th>
        </tr>
      </thead>
      <tbody>
        {seeds.map((s, i) => (
          <tr key={s.team} style={{ background: i % 2 ? "rgba(255,255,255,0.04)" : "transparent", borderBottom: s.seed === 4 ? "2px solid rgba(217,164,65,0.6)" : undefined }}>
            <td style={{ ...CELL, textAlign: "center", fontWeight: 800, color: s.seed <= 4 ? GOLD : "rgba(255,255,255,0.8)" }}>{s.seed}</td>
            <td style={{ ...CELL, fontWeight: 700 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {withLogos && <Logo team={s.team} size={20} />}
                {s.team}
              </span>
            </td>
            <td style={{ ...CELL, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{s.conf}</td>
            <td style={CELL}>{s.bid === "Auto" ? <AutoTag /> : <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)" }}>AT-LARGE</span>}</td>
            {hasRank && <td style={{ ...CELL, textAlign: "right", color: "rgba(255,255,255,0.7)" }}>{s.sourceRank ?? "–"}</td>}
            <td style={{ ...CELL, textAlign: "right", fontWeight: 700 }}>{fmtRating(s.rating, flipRating)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ROW_H = 30;
const GAP_H = 16;
const LEFT_W = 260;
const SVG_W = 170;
const RIGHT_W = 250;

type LeftItem = { kind: "row"; row: RankedRow; inField: SeededEntry | null; y: number } | { kind: "gap"; y: number };

function LinesView({ seeds, ranking, rankingTitle, valueDecimals }: { seeds: SeededEntry[]; ranking?: RankedRow[]; rankingTitle: string; valueDecimals: number }) {
  const fieldByTeam = new Map(seeds.map((s) => [s.team, s]));
  // Fall back to the field's own sourceRank (or seed) when no ranking was passed.
  const rows: RankedRow[] = ranking && ranking.length
    ? [...ranking].sort((a, b) => a.rank - b.rank)
    : seeds.map((s) => ({ team: s.team, conf: s.conf, rank: s.sourceRank ?? s.seed, value: s.sourceValue })).sort((a, b) => a.rank - b.rank);
  const shown = rows.filter((r) => r.rank <= 12 || fieldByTeam.has(r.team));

  const left: LeftItem[] = [];
  let y = 0;
  let prevRank = 0;
  for (const r of shown) {
    if (r.rank > prevRank + 1) {
      left.push({ kind: "gap", y });
      y += GAP_H;
    }
    left.push({ kind: "row", row: r, inField: fieldByTeam.get(r.team) ?? null, y });
    y += ROW_H;
    prevRank = r.rank;
  }
  const leftH = y;
  const rightH = seeds.length * ROW_H + 6; // +6: divider after seed 4
  const H = Math.max(leftH, rightH);
  const seedY = (seed: number) => (seed - 1) * ROW_H + (seed > 4 ? 6 : 0);

  return (
    <div>
      <div style={{ display: "flex", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: GOLD, marginBottom: 6 }}>
        <div style={{ width: LEFT_W }}>{rankingTitle}</div>
        <div style={{ width: SVG_W }} />
        <div style={{ width: RIGHT_W }}>PLAYOFF SEED</div>
      </div>
      <div style={{ position: "relative", width: LEFT_W + SVG_W + RIGHT_W, height: H }}>
        {left.map((it, i) =>
          it.kind === "gap" ? (
            <div key={`g${i}`} style={{ position: "absolute", top: it.y, left: 0, width: LEFT_W, height: GAP_H, textAlign: "center", fontSize: 10, lineHeight: `${GAP_H}px`, color: "rgba(255,255,255,0.35)" }}>
              • • •
            </div>
          ) : (
            <div
              key={it.row.team}
              style={{
                position: "absolute",
                top: it.y,
                left: 0,
                width: LEFT_W,
                height: ROW_H - 4,
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "0 8px",
                boxSizing: "border-box",
                borderRadius: 4,
                background: it.inField ? "rgba(255,255,255,0.06)" : "rgba(196,92,82,0.14)",
                opacity: it.inField ? 1 : 0.75,
              }}
            >
              <span style={{ width: 20, textAlign: "right", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{it.row.rank}</span>
              <Logo team={it.row.team} size={17} />
              <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: it.inField ? undefined : "line-through" }}>{it.row.team}</span>
              {!it.inField && <span style={{ fontSize: 9, fontWeight: 800, color: "#e07a6f", letterSpacing: "0.06em" }}>OUT</span>}
              {it.row.value != null && <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.65)" }}>{it.row.value.toFixed(valueDecimals)}</span>}
            </div>
          )
        )}

        <svg width={SVG_W} height={H} style={{ position: "absolute", left: LEFT_W, top: 0, overflow: "visible" }}>
          {left.map((it) => {
            if (it.kind !== "row" || !it.inField) return null;
            const y1 = it.y + (ROW_H - 4) / 2;
            const y2 = seedY(it.inField.seed) + (ROW_H - 4) / 2;
            const moved = it.row.rank !== it.inField.seed;
            const auto = it.inField.bid === "Auto";
            const color = auto ? "#d9a441" : "rgba(255,255,255,0.75)";
            return (
              <g key={it.row.team}>
                <path d={`M 4 ${y1} C ${SVG_W / 2} ${y1}, ${SVG_W / 2} ${y2}, ${SVG_W - 4} ${y2}`} fill="none" stroke={color} strokeWidth={moved ? 2.2 : 1.4} strokeOpacity={moved ? 1 : 0.45} strokeDasharray={auto && moved ? "5 3" : undefined} />
                <circle cx={4} cy={y1} r={2.5} fill={color} />
                <circle cx={SVG_W - 4} cy={y2} r={2.5} fill={color} />
              </g>
            );
          })}
        </svg>

        {seeds.map((s) => (
          <div
            key={s.team}
            style={{
              position: "absolute",
              top: seedY(s.seed),
              left: LEFT_W + SVG_W,
              width: RIGHT_W,
              height: ROW_H - 4,
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "0 8px",
              boxSizing: "border-box",
              borderRadius: 4,
              background: s.seed <= 4 ? "rgba(217,164,65,0.16)" : "rgba(255,255,255,0.06)",
            }}
          >
            <span style={{ width: 18, textAlign: "right", fontSize: 12, fontWeight: 800, color: s.seed <= 4 ? GOLD : "rgba(255,255,255,0.8)" }}>{s.seed}</span>
            <Logo team={s.team} size={17} />
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.team}</span>
            {s.bid === "Auto" && <AutoTag />}
            {s.seed <= 4 && <span style={{ fontSize: 8.5, fontWeight: 800, color: GOLD, letterSpacing: "0.06em" }}>BYE</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ lines }: { lines: boolean }) {
  return (
    <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "center", marginTop: 12, fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <AutoTag /> conference auto-bid (P4 champs + top G5)
      </span>
      <span>Seeds 1–4: first-round bye</span>
      {lines && <span>Gold line = auto-bid · struck = bumped out</span>}
    </div>
  );
}
