// Checks the inline tempo copy in api/cfbd-sync.ts matches src/lib/totals2/tempo.ts on one real CFBD week.
//   bun scripts/totals_v2/tempo_parity.ts   (needs CFBD access)
import { aggregateTempo as lib } from "../../src/lib/totals2/tempo";
import { aggregateTempo as api } from "../../api/cfbd-sync";
const headers: Record<string, string> = process.env.CFBD_API_KEY ? { Authorization: `Bearer ${process.env.CFBD_API_KEY}` } : {};
const plays = await (await fetch("https://api.collegefootballdata.com/plays?year=2025&week=5&seasonType=regular&classification=fbs", { headers })).json();
const key = (r: any) => `${r.game_id}|${r.team}|${r.tempo_sec_sum}|${r.tempo_n}`;
const a = new Set(lib(plays).map(key));
const b = api(plays).map(key);
const same = b.length === a.size && b.every((k) => a.has(k));
console.log(same ? `parity OK (${a.size} team-games)` : `MISMATCH lib=${a.size} api=${b.length}`);
process.exit(same ? 0 : 1);
