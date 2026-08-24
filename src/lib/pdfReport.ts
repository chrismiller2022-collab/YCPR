import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtNum, fmtOdds, fmtPct } from "./format";
import { chunkForCompactGrid, type CompactRatingRow } from "./compactPowerRatings";
import type { ChangeRow, WinsLossesRow, ConferencePreviewRowData, MatchupRow } from "./reportData";
import { loadTeamLogos } from "./pdfLogos";

const MARGIN = 40;
// Landscape letter is 792pt wide x 612pt tall - much shorter than portrait,
// so the "do we need a new page" threshold has to be lower.
const MAX_Y = 540;

// Draws a team's logo (if we have one) left-aligned and vertically
// centered inside a table cell, for use in autoTable's didDrawCell hook.
// Wrapped in try/catch since a malformed data URL shouldn't take down
// the rest of the report.
function drawLogoInCell(doc: jsPDF, cell: { x: number; y: number; height: number }, dataUrl: string | undefined) {
  if (!dataUrl) return;
  const size = 10;
  const x = cell.x + 2;
  const y = cell.y + (cell.height - size) / 2;
  try {
    doc.addImage(dataUrl, "PNG", x, y, size, size);
  } catch {
    // logo just doesn't render for this row; the team name text is
    // unaffected since it's drawn independently by autoTable.
  }
}

