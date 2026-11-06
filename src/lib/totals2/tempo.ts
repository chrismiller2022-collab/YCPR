// Offensive tempo from CFBD play-by-play: game-clock seconds an offense uses per snap. Shared by the training pull
// (scripts/totals_v2/pull_tempo.ts) and the weekly plays sync (api/cfbd-sync.ts), so the definition is identical.
//
// For each pair of consecutive scrimmage snaps by the same offense on the same drive and in the same quarter, the
// interval is the game clock that ran between them. Left out: garbage time (same margins as the play-level pull),
// the last 2:00 of each half (hurry-up / clock-kill), overtime, kneel-downs and spikes, and intervals over 45 seconds
// (a timeout, injury or review sits in between). Lower = faster; an average offense uses ~22-25 seconds of clock.
//
// Data quality: CFBD's play clock is missing for a large share of games — the clock just repeats from snap to snap,
// so every interval reads 0. A game counts only when fewer than 20% of its snap-to-snap intervals are zero; games that
// fail are skipped entirely (tempo_n = 0) rather than read as an impossibly fast offense.

export interface TempoPlay {
  gameId?: number | string;
  offense?: string;
  driveNumber?: number | null;
  playNumber?: number | null;
  id?: number | string;
  period?: number | null;
  clock?: { minutes?: number | null; seconds?: number | null } | null;
  offenseScore?: number | null;
  defenseScore?: number | null;
  down?: number | null;
  playType?: string | null;
  playText?: string | null;
}

export interface TempoAgg {
  game_id: string;
  team: string;
  tempo_sec_sum: number;
  tempo_n: number;
}

const SCRIMMAGE = /rush|pass|sack|interception|fumble/i;
const NON_SCRIMMAGE = /kickoff|punt|field goal|extra point|two point|2pt|penalty|timeout|end of|end period|coin toss|uncategorized|blocked|safety|defensive 2|official/i;
const MAX_INTERVAL = 45;

function garbage(period: number, a: number, b: number): boolean {
  const m = Math.abs(a - b);
  return period === 1 ? m > 43 : period === 2 ? m > 37 : period === 3 ? m > 27 : period === 4 ? m > 22 : false;
}
const n = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function aggregateTempo(plays: TempoPlay[]): TempoAgg[] {
  const order = (p: TempoPlay) => {
    const d = n(p.driveNumber);
    const k = n(p.playNumber);
    return d != null && k != null ? d * 1000 + k : Number(p.id ?? 0) % 1e9;
  };
  const byGame = new Map<string, TempoPlay[]>();
  for (const p of plays) {
    if (p.gameId == null || !p.offense) continue;
    const k = String(p.gameId);
    (byGame.get(k) ?? byGame.set(k, []).get(k)!).push(p);
  }
  const out = new Map<string, TempoAgg>();
  for (const [gameId, list] of byGame) {
    list.sort((a, b) => order(a) - order(b));
    const gameOut = new Map<string, TempoAgg>();
    let zeros = 0, pairs = 0;
    let prev: { off: string; drive: number | null; period: number; secs: number } | null = null;
    for (const p of list) {
      const type = String(p.playType ?? "");
      const text = String(p.playText ?? "");
      const isSnap = SCRIMMAGE.test(type) && !NON_SCRIMMAGE.test(type) && n(p.down) != null && !/kneel|spike|victory formation/i.test(text);
      if (!isSnap) continue;
      const period = n(p.period) ?? 0;
      const secs = p.clock ? (n(p.clock.minutes) ?? NaN) * 60 + (n(p.clock.seconds) ?? NaN) : NaN;
      const drive = n(p.driveNumber);
      const cur = { off: p.offense!, drive, period, secs };
      if (
        prev &&
        Number.isFinite(secs) &&
        Number.isFinite(prev.secs) &&
        prev.off === cur.off &&
        prev.drive === drive &&
        prev.period === period &&
        period >= 1 &&
        period <= 4 &&
        !((period === 2 || period === 4) && prev.secs <= 120) &&
        !garbage(period, n(p.offenseScore) ?? 0, n(p.defenseScore) ?? 0)
      ) {
        const dt = prev.secs - secs;
        pairs++;
        if (dt === 0) zeros++;
        if (dt >= 0 && dt <= MAX_INTERVAL) {
          const k = `${gameId}|${cur.off}`;
          const a = gameOut.get(k) ?? { game_id: gameId, team: cur.off, tempo_sec_sum: 0, tempo_n: 0 };
          a.tempo_sec_sum += dt;
          a.tempo_n++;
          gameOut.set(k, a);
        }
      }
      prev = cur;
    }
    if (pairs >= 40 && zeros / pairs < 0.2) for (const [k, v] of gameOut) out.set(k, v);
  }
  return Array.from(out.values());
}
