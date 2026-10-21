import type { CSSProperties } from "react";
import GraphicFrame, { AutoTag, GOLD, Logo } from "./GraphicFrame";
import { projectTwelveTeamBracket, type AdvanceOptions, type ProjectedGame, type SeededEntry } from "../../lib/playoffGraphics";

// 12-team CFP bracket as a capture-ready tree (BracketPage.tsx's shape and
// sites): First Round 8v9 / 5v12 / 6v11 / 7v10 at the higher seed, seeds 1-4
// waiting in the quarterfinals, QF/SF/title neutral. Each later round shows
// the projected favorite advancing (spread <= 0), same as BracketPage.

const GW = 214; // game box width
const RH = 28; // team row height
const GH = RH * 2 + 1;
const COL_GAP = 40;
const PITCH = GH + 26;
const TOP = 22; // room for round labels
const CHAMP_W = 170;

function fmtSpread(s: number) {
  if (Math.abs(s) < 0.05) return "PK";
  return `${s > 0 ? "+" : ""}${s.toFixed(1)}`;
}

function TeamRow({ e, spread, winner, home, showAuto }: { e: SeededEntry; spread: number; winner: boolean; home: boolean; showAuto: boolean }) {
  const st: CSSProperties = {
    height: RH,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 8px 0 6px",
    boxSizing: "border-box",
    borderLeft: `3px solid ${winner ? "#d9a441" : "transparent"}`,
    opacity: winner ? 1 : 0.55,
  };
  return (
    <div style={st}>
      <span style={{ width: 16, textAlign: "right", fontSize: 11, fontWeight: 800, color: e.seed <= 4 ? GOLD : "rgba(255,255,255,0.7)" }}>{e.seed}</span>
      <Logo team={e.team} size={17} />
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: winner ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.team}</span>
      {showAuto && e.bid === "Auto" && <AutoTag label="A" />}
      {home && <span style={{ fontSize: 8.5, fontWeight: 800, color: "rgba(255,255,255,0.6)", letterSpacing: "0.05em" }}>HOME</span>}
      <span style={{ width: 36, textAlign: "right", fontSize: 11.5, fontWeight: 700, color: spread < 0 ? "#8fc79a" : spread > 0 ? "#e0a95f" : "#fff" }}>{fmtSpread(spread)}</span>
    </div>
  );
}

function GameBox({ g, x, y, showAuto }: { g: ProjectedGame; x: number; y: number; showAuto: boolean }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: GW, height: GH, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 5, overflow: "hidden" }}>
      <TeamRow e={g.top} spread={g.topSpread} winner={g.winner === g.top} home={g.host === g.top.team} showAuto={showAuto} />
      <div style={{ height: 1, background: "rgba(255,255,255,0.12)" }} />
      <TeamRow e={g.bottom} spread={-g.topSpread} winner={g.winner === g.bottom} home={g.host === g.bottom.team} showAuto={showAuto} />
    </div>
  );
}

export default function TwelveTeamBracketGraphic({
  eyebrow,
  header,
  subtitle,
  field,
  liveByTeam,
  showAutoTags = true,
}: {
  eyebrow: string;
  header: string;
  subtitle?: string;
  /** 12 seeded entries (e.g. build12FromResumeSoFar(soFarFull, liveByTeam)). */
  field: SeededEntry[];
  /** For per-team HFA (hfaFor) on first-round home games. */
  liveByTeam?: AdvanceOptions["liveByTeam"];
  showAutoTags?: boolean;
}) {
  const b = projectTwelveTeamBracket(field, { liveByTeam });
  if (!b) return <GraphicFrame eyebrow={eyebrow} header={header}>Not enough teams for a 12-team field.</GraphicFrame>;

  const colX = (c: number) => c * (GW + COL_GAP);
  const qfY = (i: number) => TOP + i * PITCH;
  const sfY = (i: number) => (qfY(2 * i) + qfY(2 * i + 1)) / 2;
  const fY = (sfY(0) + sfY(1)) / 2;
  const W = colX(4) + CHAMP_W;
  const H = qfY(3) + GH + 4;

  // connector from a box's right-middle into a target row's left edge
  const link = (fromCol: number, fromY: number, toRowY: number) => {
    const x1 = colX(fromCol) + GW;
    const y1 = fromY + GH / 2;
    const x2 = colX(fromCol + 1);
    const mx = x1 + COL_GAP / 2;
    return `M ${x1} ${y1} H ${mx} V ${toRowY} H ${x2}`;
  };
  const rowMid = (boxY: number, bottom: boolean) => boxY + (bottom ? RH + 1 + RH / 2 : RH / 2);

  const paths: string[] = [];
  b.firstRound.forEach((_, i) => paths.push(link(0, qfY(i), rowMid(qfY(i), true))));
  b.quarterfinals.forEach((_, i) => paths.push(link(1, qfY(i), rowMid(sfY(Math.floor(i / 2)), i % 2 === 1))));
  b.semifinals.forEach((_, i) => paths.push(link(2, sfY(i), rowMid(fY, i === 1))));
  paths.push(`M ${colX(3) + GW} ${fY + GH / 2} H ${colX(4)}`);

  const labels = ["FIRST ROUND", "QUARTERFINALS", "SEMIFINALS", "CHAMPIONSHIP", "CHAMPION"];
  const champ = b.champion;

  return (
    <GraphicFrame eyebrow={eyebrow} header={header} subtitle={subtitle}>
      <div style={{ position: "relative", width: W, height: H }}>
        {labels.map((l, c) => (
          <div key={l} style={{ position: "absolute", left: colX(c), top: 0, width: c === 4 ? CHAMP_W : GW, textAlign: "center", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: GOLD }}>
            {l}
          </div>
        ))}
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
          ))}
        </svg>
        {b.firstRound.map((g, i) => (
          <GameBox key={`r1${i}`} g={g} x={colX(0)} y={qfY(i)} showAuto={showAutoTags} />
        ))}
        {b.quarterfinals.map((g, i) => (
          <GameBox key={`qf${i}`} g={g} x={colX(1)} y={qfY(i)} showAuto={showAutoTags} />
        ))}
        {b.semifinals.map((g, i) => (
          <GameBox key={`sf${i}`} g={g} x={colX(2)} y={sfY(i)} showAuto={showAutoTags} />
        ))}
        <GameBox g={b.final} x={colX(3)} y={fY} showAuto={showAutoTags} />
        <div
          style={{
            position: "absolute",
            left: colX(4),
            top: fY - 18,
            width: CHAMP_W,
            height: GH + 36,
            border: "2px solid #d9a441",
            borderRadius: 8,
            background: "rgba(217,164,65,0.12)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            boxSizing: "border-box",
          }}
        >
          <Logo team={champ.team} size={44} />
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", textAlign: "center" }}>
            <span style={{ color: GOLD }}>{champ.seed}</span> {champ.team}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 10, fontWeight: 600, display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
        Spreads from YC power ratings · First round at the higher seed, then neutral · Gold bar = projected winner
        {showAutoTags && (
          <>
            {" · "}
            <AutoTag label="A" /> auto-bid
          </>
        )}
      </div>
    </GraphicFrame>
  );
}
