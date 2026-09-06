import { parseCsv } from "../csvImport";
import type { WestgateStandingRow } from "./westgateStandings";

// Expected columns (case-insensitive): place, alias, record, points,
// cash_prize. place accepts a bare number ("1") or a tie ("5T", "13T") —
// the trailing "T" is stripped to get the numeric rank used for sorting
// and for matching against a reference season's payout percentages.
// cash_prize is optional — leave blank for an in-progress season's
// standings (only a completed season needs it, to seed the payout %
// table).
export const WESTGATE_STANDINGS_CSV_TEMPLATE =
  "place,alias,record,points,cash_prize\n1,DFLEMING22-2,65-31-2-0,66.00,216000\n5T,BILL-7,60-36-2-0,61.00,19800\n";

export interface WestgateStandingImportError {
  line: number;
  raw: Record<string, string>;
  reason: string;
}

export interface WestgateStandingsImportResult {
  resolved: Omit<WestgateStandingRow, "id" | "season">[];
  errors: WestgateStandingImportError[];
}

export function parseWestgateStandingsCsv(text: string): WestgateStandingsImportResult {
  const rows = parseCsv(text);
  const resolved: Omit<WestgateStandingRow, "id" | "season">[] = [];
  const errors: WestgateStandingImportError[] = [];

  rows.forEach((row, i) => {
    const lineNum = i + 2;
    const get = (key: string) => (row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()] ?? "").trim();

    const placeRaw = get("place");
    const m = /^(\d+)(t)?$/i.exec(placeRaw);
    if (!m) {
      errors.push({ line: lineNum, raw: row, reason: `Couldn't read place "${placeRaw}" (expected e.g. "1" or "5T")` });
      return;
    }
    const alias = get("alias");
    if (!alias) {
      errors.push({ line: lineNum, raw: row, reason: "Missing alias" });
      return;
    }
    const pointsRaw = get("points");
    const points = pointsRaw === "" ? null : parseFloat(pointsRaw);
    const cashRaw = get("cash_prize").replace(/[$,]/g, "");
    const cash_prize = cashRaw === "" ? null : parseFloat(cashRaw);

    resolved.push({
      place_rank: parseInt(m[1], 10),
      place_label: placeRaw,
      alias,
      record: get("record") || null,
      points: points != null && Number.isNaN(points) ? null : points,
      cash_prize: cash_prize != null && Number.isNaN(cash_prize) ? null : cash_prize,
    });
  });

  return { resolved, errors };
}
