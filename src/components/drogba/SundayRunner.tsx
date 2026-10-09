import { useRef, useState } from "react";
import { pullDrogba, syncGamesWeek } from "../../lib/api/drogbaData";
import { pullFanDuelSnapshot } from "../../lib/drogba/fanduelPull";
import { findGaps, fitForWeek, projectWeek, type GapPlan, type WeekSplit } from "../../lib/drogba/weekPlan";
import type { DrogbaState } from "../../lib/drogba/useDrogba";
import { DIM } from "./shared";

type StepStatus = "pending" | "running" | "ok" | "error" | "skipped";
interface Step {
  id: string;
  label: string;
  cost: string; // what it uses, shown before it runs
  status: StepStatus;
  detail: string;
  run: () => Promise<string>;
}

// A projected spread per game, so a run can say which numbers moved once fresh data was in.
export type Snapshot = Map<string, number>;
export interface RunDiff {
  before: Snapshot;
  after: Snapshot;
}

const MARK: Record<StepStatus, string> = { pending: "·", running: "…", ok: "✓", error: "✗", skipped: "–" };
const COLOR: Record<StepStatus, string> = { pending: "var(--chalk-dim)", running: "#e8c84a", ok: "#8fd39a", error: "#e07a7a", skipped: "var(--chalk-dim)" };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs the Sunday routine as a list of steps from the browser, each one a short request, so nothing runs into the server's
// 60-second limit and a failed step can be retried on its own.
export default function SundayRunner({ state, split, onDiff }: { state: DrogbaState; split: WeekSplit; onDiff: (d: RunDiff | null) => void }) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const diffRef = useRef<{ before: Snapshot } | null>(null);

  function snapshot(): Snapshot {
    const st = stateRef.current;
    const out: Snapshot = new Map();
    if (!st.engine) return out;
    for (const r of projectWeek(st.engine, fitForWeek(st.engine, split.season, split.upcoming), split.season, split.upcoming)) if (r.modelSpread != null) out.set(r.g.id, r.modelSpread);
    return out;
  }

  async function rebuild(): Promise<string> {
    const v = stateRef.current.version;
    stateRef.current.reload();
    for (let i = 0; i < 400; i++) {
      await wait(300);
      const s = stateRef.current;
      if (s.version > v && !s.loading && !s.building) {
        if (s.error) throw new Error(s.error);
        return "Ratings rebuilt with the new data.";
      }
    }
    throw new Error("Timed out waiting for the ratings to rebuild");
  }

  async function execute(list: Step[], from: number) {
    setRunning(true);
    const update = (i: number, patch: Partial<Step>) => setSteps((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    for (let i = from; i < list.length; i++) {
      update(i, { status: "running", detail: "" });
      try {
        const detail = await list[i].run();
        list[i] = { ...list[i], status: "ok", detail };
        update(i, { status: "ok", detail });
      } catch (e: any) {
        update(i, { status: "error", detail: e?.message ?? "Failed" });
        setRunning(false);
        return;
      }
    }
    setRunning(false);
    if (diffRef.current) onDiff({ before: diffRef.current.before, after: snapshot() });
  }

  function start(kind: "full" | "gaps") {
    const st = stateRef.current;
    if (!st.engine) return;
    const { season, last, upcoming } = split;
    const gaps: GapPlan = findGaps(st.games, st.gameStats, split, st.fanduelLines, st.engine.hasPlays, Date.now());
    const list: Step[] = [];
    const add = (id: string, label: string, cost: string, run: () => Promise<string>) => list.push({ id, label, cost, status: "pending", detail: "", run });

    const gamesStep = (w: number) => add(`games-${w}`, `Results, schedule and lines for week ${w}`, "3 CFBD calls", async () => {
      const r = await syncGamesWeek(season, w);
      return `${r.gamesUpserted} games and ${r.linesUpserted} lines refreshed.`;
    });
    const advStep = (w: number) => add(`adv-${w}`, `Advanced stats for week ${w}`, "1 CFBD call", async () => {
      const r = await pullDrogba("gameadv", season, w);
      return `${r.gameAdv?.saved ?? 0} team-games saved (${r.gameAdv?.withPpa ?? 0} with PPA).${r.warnings?.length ? ` ${r.warnings.join("; ")}` : ""}`;
    });
    const playsStep = (w: number) => add(`plays-${w}`, `Play-by-play for week ${w}`, "1 CFBD call (large)", async () => {
      const r = await pullDrogba("plays", season, w);
      return `${r.plays?.fetched.toLocaleString() ?? 0} plays pulled, ${r.plays?.saved ?? 0} team-games saved.${r.warnings?.length ? ` ${r.warnings.join("; ")}` : ""}`;
    });
    const openersStep = () => add("openers", `FanDuel openers (current lines)`, "10 Odds API credits", async () => {
      const s = stateRef.current;
      const r = await pullFanDuelSnapshot(s.games, s.bovadaOpen, null, null, null);
      const wk = r.summary;
      return `${wk.matched} of ${wk.withLine} FanDuel lines matched to games (${wk.unmatched} not matched); credits left ${wk.remaining ?? "?"}. Games FanDuel hasn't posted yet are filled by running "Fill gaps" later.`;
    });

    if (kind === "full") {
      if (last >= 1) {
        gamesStep(last);
        advStep(last);
        playsStep(last);
      }
      gamesStep(upcoming);
      openersStep();
    } else {
      for (const w of gaps.gamesWeeks) gamesStep(w);
      for (const w of gaps.advWeeks) advStep(w);
      for (const w of gaps.playWeeks) playsStep(w);
      if (gaps.needOpeners) openersStep();
    }
    if (list.length === 0) {
      setTitle("Fill gaps");
      setSteps([]);
      setRunning(false);
      alert("Nothing is missing: last week's results and stats are all in and every game this week has a FanDuel opener.");
      return;
    }
    add("rebuild", "Rebuild ratings and re-check", "no external calls", rebuild);

    const cfbd = list.filter((s) => s.cost.includes("CFBD")).reduce((n, s) => n + (s.id.startsWith("games") ? 3 : 1), 0);
    const credits = list.some((s) => s.id === "openers") ? 10 : 0;
    const summary = `${kind === "full" ? "Run the full Sunday routine" : "Fill the gaps"}:\n\n${list.map((s, i) => `${i + 1}. ${s.label}`).join("\n")}\n\nUses about ${cfbd} CFBD calls${credits ? ` and ${credits} Odds API credits` : ""}. Continue?`;
    if (!window.confirm(summary)) return;

    diffRef.current = { before: snapshot() };
    onDiff(null);
    setTitle(kind === "full" ? "Full Sunday run" : "Fill gaps");
    setSteps(list);
    void execute(list, 0);
  }

  async function retry(i: number) {
    const list = steps.map((s) => ({ ...s }));
    await execute(list, i);
  }

  return (
    <div style={{ margin: "0.8rem 0 0.4rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="menu-btn" disabled={running || !state.engine} onClick={() => start("full")} style={{ fontWeight: 700 }}>
          Run Sunday routine
        </button>
        <button className="menu-btn" disabled={running || !state.engine} onClick={() => start("gaps")}>
          Fill gaps only
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          Full: last week's results, advanced stats and play-by-play, this week's schedule and lines, FanDuel openers, then rebuild. Gaps: only what the checklist below says is missing.
        </span>
      </div>
      {steps.length > 0 && (
        <div style={{ marginTop: "0.6rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.2rem" }}>{title}</div>
          {steps.map((s, i) => (
            <div key={s.id} style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", padding: "0.2rem 0", fontSize: "0.82rem" }}>
              <span style={{ color: COLOR[s.status], fontWeight: 700, width: "1rem", textAlign: "center" }}>{MARK[s.status]}</span>
              <div style={{ flex: 1 }}>
                <span>{s.label}</span> <span style={{ color: "var(--chalk-dim)", fontSize: "0.74rem" }}>· {s.cost}</span>
                {s.detail && <div style={{ fontSize: "0.76rem", color: s.status === "error" ? "#e07a7a" : "var(--chalk-dim)" }}>{s.detail}</div>}
              </div>
              {s.status === "error" && !running && (
                <button className="menu-btn" onClick={() => retry(i)} style={{ fontSize: "0.72rem", padding: "0.1rem 0.5rem" }}>
                  Retry from here
                </button>
              )}
            </div>
          ))}
          {!running && steps.every((s) => s.status === "ok") && <p style={DIM}>Done. The checklist, reports and bet list below now reflect the fresh data.</p>}
        </div>
      )}
    </div>
  );
}
