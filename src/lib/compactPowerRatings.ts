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
//
// Deliberately does NOT re-sort rows — it trusts the order it's handed.
// Every "full list" caller (Full List, Top 25/G6, Resume, SOS, Win Totals,
// Wins/Losses Left) already hands in rows in rank order, so that's a no-op
// for them. But Gainers/Losers hands in rows pre-sorted by change
// magnitude with each row's ORIGINAL overall rank still attached (rank is
// display data there, not the sort key) — an internal re-sort-by-rank used
// to silently discard that order and put the list back in rank order,
// which is exactly the bug Chris reported (gainers/losers PNGs looking
// identical to a plain top/bottom-30 rank list).
export function chunkForCompactGrid(rows: CompactRatingRow[], targetRowsPerColumn = 34): CompactRatingRow[][] {
  if (rows.length === 0) return [];
  const numColumns = Math.max(1, Math.ceil(rows.length / targetRowsPerColumn));
  const rowsPerColumn = Math.ceil(rows.length / numColumns);
  const columns: CompactRatingRow[][] = [];
  for (let i = 0; i < numColumns; i++) {
    const slice = rows.slice(i * rowsPerColumn, (i + 1) * rowsPerColumn);
    if (slice.length > 0) columns.push(slice);
  }
  return columns;
}
