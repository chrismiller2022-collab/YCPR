import { useState, type RefObject } from "react";
import { Download } from "lucide-react";
import { exportNodeAsPdf } from "../lib/exportPng";

export default function ExportPdfButton({
  targetRef,
  filename,
  label = "Export PDF",
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
      await exportNodeAsPdf(targetRef.current, name);
    } catch (err) {
      console.error("PDF export failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="export-png-btn" onClick={handleClick} disabled={busy} title="Export this report as a PDF" data-export-exclude="true">
      <Download size={14} />
      {busy ? "Exporting…" : label}
    </button>
  );
}
