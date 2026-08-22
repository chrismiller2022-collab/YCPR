// Shared chunking logic for the compact, spreadsheet-style power ratings
// display used by (1) the branded Tweet graphic on the live power ratings
// page and (2) the Power Ratings section of the Weekly Report PDF. Both
// consumers need the same idea: take a long, single-column ranked list and
// lay it out as several short columns side by side so it reads like a
// compact spreadsheet instead of a scroll-forever list.
export interface CompactRatingRow {
  rank: number;
  team: string;
  conf: string;
  rating: number;
}

// Column count is derived from how many rows there are, not hardcoded —
// FBS and FCS have different team counts (and that count can shift with
// realignment), so a fixed column count would leave one division's grid
// oddly short/tall relative to the other. Targeting a fixed number of rows
// per column and solving for the column count keeps both grids visually
// similar in shape no matter how many teams are in play.
export function chunkForCompactGrid(rows: CompactRatingRow[], targetRowsPerColumn = 34): CompactRatingRow[][] {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  if (sorted.length === 0) return [];
  const numColumns = Math.max(1, Math.ceil(sorted.length / targetRowsPerColumn));
  const rowsPerColumn = Math.ceil(sorted.length / numColumns);
  const columns: CompactRatingRow[][] = [];
  for (let i = 0; i < numColumns; i++) {
    const slice = sorted.slice(i * rowsPerColumn, (i + 1) * rowsPerColumn);
    if (slice.length > 0) columns.push(slice);
  }
  return columns;
}
