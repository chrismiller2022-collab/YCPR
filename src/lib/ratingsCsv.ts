// Parsers for the three external rating sources that feed the multi-rating
// admin page's "pull" step: the published Google Sheet (CSV export) and
// the two weekly CSV uploads (McIllece, Massey). All run client-side —
// same reasoning as csvImport.ts: no CFBD rate limit or Vercel timeout
// risk, and this is where the canonical team roster + fuzzy matcher
// already live.

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function splitCsvLines(text: string): string[] {
  // Handle all three line-ending conventions (CRLF, LF, and bare CR — old
  // Mac / some Excel exports use CR-only, which previously made the whole
  // file read as a single "line" and silently return 0 parsed rows).
  return text.replace(/^﻿/, "").split(/\r\n|\r|\n/).filter((l) => l.length > 0);
}

// Trim + case-insensitive header match — tolerates stray whitespace or
// case drift in an export without weakening the "must have this column"
// check itself.
function findHeaderIdx(headers: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === target);
}

// ---------------------------------------------------------------------
// Google Sheet pull. Header-keyed (the sheet has one real header per
// column, no repeated/blank labels) — only pulls the systems that are
// sourced from the sheet, per the site owner's spec. Sagarin, CFBD 2025,
// COPE, YC, Consensus, SP+, FPI, SRS all live in the sheet too but are
// deliberately NOT pulled from here (SP+/FPI/SRS/Core come from the CFBD
// API; YC/Consensus are computed by this app; Sagarin/COPE aren't tracked
// systems for this build).
// ---------------------------------------------------------------------
const SHEET_COLUMN_TO_SYSTEM: Record<string, string> = {
  TR: "tr",
  John: "john",
  Harris: "harris",
  "FEI avg": "fei_avg",
  "Win Totals": "win_totals",
  "F+": "f_plus",
  Dok: "dok",
  Action: "action",
  Power: "power",
  DRat: "drat",
  Pi: "pi",
};

export interface SheetPullRow {
  team: string; // raw name as it appears in the sheet
  division: string | null;
  values: Record<string, number>;
}

export function parseSheetCsv(text: string): SheetPullRow[] {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const teamIdx = findHeaderIdx(headers, "Team");
  const divIdx = findHeaderIdx(headers, "Division");
  if (teamIdx === -1) return [];

  const wantedCols: { idx: number; systemKey: string }[] = [];
  headers.forEach((h, i) => {
    const key = SHEET_COLUMN_TO_SYSTEM[h.trim()];
    if (key) wantedCols.push({ idx: i, systemKey: key });
  });

  const out: SheetPullRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const team = (fields[teamIdx] ?? "").trim();
    if (!team) continue; // trailing blank/footer rows (e.g. the weights row)
    const division = divIdx !== -1 ? (fields[divIdx] ?? "").trim() || null : null;
    const values: Record<string, number> = {};
    for (const { idx, systemKey } of wantedCols) {
      const raw = (fields[idx] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isNaN(n)) values[systemKey] = n;
    }
    out.push({ team, division, values });
  }
  return out;
}

// ---------------------------------------------------------------------
// McIllece weekly CSV. Header-keyed: "Team" + "Power" columns. Sign-
// flipped to this site's negative-is-better convention (confirmed against
// the published sheet: McIllece's raw Power for Ohio State was 31.0,
// the sheet's McIllece column showed -31.00 for the same team).
// ---------------------------------------------------------------------
export interface McilleceRow {
  team: string;
  value: number;
}

export function parseMcilleceCsv(text: string): McilleceRow[] {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const teamIdx = findHeaderIdx(headers, "Team");
  const powerIdx = findHeaderIdx(headers, "Power");
  if (teamIdx === -1 || powerIdx === -1) return [];

  const out: McilleceRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const team = (fields[teamIdx] ?? "").trim();
    const raw = (fields[powerIdx] ?? "").trim();
    if (!team || raw === "") continue;
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    out.push({ team, value: -n });
  }
  return out;
}

// ---------------------------------------------------------------------
// Massey weekly CSV. NOT header-keyed — Massey's export repeats a blank
// header for the value column that follows each named RANK column (e.g.
// "...,Pwr,,Off,,..." means the "Pwr" column itself holds a rank integer,
// and the value immediately after it holds the real Pwr rating). Confirmed
// against a real row: header index of "Pwr" held "1" (Ohio State's rank),
// and the next column held "80.49" (Ohio State's actual Pwr rating).
// So: find the header index of the named column, read the value from
// index+1, not from the named index itself.
//
// Raw Pwr values are then min-max normalized across the whole upload to
// the range [-55, +30] (worst team -> +30, best team -> -55 pre-flip)
// and then sign-flipped, per the site owner's own methodology — this
// happens in normalizeMasseyRows() below since it needs the full batch's
// min/max, not just one row.
// ---------------------------------------------------------------------
export interface MasseyRawRow {
  team: string;
  pwr: number;
}

export function parseMasseyCsv(text: string): MasseyRawRow[] {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const teamIdx = findHeaderIdx(headers, "Team");
  const pwrLabelIdx = findHeaderIdx(headers, "Pwr");
  if (teamIdx === -1 || pwrLabelIdx === -1) return [];
  const pwrValueIdx = pwrLabelIdx + 1;

  const out: MasseyRawRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const team = (fields[teamIdx] ?? "").trim();
    const raw = (fields[pwrValueIdx] ?? "").trim();
    if (!team || raw === "") continue;
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    out.push({ team, pwr: n });
  }
  return out;
}

export interface MasseyRow {
  team: string;
  value: number;
}

/**
 * Min-max normalizes raw Massey Pwr values (higher = better) onto
 * [-55, +30] preserving order (best raw -> +30, worst raw -> -55), then
 * sign-flips the whole batch so the best team ends up most negative —
 * matching every other system's negative-is-better convention. With this
 * order of operations, the best team lands near -30 and the worst near
 * +55, which is what the published sheet's own Massey column shows
 * (Ohio State, the best team, sits at -30.00).
 */
export function normalizeMasseyRows(rows: MasseyRawRow[]): MasseyRow[] {
  if (rows.length === 0) return [];
  const values = rows.map((r) => r.pwr);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return rows.map((r) => {
    const t = span === 0 ? 0.5 : (r.pwr - min) / span; // 0 = worst, 1 = best
    const normalized = -55 + t * (30 - -55); // worst -> -55, best -> +30
    return { team: r.team, value: -normalized }; // sign-flip: best -> -30ish, worst -> +55ish
  });
}
