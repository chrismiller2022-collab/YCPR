import { useState, type RefObject } from "react";
import { Download } from "lucide-react";
import { exportNodeAsPng } from "../lib/exportPng";

export default function ExportPngButton({
  targetRef,
  filename,
  label = "Export PNG",
}: {
  targetRef: RefObject<HTMLElement>;
  filename: string | (() => string);
  label?: string;
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
  );
}
