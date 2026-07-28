import { WP_TABLE, ML_TABLE } from "../data/oddsTables";

export const HFA = 2.4;

// Fallback only — used when a team doesn't have a live per-team HFA value
// saved yet (e.g. before the weekly CSV includes it, or for a team with no
// data at all). Once a team has its own HFA saved, that value is used
// instead, everywhere a spread involves them as the home team.
export function hfaFor(homeTeamName, liveByTeam) {
  const v = liveByTeam?.[homeTeamName]?.hfa;
  return v != null ? v : HFA;
}

function interpolateTable(table, spread) {
  if (spread == null || Number.isNaN(spread)) return null;
  if (spread <= table[0][0]) return table[0][1];
  if (spread >= table[table.length - 1][0]) return table[table.length - 1][1];

  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid][0] <= spread) lo = mid;
    else hi = mid;
  }
  const [s0, w0] = table[lo];
  const [s1, w1] = table[hi];
  if (s1 === s0) return w0;
  const t = (spread - s0) / (s1 - s0);
  return w0 + (w1 - w0) * t;
}

export function spreadToWinPct(spread) {
  return interpolateTable(WP_TABLE, spread);
}

export function spreadToMoneyline(spread) {
  return interpolateTable(ML_TABLE, spread);
}

// Green = favorite (more negative), red = underdog (more positive),
// with a neutral gray around a pick'em (0).
function spreadRGB(value) {
  const clamp = Math.max(-15, Math.min(15, value));
  const favorite = [90, 168, 105];
  const neutral = [143, 167, 154];
  const underdog = [196, 92, 82];
  if (clamp <= 0) {
    const k = clamp / -15; // 0 (neutral) -> 1 (favorite)
    return neutral.map((n, i) => Math.round(n + (favorite[i] - n) * k));
  }
  const k = clamp / 15; // 0 (neutral) -> 1 (underdog)
  return neutral.map((n, i) => Math.round(n + (underdog[i] - n) * k));
}

export function spreadColor(value) {
  const [r, g, b] = spreadRGB(value);
  return `rgb(${r}, ${g}, ${b})`;
}

export function spreadBg(value, alpha) {
  const [r, g, b] = spreadRGB(value);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
