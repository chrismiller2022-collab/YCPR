import { toPng, toBlob } from "html-to-image";

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

async function withCapturePrep<T>(node: HTMLElement, capture: () => Promise<T>): Promise<T> {
  const restoreScroll = expandScrollAreas(node);
  const removeBranding = appendBrandingFooter(node);
  try {
    return await capture();
  } finally {
    removeBranding();
    restoreScroll();
  }
}

const CAPTURE_OPTS = { backgroundColor: "#1f2041", pixelRatio: 2, filter: shouldInclude };

export async function exportNodeAsPng(node: HTMLElement, filename: string) {
  const dataUrl = await withCapturePrep(node, () => toPng(node, CAPTURE_OPTS));
  const link = document.createElement("a");
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Same rasterization (branding + scroll-area expansion included) as exportNodeAsPng, but returns a Blob instead of triggering a download — used by the Tweet button. */
export async function exportNodeAsPngBlob(node: HTMLElement): Promise<Blob> {
  const blob = await withCapturePrep(node, () => toBlob(node, CAPTURE_OPTS));
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
