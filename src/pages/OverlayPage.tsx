import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import OverlayView from "../components/overlay/OverlayView";
import { useOverlayData, useOverlayState } from "../lib/overlay";

// What the Google TV app loads into its see-through window. Must stay
// fully transparent everywhere except the bug itself — the video is
// underneath. Controlled entirely from /overlay/control; there's no UI
// here because the TV remote never reaches this window.
export default function OverlayPage() {
  const [params] = useSearchParams();
  const screen = params.get("screen") || "default";
  const [state] = useOverlayState(screen);
  const { contexts, scores } = useOverlayData(state, true);

  useEffect(() => {
    const els = [document.documentElement, document.body];
    for (const el of els) {
      el.style.background = "transparent";
      el.style.margin = "0";
      el.style.overflow = "hidden";
    }
  }, []);

  if (!state) return null;
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OverlayView state={state} contexts={contexts} scores={scores} />
    </div>
  );
}
