import { useState, type RefObject } from "react";
import { Download } from "lucide-react";
import { exportNodeAsPng, getMaxTableBodyRowCount } from "../lib/exportPng";
import TweetButton from "./TweetButton";

// Full-list team/tool pages can run past a hundred rows, which makes for
// an unwieldy PNG when someone just wants a quick share — but a 16-team
// conference table or a single week's slate of games shouldn't ever
// nag about it. 25 draws the line at "long enough that Top 25 is a
// meaningfully different, more shareable export," not just "has rows."
const TOP_N_PROMPT_THRESHOLD = 25;

export interface ExportRowMode {
  label: string;
  match: (row: HTMLTableRowElement) => boolean;
}

// Renders Export PNG next to a Tweet button everywhere this component is
// already used, site-wide — a single change here instead of touching
// every page that has an export button. Pass showTweet={false} to opt a
// particular usage out.
export default function ExportPngButton({
  targetRef,
  filename,
  label = "Export PNG",
  showTweet = true,
  tweetText = "",
  rowModes,
  tighten,
}: {
  targetRef: RefObject<HTMLElement>;
  filename: string | (() => string);
  label?: string;
  showTweet?: boolean;
  tweetText?: string | (() => string);
  // For non-ranking pages where "Top 25" doesn't mean anything — e.g.
  // Weekly Matchups' Full Card / Completed Games Only / Future Games.
  // When provided, replaces the Top-N prompt with buttons for each mode,
  // still only shown once the row count clears TOP_N_PROMPT_THRESHOLD.
  rowModes?: ExportRowMode[];
  // Tightens every cell's padding for capture only — for wide multi-
  // column tables that read sparse once shrunk down for mobile viewing.
  tighten?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const runExport = async (topN?: number, rowMatch?: (row: HTMLTableRowElement) => boolean) => {
    if (!targetRef.current || busy) return;
    setChoosing(false);
    setBusy(true);
    try {
      const name = typeof filename === "function" ? filename() : filename;
      await exportNodeAsPng(targetRef.current, name, topN, rowMatch, tighten);
    } catch (err) {
      console.error("PNG export failed", err);
    } finally {
      setBusy(false);
    }
  };

  const handleClick = () => {
    if (!targetRef.current || busy) return;
    const rowCount = getMaxTableBodyRowCount(targetRef.current);
    if (rowCount > TOP_N_PROMPT_THRESHOLD) {
      setChoosing(true);
      return;
    }
    void runExport();
  };

  if (choosing) {
    return (
      <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }} data-export-exclude="true">
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Export:</span>
        {rowModes ? (
          rowModes.map((mode) => (
            <button key={mode.label} type="button" className="export-png-btn" onClick={() => void runExport(undefined, mode.match)} disabled={busy}>
              {mode.label}
            </button>
          ))
        ) : (
          <>
            <button type="button" className="export-png-btn" onClick={() => void runExport()} disabled={busy}>
              Full List
            </button>
            <button type="button" className="export-png-btn" onClick={() => void runExport(25)} disabled={busy}>
              Top 25
            </button>
          </>
        )}
        <button
          type="button"
          className="export-png-btn"
          onClick={() => setChoosing(false)}
          disabled={busy}
          title="Cancel"
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: "0.5rem" }} data-export-exclude="true">
      <button
        type="button"
        className="export-png-btn"
        onClick={handleClick}
        disabled={busy}
        title="Export this table as a PNG image"
      >
        <Download size={14} />
        {busy ? "Exporting…" : label}
      </button>
      {showTweet && <TweetButton targetRef={targetRef} filename={filename} tweetText={tweetText} />}
    </span>
  );
}
