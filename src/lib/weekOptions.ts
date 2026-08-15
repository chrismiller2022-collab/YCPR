// The exact set of week labels Data Upload (and, since the YC push button,
// the Rating Systems page) can save weekly_team_stats under. Pulled out to
// its own file so both AdminPage.tsx and RatingSystemsPanel.tsx can import
// it without a circular import between the two page files.
export const WEEK_OPTIONS = ["preseason", ...Array.from({ length: 16 }, (_, i) => `week${i + 1}`)];
