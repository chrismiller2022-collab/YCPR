import { WEEKS } from "../data/games";
import { conferencesForDivision } from "../data/teams";

export const NAV: any[] = [
  {
    key: "faq",
    label: "FAQ",
    single: true,
    pageType: "faq",
  },
  {
    key: "teampages",
    label: "Team Pages",
    drill: true,
  },
  {
    key: "confpreviews",
    label: "Conference Previews",
    subs: [
      { key: "overview", label: "Conference Comparison", pageType: "confoverview" },
      ...conferencesForDivision("FBS").map((c) => ({ key: c, label: c })),
    ],
  },
  {
    key: "tools",
    label: "Tools",
    subs: [
      { key: "matchup", label: "Hypothetical Matchup", pageType: "matchup" },
      { key: "scheduleswap", label: "Schedule Swap", pageType: "scheduleswap" },
      { key: "resumecompare", label: "Resume Comparison", pageType: "resumecompare" },
      { key: "confcompare", label: "Conference Comparison", pageType: "confcompare" },
      { key: "tougheststretch", label: "Toughest Game Stretch", pageType: "tougheststretch" },
      { key: "playoff24", label: "24 Team Playoff (FCS Style)", pageType: "playoff24" },
      { key: "weekreport", label: "Week Report (PDF)", pageType: "weekreport" },
      { key: "cfbsurvivor", label: "CFB Survivor", pageType: "cfbsurvivor" },
    ],
  },
  {
    key: "ratings",
    label: "Weekly Power Ratings",
    subs: [
      { key: "preseason", label: "Preseason" },
      ...WEEKS,
      { key: "live", label: "Live", pageType: "home" },
      { key: "weeklyprogression", label: "Weekly Progression" },
    ],
  },
  {
    key: "futures",
    label: "Futures",
    futures: true,
    items: [
      {
        key: "wintotals",
        label: "Win Totals",
        expandable: true,
        subs: [...WEEKS, { key: "live", label: "Live" }],
      },
      {
        key: "confwinodds",
        label: "Conference Win Odds",
      },
      {
        key: "confwintotals",
        label: "Conference Win Totals",
      },
      {
        key: "playoff",
        label: "To Make Playoff",
      },
      {
        key: "natty",
        label: "Natty",
      },
      {
        key: "pythagwins",
        label: "Pythag Wins",
      },
    ],
  },
  {
    key: "matchups",
    label: "Weekly Matchups",
    subs: [...WEEKS, { key: "all", label: "All" }],
  },
  {
    key: "resume",
    label: "Resume Ratings",
    subs: [...WEEKS, { key: "live", label: "Live" }, { key: "weeklyprogression", label: "Weekly Progression" }],
  },
  {
    key: "sos",
    label: "Strength of Schedule",
    subs: [
      ...WEEKS,
      { key: "live", label: "Live" },
      { key: "weeklyprogression", label: "Weekly Progression" },
      { key: "tougheststretch", label: "Toughest Game Stretch", pageType: "tougheststretch" },
    ],
  },
  {
    key: "bracket",
    label: "FBS Playoff Bracket",
    subs: [...WEEKS, { key: "live", label: "Live" }],
  },
  {
    key: "fcs",
    label: "FCS",
    futures: true,
    items: [
      {
        key: "fcsbracket",
        label: "FCS Playoff Bracket",
        expandable: true,
        subs: [...WEEKS, { key: "live", label: "Live" }],
      },
      {
        key: "fcsratings",
        label: "FCS Power Ratings",
        expandable: true,
        subs: [
          { key: "preseason", label: "Preseason" },
          ...WEEKS,
          { key: "live", label: "Live" },
          { key: "weeklyprogression", label: "Weekly Progression" },
        ],
      },
      {
        key: "fcsconfpreviews",
        label: "FCS Conference Previews",
        expandable: true,
        subs: conferencesForDivision("FCS").map((c) => ({ key: c, label: c })),
      },
      {
        key: "fcswintotals",
        label: "FCS Win Totals",
        expandable: true,
        subs: [...WEEKS, { key: "live", label: "Live" }],
      },
      {
        key: "fcssos",
        label: "FCS SOS/SOR",
        expandable: true,
        subs: [
          ...WEEKS,
          { key: "live", label: "Live" },
          { key: "weeklyprogression", label: "Weekly Progression" },
        ],
      },
    ],
  },
  {
    key: "modelresults",
    label: "Model Results",
    subs: [
      { key: "2024", label: "2024" },
      { key: "2025", label: "2025" },
      { key: "2026", label: "2026" },
      { key: "all", label: "All" },
    ],
  },
];
