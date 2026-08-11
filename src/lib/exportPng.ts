import { toPng } from "html-to-image";

// Wrapper containers use `.table-scroll` (max-height + overflow: auto) so
// long tables scroll on-page instead of stretching the layout. html-to-image
// only captures what's actually rendered, so a scrolled container would
// otherwise crop the exported PNG to whatever fits in the viewport. Before
// capturing, temporarily un-clip every scroll container inside the target so
// the full table renders, then restore the original inline styles right
// after — the on-page UI never visibly changes.
function expandScrollAreas(root: HTMLElement): () => void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>(".table-scroll"));
  if (root.classList.contains("table-scroll")) targets.push(root);

  const restores = targets.map((el) => {
    const prevCssText = el.style.cssText;
    el.style.maxHeight = "none";
    el.style.overflow = "visible";
    return () => {
      el.style.cssText = prevCssText;
    };
  });

  return () => restores.forEach((restore) => restore());
}

// Elements marked data-export-exclude="true" (search boxes, filter
// dropdowns, mode toggles, the export button itself, footer disclaimers)
// are skipped entirely so the PNG only shows the header + table.
function shouldInclude(domNode: HTMLElement | Node) {
  if (!(domNode instanceof HTMLElement)) return true;
  return domNode.dataset.exportExclude !== "true";
}

export async function exportNodeAsPng(node: HTMLElement, filename: string) {
  const restore = expandScrollAreas(node);
  try {
    const dataUrl = await toPng(node, {
      backgroundColor: "#1f2041",
      pixelRatio: 2,
      filter: shouldInclude,
    });
    const link = document.createElement("a");
    link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    restore();
  }
}
