import { useState, type RefObject } from "react";
import { Twitter } from "lucide-react";
import { shareNodeToTwitter } from "../lib/exportPng";

export default function TweetButton({
  targetRef,
  filename,
  tweetText = "",
  label = "Tweet",
}: {
  targetRef: RefObject<HTMLElement>;
  filename: string | (() => string);
  tweetText?: string | (() => string);
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const name = typeof filename === "function" ? filename() : filename;
      const text = typeof tweetText === "function" ? tweetText() : tweetText;
      const result = await shareNodeToTwitter(targetRef.current, name, text);
      if (result === "clipboard") setMessage("Image copied — paste it into the tweet box.");
      else if (result === "download") setMessage("Image downloaded — attach it to the tweet manually.");
    } catch (err) {
      console.error("Tweet share failed", err);
      setMessage("Couldn't prepare the image — try Export PNG instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="export-png-btn"
        onClick={handleClick}
        disabled={busy}
        title="Share this as a tweet"
      >
        <Twitter size={14} />
        {busy ? "Preparing…" : label}
      </button>
      {message && (
        <span
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "0.3rem",
            fontSize: "0.72rem",
            color: "var(--chalk-dim)",
            background: "var(--turf-panel)",
            border: "1px solid var(--hash)",
            borderRadius: 6,
            padding: "0.3rem 0.5rem",
            whiteSpace: "nowrap",
            zIndex: 5,
          }}
        >
          {message}
        </span>
      )}
    </span>
  );
}
