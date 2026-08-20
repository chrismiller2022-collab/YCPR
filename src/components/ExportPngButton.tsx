import { useState, type RefObject } from "react";
import { Download } from "lucide-react";
import { exportNodeAsPng } from "../lib/exportPng";
import TweetButton from "./TweetButton";

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
}: {
  targetRef: RefObject<HTMLElement>;
  filename: string | (() => string);
  label?: string;
  showTweet?: boolean;
  tweetText?: string | (() => string);
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    try {
      const name = typeof filename === "function" ? filename() : filename;
      await exportNodeAsPng(targetRef.current, name);
    } catch (err) {
      console.error("PNG export failed", err);
    } finally {
      setBusy(false);
    }
  };

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