function changeTable(
  doc: jsPDF,
  title: string,
  rows: ChangeRow[],
  startY: number,
  logosByTeam?: Map<string, string>
) {
  doc.setFontSize(11);
  doc.text(title, MARGIN, startY);
  autoTable(doc, {
    startY: startY + 8,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Team", "Conference", "Change"]],
    body: rows.map((r) => [
      r.team.team,
      r.team.conf,
      (r.value > 0 ? "+" : "") + r.value.toFixed(2),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [31, 32, 65] },
    theme: "striped",
    columnStyles: logosByTeam ? { 0: { cellPadding: { top: 3, right: 3, bottom: 3, left: 15 } } } : undefined,
    didDrawCell: logosByTeam
      ? (data) => {
          if (data.section !== "body" || data.column.index !== 0) return;
          drawLogoInCell(doc, data.cell, logosByTeam.get(rows[data.row.index]?.team.team));
        }
      : undefined,
  });
  return (doc as any).lastAutoTable.finalY;
}

function winsLossesTable(
  doc: jsPDF,
  title: string,
  rows: WinsLossesRow[],
  valueKey: "winsLeft" | "lossesLeft",
  startY: number,
  logosByTeam?: Map<string, string>
) {
  doc.setFontSize(11);
  doc.text(title, MARGIN, startY);
  autoTable(doc, {
    startY: startY + 8,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Team", "Conference", "Win Projection", "Total Games", title.includes("Wins") ? "Wins Left" : "Losses Left"]],
    body: rows.map((r) => [
      r.team.team,
      r.team.conf,
      r.winProjection.toFixed(2),
      String(r.totalGames),
      r[valueKey].toFixed(2),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [31, 32, 65] },
    theme: "striped",
    columnStyles: logosByTeam ? { 0: { cellPadding: { top: 3, right: 3, bottom: 3, left: 15 } } } : undefined,
    didDrawCell: logosByTeam
      ? (data) => {
          if (data.section !== "body" || data.column.index !== 0) return;
          drawLogoInCell(doc, data.cell, logosByTeam.get(rows[data.row.index]?.team.team));
        }
      : undefined,
  });
  return (doc as any).lastAutoTable.finalY;
}

// Small helper so each call site doesn't need to repeat the
// page-break-if-needed logic before every table.
function pageBreakIfNeeded(doc: jsPDF, y: number): number {
  if (y > MAX_Y) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

// Same compact, spreadsheet-style layout as the branded Tweet graphic
// (CompactPowerRatingsGraphic component / chunkForCompactGrid helper): the
// full ranked list is chunked into several short columns instead of one
// long scroll, then "zipped" into a single wide autoTable whose columns
// repeat a #/Team/Rtg header group once per chunk — that's the only way to
// get side-by-side tables out of jspdf-autotable without hand-rolling
// per-cell positioning.
function compactPowerRatingsTable(doc: jsPDF, title: string, rows: CompactRatingRow[], startY: number): number {
  doc.setFontSize(11);
  doc.text(title, MARGIN, startY);

  const columns = chunkForCompactGrid(rows, 34);
  if (columns.length === 0) {
    doc.setFontSize(9);
    doc.text("No teams available.", MARGIN, startY + 16);
    return startY + 16;
  }

  const maxRows = Math.max(...columns.map((c) => c.length));
  const head = [columns.flatMap(() => ["#", "Team", "Rtg"])];
  const body = Array.from({ length: maxRows }, (_, ri) =>
    columns.flatMap((col) => {
      const r = col[ri];
      if (!r) return ["", "", ""];
      return [String(r.rank), r.team, (r.rating > 0 ? "+" : "") + r.rating.toFixed(1)];
    })
  );

  autoTable(doc, {
    startY: startY + 8,
    margin: { left: MARGIN, right: MARGIN },
    head,
    body,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [31, 32, 65] },
    theme: "striped",
    columnStyles: Object.fromEntries(
      columns.flatMap((_, ci) => [
        [ci * 3, { cellWidth: 18, halign: "right" as const }],
        [ci * 3 + 1, { cellWidth: 90 }],
        [ci * 3 + 2, { cellWidth: 30, halign: "right" as const }],
      ])
    ),
  });
  return (doc as any).lastAutoTable.finalY;
}

export interface WeekReportInput {
  division: "FBS" | "FCS";
  week: number;
  sos: { gainers: ChangeRow[]; losers: ChangeRow[] };
  resume: { gainers: ChangeRow[]; losers: ChangeRow[] };
  rating: { gainers: ChangeRow[]; losers: ChangeRow[] };
  winsLossesLeft: { byWinsLeft: WinsLossesRow[]; byLossesLeft: WinsLossesRow[] };
  conferencePreviews: ConferencePreviewRowData[];
  matchups: MatchupRow[];
  powerRatings: CompactRatingRow[];
  hasWeeklyChangeData: boolean;
}

export async function buildWeekReportPdf(input: WeekReportInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const {
    division,
    week,
    sos,
    resume,
    rating,
    winsLossesLeft: wl,
    conferencePreviews,
    matchups,
    powerRatings,
    hasWeeklyChangeData,
  } = input;

  // --- Title page ---
  doc.setFontSize(22);
  doc.text(`${division} Week ${week} Report`, MARGIN, 55);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(
    `Generated ${new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`,
    MARGIN,
    75
  );
  doc.setTextColor(0);

  let y = 100;

  // Logos for every team appearing in the row-based Top 25 / Wins-Left
  // sections below (the compact spreadsheet-style Full Power Ratings grid
  // in Section 4 stays text-only — at ~7pt font in a 34-row column, a
  // squeezed-in logo icon would be illegible rather than useful).
  const logoTeams = [
    ...sos.gainers,
    ...sos.losers,
    ...resume.gainers,
    ...resume.losers,
    ...rating.gainers,
    ...rating.losers,
  ].map((r) => r.team.team).concat(wl.byWinsLeft.map((r) => r.team.team), wl.byLossesLeft.map((r) => r.team.team));
  const logosByTeam = await loadTeamLogos(logoTeams);

  if (!hasWeeklyChangeData) {
    doc.setFontSize(10);
    doc.setTextColor(150, 90, 0);
    doc.text(
      "Note: fewer than two weeks of data have been saved yet, so the change-from-last-week",
      MARGIN,
      y
    );
    doc.text(
      "sections below are empty. They'll populate automatically once two weeks exist.",
      MARGIN,
      y + 14
    );
    doc.setTextColor(0);
    y += 34;
  }

  // --- Section 1: Top 25 gainers/losers ---
  doc.setFontSize(16);
  doc.text("1. Top 25 Gainers & Losers (Change From Last Week)", MARGIN, y);
  y += 20;

  y = changeTable(doc, "1a. Strength of Schedule (SOS) - Top 25 Gainers", sos.gainers, y, logosByTeam) + 26;
  y = pageBreakIfNeeded(doc, y);
  y = changeTable(doc, "1a. Strength of Schedule (SOS) - Top 25 Losers", sos.losers, y, logosByTeam) + 26;

  y = pageBreakIfNeeded(doc, y);
  y = changeTable(doc, "1b. Resume Rating - Top 25 Gainers", resume.gainers, y, logosByTeam) + 26;
  y = pageBreakIfNeeded(doc, y);
  y = changeTable(doc, "1b. Resume Rating - Top 25 Losers", resume.losers, y, logosByTeam) + 26;

  y = pageBreakIfNeeded(doc, y);
  y = changeTable(doc, "1c. Power Rating - Top 25 Gainers", rating.gainers, y, logosByTeam) + 26;
  y = pageBreakIfNeeded(doc, y);
  y = changeTable(doc, "1c. Power Rating - Top 25 Losers", rating.losers, y, logosByTeam) + 26;

  y = pageBreakIfNeeded(doc, y);
  y =
    winsLossesTable(doc, "1d. Wins Left - Top 25", wl.byWinsLeft, "winsLeft", y, logosByTeam) + 26;
  y = pageBreakIfNeeded(doc, y);
  y =
    winsLossesTable(doc, "1e. Losses Left - Top 25", wl.byLossesLeft, "lossesLeft", y, logosByTeam) + 26;

  // --- Section 2: Week matchups ---
  doc.addPage();
  doc.setFontSize(16);
  doc.text(`2. ${division} Week ${week} Matchups`, MARGIN, MARGIN);

  if (matchups.length === 0) {
    doc.setFontSize(10);
    doc.text(`No ${division} vs ${division} games scheduled for Week ${week}.`, MARGIN, MARGIN + 20);
  } else {
    autoTable(doc, {
      startY: MARGIN + 16,
      margin: { left: MARGIN, right: MARGIN },
      head: [[
        "Date",
        "Away",
        "Away PR",
        "Away Spread",
        "Away ML",
        "Away Win%",
        "Home",
        "Home PR",
        "Home Spread",
        "Home ML",
        "Home Win%",
      ]],
      body: matchups.map((m) => [
        m.dateLabel,
        m.away.team,
        (m.away.rating > 0 ? "+" : "") + m.away.rating.toFixed(2),
        (m.awaySpread > 0 ? "+" : "") + m.awaySpread.toFixed(1),
        fmtOdds(m.awayMoneyline),
        fmtPct(m.awayWinPct),
        m.home.team,
        (m.home.rating > 0 ? "+" : "") + m.home.rating.toFixed(2),
        (m.homeSpread > 0 ? "+" : "") + m.homeSpread.toFixed(1),
        fmtOdds(m.homeMoneyline),
        fmtPct(m.homeWinPct),
      ]),
      styles: { fontSize: 7, cellPadding: 2.5 },
      headStyles: { fillColor: [31, 32, 65] },
      theme: "striped",
    });
  }

  // --- Section 3: Conference previews ---
  doc.addPage();
  doc.setFontSize(16);
  doc.text(`3. All ${division} Conference Previews`, MARGIN, MARGIN);
  y = MARGIN + 24;

  for (const cp of conferencePreviews) {
    if (cp.rows.length === 0) continue;
    y = pageBreakIfNeeded(doc, y);
    doc.setFontSize(12);
    doc.text(cp.conference, MARGIN, y);
    autoTable(doc, {
      startY: y + 8,
      margin: { left: MARGIN, right: MARGIN },
      head: [[
        "Team",
        "Power Rating",
        "Proj. Wins",
        "Vegas Win Total",
        "Win Total Diff",
        "Conf. Wins",
        "Conf. Win Line",
        "Conf. Win Diff",
        "Fair Conf. Price",
        "Conf. Odds",
        "Conf. Vegas Odds",
      ]],
      body: cp.rows.map((r) => [
        r.team.team,
        (r.team.rating > 0 ? "+" : "") + r.team.rating.toFixed(2),
        r.winTotal.toFixed(2),
        fmtNum(r.seasonWinLine),
        r.seasonWinLine != null ? ((r.winTotal - r.seasonWinLine) > 0 ? "+" : "") + (r.winTotal - r.seasonWinLine).toFixed(2) : "–",
        r.confWinTotal.toFixed(2),
        fmtNum(r.confLine),
        r.confLine != null ? ((r.confWinTotal - r.confLine) > 0 ? "+" : "") + (r.confWinTotal - r.confLine).toFixed(2) : "–",
        fmtOdds(r.fairPrice),
        fmtPct(r.confWinPct),
        fmtOdds(r.odds),
      ]),
      styles: { fontSize: 7, cellPadding: 2.5 },
      headStyles: { fillColor: [31, 32, 65] },
      theme: "striped",
    });
    y = (doc as any).lastAutoTable.finalY + 24;
  }

  // --- Section 4: Full power ratings, compact spreadsheet layout ---
  doc.addPage();
  doc.setFontSize(16);
  doc.text(`4. Full ${division} Power Ratings`, MARGIN, MARGIN);
  compactPowerRatingsTable(doc, `${division} — every team, ranked`, powerRatings, MARGIN + 24);

  doc.save(`${division.toLowerCase()}-week-${week}-report.pdf`);
}
