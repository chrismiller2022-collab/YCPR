// Central registry of every rating system feeding the multi-rating admin
// page. One place to add a new system rather than scattering string
// literals across sync endpoints, upload parsers, and UI tables.
//
// Every value stored under these keys (in rating_pulls / weekly_power_ratings)
// is normalized to this site's convention: negative = favored/better team,
// same scale as the existing power rating / YC. Sources that don't
// natively use that convention (Massey's raw CSV, e.g.) are transformed at
// parse time — see massey/mcillece CSV parsers.

export type RatingSource = "cfbd_api" | "google_sheet" | "csv_upload" | "computed" | "scraped";

export interface RatingSystemDef {
  key: string;
  label: string;
  source: RatingSource;
}

export const RATING_SYSTEMS: RatingSystemDef[] = [
  // Computed by this app, not pulled from anywhere.
  { key: "yc", label: "YC", source: "computed" },
  { key: "consensus", label: "Consensus", source: "computed" },
  // The pre-standardization build of YC / Consensus (plain weighted average of
  // each system's stored value), still computed and saved every week so the
  // new build can be tracked against it. Never an input to anything. Weeks
  // saved before the switch have no rows for these — their "yc"/"consensus"
  // ARE the old method (buildRatingsByTeam fills these from them for those
  // weeks, in memory only).
  { key: "yc_legacy", label: "YC (old method)", source: "computed" },
  { key: "consensus_legacy", label: "Consensus (old method)", source: "computed" },
  // Sent here from the Monte Carlo SRS tab's "Send to Rating Systems" button —
  // this app's own SRS computation (Monte Carlo engine's computeSrsStats),
  // distinct from the CFBD-sourced "srs" system below.
  { key: "yc_srs", label: "YC SRS", source: "computed" },

  // CFBD API.
  { key: "fpi", label: "FPI", source: "cfbd_api" },
  { key: "sp", label: "SP+", source: "cfbd_api" },
  { key: "srs", label: "CFBD SRS", source: "cfbd_api" },
  { key: "core", label: "Core", source: "cfbd_api" },
  { key: "elo", label: "Elo", source: "cfbd_api" }, // min-max normalized to [-30, +55] and sign-flipped, same treatment as Massey

  // Scraped directly from each source's own public page (FEI/F+/Sagarin)
  // or uploaded weekly (McIllece/Massey) — grouped and ordered ahead of
  // the Google Sheet block per Chris's request.
  { key: "fei_avg", label: "FEI", source: "scraped" },
  { key: "f_plus", label: "F+", source: "scraped" },
  // McIllece can be scraped from mcillecesports.com/power-ratings (the same
  // Team/Power table the weekly CSV comes from); the CSV upload stays as a fallback.
  { key: "mcillece", label: "McIllece", source: "scraped" },
  { key: "massey", label: "Massey", source: "csv_upload" },
  // Scraped directly from sagarin.com's own public page — no year param,
  // it's always just "current."
  { key: "sagarin", label: "Sagarin", source: "scraped" },
  // Sagarin's other score-based ratings, from the same page (RATING above is his
  // synthesis of Predictor, Golden Mean and Recent). Track-only by default: not in
  // Consensus and no YC weight until you opt them in.
  { key: "sagarin_pred", label: "Sagarin Predictor", source: "scraped" },
  { key: "sagarin_gm", label: "Sagarin Golden Mean", source: "scraped" },
  { key: "sagarin_recent", label: "Sagarin Recent", source: "scraped" },
  { key: "sagarin_strong", label: "Sagarin Strong Recent", source: "scraped" },
  // JP+ (jpplusratings.com) — scraped from its home-page power ratings table.
  // FBS only. Starts with no YC weight and unchecked for Consensus — set both in the weights box.
  { key: "jpplus", label: "JP+", source: "scraped" },

  // TeamRankings predictive rating — scraped from teamrankings.com (FBS only);
  // used to come from the Google Sheet's TR column.
  { key: "tr", label: "TR", source: "scraped" },

  // Published Google Sheet.
  { key: "john", label: "John Harris", source: "google_sheet" },
  { key: "harris", label: "Harris Smoothed", source: "google_sheet" },
  { key: "dok", label: "Dok", source: "google_sheet" },
  { key: "action", label: "Action", source: "google_sheet" },
  { key: "power", label: "Power", source: "google_sheet" },
  { key: "drat", label: "DRate", source: "google_sheet" },
  { key: "pi", label: "Pi", source: "google_sheet" },
  { key: "win_totals", label: "Win Totals", source: "google_sheet" },
];

