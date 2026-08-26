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

// Derives a moneyline directly from a win probability, using the standard
// American-odds formula, instead of interpolating ML_TABLE. This exists
// because linearly interpolating ML_TABLE near a pick'em game produces
// values inside the -100..+100 "dead zone" that no real moneyline can
// occupy (odds jump straight from -100 to +100 at true even money — there
// is no valid value in between). Deriving directly from probability can
// never land in that zone, so it's used anywhere a probability is already
// available (e.g. the ESPN pool tools) rather than spreadToMoneyline.
export function fairMoneylineFromWinPct(winPct) {
  if (winPct == null || Number.isNaN(winPct)) return null;
  const p = Math.min(Math.max(winPct, 0.0001), 0.9999);
  return p >= 0.5 ? -100 * (p / (1 - p)) : 100 * ((1 - p) / p);
}

// Inverse of fairMoneylineFromWinPct — the implied win% a moneyline
// carries (vig included, since this is meant for real market prices,
// not our own fair-value output). Several places had this exact formula
// duplicated inline (AdminMatchupsPanel's home-side EV, for one) before
// this existed; new code should use this instead of re-deriving it.
export function moneylineToImpliedWinPct(price) {
  if (price == null || Number.isNaN(price)) return null;
  return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
}

// Shared with PmAdminPanel's Yes/No pricing (Kalshi-style cents, 0-100 =
// implied probability directly) — a "Yes" at pct% probability has a "No"
// at exactly 100-pct%, since these are our own fair-value numbers, not
// live market prices carrying a vig.
export function fairYesNoPct(pct) {
  if (pct == null || Number.isNaN(pct)) return null;
  const yes = Math.min(100, Math.max(0, pct));
  return { yes, no: 100 - yes };
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
