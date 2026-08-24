import { TEAM_LOGOS } from "../data/logos";

// jsPDF can only embed actual image data (base64/Data URL), not a remote
// <img src> the way the live site's TeamLogo component does — so before
// building a report, every team's logo needs to be fetched once and
// converted to a canvas-drawn PNG data URL. Best-effort: any single team
// whose logo fails (network hiccup, no CORS header from the CDN, no entry
// in TEAM_LOGOS at all) is just left out of the returned map rather than
// failing the whole report — that team's row falls back to plain text,
// same as it always looked before logos existed.
export async function loadTeamLogos(teams: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(teams));
  const entries = await Promise.all(
    unique.map(async (team) => {
      const url = TEAM_LOGOS[team];
      if (!url) return null;
      try {
        const dataUrl = await loadImageAsDataUrl(url);
        return [team, dataUrl] as const;
      } catch {
        return null;
      }
    })
  );
  return new Map(entries.filter((e): e is [string, string] => e != null));
}

function loadImageAsDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 64;
        canvas.height = img.naturalHeight || 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("no canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        // Most likely a tainted-canvas SecurityError (the CDN didn't send
        // an Access-Control-Allow-Origin header) — nothing to recover
        // from client-side, so this team just goes without a logo.
        reject(err);
      }
    };
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}
