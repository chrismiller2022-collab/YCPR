import { toPng, toBlob } from "html-to-image";

// Row-count helper shared by ExportPngButton (to decide whether to show
// the Full List/Top 25 prompt at all) and limitToTopN below (to actually
// truncate for capture). "Row count" = the biggest single <tbody>'s
// direct <tr> count — biggest, not total, so a page with several small
// tables (e.g. Hardest/Easiest side-by-side SOS columns) doesn't
// accidentally sum past the threshold and trigger a prompt that wouldn't
// make sense there.
export function getMaxTableBodyRowCount(root: HTMLElement): number {
  const bodies = Array.from(root.querySelectorAll<HTMLTableSectionElement>("table tbody"));
  let max = 0;
  for (const tbody of bodies) {
    const count = tbody.querySelectorAll(":scope > tr").length;
    if (count > max) max = count;
  }
  return max;
}

// For "Top 25" exports — hides every body row past the Nth in each table
// inside the target, so the exported PNG only shows the first N. Every
// team-list page on the site already renders rows in ranked order, so
// "first N rendered rows" is exactly "Top N" with no per-page wiring
// needed here. Restored right after capture, same pattern as
// expandScrollAreas below.
function limitToTopN(root: HTMLElement, n: number): () => void {
  const bodies = Array.from(root.querySelectorAll<HTMLTableSectionElement>("table tbody"));
  const restores: (() => void)[] = [];
  for (const tbody of bodies) {
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
    rows.forEach((row, i) => {
      if (i >= n) {
        const prevDisplay = row.style.display;
        row.style.display = "none";
        restores.push(() => {
          row.style.display = prevDisplay;
        });
      }
    });
  }
  return () => restores.forEach((restore) => restore());
}

// For pages that aren't a ranking (Weekly Matchups, etc.) — "Top 25"
// doesn't mean anything there, but showing/hiding rows by some other
// real property (e.g. completed vs. not-yet-played) does. Rows are
// matched by a predicate instead of position; anything not matching is
// hidden for capture only, same restore pattern as limitToTopN.
export function filterRowsByMatch(root: HTMLElement, match: (row: HTMLTableRowElement) => boolean): () => void {
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("table tbody > tr"));
  const restores: (() => void)[] = [];
  for (const row of rows) {
    if (!match(row)) {
      const prevDisplay = row.style.display;
      row.style.display = "none";
      restores.push(() => {
        row.style.display = prevDisplay;
      });
    }
  }
  return () => restores.forEach((restore) => restore());
}

// Wide data tables (many columns, each with its normal interactive
// padding) read fine on desktop but look sparse once exported and
// viewed shrunk down on a phone — there's no good way to reflow a
// 13-column table into a narrow single column the way a ranked list
// can be (see Watchability's dedicated mobile export layout), so this
// instead tightens padding across every cell for the capture only,
// closing up the dead space between columns without changing the
// on-page interactive table at all.
function tightenPadding(root: HTMLElement): () => void {
  const cells = Array.from(root.querySelectorAll<HTMLElement>("th, td"));
  const restores = cells.map((cell) => {
    const prevPadding = cell.style.padding;
    cell.style.padding = "0.25rem 0.4rem";
    return () => {
      cell.style.padding = prevPadding;
    };
  });
  return () => restores.forEach((restore) => restore());
}

// Wrapper containers use `.table-scroll` (max-height + overflow: auto) so
// long tables scroll on-page instead of stretching the layout. html-to-image
// only captures what's actually rendered, so a scrolled container would
// otherwise crop the exported PNG to whatever fits in the viewport. Before
// capturing, temporarily un-clip every scroll container inside the target so
// the full table renders, then restore the original inline styles right
// after — the on-page UI never visibly changes.
function expandScrollAreas(root: HTMLElement): () => void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>(".table-scroll, [data-export-scroll]"));
  if (root.classList.contains("table-scroll") || root.dataset.exportScroll != null) targets.push(root);

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

// Bakes site branding directly into every exported/tweeted PNG (site name
// bottom-left, Twitter handle bottom-right) — appended to the DOM right
// before capture and removed right after, so the on-page UI never shows it.
const SITE_BRAND = "YC • POWER RATINGS";
const TWITTER_HANDLE = "@YCtheflea";

function appendBrandingFooter(root: HTMLElement): () => void {
  const bar = document.createElement("div");
  bar.style.cssText = [
    "display:flex",
    "justify-content:space-between",
    "align-items:center",
    "gap:12px",
    "padding:10px 16px",
    "margin-top:10px",
    "border-top:1px solid rgba(255,255,255,0.15)",
    "font-size:13px",
    "font-weight:700",
    "letter-spacing:0.05em",
  ].join(";");

  const left = document.createElement("span");
  left.textContent = SITE_BRAND;
  left.style.color = "rgba(255,255,255,0.55)";

  const right = document.createElement("span");
  right.textContent = TWITTER_HANDLE;
  right.style.color = "var(--gold, #d9a441)";

  bar.appendChild(left);
  bar.appendChild(right);
  root.appendChild(bar);

  return () => bar.remove();
}