export const RATING_SYSTEMS_BY_KEY: Record<string, RatingSystemDef> = Object.fromEntries(
  RATING_SYSTEMS.map((s) => [s.key, s])
);

// Nothing is excluded from YC or Consensus in code.
// - YC is a weighted average: every system has a weight (system_key rows in
//   rating_system_weights; 0 = off, can change any time). Consensus is one of
//   YC's inputs.
// - Consensus is a PLAIN average of whichever systems are switched on for it.
//   Membership is stored beside the weights as `consensus:<system_key>` rows
//   (1 = in, 0 = out) and edited with the checkboxes in the weights box.

/** rating_system_weights key holding whether a system is in the Consensus average (1 = in, 0 = out). */
export function consensusMemberKey(systemKey: string): string {
  return `consensus:${systemKey}`;
}

// A system with no saved membership row keeps Consensus's old behavior: in,
// except Pi (not fully rated), JP+ (new, FBS-only, still being evaluated) and Sagarin's
// extra rating types (track-only for now),
// which start out so adding them didn't silently move Consensus and YC.
// Saving the weights box writes an explicit in/out value for every system.
const NOT_IN_CONSENSUS_BY_DEFAULT = ["pi", "jpplus", "sagarin_pred", "sagarin_gm", "sagarin_recent", "sagarin_strong"];
export function defaultInConsensus(systemKey: string): boolean {
  return !NOT_IN_CONSENSUS_BY_DEFAULT.includes(systemKey);
}

/** Whether a system is currently in the Consensus average, given the saved weights/membership map. */
export function isInConsensus(systemKey: string, saved: Record<string, number>): boolean {
  const v = saved[consensusMemberKey(systemKey)];
  return v == null ? defaultInConsensus(systemKey) : v > 0;
}

/** YC, Consensus and their old-method twins — computed here, never pulled, never inputs to each other except Consensus -> YC. */
export const COMPOSITE_SYSTEMS = ["yc", "consensus", "yc_legacy", "consensus_legacy"];

/** Every system that's shown in the systems table / saved to a week snapshot — independent of whether it currently feeds YC or Consensus. */
export const ALL_PULLED_SYSTEMS = RATING_SYSTEMS.filter((s) => !COMPOSITE_SYSTEMS.includes(s.key)).map((s) => s.key);

/** Every system that's an input to the YC weighted average (every pulled system, plus Consensus). */
export const YC_INPUT_SYSTEMS = ["consensus", ...ALL_PULLED_SYSTEMS];

/** Every system that CAN be in the Consensus average (each is switched in/out via consensusMemberKey). */
export const CONSENSUS_INPUT_SYSTEMS = ALL_PULLED_SYSTEMS;

// YC / Consensus are built from STANDARDIZED inputs (see lib/ratingStandardize.ts):
// each system's value as SDs from the FBS average, times this many points.
// Stored beside the weights as a `setting:` row so it's edited and saved with them.
export const STD_MULTIPLIER_SETTING_KEY = "setting:std_multiplier";
export const DEFAULT_LIVE_STD_MULTIPLIER = 13.5;
export function liveStdMultiplier(saved: Record<string, number>): number {
  const v = saved[STD_MULTIPLIER_SETTING_KEY];
  return v != null && Number.isFinite(v) && v > 0 ? v : DEFAULT_LIVE_STD_MULTIPLIER;
}
