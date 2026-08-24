import { conferencesForDivision } from "../data/teams";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Single source of truth for what's on the weekly admin checklist — the
// dashboard home view's compact widget (current week only) and the full
// Weekly Checklist page (every week, collapsible) both render from this
// same list, so adding/renaming an item only ever needs to happen here.
//
// subItems is recursive (a sub-item can itself have subItems) so a group
// like "Futures" can contain its own nested groups ("Win Totals" -> All/
// Overs/Unders) without flattening everything into compound labels.
export interface ChecklistItemDef {
  key: string;
  label: string;
  url?: string;
  subItems?: ChecklistItemDef[];
}

export const CHECKLIST_ITEMS: ChecklistItemDef[] = [
  {
    key: "update_ratings",
    label: "Update Ratings",
    subItems: [
      { key: "update_ratings_cfbd", label: "CFBD" },
      { key: "update_ratings_sheet", label: "Sheet" },
      { key: "update_ratings_mcillece", label: "McIllece" },
      { key: "update_ratings_massey", label: "Massey" },
      { key: "update_ratings_srs", label: "Run SRS" },
    ],
  },
  { key: "monte_carlo", label: "Run Monte Carlo" },
  { key: "data_upload", label: "Data Upload" },
  { key: "survivor_picks", label: "Survivor picks" },
  {
    key: "pools",
    label: "Pools",
    subItems: [
      { key: "pools_espn_ml", label: "ESPN Moneyline" },
      { key: "pools_espn_spread", label: "ESPN Spread" },
      { key: "pools_espn_confidence", label: "ESPN Confidence" },
      { key: "pools_brit", label: "The Brit" },
      { key: "pools_peay", label: "Peay" },
      { key: "pools_cbs_splash", label: "CBS Splash" },
      { key: "pools_cfbd", label: "CFBD" },
      { key: "pools_cbs", label: "CBS" },
      {
        key: "pools_cfb_survivor",
        label: "CFB Survivor",
        url: "https://app.splashsports.com/contest/fd3afd3f-9fe8-4d70-a68f-085efb6c99b2/entries/overall",
      },
    ],
  },
  { key: "pull_games_lines", label: "Pull games and Lines" },
  { key: "odds_board", label: "Check Odds Board and make bets" },
];

// Every leaf checklist key nested under an item — recurses through
// however many levels of subItems exist, so a group of groups (e.g.
// "Futures" -> "Win Totals" -> All/Overs/Unders) still resolves down to
// its actual checkable leaves.
export function leafKeysFor(item: ChecklistItemDef): string[] {
  return item.subItems ? item.subItems.flatMap(leafKeysFor) : [item.key];
}

export function allLeafKeys(): string[] {
  return CHECKLIST_ITEMS.flatMap(leafKeysFor);
}

// Preseason-only checklist — separate from the week-by-week list above
// since it covers one-time setup/publishing work rather than something
// repeated every week. Stored under the reserved week label
// "preseason_checklist" in the same admin_weekly_checklist table (kept
// distinct from the "preseason" week label already used for the Week 1
// ratings snapshot, which is a different thing).
export const PRESEASON_CHECKLIST_WEEK = "preseason_checklist";

export const PRESEASON_CHECKLIST_ITEMS: ChecklistItemDef[] = [
  {
    key: "post",
    label: "Post",
    subItems: [
      {
        key: "post_sos",
        label: "SOS",
        subItems: [
          { key: "post_sos_mine", label: "My SOS" },
          { key: "post_sos_top12", label: "Top 12 Team" },
        ],
      },
      { key: "post_resume_rating", label: "Resume Rating (Projected)" },
      { key: "post_fbs_playoff", label: "FBS Playoff" },
      {
        key: "post_conference_previews",
        label: "Conference Previews",
        subItems: conferencesForDivision("FBS").map((c) => ({
          key: `post_conf_preview_${slugify(c)}`,
          label: c,
        })),
      },
      { key: "post_playoff_seeding_mc", label: "Playoff Seeding Monte Carlo" },
      { key: "post_specific_team_pages", label: "Specific Team Pages" },
      {
        key: "post_futures",
        label: "Futures",
        subItems: [
          { key: "post_futures_other", label: "Other Futures" },
          {
            key: "post_futures_win_totals",
            label: "Win Totals",
            subItems: [
              { key: "post_futures_win_totals_all", label: "All" },
              { key: "post_futures_win_totals_overs", label: "Overs" },
              { key: "post_futures_win_totals_unders", label: "Unders" },
            ],
          },
          {
            key: "post_futures_conf_win_totals",
            label: "Conf. Win Totals",
            subItems: [
              { key: "post_futures_conf_win_totals_all", label: "All" },
              { key: "post_futures_conf_win_totals_overs", label: "Overs" },
              { key: "post_futures_conf_win_totals_unders", label: "Unders" },
            ],
          },
        ],
      },
      { key: "post_toughest_stretch", label: "Toughest Game Stretch" },
      { key: "post_conference_comparisons", label: "Conference Comparisons" },
      { key: "post_24_team_playoff", label: "24 Team Playoff" },
      {
        key: "post_power_ratings",
        label: "Power Ratings",
        subItems: [
          { key: "post_power_ratings_all", label: "All" },
          { key: "post_power_ratings_top25", label: "Top 25" },
          { key: "post_power_ratings_g6_top25", label: "G6 Top 25" },
        ],
      },
      {
        key: "post_fcs",
        label: "FCS",
        subItems: [
          { key: "post_fcs_win_totals", label: "Win Totals" },
          { key: "post_fcs_power_ratings", label: "Power Ratings" },
          { key: "post_fcs_sos", label: "SOS" },
          { key: "post_fcs_playoff", label: "Playoff" },
        ],
      },
    ],
  },
];
