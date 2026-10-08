import { winPctColor, isSmallSample } from "../winPctColor";

// ATS: the site's win-% scale (yellow at the -110 break-even of 52.4%, green by ~60%, red by ~45%).
export const atsColor = (pct: number | null | undefined): string | undefined => (pct == null ? undefined : winPctColor(pct / 100));
export { isSmallSample };

const RED = [224, 122, 122];
const YELLOW = [232, 200, 74];
const GREEN = [143, 211, 154];
const lerp = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

// Closing-line value, in points: yellow at 0, full green at +1.5 (the target), full red at -1.5.
export function clvColor(v: number | null | undefined): string | undefined {
  if (v == null || Number.isNaN(v)) return undefined;
  const t = Math.max(-1, Math.min(1, v / 1.5));
  return t >= 0 ? lerp(YELLOW, GREEN, t) : lerp(YELLOW, RED, -t);
}
