// College Basketball's own CSV parsers — reuses the CFB side's generic
// CSV utilities (parseCsvLine/splitCsvLines/findHeaderIdx have nothing
// CFB-specific in them) but keeps the actual per-source parsing separate,
// since column layouts and scaling conventions differ per sport.
import { parseCsvLine, splitCsvLines, findHeaderIdx } from "./ratingsCsv";

// ---------------------------------------------------------------------
// Massey CBB weekly CSV — UNVERIFIED against a real export yet (Chris
// hasn't looked at the actual file format). Massey's CFB export is NOT
// header-keyed for the rating column itself: it repeats a blank header
// for the value that follows each named RANK column (e.g. "...,Pwr,,
// Off,,..." means "Pwr" itself holds a rank integer, and the column
// right after it holds the real Pwr rating) — this assumes Massey's CBB
// export follows the same convention, since it's the same site/engine.
// If a real file turns out to be shaped differently, this needs
// adjusting against that real file rather than more guessing.
//
// No sign-flip, no min-max normalization — unlike the CFB side (which
// forces every system onto its own negative-is-better convention), CBB
// keeps every system on its own native higher-is-better scale, same
// choice as CBBD's SRS/Elo. Massey's raw Pwr is already higher-is-better.
// ---------------------------------------------------------------------
export interface CbbMasseyRow {
  team: string;
  value: number;
}

export function parseCbbMasseyCsv(text: string): CbbMasseyRow[] {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const teamIdx = findHeaderIdx(headers, "Team");
  const pwrLabelIdx = findHeaderIdx(headers, "Pwr");
  if (teamIdx === -1 || pwrLabelIdx === -1) return [];
  const pwrValueIdx = pwrLabelIdx + 1;

  const out: CbbMasseyRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const team = (fields[teamIdx] ?? "").trim();
    const raw = (fields[pwrValueIdx] ?? "").trim();
    if (!team || raw === "") continue;
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    out.push({ team, value: n });
  }
  return out;
}
