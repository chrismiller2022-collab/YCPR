// Central registry of every rating system feeding the multi-rating admin
// page. One place to add a new system rather than scattering string
// literals across sync endpoints, upload parsers, and UI tables.
//
// Every value stored under these keys (in rating_pulls / weekly_power_ratings)
// is normalized to this site's convention: negative = favored/better team,
// same scale as the existing power rating / YC. Sources that don't
// natively use that convention (Massey's raw CSV, e.g.) are transformed at
// parse time — see massey/mcillece CSV parsers.

export type RatingSource = "cfbd_api" | "google_sheet" | "csv_upload" | "computed";

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

  // Published Google Sheet.
  { key: "john", label: "John Harris", source: "google_sheet" },
  { key: "harris", label: "Harris Smoothed", source: "google_sheet" },
  { key: "dok", label: "Dok", source: "google_sheet" },
  { key: "action", label: "Action", source: "google_sheet" },
  { key: "power", label: "Power", source: "google_sheet" },
  { key: "drat", label: "DRate", source: "google_sheet" },
  { key: "pi", label: "Pi", source: "google_sheet" },
  { key: "tr", label: "TR", source: "google_sheet" },
  { key: "fei_avg", label: "FEI", source: "google_sheet" },
  { key: "f_plus", label: "F+", source: "google_sheet" },
  { key: "win_totals", label: "Win Totals", source: "google_sheet" },

  // Weekly CSV uploads.
  { key: "mcillece", label: "McIllece", source: "csv_upload" },
  { key: "massey", label: "Massey", source: "csv_upload" },
];

export const RATING_SYSTEMS_BY_KEY: Record<string, RatingSystemDef> = Object.fromEntries(
  RATING_SYSTEMS.map((s) => [s.key, s])
);

// F+ and Pi aren't fully rated across every team yet — temporarily
// excluded from both YC and Consensus so a handful of missing/partial
// pulls don't skew the aggregates, while still showing up as their own
// column in the systems table (and still saved into a week snapshot) so
// progress on filling them in stays visible. Remove from this list once
// they're fully rated to fold them back into both aggregates.
export const AGGREGATE_EXCLUDED_SYSTEMS = ["f_plus", "pi"];

/** Every system that's shown in the systems table / saved to a week snapshot — independent of whether it currently feeds YC or Consensus. */
export const ALL_PULLED_SYSTEMS = RATING_SYSTEMS.filter((s) => s.key !== "yc" && s.key !== "consensus").map((s) => s.key);

/** Every system that's an input to the YC weighted average (i.e. NOT yc itself, minus AGGREGATE_EXCLUDED_SYSTEMS). */
export const YC_INPUT_SYSTEMS = RATING_SYSTEMS.filter(
  (s) => s.key !== "yc" && !AGGREGATE_EXCLUDED_SYSTEMS.includes(s.key)
).map((s) => s.key);

/** Every system that's an input to Consensus (a simple average — every pulled system, excluding YC/Consensus themselves and AGGREGATE_EXCLUDED_SYSTEMS). */
export const CONSENSUS_INPUT_SYSTEMS = RATING_SYSTEMS.filter(
  (s) => s.key !== "yc" && s.key !== "consensus" && !AGGREGATE_EXCLUDED_SYSTEMS.includes(s.key)
).map((s) => s.key);
