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
  // JP+ (jpplusratings.com) — scraped from its home-page power ratings table.
  // FBS only. Starts with a 0 Consensus weight and no YC weight — set both in the weights box.
  { key: "jpplus", label: "JP+", source: "scraped" },

  // Published Google Sheet.
  { key: "john", label: "John Harris", source: "google_sheet" },
  { key: "harris", label: "Harris Smoothed", source: "google_sheet" },
  { key: "dok", label: "Dok", source: "google_sheet" },
  { key: "action", label: "Action", source: "google_sheet" },
  { key: "power", label: "Power", source: "google_sheet" },
  { key: "drat", label: "DRate", source: "google_sheet" },
  { key: "pi", label: "Pi", source: "google_sheet" },
  { key: "tr", label: "TR", source: "google_sheet" },
  { key: "win_totals", label: "Win Totals", source: "google_sheet" },
];

export const RATING_SYSTEMS_BY_KEY: Record<string, RatingSystemDef> = Object.fromEntries(
  RATING_SYSTEMS.map((s) => [s.key, s])
);

// Nothing is excluded from YC or Consensus in code — every system is a weighted
// input to both, and a weight of 0 turns one off. YC weights are the
// system_key rows in rating_system_weights; the weight a system carries INSIDE
// Consensus is stored beside them under `consensus:<system_key>`. Both are
// edited in the Rating Systems weights box and can change at any time.

/** rating_system_weights key for a system's weight inside the Consensus average. */
export function consensusWeightKey(systemKey: string): string {
  return `consensus:${systemKey}`;
}

// Consensus used to be an unweighted average of every system except Pi. A
// system with no saved Consensus weight keeps that behavior: 1 (counts equally),
// except Pi (not fully rated) and JP+ (new, FBS-only, still being evaluated),
// which start at 0 so adding them didn't silently move Consensus and YC. Saving
// the weights box writes an explicit value for every system.
const DEFAULT_CONSENSUS_ZERO = ["pi", "jpplus"];
export function defaultConsensusWeight(systemKey: string): number {
  return DEFAULT_CONSENSUS_ZERO.includes(systemKey) ? 0 : 1;
}

/** Every system that's shown in the systems table / saved to a week snapshot — independent of whether it currently feeds YC or Consensus. */
export const ALL_PULLED_SYSTEMS = RATING_SYSTEMS.filter((s) => s.key !== "yc" && s.key !== "consensus").map((s) => s.key);

/** Every system that's an input to the YC weighted average (everything except YC itself; Consensus is one of them). */
export const YC_INPUT_SYSTEMS = RATING_SYSTEMS.filter((s) => s.key !== "yc").map((s) => s.key);

/** Every system that's an input to Consensus (every pulled system; each carries its own Consensus weight, 0 = not in the average). */
export const CONSENSUS_INPUT_SYSTEMS = RATING_SYSTEMS.filter((s) => s.key !== "yc" && s.key !== "consensus").map((s) => s.key);
