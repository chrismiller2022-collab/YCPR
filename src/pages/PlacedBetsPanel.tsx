import { useEffect, useMemo, useRef, useState } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import TeamLink from "../components/TeamLink";
import {
  fetchPlacedBets,
  importPlacedBets,
  fetchPlacedParlays,
  BOOK_LABELS,
  fetchJuicereelAuthorizeUrl,
  fetchJuicereelStatus,
  disconnectJuicereel,
  syncJuicereel,
  type PlacedBetRow,
  type PlacedParlayRow,
  type PlacedParlayLeg,
  type BetBook,
  type BetType,
  type BetResult,
  type NewPlacedBet,
  type JuicereelStatus,
  type JuicereelSyncResult,
} from "../lib/api/placedBets";
import { parsePlacedBetsCsv, PLACED_BETS_CSV_TEMPLATE, type PlacedBetImportError } from "../lib/api/placedBetsImport";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { pickLine } from "../lib/matchupsCompute";
import { moneylineToImpliedWinPct } from "../lib/odds";
import { fetchPoolBalanceSummary, type PoolBalanceSummary } from "../lib/api/poolBalanceSummary";
import { useGameTotalsEngine, type EnrichedGameRow } from "../lib/gameTotalsEngine";
import { splitTeamTotal } from "../lib/gameTotals";

