// Turns raw DB rows (games, betting_lines) into the flat game list DROGBA works on. Pure — used by the
// admin page (rows from Supabase) and by the bun backtest scripts (rows from JSON dumps).

export interface DGame {
  id: string;
  season: number;
  week: number;
  startMs: number | null;
  neutral: boolean;
  home: string;
  away: string;
  homeFbs: boolean;
  awayFbs: boolean;
  homePts: number | null;
  awayPts: number | null;
  completed: boolean;
  open: number | null; // opening spread, home-relation (negative = home favored)
  openProvider: string | null;
  close: number | null; // closing spread from the SAME book as `open` when possible
}

export interface RawGameRow {
  id: string;
  season: number;
  week: number | null;
  season_type: string | null;
  start_date: string | null;
  neutral_site: boolean | null;
  home_team: string;
  away_team: string;
  home_classification: string | null;
  away_classification: string | null;
  home_points: number | null;
  away_points: number | null;
  completed: boolean | null;
}

export interface RawLineRow {
  game_id: string;
  provider: string | null;
  spread: number | null;
  opening_spread: number | null;
}

// Bovada is the only book with an opening line on ~99% of FBS games in every season 2021-26 (the
// others only cover 2023+ and only part of the slate), so it is the consistent series. Other books'
// opens differ from it by ~1.5 points on average — "the open" is book-specific.
export const OPEN_PROVIDER_ORDER = ["Bovada", "DraftKings", "Draft Kings", "ESPN Bet", "consensus", "William Hill (New Jersey)"];

// Which book's opening line the model treats as "the open".
//   fanduel_then_bovada — FanDuel's open where we have one, Bovada's otherwise (default)
//   fanduel_only        — games without a FanDuel line drop out of the analysis (no mixing of books)
//   bovada              — the original series
export type OpenMode = "fanduel_then_bovada" | "fanduel_only" | "bovada";
export const OPEN_MODE_LABELS: Record<OpenMode, string> = {
  fanduel_then_bovada: "FanDuel open (Bovada where missing)",
  fanduel_only: "FanDuel open only",
  bovada: "Bovada open",
};
export interface BookLineLike {
  open: number;
}

export function buildGames(rows: RawGameRow[], lines: RawLineRow[], fanduel?: Map<string, BookLineLike>, mode: OpenMode = "bovada"): DGame[] {
  const byGame = new Map<string, RawLineRow[]>();
  for (const l of lines) {
    const a = byGame.get(l.game_id);
    if (a) a.push(l);
    else byGame.set(l.game_id, [l]);
  }
  const out: DGame[] = [];
  for (const g of rows) {
    if (g.season_type && g.season_type !== "regular") continue;
    if (g.week == null) continue;
    const ls = byGame.get(g.id) ?? [];
    let open: number | null = null;
    let openProvider: string | null = null;
    let close: number | null = null;
    for (const p of OPEN_PROVIDER_ORDER) {
      const x = ls.find((l) => l.provider === p && l.opening_spread != null);
      if (x) {
        open = x.opening_spread;
        openProvider = p;
        close = x.spread;
        break;
      }
    }
    // The close is Bovada's closing line whenever it has one (it has one for essentially every game), so every
    // game is graded against the same book's close rather than whichever snapshot happened to exist.
    const bovadaClose = ls.find((l) => l.provider === "Bovada" && l.spread != null)?.spread ?? null;
    if (bovadaClose != null) close = bovadaClose;
    if (close == null) close = ls.find((l) => l.spread != null)?.spread ?? null;
    const startMs = g.start_date ? Date.parse(g.start_date) : null;
    if (mode !== "bovada") {
      const fd = fanduel?.get(g.id);
      if (fd) {
        open = fd.open;
        openProvider = "FanDuel";
      } else if (mode === "fanduel_only") {
        open = null;
        openProvider = null;
      }
    }
    out.push({
      id: g.id,
      season: g.season,
      week: g.week,
      startMs,
      neutral: !!g.neutral_site,
      home: g.home_team,
      away: g.away_team,
      homeFbs: g.home_classification === "fbs",
      awayFbs: g.away_classification === "fbs",
      homePts: g.home_points,
      awayPts: g.away_points,
      completed: !!g.completed && g.home_points != null && g.away_points != null,
      open,
      openProvider,
      close,
    });
  }
  return out.sort((a, b) => a.season - b.season || a.week - b.week || (a.startMs ?? 0) - (b.startMs ?? 0));
}

export const isFbsGame = (g: DGame) => g.homeFbs && g.awayFbs;
export const margin = (g: DGame) => (g.homePts ?? 0) - (g.awayPts ?? 0);
