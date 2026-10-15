import { useState } from "react";
import { parseSplashPickemText, parseSplashCbsText, matchSplashLines } from "../lib/splashPickemParse";

// Paste box shared by the Splash-hosted pool panels. Parses the pasted
// picks page, matches games to the week, and hands back each game's
// away-perspective line — the panel applies it to local state only, so
// nothing is saved until the panel's own Save is clicked.

export interface SplashPasteGame {
  id: string;
  away_team: string;
  home_team: string;
  currentLine: number | null;
  vegasLine: number | null;
}

// The CBS/Kelly page won't let its lines be selected, so its text comes
// from this snippet (run in DevTools Console on the picks page): it dumps
// every text node, including CSS pseudo-element content, one per line,
// and copies the result to the clipboard. Read-only — it sends nothing.
const CONSOLE_SNIPPET = `(() => {
  const out = [];
  const pseudo = (el, p) => {
    const c = getComputedStyle(el, p).content;
    return c && c !== "none" && c !== "normal" ? c.replace(/^"|"$/g, "") : "";
  };
  const walk = (el) => {
    out.push(pseudo(el, "::before"));
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out.push(n.textContent.trim());
      else if (n.nodeType === 1 && !["SCRIPT", "STYLE", "SVG"].includes(n.tagName.toUpperCase())) walk(n);
    }
    out.push(pseudo(el, "::after"));
  };
  walk(document.body);
  copy(out.filter(Boolean).join("\\n"));
  console.log("Copied", out.filter(Boolean).length, "lines");
})();`;

function fmt(v: number | null) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

export default function SplashLinePaste({
  format,
  games,
  disabled,
  onApply,
}: {
  format: "peay" | "cbs";
  games: SplashPasteGame[];
  disabled?: boolean;
  onApply: (lineByGame: Map<string, number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ summary: string; details: { text: string; warn?: boolean }[] } | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);

  function apply() {
    const parsed = format === "peay" ? parseSplashPickemText(text) : parseSplashCbsText(text);
    if (parsed.length === 0) {
      setResult({ summary: "No games found in the pasted text — see the instructions above.", details: [] });
      return;
    }
    const { matches, unmatched } = matchSplashLines(
      parsed,
      games.map((g) => ({ id: g.id, away_team: g.away_team, home_team: g.home_team }))
    );
    const lineByGame = new Map(matches.map((m) => [m.gameId, m.awayLine]));
    const details: { text: string; warn?: boolean }[] = [];
    for (const g of games) {
      const next = lineByGame.get(g.id);
      if (next == null) continue;
      const vegasNote = g.vegasLine != null && g.vegasLine !== next ? ` (Vegas ${fmt(g.vegasLine)})` : "";
      if (g.currentLine !== next)
        details.push({ text: `${g.away_team} @ ${g.home_team}: ${fmt(g.currentLine)} → ${fmt(next)}${vegasNote}`, warn: !!vegasNote });
      else if (vegasNote) details.push({ text: `${g.away_team} @ ${g.home_team}: ${fmt(next)}${vegasNote}`, warn: true });
    }
    for (const u of unmatched)
      details.push({ text: `Not matched to a game this week: ${u.rawTeamA} vs ${u.rawTeamB} (${fmt(u.teamALine)})`, warn: true });
    const missing = games.filter((g) => !lineByGame.has(g.id));
    for (const g of missing) details.push({ text: `No pasted line for: ${g.away_team} @ ${g.home_team}` });
    onApply(lineByGame);
    setResult({
      summary: `Filled ${matches.length} of ${games.length} games from ${parsed.length} pasted. ${unmatched.length} unmatched, ${missing.length} without a pasted line. Orange = differs from Vegas. Review, then Save.`,
      details,
    });
  }

  return (
    <>
      <button className={`mode-btn ${open ? "mode-btn-active" : ""}`} onClick={() => setOpen((v) => !v)}>
        Paste Splash lines
      </button>
      {open && (
        <div style={{ flexBasis: "100%", border: "1px solid var(--hash)", borderRadius: 8, padding: "0.75rem" }}>
          {format === "peay" ? (
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
              On the Splash picks page press Ctrl+A, Ctrl+C, then paste here.
            </p>
          ) : (
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
              This page's lines can't be copied normally. Click{" "}
              <button
                className="menu-btn"
                style={{ padding: "0.1rem 0.4rem", fontSize: "0.78rem" }}
                onClick={() => {
                  navigator.clipboard.writeText(CONSOLE_SNIPPET).then(() => setSnippetCopied(true));
                }}
              >
                {snippetCopied ? "Snippet copied ✓" : "Copy console snippet"}
              </button>
              , open the Splash picks page, press F12 → Console, paste it and press Enter (it prints "Copied N lines"), then
              paste here.
            </p>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.75rem" }}
            placeholder="Paste the Splash picks page here…"
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button className="menu-btn" onClick={apply} disabled={disabled || games.length === 0 || text.trim() === ""}>
              Fill lines
            </button>
            <button
              className="menu-btn"
              onClick={() => {
                setText("");
                setResult(null);
              }}
            >
              Clear
            </button>
          </div>
          {result && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
              <strong>{result.summary}</strong>
              {result.details.length > 0 && (
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {result.details.map((d, i) => (
                    <li key={i} style={{ color: d.warn ? "#a15c00" : undefined }}>
                      {d.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