function fmtPrice(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}
function fmtLine(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtMoney(v: number | null): string {
  if (v == null) return "–";
  return `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
}

// team_total bets store side as "TeamName|over" — everywhere else side
// is already display-ready (a team name, or "over"/"under").
function splitTeamTotalSide(side: string): { team: string; dir: string } | null {
  const i = side.indexOf("|");
  return i === -1 ? null : { team: side.slice(0, i), dir: side.slice(i + 1) };
}
function displaySide(bet: PlacedBetRow): string {
  if (bet.bet_type === "team_total") {
    const s = splitTeamTotalSide(bet.side);
    return s ? `${s.team} ${s.dir}` : bet.side;
  }
  return bet.side;
}

// A bet's `result` column is set once at save/import time and never
// touched again — there's no grading pass anywhere that goes back and
// compares it to a final score, so every manually- or CSV-imported bet
// just sits at "pending" forever even once its game is long over. Unlike
// live power ratings (which really do keep moving and would "drift" if
// re-derived after the fact), a completed game's final score is fixed
// the moment it goes final, so grading live against `games` here carries
// none of that risk — it can only ever resolve pending -> a real result,
// never flip a settled one. Only ever called when bet.result is still
// "pending"; an explicitly-set result (e.g. from a CSV that already knew
// the outcome) is never second-guessed.
// Core win/loss/push comparison against a score — factored out so both
// final grading (gated on the game actually being over) and live
// grading (evaluated against whatever score is currently synced, final
// or not) share one implementation and can never disagree on the
// boundary between a win and a loss.
function gradeAgainstScore(
  bet: { bet_type: BetType; side: string; line_value: number | null },
  game: { home_team: string; away_team: string },
  homePoints: number,
  awayPoints: number
): BetResult {
  const isAway = bet.side === game.away_team;

  if (bet.bet_type === "moneyline") {
    if (awayPoints === homePoints) return "push"; // no ties in real CFB, but nothing else to call it
    const awayWon = awayPoints > homePoints;
    return isAway === awayWon ? "win" : "loss";
  }

  if (bet.bet_type === "spread") {
    if (bet.line_value == null) return "pending";
    if (!isAway && bet.side !== game.home_team) return "pending"; // side isn't either team in this game
    const ownMargin = isAway ? awayPoints - homePoints : homePoints - awayPoints;
    const coverMargin = ownMargin + bet.line_value;
    return coverMargin > 0 ? "win" : coverMargin < 0 ? "loss" : "push";
  }

  if (bet.bet_type === "total") {
    if (bet.line_value == null) return "pending";
    const actual = homePoints + awayPoints;
    if (actual === bet.line_value) return "push";
    const isOver = bet.side === "over";
    return isOver === actual > bet.line_value ? "win" : "loss";
  }

  if (bet.bet_type === "team_total") {
    if (bet.line_value == null) return "pending";
    const s = splitTeamTotalSide(bet.side);
    if (!s) return "pending";
    const isTeamAway = s.team === game.away_team;
    const isTeamHome = s.team === game.home_team;
    if (!isTeamAway && !isTeamHome) return "pending"; // team name mismatch — don't guess
    const teamScore = isTeamAway ? awayPoints : homePoints;
    if (teamScore === bet.line_value) return "push";
    const isOver = s.dir === "over";
    return isOver === teamScore > bet.line_value ? "win" : "loss";
  }

  return "pending";
}

function gradeBetAgainstGame(bet: PlacedBetRow, game: GameWithLines | undefined): BetResult {
  if (!game || !game.completed || game.home_points == null || game.away_points == null) return "pending";
  return gradeAgainstScore(bet, game, game.home_points, game.away_points);
}

interface ClvResult {
  currentLine: number | null;
  clv: number | null;
  favorable: boolean | null;
}

// Closing Line Value isn't stored as a separate snapshot — it's computed
// live against whatever the currently-synced consensus line is, which
// becomes a stable "closing" reference once the game has kicked off (no
// separate capture step needed; the live line simply stops moving once
// there's nothing left to sync against).
function computeClv(bet: PlacedBetRow, game: GameWithLines | undefined): ClvResult {
  if (!game) return { currentLine: null, clv: null, favorable: null };
  const line = pickLine(game.lines);
  if (!line) return { currentLine: null, clv: null, favorable: null };

  if (bet.bet_type === "total") {
    if (line.over_under == null || bet.line_value == null) return { currentLine: line.over_under, clv: null, favorable: null };
    const isOver = bet.side === "over";
    const clv = isOver ? line.over_under - bet.line_value : bet.line_value - line.over_under;
    return { currentLine: line.over_under, clv, favorable: clv > 0 };
  }

  if (bet.bet_type === "spread") {
    if (bet.line_value == null || line.spread == null) return { currentLine: null, clv: null, favorable: null };
    const isAway = bet.side === game.away_team;
    const currentAwaySpread = -line.spread; // spread field is home-perspective
    const currentSideSpread = isAway ? currentAwaySpread : -currentAwaySpread;
    const clv = currentSideSpread - bet.line_value;
    return { currentLine: currentSideSpread, clv, favorable: clv > 0 };
  }

  if (bet.bet_type === "moneyline") {
    const isAway = bet.side === game.away_team;
    const currentPrice = isAway ? line.away_moneyline : line.home_moneyline;
    if (currentPrice == null) return { currentLine: currentPrice, clv: null, favorable: null };
    const myImplied = moneylineToImpliedWinPct(bet.price);
    const currentImplied = moneylineToImpliedWinPct(currentPrice);
    if (myImplied == null || currentImplied == null) return { currentLine: currentPrice, clv: null, favorable: null };
    const clvPct = (currentImplied - myImplied) * 100;
    return { currentLine: currentPrice, clv: clvPct, favorable: clvPct > 0 };
  }

  // team_total — no per-team market line synced consistently enough
  // site-wide to grade CLV against yet (see team_total_lines' own
  // caveats); leave blank rather than compare against something that
  // isn't really "closing."
  return { currentLine: null, clv: null, favorable: null };
}

// Profit/loss in dollars for a settled bet. Prefers the stated to_win
// (what the book actually quoted) over deriving one from price+stake,
// since real books round odd cents in ways a formula won't reproduce
// exactly. Returns null for a pending bet or one missing a stake (e.g.
// bets logged from Admin Matchups' checkbox before this had a stake
// column) — null is excluded from every record/ROI total below, not
// treated as a zero.
function betProfitForResult(bet: { stake: number | null; to_win: number | null; price: number }, result: BetResult): number | null {
  if (result === "pending" || bet.stake == null) return null;
  if (result === "push") return 0;
  if (result === "loss") return -bet.stake;
  if (bet.to_win != null) return bet.to_win;
  return bet.price > 0 ? bet.stake * (bet.price / 100) : bet.stake * (100 / Math.abs(bet.price));
}
function betProfit(bet: PlacedBetRow): number | null {
  return betProfitForResult(bet, bet.result);
}

interface Record_ {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  staked: number;
  profit: number;
}
function emptyRecord(): Record_ {
  return { wins: 0, losses: 0, pushes: 0, pending: 0, staked: 0, profit: 0 };
}
function addBetToRecord(rec: Record_, bet: PlacedBetRow) {
  if (bet.result === "pending") {
    rec.pending++;
    return;
  }
  if (bet.result === "win") rec.wins++;
  else if (bet.result === "loss") rec.losses++;
  else if (bet.result === "push") rec.pushes++;
  if (bet.stake != null) rec.staked += bet.stake;
  const p = betProfit(bet);
  if (p != null) rec.profit += p;
}
function roi(rec: Record_): number | null {
  return rec.staked > 0 ? (rec.profit / rec.staked) * 100 : null;
}

function fmtMoneyPlain(v: number): string {
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------
// Exposure Tracker — every game with money on it, grouped across all
// books, so a quick glance shows what's actually riding on each kickoff
// this week. "Rooting interest" translates the stored side/line back
// into what you're actually hoping happens on the field, independent of
// which book's own market wording it came from.
// ---------------------------------------------------------------------
function fmtLineAbs(v: number | null): string {
  return v == null ? "–" : v.toFixed(1);
}
function fmtStake(v: number | null): string {
  return v == null ? "–" : `$${v.toFixed(2)}`;
}
function fmtKickoff(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function rootingInterest(bet: PlacedBetRow): string {
  if (bet.bet_type === "moneyline") return `${bet.side} to win`;
  if (bet.bet_type === "spread") return `${bet.side} ${fmtLine(bet.line_value)} to cover`;
  if (bet.bet_type === "team_total") {
    const s = splitTeamTotalSide(bet.side);
    return s ? `${s.team} team total ${s.dir} ${fmtLineAbs(bet.line_value)}` : bet.side;
  }
  return `Game ${bet.side} ${fmtLineAbs(bet.line_value)}`;
}

type GameStatus = "not_started" | "in_progress" | "final";

function gameStatus(game: GameWithLines): GameStatus {
  if (game.completed) return "final";
  if (game.home_points != null || game.away_points != null) return "in_progress";
  return "not_started";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// 0 (red) .. 1 (green), how well a bet is trending against whatever
// score is currently synced — smooth rather than a coin flip, so an
// in-progress game reads as a gradient. Spread/moneyline use a 28-point
// span (two scores either way) to go fully saturated; totals/team
// totals instead track literal progress toward the number, exactly per
// Chris's own framing: an Over starts red at 0-0 and turns green as the
// score climbs toward the total; an Under is the mirror image.
function betGoodness(
  bet: { bet_type: BetType; side: string; line_value: number | null },
  homeTeam: string,
  awayTeam: string,
  homePoints: number,
  awayPoints: number
): number | null {
  const isAway = bet.side === awayTeam;
  if (bet.bet_type === "moneyline") {
    const margin = isAway ? awayPoints - homePoints : homePoints - awayPoints;
    return clamp01(0.5 + margin / 28);
  }
  if (bet.bet_type === "spread") {
    if (bet.line_value == null || (!isAway && bet.side !== homeTeam)) return null;
    const ownMargin = isAway ? awayPoints - homePoints : homePoints - awayPoints;
    return clamp01(0.5 + (ownMargin + bet.line_value) / 28);
  }
  if (bet.bet_type === "total") {
    if (!bet.line_value) return null;
    const actual = homePoints + awayPoints;
    return bet.side === "over" ? clamp01(actual / bet.line_value) : clamp01(1 - actual / bet.line_value);
  }
  if (bet.bet_type === "team_total") {
    if (!bet.line_value) return null;
    const s = splitTeamTotalSide(bet.side);
    if (!s) return null;
    const teamScore = s.team === awayTeam ? awayPoints : s.team === homeTeam ? homePoints : null;
    if (teamScore == null) return null;
    return s.dir === "over" ? clamp01(teamScore / bet.line_value) : clamp01(1 - teamScore / bet.line_value);
  }
  return null;
}

function trendColor(result: BetResult, goodness: number | null): string {
  if (result === "win") return "hsl(122, 55%, 45%)";
  if (result === "loss") return "hsl(0, 62%, 52%)";
  if (result === "push") return "var(--chalk-dim)";
  if (goodness == null) return "var(--chalk-dim)"; // game hasn't started, or this bet's own line is missing
  return `hsl(${Math.round(goodness * 122)}, 60%, 48%)`;
}

function TrendDot({ result, goodness, title }: { result: BetResult; goodness: number | null; title: string }) {
  return (
    <span
      title={title}
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: trendColor(result, goodness), flexShrink: 0 }}
    />
  );
}

function fmtScore(game: GameWithLines): string {
  const status = gameStatus(game);
  if (status === "not_started") return "Not started";
  const ap = game.away_points ?? 0;
  const hp = game.home_points ?? 0;
  return `${ap}-${hp}${status === "final" ? " Final" : " live"}`;
}

// Full comparison against a hypothetical/current score, same boundary
// as gradeAgainstScore but usable for a placed_bets row OR a bare
// parlay leg (which has no id/stake/created_at of its own to satisfy
// PlacedBetRow) — anything with bet_type/side/line_value qualifies.
function liveResultForBet(bet: { bet_type: BetType; side: string; line_value: number | null }, game: GameWithLines | undefined): BetResult {
  if (!game || game.home_points == null || game.away_points == null) return "pending";
  return gradeAgainstScore(bet, game, game.home_points, game.away_points);
}

function computeLivePnlForBet(bet: PlacedBetRow, game: GameWithLines | undefined): number {
  if (bet.stake == null) return 0;
  if (bet.result !== "pending") return betProfit(bet) ?? 0;
  return betProfitForResult(bet, liveResultForBet(bet, game)) ?? 0;
}

// A parlay's live P&L can't be a smooth blend of its legs' goodness —
// one leg losing kills the whole ticket regardless of how the others
// are trending, so this only ever resolves to "lost" (any leg already a
// live loss), "won" (every leg currently winning/final-won), or "still
// live" (counted as $0 rather than guessing at a fractional value).
function computeLivePnlForParlay(parlay: PlacedParlayRow, gamesById: Map<string, GameWithLines>): number {
  if (parlay.stake == null) return 0;
  if (parlay.result !== "pending") return betProfitForResult(parlay, parlay.result) ?? 0;
  let anyLoss = false;
  let allWin = true;
  for (const leg of parlay.legs) {
    const r = liveResultForBet(leg, gamesById.get(leg.game_id));
    if (r === "loss") anyLoss = true;
    if (r !== "win") allWin = false;
  }
  if (anyLoss) return -parlay.stake;
  if (allWin) return parlay.to_win ?? 0;
  return 0;
}

interface GameExposure {
  gameId: string;
  game: GameWithLines;
  bets: PlacedBetRow[];
  parlayLegs: { leg: PlacedParlayLeg; parlay: PlacedParlayRow }[];
  totalStake: number;
  bestCase: number;
  worstCase: number;
  status: GameStatus;
}

function buildExposure(bets: PlacedBetRow[], parlays: PlacedParlayRow[], gamesById: Map<string, GameWithLines>): GameExposure[] {
  const byGame = new Map<string, { bets: PlacedBetRow[]; parlayLegs: { leg: PlacedParlayLeg; parlay: PlacedParlayRow }[] }>();
  function bucket(gameId: string) {
    if (!byGame.has(gameId)) byGame.set(gameId, { bets: [], parlayLegs: [] });
    return byGame.get(gameId)!;
  }
  bets.forEach((b) => {
    if (b.stake == null || b.stake === 0) return;
    bucket(b.game_id).bets.push(b);
  });
  parlays.forEach((p) => p.legs.forEach((leg) => bucket(leg.game_id).parlayLegs.push({ leg, parlay: p })));

  const out: GameExposure[] = [];
  byGame.forEach((entry, gameId) => {
    const game = gamesById.get(gameId);
    if (!game) return;

    let totalStake = 0;
    let best = 0;
    let worst = 0;
    entry.bets.forEach((b) => {
      if (b.stake == null) return;
      totalStake += b.stake;
      const win = b.to_win ?? (b.price > 0 ? b.stake * (b.price / 100) : b.stake * (100 / Math.abs(b.price)));
      best += win;
      worst -= b.stake;
    });
    // A parlay leg puts the WHOLE parlay's stake at risk on this one
    // game (a loss here loses the whole ticket), so it's counted in
    // full here — not divided by leg count. That means the same parlay
    // stake shows up again on every other game it touches too; the top
    // summary bar counts each parlay exactly once instead.
    const seenParlayIds = new Set<number>();
    entry.parlayLegs.forEach(({ parlay }) => {
      if (seenParlayIds.has(parlay.id)) return;
      seenParlayIds.add(parlay.id);
      if (parlay.stake != null) {
        totalStake += parlay.stake;
        worst -= parlay.stake;
      }
      if (parlay.to_win != null) best += parlay.to_win;
    });

    out.push({ gameId, game, bets: entry.bets, parlayLegs: entry.parlayLegs, totalStake, bestCase: best, worstCase: worst, status: gameStatus(game) });
  });
  return out;
}

function SummaryChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "0.5rem 0.8rem", border: "1px solid var(--hash)", borderRadius: 8, minWidth: 150 }}>
      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ExposureSummaryBar({ bets, parlays, gamesById }: { bets: PlacedBetRow[]; parlays: PlacedParlayRow[]; gamesById: Map<string, GameWithLines> }) {
  const totalStake = bets.reduce((s, b) => s + (b.stake ?? 0), 0) + parlays.reduce((s, p) => s + (p.stake ?? 0), 0);
  const totalToWin = bets.reduce((s, b) => s + (b.to_win ?? 0), 0) + parlays.reduce((s, p) => s + (p.to_win ?? 0), 0);
  const livePnl =
    bets.reduce((s, b) => s + computeLivePnlForBet(b, gamesById.get(b.game_id)), 0) +
    parlays.reduce((s, p) => s + computeLivePnlForParlay(p, gamesById), 0);

  const gameIds = new Set<string>();
  bets.forEach((b) => gameIds.add(b.game_id));
  parlays.forEach((p) => p.legs.forEach((l) => gameIds.add(l.game_id)));
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  gameIds.forEach((id) => {
    const g = gamesById.get(id);
    if (!g) return;
    const st = gameStatus(g);
    if (st === "final") completed++;
    else if (st === "in_progress") inProgress++;
    else notStarted++;
  });

  return (
    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <SummaryChip label="Total Staked" value={fmtStake(totalStake)} />
      <SummaryChip label="Total To Win" value={fmtStake(totalToWin)} />
      <SummaryChip label="Live P&L" value={fmtMoney(livePnl)} color={livePnl > 0 ? "#8fd39a" : livePnl < 0 ? "#e07a7a" : undefined} />
      <SummaryChip label="Games" value={`${completed} final · ${inProgress} live · ${notStarted} upcoming`} />
    </div>
  );
}

// My model's spread/total/team-total projections for this game, next to
// the currently-synced Vegas line for the same three — reuses the exact
// numbers the Totals engine already computes (myHomeSpread/
// projectedTotal), so this can never disagree with what the Totals tool
// itself shows for the same game.
function GamePredictions({ enriched }: { enriched: EnrichedGameRow | undefined }) {
  if (!enriched) return <p style={{ fontSize: "0.76rem", color: "var(--chalk-dim)", margin: "0 0 0.5rem" }}>No model projection for this game yet.</p>;
  const myTotal = enriched.projection?.projectedTotal ?? null;
  const myHomeSpread = enriched.myHomeSpread;
  const myTeamTotals = splitTeamTotal(myTotal, myHomeSpread);
  const vegasTotal = enriched.odds.vegasTotal;
  const vegasHomeSpread = enriched.game.homeSpread;
  const vegasTeamTotals = splitTeamTotal(vegasTotal, vegasHomeSpread);
  const cell = { padding: "0.1rem 0" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "0.1rem 0.9rem", fontSize: "0.78rem", marginBottom: "0.7rem" }}>
      <span />
      <span style={{ color: "var(--chalk-dim)" }}>Mine</span>
      <span style={{ color: "var(--chalk-dim)" }}>Vegas (current)</span>
      <span style={{ color: "var(--chalk-dim)", ...cell }}>Spread (home)</span>
      <span style={cell}>{fmtLine(myHomeSpread)}</span>
      <span style={cell}>{fmtLine(vegasHomeSpread)}</span>
      <span style={{ color: "var(--chalk-dim)", ...cell }}>Total</span>
      <span style={cell}>{myTotal != null ? myTotal.toFixed(1) : "–"}</span>
      <span style={cell}>{vegasTotal != null ? vegasTotal.toFixed(1) : "–"}</span>
      <span style={{ color: "var(--chalk-dim)", ...cell }}>Team totals (away–home)</span>
      <span style={cell}>{myTeamTotals.away != null && myTeamTotals.home != null ? `${myTeamTotals.away.toFixed(1)}–${myTeamTotals.home.toFixed(1)}` : "–"}</span>
      <span style={cell}>
        {vegasTeamTotals.away != null && vegasTeamTotals.home != null ? `${vegasTeamTotals.away.toFixed(1)}–${vegasTeamTotals.home.toFixed(1)}` : "–"}
      </span>
    </div>
  );
}

function ParlayLegList({ parlay, currentLegGameId }: { parlay: PlacedParlayRow; currentLegGameId: string }) {
  return (
    <div style={{ marginTop: "0.3rem", paddingLeft: "0.9rem", borderLeft: "2px solid var(--hash)", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      {parlay.legs.map((leg) => (
        <div key={leg.id} style={{ fontSize: "0.76rem", fontWeight: leg.game_id === currentLegGameId ? 700 : 400 }}>
          {leg.away_team} @ {leg.home_team} — {rootingInterest({ bet_type: leg.bet_type, side: leg.side, line_value: leg.line_value } as PlacedBetRow)}
          {fmtPrice(leg.price) !== "–" ? ` (${fmtPrice(leg.price)})` : ""}
        </div>
      ))}
    </div>
  );
}

// Bets grouped by which parlay they belong to (undefined key for the
// single game-and-leg parlay this game happens to appear in more than
// once) — a game can have legs from more than one parlay, so this
// dedupes by parlay id and expands on click to show that parlay's OTHER
// legs (elsewhere) inline, per Chris's ask.
function GameParlayLegs({ legs }: { legs: { leg: PlacedParlayLeg; parlay: PlacedParlayRow }[] }) {
  const [openParlayId, setOpenParlayId] = useState<number | null>(null);
  const byParlay = new Map<number, { parlay: PlacedParlayRow; legs: PlacedParlayLeg[] }>();
  legs.forEach(({ leg, parlay }) => {
    if (!byParlay.has(parlay.id)) byParlay.set(parlay.id, { parlay, legs: [] });
    byParlay.get(parlay.id)!.legs.push(leg);
  });
  if (byParlay.size === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.3rem" }}>
      {Array.from(byParlay.values()).map(({ parlay, legs: theseLegs }) => {
        const isOpen = openParlayId === parlay.id;
        return (
          <div key={parlay.id}>
            <div
              onClick={() => setOpenParlayId(isOpen ? null : parlay.id)}
              style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.8rem", cursor: "pointer", color: "var(--gold, #d9a441)" }}
            >
              <span>
                {BOOK_LABELS[parlay.book] ?? parlay.book}: part of a {parlay.legs.length}-leg parlay
                {theseLegs.length > 1 ? ` (${theseLegs.length} legs here)` : ""} — {fmtPrice(parlay.price)} {isOpen ? "▲" : "▼"}
              </span>
              <span style={{ flexShrink: 0 }}>{fmtStake(parlay.stake)} to win {fmtStake(parlay.to_win)}</span>
            </div>
            {isOpen && <ParlayLegList parlay={parlay} currentLegGameId={theseLegs[0].game_id} />}
          </div>
        );
      })}
    </div>
  );
}

function GameExposureCard({ ex, enriched }: { ex: GameExposure; enriched: EnrichedGameRow | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: "0.7rem 0.9rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem", cursor: "pointer" }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
          <TeamLink team={ex.game.away_team} size={16} /> @ <TeamLink team={ex.game.home_team} size={16} />
        </div>
        <div style={{ fontSize: "0.76rem", color: "var(--chalk-dim)" }}>{fmtKickoff(ex.game.start_date)}</div>
        <div
          style={{
            fontSize: "0.8rem",
            fontWeight: 700,
            color: ex.status === "final" ? "var(--chalk-dim)" : ex.status === "in_progress" ? "#f2c94c" : "var(--chalk-dim)",
          }}
        >
          {fmtScore(ex.game)}
        </div>
        <div style={{ fontSize: "0.78rem" }}>
          Best <span style={{ color: "#8fd39a", fontWeight: 700 }}>{fmtMoney(ex.bestCase)}</span> · Worst{" "}
          <span style={{ color: "#e07a7a", fontWeight: 700 }}>{fmtMoney(ex.worstCase)}</span>
        </div>
        <div style={{ fontWeight: 700, color: "var(--gold, #d9a441)" }}>{fmtStake(ex.totalStake)} total {open ? "▲" : "▼"}</div>
      </div>

      {open && (
        <div style={{ marginTop: "0.6rem" }}>
          <GamePredictions enriched={enriched} />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {ex.bets.map((bet) => {
              const clv = computeClv(bet, ex.game);
              const goodness =
                ex.game.home_points != null && ex.game.away_points != null
                  ? betGoodness(bet, ex.game.home_team, ex.game.away_team, ex.game.home_points, ex.game.away_points)
                  : null;
              return (
                <div key={bet.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.8rem" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <TrendDot result={bet.result} goodness={goodness} title={`${bet.result === "pending" ? "Live trend" : bet.result}`} />
                    <span>
                      <span style={{ color: "var(--chalk-dim)" }}>{BOOK_LABELS[bet.book] ?? bet.book}:</span> {rootingInterest(bet)}
                      {clv.currentLine != null && (
                        <span style={{ color: "var(--chalk-dim)" }}>
                          {" "}
                          (closing {bet.bet_type === "moneyline" ? fmtPrice(clv.currentLine) : fmtLine(clv.currentLine)}
                          {clv.clv != null ? `, CLV ${clv.clv > 0 ? "+" : ""}${clv.clv.toFixed(1)}${bet.bet_type === "moneyline" ? "%" : ""}` : ""})
                        </span>
                      )}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0 }}>
                    {fmtStake(bet.stake)} → {fmtStake(bet.to_win)}
                  </span>
                </div>
              );
            })}
          </div>
          <GameParlayLegs legs={ex.parlayLegs} />
        </div>
      )}
    </div>
  );
}

type ExposureSortKey = "kickoff" | "stake";

function ExposureTrackerSection({
  bets,
  parlays: allParlays,
  gamesById,
  totalsByGameId,
}: {
  bets: PlacedBetRow[];
  parlays: PlacedParlayRow[];
  gamesById: Map<string, GameWithLines>;
  totalsByGameId: Map<string, EnrichedGameRow>;
}) {
  const [sortKey, setSortKey] = useState<ExposureSortKey>("kickoff");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Teasers are already stored as independent spread bets (see the
  // import), so hiding parlays leaves them in.
  const [hideParlays, setHideParlays] = useState(false);
  const parlays = useMemo(() => (hideParlays ? [] : allParlays), [hideParlays, allParlays]);

  const exposures = useMemo(() => {
    const list = buildExposure(bets, parlays, gamesById);
    return [...list].sort((a, b) => {
      const av = sortKey === "kickoff" ? new Date(a.game.start_date ?? 0).getTime() : a.totalStake;
      const bv = sortKey === "kickoff" ? new Date(b.game.start_date ?? 0).getTime() : b.totalStake;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [bets, parlays, gamesById, sortKey, sortDir]);

  function toggleSort(key: ExposureSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "kickoff" ? "asc" : "desc");
    }
  }

  if (exposures.length === 0 && allParlays.length === 0) {
    return <p style={{ color: "var(--chalk-dim)" }}>No games with a stake in view.</p>;
  }

  return (
    <div>
      <ExposureSummaryBar bets={bets} parlays={parlays} gamesById={gamesById} />

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort by:</span>
        <button className="menu-btn" onClick={() => toggleSort("kickoff")} style={{ fontWeight: sortKey === "kickoff" ? 700 : 400 }}>
          Kickoff {sortKey === "kickoff" ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </button>
        <button className="menu-btn" onClick={() => toggleSort("stake")} style={{ fontWeight: sortKey === "stake" ? 700 : 400 }}>
          Total Stake {sortKey === "stake" ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", marginLeft: "0.5rem" }}>
          <input type="checkbox" checked={hideParlays} onChange={(e) => setHideParlays(e.target.checked)} />
          Without parlays
        </label>
        <span style={{ marginLeft: "auto", fontSize: "0.82rem", color: "var(--chalk-dim)" }}>{exposures.length} game{exposures.length === 1 ? "" : "s"}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {exposures.map((ex) => (
          <GameExposureCard key={ex.gameId} ex={ex} enriched={totalsByGameId.get(ex.gameId)} />
        ))}
      </div>

      {parlays.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <div className="section-label" style={{ marginBottom: "0.5rem" }}>
            Parlays
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {parlays.map((p) => (
              <div key={p.id} style={{ padding: "0.6rem 0.8rem", background: "var(--turf-panel)", border: "1px solid var(--hash)", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 700 }}>
                  <span>
                    {BOOK_LABELS[p.book] ?? p.book} · {p.legs.length}-leg parlay · {fmtPrice(p.price)}
                  </span>
                  <span>
                    {fmtStake(p.stake)} → {fmtStake(p.to_win)}
                  </span>
                </div>
                <ParlayLegList parlay={p} currentLegGameId="" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PoolSummaryChip({ label, cost, winnings }: { label: string; cost: number; winnings: number }) {
  const net = winnings - cost;
  return (
    <div style={{ padding: "0.6rem 0.8rem", border: "1px solid var(--hash)", borderRadius: 8, minWidth: 150 }}>
      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "0.8rem" }}>
        {fmtMoneyPlain(cost)} in · {fmtMoneyPlain(winnings)} back
      </div>
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: net > 0 ? "#8fd39a" : net < 0 ? "#e07a7a" : undefined }}>{fmtMoney(net)}</div>
    </div>
  );
}

function RecordSummary({ label, rec }: { label: string; rec: Record_ }) {
  const r = roi(rec);
  return (
    <div style={{ padding: "0.6rem 0.8rem", border: "1px solid var(--hash)", borderRadius: 8, minWidth: 150 }}>
      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
        {rec.wins}-{rec.losses}
        {rec.pushes > 0 ? `-${rec.pushes}` : ""}
      </div>
      <div style={{ fontSize: "0.8rem", color: rec.profit > 0 ? "#8fd39a" : rec.profit < 0 ? "#e07a7a" : undefined }}>{fmtMoney(rec.profit)}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>
        {r != null ? `${r > 0 ? "+" : ""}${r.toFixed(1)}% ROI` : "–"}
        {rec.pending > 0 ? ` · ${rec.pending} pending` : ""}
      </div>
    </div>
  );
}

// Reads the `?juicereel=connected|error` params JuiceReel's OAuth
// redirect lands back on this site with (see juicereel-oauth-callback.ts)
// once, on mount, then strips them from the URL so a page refresh doesn't
// re-show the same message.
function useJuicereelRedirectStatus(): { status: "connected" | "error"; message: string | null } | null {
  const [result, setResult] = useState<{ status: "connected" | "error"; message: string | null } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("juicereel");
    if (status === "connected" || status === "error") {
      setResult({ status, message: params.get("juicereel_message") });
      params.delete("juicereel");
      params.delete("juicereel_message");
      const newSearch = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    }
  }, []);
  return result;
}

function JuicereelConnectControl({ onImported }: { onImported: () => void }) {
  const [status, setStatus] = useState<JuicereelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<JuicereelSyncResult | null>(null);
  const redirectResult = useJuicereelRedirectStatus();

  function refreshStatus() {
    setLoading(true);
    fetchJuicereelStatus()
      .then(setStatus)
      .catch((err) => setMessage(err.message ?? "Failed to load JuiceReel status"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!redirectResult) return;
    if (redirectResult.status === "connected") {
      setMessage("JuiceReel connected.");
      refreshStatus();
    } else {
      setMessage(`JuiceReel connection failed: ${redirectResult.message ?? "unknown error"}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectResult]);

  async function handleConnect() {
    setBusy("connect");
    setMessage(null);
    try {
      const { url } = await fetchJuicereelAuthorizeUrl();
      window.location.href = url;
    } catch (err: any) {
      setMessage(err.message ?? "Failed to start JuiceReel connection");
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy("sync");
    setMessage(null);
    setSyncResult(null);
    try {
      const result = await syncJuicereel();
      setSyncResult(result);
      if (result.imported > 0) onImported();
    } catch (err: any) {
      setMessage(err.message ?? "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect JuiceReel? You can reconnect any time.")) return;
    setBusy("disconnect");
    setMessage(null);
    try {
      await disconnectJuicereel();
      setSyncResult(null);
      refreshStatus();
    } catch (err: any) {
      setMessage(err.message ?? "Failed to disconnect");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.9rem 1rem", marginBottom: "1.25rem" }}>
      <div className="section-label" style={{ marginBottom: "0.5rem" }}>
        JuiceReel Bet Sync
      </div>
      {loading ? (
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>Checking connection…</p>
      ) : status?.connected ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem" }}>
            Connected{status.displayName ? ` as ${status.displayName}` : ""}
            {status.lastSyncCheckpoint && (
              <span style={{ color: "var(--chalk-dim)" }}> · last synced {new Date(status.lastSyncCheckpoint).toLocaleString()}</span>
            )}
          </span>
          <button className="menu-btn" onClick={handleSync} disabled={busy != null}>
            {busy === "sync" ? "Syncing…" : "Sync Now"}
          </button>
          <button className="menu-btn" onClick={handleDisconnect} disabled={busy != null}>
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
            Automatically syncs settled/open college football bets from Kalshi, NoVig, BetOnline, Bovada, and DK
            Predictions via JuiceReel's account connection — no password ever passes through this site.
          </p>
          <button className="menu-btn" onClick={handleConnect} disabled={busy != null}>
            {busy === "connect" ? "Redirecting…" : "Connect JuiceReel"}
          </button>
        </div>
      )}
      {message && <p style={{ fontSize: "0.82rem", marginTop: "0.6rem", marginBottom: 0 }}>{message}</p>}
      {syncResult && (
        <div style={{ fontSize: "0.82rem", marginTop: "0.6rem" }}>
          <p style={{ margin: 0 }}>
            Fetched {syncResult.fetched}, imported {syncResult.imported}
            {syncResult.skipped.length > 0 ? `, skipped ${syncResult.skipped.length}` : ""}.
          </p>
          {syncResult.skipped.length > 0 && (
            <details style={{ marginTop: "0.3rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--chalk-dim)" }}>Why bets were skipped</summary>
              <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem" }}>
                {syncResult.skipped.map((s) => (
                  <li key={s.juicereelBetId}>
                    Bet {s.juicereelBetId}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CsvImportControl({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [resolved, setResolved] = useState<NewPlacedBet[]>([]);
  const [errors, setErrors] = useState<PlacedBetImportError[]>([]);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleCheck(csvText: string) {
    setText(csvText);
    setMessage(null);
    setChecking(true);
    try {
      const { resolved: r, errors: e } = await parsePlacedBetsCsv(csvText);
      setResolved(r);
      setErrors(e);
    } catch (err: any) {
      setMessage(`Error: ${err.message ?? "Failed to parse CSV"}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleFile(f: File) {
    const text = await f.text();
    await handleCheck(text);
  }

  async function handleImport() {
    if (resolved.length === 0) return;
    setImporting(true);
    setMessage(null);
    try {
      const { imported } = await importPlacedBets(resolved);
      setMessage(`Imported ${imported} bet${imported === 1 ? "" : "s"}.`);
      setResolved([]);
      setErrors([]);
      setText("");
      onImported();
    } catch (err: any) {
      setMessage(`Error: ${err.message ?? "Import failed"}`);
    } finally {
      setImporting(false);
    }
  }

  if (!open) {
    return (
      <button className="mode-btn" onClick={() => setOpen(true)} style={{ marginBottom: "1rem" }}>
        Upload CSV
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>Upload bets from CSV</strong>
        <button className="mode-btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
        Columns: date, book, away_team, home_team, bet_type, side, line_value, price, stake, to_win, result. Team
        names just need to be recognizable (e.g. "Bama" matches Alabama) — rows that can't be matched to a real
        scheduled game show up as errors below instead of being silently guessed.{" "}
        <button
          className="mode-btn"
          style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem" }}
          onClick={() => {
            const blob = new Blob([PLACED_BETS_CSV_TEMPLATE], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "placed-bets-template.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download template
        </button>
      </p>

      <input ref={fileRef} type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", margin: "0.5rem 0 0.2rem" }}>...or paste CSV text:</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && handleCheck(text)}
        rows={6}
        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.75rem" }}
        placeholder={PLACED_BETS_CSV_TEMPLATE}
      />
      <button className="mode-btn" onClick={() => handleCheck(text)} disabled={checking || !text.trim()} style={{ marginTop: "0.4rem" }}>
        {checking ? "Checking…" : "Check"}
      </button>

      {message && <p style={{ color: message.startsWith("Error") ? "crimson" : "#8fd39a" }}>{message}</p>}

      {resolved.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <p style={{ color: "#8fd39a", fontSize: "0.85rem" }}>{resolved.length} row(s) ready to import.</p>
          <button className="mode-btn mode-btn-active" onClick={handleImport} disabled={importing}>
            {importing ? "Importing…" : `Import ${resolved.length} bet${resolved.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <p style={{ color: "#e07a7a", fontSize: "0.85rem" }}>{errors.length} row(s) couldn't be matched — fix and re-check:</p>
          <ul style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>
            {errors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PlacedBetsPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState<number | "all">("all");
  useDefaultToAdminWeek(setWeek);
  const [bets, setBets] = useState<PlacedBetRow[]>([]);
  const [parlays, setParlays] = useState<PlacedParlayRow[]>([]);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [poolSummary, setPoolSummary] = useState<PoolBalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchPlacedBets(season), fetchPlacedParlays(season), fetchGamesWithLines(season), fetchPoolBalanceSummary(season)])
      .then(([betRows, parlayRows, gameRows, summary]) => {
        setBets(betRows);
        setParlays(parlayRows);
        setGames(gameRows);
        setPoolSummary(summary);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [season, reloadTick]);

  // Same model projections the Totals tool itself uses, keyed by game id
  // so the Exposure Tracker's per-game "Mine vs Vegas" row can never
  // drift from what that page shows for the same game.
  const { rows: totalsRows } = useGameTotalsEngine(season);
  const totalsByGameId = useMemo(() => new Map(totalsRows.map((r) => [r.game.id, r])), [totalsRows]);

  const gamesById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  // Grades any still-"pending" bet against its game's final score — see
  // gradeBetAgainstGame for why this is safe to do live (unlike ratings,
  // a final score never changes once it's in). Everything downstream
  // (records, P&L, the table, Exposure Tracker) reads from this instead
  // of the raw fetched rows, so a bet's result/P&L show up the moment its
  // game syncs as final, with no separate "run grading" step needed.
  const gradedBets = useMemo(
    () => bets.map((b) => (b.result === "pending" ? { ...b, result: gradeBetAgainstGame(b, gamesById.get(b.game_id)) } : b)),
    [bets, gamesById]
  );
  const availableWeeks = useMemo(() => Array.from(new Set(gradedBets.map((b) => b.week))).sort((a, b) => a - b), [gradedBets]);
  const visibleBets = useMemo(
    () => (week === "all" ? gradedBets : gradedBets.filter((b) => b.week === week)),
    [gradedBets, week]
  );

  // Same "grade once every leg's game is final" idea as gradedBets — a
  // push leg with no losing legs still counts the parlay as a win
  // (the real payout would reduce to the remaining legs' price, which
  // isn't recomputed here, but it never turns a non-losing ticket into
  // a loss).
  const gradedParlays = useMemo(
    () =>
      parlays.map((p) => {
        if (p.result !== "pending") return p;
        let allDecided = true;
        let anyLoss = false;
        let anyWin = false;
        for (const leg of p.legs) {
          const game = gamesById.get(leg.game_id);
          const r = game && game.completed && game.home_points != null && game.away_points != null
            ? gradeAgainstScore(leg, game, game.home_points, game.away_points)
            : "pending";
          if (r === "pending") {
            allDecided = false;
            break;
          }
          if (r === "loss") anyLoss = true;
          if (r === "win") anyWin = true;
        }
        if (!allDecided) return p;
        const result: BetResult = anyLoss ? "loss" : anyWin ? "win" : "push";
        return { ...p, result };
      }),
    [parlays, gamesById]
  );
  const visibleParlays = useMemo(
    () => (week === "all" ? gradedParlays : gradedParlays.filter((p) => p.week === week)),
    [gradedParlays, week]
  );

  const overall = useMemo(() => {
    const rec = emptyRecord();
    visibleBets.forEach((b) => addBetToRecord(rec, b));
    return rec;
  }, [visibleBets]);

  const byBook = useMemo(() => {
    const map = new Map<BetBook, Record_>();
    visibleBets.forEach((b) => {
      if (!map.has(b.book)) map.set(b.book, emptyRecord());
      addBetToRecord(map.get(b.book)!, b);
    });
    return map;
  }, [visibleBets]);

  const byType = useMemo(() => {
    const map = new Map<BetType, Record_>();
    visibleBets.forEach((b) => {
      if (!map.has(b.bet_type)) map.set(b.bet_type, emptyRecord());
      addBetToRecord(map.get(b.bet_type)!, b);
    });
    return map;
  }, [visibleBets]);

  // Money still on the table — staked on bets that haven't graded yet,
  // not part of the Combined section's in/back totals below (which only
  // covers what's actually settled).
  const pendingStaked = useMemo(
    () => visibleBets.filter((b) => b.result === "pending" && b.stake != null).reduce((sum, b) => sum + (b.stake ?? 0), 0),
    [visibleBets]
  );
  const betsReturned = overall.staked + overall.profit;

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Placed Bets</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Bets logged from Admin Matchups' Bet checkbox, plus anything imported here from a CSV — book, type, side,
        line, price, stake, and result. Closing Line Value is computed live against the currently-synced consensus
        line, which becomes a stable "closing" reference once a game has kicked off.
      </p>

      <JuicereelConnectControl onImported={() => setReloadTick((n) => n + 1)} />
      <CsvImportControl onImported={() => setReloadTick((n) => n + 1)} />

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
        <label>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <label>
          Week{" "}
          <select value={week} onChange={(e) => setWeek(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
            <option value="all">Whole season</option>
            {availableWeeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && bets.length === 0 && <p style={{ color: "var(--chalk-dim)" }}>No bets logged for {season} yet.</p>}

      {/* This page defaults its week filter to the site-wide Admin week
          selector (useDefaultToAdminWeek above), which advances once a
          week's games are done — so as soon as that happens, this filter
          can silently mismatch every bet actually logged. Before this,
          that produced a totally blank page below the filters with no
          "whole season" escape hatch, which read as "my bets are gone"
          (they weren't — see the week filter). */}
      {!loading && bets.length > 0 && visibleBets.length === 0 && (
        <p style={{ color: "var(--chalk-dim)" }}>
          No bets logged for {week === "all" ? "the whole season" : `Week ${week}`} — {bets.length} bet{bets.length === 1 ? "" : "s"}{" "}
          logged this season across week{availableWeeks.length === 1 ? "" : "s"} {availableWeeks.join(", ")}.{" "}
          <button className="menu-btn" onClick={() => setWeek("all")} style={{ padding: "0.15rem 0.6rem", fontSize: "0.8rem" }}>
            Show whole season
          </button>
        </p>
      )}

      {!loading && visibleBets.length > 0 && (
        <>
          <h3 style={{ marginBottom: "0.5rem" }}>Exposure Tracker</h3>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
            Every game in view with a stake on it, across all books, with what you're actually rooting for.
          </p>
          <div style={{ marginBottom: "1.75rem" }}>
            <ExposureTrackerSection bets={visibleBets} parlays={visibleParlays} gamesById={gamesById} totalsByGameId={totalsByGameId} />
          </div>

          <h3 style={{ marginBottom: "0.5rem" }}>Bets</h3>

          <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "0.4rem" }}>
            Overall
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.2rem" }}>
            <RecordSummary label="Overall" rec={overall} />
          </div>

          <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "0.4rem" }}>
            By Book
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.2rem" }}>
            {Array.from(byBook.entries()).map(([book, rec]) => (
              <RecordSummary key={book} label={BOOK_LABELS[book] ?? book} rec={rec} />
            ))}
          </div>

          <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "0.4rem" }}>
            By Bet Type
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.5rem" }}>
            {Array.from(byType.entries()).map(([type, rec]) => (
              <RecordSummary key={type} label={type.replace("_", " ")} rec={rec} />
            ))}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Placed</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Game</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Book</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Type</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Side</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>My Line</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>My Price</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Current/Closing</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>CLV</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Stake</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Result</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>P/L</th>
                </tr>
              </thead>
              <tbody>
                {visibleBets.map((bet) => {
                  const game = gamesById.get(bet.game_id);
                  const clv = computeClv(bet, game);
                  const profit = betProfit(bet);
                  return (
                    <tr key={bet.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "0.35rem 0.6rem", color: "var(--chalk-dim)" }}>{fmtDate(bet.created_at)}</td>
                      <td style={{ padding: "0.35rem 0.6rem" }}>{bet.week}</td>
                      <td style={{ padding: "0.35rem 0.6rem" }}>
                        <TeamLink team={bet.away_team} size={16} /> @ <TeamLink team={bet.home_team} size={16} />
                      </td>
                      <td style={{ padding: "0.35rem 0.6rem" }}>{BOOK_LABELS[bet.book] ?? bet.book}</td>
                      <td style={{ padding: "0.35rem 0.6rem", textTransform: "capitalize" }}>{bet.bet_type.replace("_", " ")}</td>
                      <td style={{ padding: "0.35rem 0.6rem", textTransform: "capitalize" }}>{displaySide(bet)}</td>
                      <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>
                        {bet.bet_type === "moneyline" ? "–" : fmtLine(bet.line_value)}
                      </td>
                      <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{fmtPrice(bet.price)}</td>
                      <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>
                        {bet.bet_type === "moneyline" ? fmtPrice(clv.currentLine) : fmtLine(clv.currentLine)}
                      </td>
                      <td
                        style={{
                          padding: "0.35rem 0.6rem",
                          textAlign: "right",
                          fontWeight: 700,
                          color: clv.favorable == null ? undefined : clv.favorable ? "#8fd39a" : "#c45c52",
                        }}
                      >
                        {clv.clv != null ? `${clv.clv > 0 ? "+" : ""}${clv.clv.toFixed(1)}${bet.bet_type === "moneyline" ? "pp" : ""}` : "–"}
                      </td>
                      <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{bet.stake != null ? `$${bet.stake.toFixed(2)}` : "–"}</td>
                      <td
                        style={{
                          padding: "0.35rem 0.6rem",
                          textAlign: "right",
                          textTransform: "capitalize",
                          color: bet.result === "win" ? "#8fd39a" : bet.result === "loss" ? "#e07a7a" : undefined,
                        }}
                      >
                        {bet.result}
                      </td>
                      <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: profit == null ? undefined : profit > 0 ? "#8fd39a" : profit < 0 ? "#e07a7a" : undefined }}>
                        {fmtMoney(profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {poolSummary && (
            <>
              <h3 style={{ marginTop: "2rem", marginBottom: "0.5rem" }}>Pools</h3>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: 0 }}>
                The Brit plus every flat pool cost tracked on the Balance Sheet — season-long, not affected by
                the week filter above.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.5rem" }}>
                {poolSummary.items.map((item) => (
                  <PoolSummaryChip key={item.key} label={item.label} cost={item.cost} winnings={item.winnings} />
                ))}
                <PoolSummaryChip label="Total" cost={poolSummary.totalCost} winnings={poolSummary.totalWinnings} />
              </div>

              <h3 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Combined</h3>
              <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: 0 }}>
                Everything you've put in this season vs. everything settled bets and pools have paid back so
                far.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                <PoolSummaryChip label="Bets" cost={overall.staked} winnings={betsReturned} />
                <PoolSummaryChip label="Pools" cost={poolSummary.totalCost} winnings={poolSummary.totalWinnings} />
                <PoolSummaryChip
                  label="Season total"
                  cost={overall.staked + poolSummary.totalCost}
                  winnings={betsReturned + poolSummary.totalWinnings}
                />
              </div>
              {pendingStaked > 0 && (
                <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
                  Plus {fmtMoneyPlain(pendingStaked)} staked on bets still pending — not counted above until they grade.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
