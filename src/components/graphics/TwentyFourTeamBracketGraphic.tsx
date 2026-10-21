import type { CSSProperties } from "react";
import GraphicFrame, { AutoTag, GOLD, Logo } from "./GraphicFrame";
import { pairFirstRoundNoConfConflict, playGame, reseedAndPair } from "../../lib/bracket24";
import { hfaFor } from "../../lib/odds";
import type { Field24Entry, RatingSource } from "../../lib/playoffGraphics";

// 24-team bracket (FCS-style: seeds 1-8 bye, 9-24 play in, every round
// reseeds best-vs-worst, better seed hosts until a neutral title game) —
// the exact walk Playoff24Page / FCSBracketPage run, via bracket24.ts.
// Because every round reseeds there is no fixed tree, so rounds are drawn
// as columns of games (like those pages) rather than with connectors.
//
// Four targets, one component:
//   FBS so far     field = build24FbsSoFar(soFarFull, liveByTeam)            style {division:"FBS", basis:"soFar"}
//   FBS projected  field = build24FbsProjected(confOdds, resumeByTeam, live) style {division:"FBS", basis:"projected"}
//   FCS so far     field = build24FcsSoFar(fcsSoFarRows, liveByTeam)        style {division:"FCS", basis:"soFar"}
//   FCS projected  field = build24FcsProjected(liveByTeam)                   style {division:"FCS", basis:"projected"}

export interface Bracket24Style {
  division: "FBS" | "FCS";
  basis: "soFar" | "projected";
}

const GW = 224;
const RH = 26;
const GH = RH * 2 + 1;
const COL_GAP = 16;
const TOP = 22;
const COL_H = 8 * (GH + 12);
const CHAMP_W = 150;

interface Game24 {
  top: Field24Entry;
  bottom: Field24Entry;
  host: string | null;
  topSpread: number;
  winner: Field24Entry;
}

export function walk24(field: Field24Entry[], liveByTeam?: RatingSource | null) {
  if (field.length < 24) return null;
  const mk = (a: Field24Entry, b: Field24Entry, neutral: boolean): Game24 => {
    const topSpread = a.team.rating - b.team.rating - (neutral ? 0 : hfaFor(a.team.team, liveByTeam));
    return { top: a, bottom: b, host: neutral ? null : a.team.team, topSpread, winner: playGame(a, b, neutral, liveByTeam) };
  };
  const byes = field.slice(0, 8);
  const r1 = pairFirstRoundNoConfConflict(field.slice(8, 24)).map((p: any) => mk(p.host, p.away, false));
  const r2 = reseedAndPair([...byes, ...r1.map((g) => g.winner)]).map((p: any) => mk(p.host, p.away, false));
  const qf = reseedAndPair(r2.map((g) => g.winner)).map((p: any) => mk(p.host, p.away, false));
  const sf = reseedAndPair(qf.map((g) => g.winner)).map((p: any) => mk(p.host, p.away, false));
  const fp = reseedAndPair(sf.map((g) => g.winner))[0];
  const final = mk(fp.host, fp.away, true);
  return { rounds: [r1, r2, qf, sf, [final]], champion: final.winner };
}

function fmtSpread(s: number) {
  if (Math.abs(s) < 0.05) return "PK";
  return `${s > 0 ? "+" : ""}${s.toFixed(1)}`;
}

