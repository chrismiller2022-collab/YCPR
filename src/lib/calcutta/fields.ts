import { TEAM_LOGOS } from "../../data/logos";
import { TEAMS_BY_NAME } from "../../data/teams";
import { formatDef } from "./formats";
import type { FieldTeam, FormatKey } from "./types";

// Field builders for the non-NFL formats.

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Short label for chips: "Ohio State" → "OSU"-ish initials, one-word names → first 4 letters. */
export function shortName(name: string): string {
  const words = name.replace(/[().']/g, "").split(/[\s-]+/).filter(Boolean);
  if (words.length === 1) return words[0].length <= 5 ? words[0].toUpperCase() : words[0].slice(0, 4).toUpperCase();
  const last = words[words.length - 1];
  if (/^(state|st)$/i.test(last)) return (words.slice(0, -1).map((w) => w[0]).join("") + "SU").toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

function logoFor(name: string): string | null {
  return TEAM_LOGOS[name] ?? null;
}

/** CFP field from team names in seed order (index 0 = #1). Empty slots are skipped. */
export function cfbFieldFromSeeds(format: FormatKey, names: (string | null)[]): FieldTeam[] {
  const byes = formatDef(format).byeCount;
  return names
    .map((name, i) => ({ name, seed: i + 1 }))
    .filter((x) => x.name)
    .map(({ name, seed }) => ({
      id: name!,
      name: name!,
      abbr: shortName(name!),
      group: "",
      note: TEAMS_BY_NAME[name!]?.conf ?? null,
      seed,
      bye: seed <= byes,
      logo: logoFor(name!),
    }));
}

export function seedNamesFromField(format: FormatKey, field: FieldTeam[]): (string | null)[] {
  const n = formatDef(format).fieldSize;
  return Array.from({ length: n }, (_, i) => field.find((t) => t.seed === i + 1)?.name ?? null);
}

export interface MadnessParse {
  field: FieldTeam[];
  regions: string[];
  errors: string[];
}

/**
 * March Madness field from pasted text. Either "Region Seed Team" per line
 * ("East 1 Duke", "South, 16, Alabama State"), or a region name on its own
 * line followed by "Seed Team" lines. Two teams on the same region + seed =
 * a First Four pair. Anything after the team name that's just numbers
 * (ratings, records) is ignored.
 */
export function parseMadnessField(text: string): MadnessParse {
  const field: FieldTeam[] = [];
  const regions: string[] = [];
  const errors: string[] = [];
  let current: string | null = null;
  const used = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\t/g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!line) return;
    let m = /^([A-Za-z][A-Za-z .'-]*?)\s+(\d{1,2})\s+(.+)$/.exec(line);
    let region: string | null;
    let seed: number;
    let name: string;
    if (m && !/^\d/.test(line)) {
      region = m[1].trim();
      seed = Number(m[2]);
      name = m[3];
    } else if ((m = /^(\d{1,2})\s+(.+)$/.exec(line))) {
      region = current;
      seed = Number(m[1]);
      name = m[2];
    } else if (/^[A-Za-z][A-Za-z .'-]*$/.test(line) && line.split(" ").length <= 3) {
      current = line.replace(/\s+region$/i, "");
      if (!regions.includes(current)) regions.push(current);
      return;
    } else {
      errors.push(`Line ${i + 1}: couldn't read "${raw.trim()}"`);
      return;
    }
    region = region?.replace(/\s+region$/i, "") ?? null;
    name = name.replace(/(\s+[-+]?\d+(\.\d+)?)+$/, "").replace(/\s*\(\d+-\d+\)\s*$/, "").trim();
    if (!region) return void errors.push(`Line ${i + 1}: no region for "${name}"`);
    if (!(seed >= 1 && seed <= 16)) return void errors.push(`Line ${i + 1}: seed ${seed} isn't 1–16`);
    if (!regions.includes(region)) regions.push(region);
    let id = slug(name);
    if (used.has(id)) return void errors.push(`Line ${i + 1}: ${name} is listed twice`);
    used.add(id);
    field.push({ id, name, abbr: shortName(name), group: region, note: null, seed, bye: false, logo: logoFor(name) });
  });
  return { field, regions, errors };
}

export function madnessFieldToText(field: FieldTeam[], regions: string[]): string {
  return regions
    .map((r) => [r, ...field.filter((t) => t.group === r).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)).map((t) => `${t.seed} ${t.name}`)].join("\n"))
    .join("\n\n");
}
