import { useEffect, useMemo, useRef, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import {
  fetchPlacedBets,
  importPlacedBets,
  BOOK_LABELS,
  type PlacedBetRow,
  type BetBook,
  type BetType,
  type NewPlacedBet,
} from "../lib/api/placedBets";
import { parsePlacedBetsCsv, PLACED_BETS_CSV_TEMPLATE, type PlacedBetImportError } from "../lib/api/placedBetsImport";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { pickLine } from "../lib/matchupsCompute";
import { moneylineToImpliedWinPct } from "../lib/odds";
import { fetchPoolBalanceSummary, type PoolBalanceSummary } from "../lib/api/poolBalanceSummary";

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
function betProfit(bet: PlacedBetRow): number | null {
  if (bet.result === "pending" || bet.stake == null) return null;
  if (bet.result === "push") return 0;
  if (bet.result === "loss") return -bet.stake;
  if (bet.to_win != null) return bet.to_win;
  return bet.price > 0 ? bet.stake * (bet.price / 100) : bet.stake * (100 / Math.abs(bet.price));
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
  const [bets, setBets] = useState<PlacedBetRow[]>([]);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [poolSummary, setPoolSummary] = useState<PoolBalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchPlacedBets(season), fetchGamesWithLines(season), fetchPoolBalanceSummary(season)])
      .then(([betRows, gameRows, summary]) => {
        setBets(betRows);
        setGames(gameRows);
        setPoolSummary(summary);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [season, reloadTick]);

  const gamesById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const availableWeeks = useMemo(() => Array.from(new Set(bets.map((b) => b.week))).sort((a, b) => a - b), [bets]);
  const visibleBets = useMemo(() => (week === "all" ? bets : bets.filter((b) => b.week === week)), [bets, week]);

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

      {!loading && visibleBets.length > 0 && (
        <>
          <h3 style={{ marginBottom: "0.5rem" }}>Bets</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.5rem" }}>
            <RecordSummary label="Overall" rec={overall} />
            {Array.from(byBook.entries()).map(([book, rec]) => (
              <RecordSummary key={book} label={BOOK_LABELS[book] ?? book} rec={rec} />
            ))}
            {Array.from(byType.entries()).map(([type, rec]) => (
              <RecordSummary key={type} label={type.replace("_", " ")} rec={rec} />
            ))}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Placed</th>
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
                      <td style={{ padding: "0.35rem 0.6rem" }}>
                        <TeamLogo team={bet.away_team} size={16} /> {bet.away_team} @ <TeamLogo team={bet.home_team} size={16} /> {bet.home_team}
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