function Row({ e, spread, winner, home, showAuto }: { e: Field24Entry; spread: number; winner: boolean; home: boolean; showAuto: boolean }) {
  const st: CSSProperties = {
    height: RH,
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 7px 0 5px",
    boxSizing: "border-box",
    borderLeft: `3px solid ${winner ? "#d9a441" : "transparent"}`,
    opacity: winner ? 1 : 0.55,
  };
  return (
    <div style={st}>
      <span style={{ width: 16, textAlign: "right", fontSize: 10.5, fontWeight: 800, color: e.seed <= 8 ? GOLD : "rgba(255,255,255,0.7)" }}>{e.seed}</span>
      <Logo team={e.team.team} size={15} />
      <span style={{ flex: 1, fontSize: 11.5, fontWeight: winner ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.team.team}</span>
      {showAuto && e.bid === "Auto" && <AutoTag label="A" />}
      {home && <span style={{ fontSize: 8, fontWeight: 800, color: "rgba(255,255,255,0.55)" }}>H</span>}
      <span style={{ width: 32, textAlign: "right", fontSize: 10.5, fontWeight: 700, color: spread < 0 ? "#8fc79a" : spread > 0 ? "#e0a95f" : "#fff" }}>{fmtSpread(spread)}</span>
    </div>
  );
}

export default function TwentyFourTeamBracketGraphic({
  eyebrow,
  header,
  subtitle,
  field,
  style,
  liveByTeam,
}: {
  eyebrow: string;
  /** Defaults by style, e.g. "FBS 24-TEAM PLAYOFF — SO FAR". */
  header?: string;
  subtitle?: string;
  /** 24 entries from one of the build24* helpers in lib/playoffGraphics.ts. */
  field: Field24Entry[];
  style: Bracket24Style;
  /** For per-team HFA (hfaFor) — every round but the title is at the better seed. */
  liveByTeam?: RatingSource | null;
}) {
  const title = header ?? `${style.division} 24-TEAM PLAYOFF — ${style.basis === "soFar" ? "IF THE SEASON ENDED TODAY" : "PROJECTED"}`;
  const defaultSub =
    style.division === "FBS"
      ? style.basis === "soFar"
        ? "10 auto-bids (top Resume So Far team in each conference) + 14 at-large by Resume So Far · seeds by Resume So Far"
        : "10 auto-bids by conference-title odds + 14 at-large by Resume Rating · seeds by Resume Rating"
      : style.basis === "soFar"
      ? "Top 24 FCS teams by Resume So Far"
      : "Top 24 FCS teams by YC power rating";
  const w = walk24(field, liveByTeam);
  if (!w) return <GraphicFrame eyebrow={eyebrow} header={title}>Not enough teams for a 24-team field.</GraphicFrame>;

  const labels = ["FIRST ROUND", "SECOND ROUND", "QUARTERFINALS", "SEMIFINALS", "CHAMPIONSHIP"];
  const colX = (c: number) => c * (GW + COL_GAP);
  const W = colX(5) + CHAMP_W;
  const H = TOP + COL_H;
  const gameY = (n: number, i: number) => TOP + (COL_H / n) * (i + 0.5) - GH / 2;
  const showAuto = style.division === "FBS";
  const champ = w.champion;

  return (
    <GraphicFrame eyebrow={eyebrow} header={title} subtitle={subtitle ?? defaultSub}>
      <div style={{ position: "relative", width: W, height: H }}>
        {[...labels, "CHAMPION"].map((l, c) => (
          <div key={l} style={{ position: "absolute", left: colX(c), top: 0, width: c === 5 ? CHAMP_W : GW, textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: GOLD }}>
            {l}
          </div>
        ))}
        {w.rounds.map((games, c) =>
          games.map((g, i) => (
            <div
              key={`${c}-${i}`}
              style={{ position: "absolute", left: colX(c), top: gameY(games.length, i), width: GW, height: GH, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 5, overflow: "hidden" }}
            >
              <Row e={g.top} spread={g.topSpread} winner={g.winner === g.top} home={g.host === g.top.team.team} showAuto={showAuto} />
              <div style={{ height: 1, background: "rgba(255,255,255,0.12)" }} />
              <Row e={g.bottom} spread={-g.topSpread} winner={g.winner === g.bottom} home={g.host === g.bottom.team.team} showAuto={showAuto} />
            </div>
          ))
        )}
        <div
          style={{
            position: "absolute",
            left: colX(5),
            top: gameY(1, 0) - 22,
            width: CHAMP_W,
            height: GH + 44,
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
          <Logo team={champ.team.team} size={44} />
          <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", textAlign: "center", padding: "0 6px" }}>
            <span style={{ color: GOLD }}>{champ.seed}</span> {champ.team.team}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 10, fontWeight: 600, display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
        Seeds 1–8 bye · every round reseeds best vs. worst · better seed hosts (H) until a neutral title game · gold bar = projected winner
        {showAuto && (
          <>
            {" · "}
            <AutoTag label="A" /> auto-bid
          </>
        )}
      </div>
    </GraphicFrame>
  );
}