async function withCapturePrep<T>(
  node: HTMLElement,
  capture: () => Promise<T>,
  topN?: number,
  rowMatch?: (row: HTMLTableRowElement) => boolean,
  tighten?: boolean,
  includeBranding = true
): Promise<T> {
  const restoreTopN = topN != null ? limitToTopN(node, topN) : () => {};
  const restoreMatch = rowMatch != null ? filterRowsByMatch(node, rowMatch) : () => {};
  const restoreTighten = tighten ? tightenPadding(node) : () => {};
  const restoreScroll = expandScrollAreas(node);
  // Opt-out for graphics that already bake in their own header/footer
  // branding (e.g. the Weekly Image Dump's compact grids) — appending this
  // generic bar on top would double it up. Defaults to true so every
  // existing call site (which never passed this) keeps behaving exactly
  // as before.
  const removeBranding = includeBranding ? appendBrandingFooter(node) : () => {};
  try {
    return await capture();
  } finally {
    removeBranding();
    restoreScroll();
    restoreTighten();
    restoreMatch();
    restoreTopN();
  }
}

const CAPTURE_OPTS = { backgroundColor: "#1f2041", pixelRatio: 2, filter: shouldInclude };

/**
 * @param topN - When set (e.g. from the Top 25 choice), body rows past
 * the Nth in every table are hidden for capture only, then restored.
 * Omit for the Full List export.
 * @param rowMatch - For non-ranking pages: hides any row this predicate
 * returns false for (e.g. only completed games), instead of a
 * positional Top N cut.
 * @param tighten - Reduces every cell's padding for capture only —
 * for wide multi-column tables that read sparse once shrunk down for
 * mobile viewing.
 * @param explicitSize - Forces the node's width/height before capture
 * (html-to-image's `width`/`height` options) — this alone only tells
 * html-to-image how big a canvas to render into; it does NOT un-clip
 * the node's own overflow, so without also fixing that, the node still
 * renders as visually cropped (scrollbar and all) into the middle of a
 * bigger, mostly-blank canvas. expandScrollAreas is what actually
 * un-clips (overflow:visible, maxHeight:none) — for .table-scroll
 * elements automatically, or any element (including the capture root
 * itself) tagged data-export-scroll for nodes that can't use
 * .table-scroll's class (e.g. it also sets a visible border/max-height
 * that would show up on the live page, not just in the export). Pass
 * the node's own scrollWidth/scrollHeight (measured after any
 * pre-capture DOM tweaks, e.g. hiding a row) as explicitSize once
 * overflow is actually un-clipped, to size the canvas to match.
 */
export async function exportNodeAsPng(
  node: HTMLElement,
  filename: string,
  topN?: number,
  rowMatch?: (row: HTMLTableRowElement) => boolean,
  tighten?: boolean,
  explicitSize?: { width: number; height: number },
  includeBranding = true
) {
  const captureOpts = explicitSize ? { ...CAPTURE_OPTS, ...explicitSize } : CAPTURE_OPTS;
  const dataUrl = await withCapturePrep(node, () => toPng(node, captureOpts), topN, rowMatch, tighten, includeBranding);
  const link = document.createElement("a");
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Same rasterization (branding + scroll-area expansion + optional Top N truncation, row-match filter, or padding tighten) as exportNodeAsPng, but returns a Blob instead of triggering a download — used by the Tweet button and the Weekly Image Dump's batch ZIP. See exportNodeAsPng's explicitSize doc — same reasoning applies here (e.g. nodes rendered off-screen for batch capture, whose shrink-to-fit width can't be trusted). */
export async function exportNodeAsPngBlob(
  node: HTMLElement,
  topN?: number,
  rowMatch?: (row: HTMLTableRowElement) => boolean,
  tighten?: boolean,
  explicitSize?: { width: number; height: number },
  includeBranding = true
): Promise<Blob> {
  const captureOpts = explicitSize ? { ...CAPTURE_OPTS, ...explicitSize } : CAPTURE_OPTS;
  const blob = await withCapturePrep(node, () => toBlob(node, captureOpts), topN, rowMatch, tighten, includeBranding);
  if (!blob) throw new Error("Failed to render PNG");
  return blob;
}

// ---------------------------------------------------------------------
// Tweet button — no web platform lets a page attach an image to a new
// tweet via a plain link (Twitter/X's web intent only accepts text/url,
// never media, and there's no way around that without a full OAuth
// backend integration). So this does the best available thing per
// platform:
//   1. Web Share API with files, if the browser supports sharing files
//      (mobile Safari/Chrome) — opens the native share sheet, and tapping
//      X there opens a tweet with the image already attached.
//   2. Desktop fallback — copies the PNG to the clipboard and opens X's
//      compose intent in a new tab; X's web compose box accepts a pasted
//      image directly (Cmd/Ctrl+V).
//   3. Last resort (clipboard API unavailable) — downloads the PNG like
//      the Export button and opens the compose intent, so there's still
//      something to attach manually.
// ---------------------------------------------------------------------
export type TweetShareResult = "shared" | "cancelled" | "clipboard" | "download";

export async function shareNodeToTwitter(node: HTMLElement, filename: string, tweetText: string): Promise<TweetShareResult> {
  const blob = await exportNodeAsPngBlob(node);
  const name = filename.endsWith(".png") ? filename : `${filename}.png`;
  const file = new File([blob], name, { type: "image/png" });

  if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: tweetText });
      return "shared";
    } catch (err: any) {
      if (err?.name === "AbortError") return "cancelled";
      // Any other share failure falls through to the clipboard fallback below.
    }
  }

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, "_blank", "noopener,noreferrer");
      return "clipboard";
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  }

  const link = document.createElement("a");
  link.download = name;
  link.href = URL.createObjectURL(blob);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, "_blank", "noopener,noreferrer");
  return "download";
}
