import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchPlacedBets, BOOK_LABELS, type PlacedBetRow } from "../lib/api/placedBets";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { pickLine } from "../lib/matchupsCompute";
import { moneylineToImpliedWinPct } from "../lib/odds";

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

  // moneyline
  const isAway = bet.side === game.away_team;
  const currentPrice = isAway ? line.away_moneyline : line.home_moneyline;
  if (currentPrice == null) return { currentLine: null, clv: null, favorable: null };
  const myImplied = moneylineToImpliedWinPct(bet.price);
  const currentImplied = moneylineToImpliedWinPct(currentPrice);
  if (myImplied == null || currentImplied == null) return { currentLine: currentPrice, clv: null, favorable: null };
  const clvPct = (currentImplied - myImplied) * 100;
  return { currentLine: currentPrice, clv: clvPct, favorable: clvPct > 0 };
}

export default function PlacedBetsPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [bets, setBets] = useState<PlacedBetRow[]>([]);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchPlacedBets(season), fetchGamesWithLines(season)])
      .then(([betRows, gameRows]) => {
        setBets(betRows);
        setGames(gameRows);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [season]);

  const gamesById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Placed Bets</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Every bet logged from Admin Matchups' Bet checkbox — book, type, side, line, and price at the time you
        placed it. Closing Line Value is computed live against the currently-synced consensus line, which becomes a
        stable "closing" reference once a game has kicked off — no separate capture step needed.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && bets.length === 0 && <p style={{ color: "var(--chalk-dim)" }}>No bets logged for {season} yet.</p>}

      {!loading && bets.length > 0 && (
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
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => {
                const game = gamesById.get(bet.game_id);
                const clv = computeClv(bet, game);
                return (
                  <tr key={bet.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "0.35rem 0.6rem", color: "var(--chalk-dim)" }}>{fmtDate(bet.created_at)}</td>
                    <td style={{ padding: "0.35rem 0.6rem" }}>
                      <TeamLogo team={bet.away_team} size={16} /> {bet.away_team} @ <TeamLogo team={bet.home_team} size={16} /> {bet.home_team}
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem" }}>{BOOK_LABELS[bet.book] ?? bet.book}</td>
                    <td style={{ padding: "0.35rem 0.6rem", textTransform: "capitalize" }}>{bet.bet_type}</td>
                    <td style={{ padding: "0.35rem 0.6rem", textTransform: bet.bet_type === "total" ? "capitalize" : "none" }}>{bet.side}</td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
