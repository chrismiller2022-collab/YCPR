// Single source of truth for what's on the weekly admin checklist — the
// dashboard home view's compact widget (current week only) and the full
// Weekly Checklist page (every week, collapsible) both render from this
// same list, so adding/renaming an item only ever needs to happen here.
export interface ChecklistSubItemDef {
  key: string;
  label: string;
  url?: string;
}
export interface ChecklistItemDef {
  key: string;
  label: string;
  subItems?: ChecklistSubItemDef[];
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

// Every leaf checklist key for a given item — a single-item entry counts
// as its own only leaf; an item with subItems counts each sub-item (not
// the parent key itself, since the parent is a derived checkbox, not
// something separately stored).
export function leafKeysFor(item: ChecklistItemDef): string[] {
  return item.subItems ? item.subItems.map((s) => s.key) : [item.key];
}

export function allLeafKeys(): string[] {
  return CHECKLIST_ITEMS.flatMap(leafKeysFor);
}

// Preseason-only checklist — separate from the week-by-week list above
// since it covers one-time setup work rather than something repeated
// every week. Stored under the reserved week label "preseason" in the
// same admin_weekly_checklist table.
export const PRESEASON_CHECKLIST_WEEK = "preseason_checklist";

export const PRESEASON_CHECKLIST_ITEMS: ChecklistItemDef[] = [
  {
    key: "post",
    label: "Post",
    subItems: [{ key: "post_sos", label: "SOS" }],
  },
];
