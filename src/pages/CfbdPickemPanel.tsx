import { useState } from "react";
import { TEAMS_BY_NAME } from "../data/teams";
import { hfaFor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";

const POOL_URL = "https://predictions.collegefootballdata.com/";

interface ParsedRow {
  id: string;
  home: string;
  away: string;
}

function parseCsv(raw: string): ParsedRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  // Skip the header row — always assumed to be id,home,away,predicted per
  // CFBD's own export format.
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    return {
      id: (parts[0] ?? "").trim(),
      home: (parts[1] ?? "").trim(),
      away: (parts[2] ?? "").trim(),
    };
  });
}

export default function CfbdPickemPanel({ onBack }: { onBack: () => void }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const { byTeam: liveByTeam } = useWeeklyStats("latest");

  function fillPredictions() {
    setCopied(false);
    const rows = parseCsv(input);
    const missing = new Set<string>();

    const outLines = ["id,home,away,predicted"];
    for (const r of rows) {
      const homeTeam = TEAMS_BY_NAME[r.home];
      const awayTeam = TEAMS_BY_NAME[r.away];

      let predicted = "";
      if (homeTeam && awayTeam) {
        // CFBD's convention (confirmed): negative = home favored (wins by
        // that many), positive = away favored (home loses by that many).
        // That's this site's "team's own spread" convention computed for
        // the home team specifically (see TeamPage.tsx's own formula):
        // home.rating - away.rating - hfa(home). Lower rating = better on
        // this site, so a well-rated home team produces a negative number
        // here, matching CFBD.
        const homeRating = liveByTeam[r.home]?.rating ?? homeTeam.rating;
        const awayRating = liveByTeam[r.away]?.rating ?? awayTeam.rating;
        const margin = homeRating - awayRating - hfaFor(r.home, liveByTeam);
        predicted = String(Math.round(margin));
      } else {
        if (!homeTeam) missing.add(r.home);
        if (!awayTeam) missing.add(r.away);
      }

      outLines.push(`${r.id},${r.home},${r.away},${predicted}`);
    }

    setOutput(outLines.join("\n"));
    setUnmatched(Array.from(missing));
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>CFBD Pick'em</h2>
        <a href={POOL_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
          Open CFBD Predictions ↗
        </a>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Paste the CSV you copy from the pool (columns: id, home, away, predicted). This fills
        in the predicted column with your power ratings' projected margin, in CFBD's own
        convention: negative = home favored (wins by that many), positive = away favored
        (home loses by that many). Copy the result back into the pool's site. Nothing here
        is saved; it's a straight paste-in / paste-out tool.
      </p>

      <label style={{ display: "block", margin: "1rem 0 0.25rem", fontWeight: 600 }}>Paste CSV</label>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={10}
        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }}
        placeholder={"id,home,away,predicted\n401864494,USC,San José State,"}
      />

      <button onClick={fillPredictions} disabled={!input.trim()} style={{ marginTop: "0.75rem" }}>
        Fill predictions
      </button>

      {unmatched.length > 0 && (
        <p style={{ color: "#a15c00", fontSize: "0.82rem" }}>
          No power rating found for: {unmatched.join(", ")}. Those rows were left blank —
          likely a name mismatch between CFBD and data/teams.ts worth reconciling.
        </p>
      )}

      {output && (
        <>
          <label style={{ display: "block", margin: "1rem 0 0.25rem", fontWeight: 600 }}>Result (copy this into the pool)</label>
          <textarea
            value={output}
            readOnly
            rows={10}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }}
          />
          <button onClick={copyOutput} style={{ marginTop: "0.5rem" }}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </>
      )}
    </div>
  );
}
