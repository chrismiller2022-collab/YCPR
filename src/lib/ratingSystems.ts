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

  // CFBD API.
  { key: "fpi", label: "FPI", source: "cfbd_api" },
  { key: "sp", label: "SP+", source: "cfbd_api" },
  { key: "srs", label: "SRS", source: "cfbd_api" },
  { key: "core", label: "Core", source: "cfbd_api" },

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

/** Every system that's an input to the YC weighted average (i.e. NOT yc itself). */
export const YC_INPUT_SYSTEMS = RATING_SYSTEMS.filter((s) => s.key !== "yc").map((s) => s.key);

/** Every system that's an input to Consensus (a simple average — every pulled system, excluding YC and Consensus itself). */
export const CONSENSUS_INPUT_SYSTEMS = RATING_SYSTEMS.filter((s) => s.key !== "yc" && s.key !== "consensus").map(
  (s) => s.key
);
